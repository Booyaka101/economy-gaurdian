import express from 'express'

export default function registerAIRoutes(app, deps) {
  const {
    getAuctionsCache,
    normalizeAuctions,
    aggregateLocalSales,
    getDefaultSlug,
    buildFairMap,
  } = deps

  const router = express.Router()

  // Helper: build a simple order-book ladder for an itemId
  function buildLadder(itemId) {
    const cache = getAuctionsCache()
    const payload = cache?.data
    if (!payload) {return { ladder: [], totalQty: 0, source: 'none' }}
    // Prefer direct commodities branch if available, else normalize all
    const comm = payload?.commodities
    let rows = []
    if (Array.isArray(comm) && comm.length) {
      rows = comm.filter(x => Number(x?.item?.id || x?.itemId) === Number(itemId)).map(x => ({
        unitPrice: Number(x.unit_price ?? x.unitPrice ?? 0),
        quantity: Number(x.quantity ?? x.quantity_total ?? 0),
      }))
    } else {
      const flat = normalizeAuctions(payload)
      rows = flat.filter(a => a.itemId === Number(itemId)).map(a => ({ unitPrice: a.unitPrice, quantity: a.quantity }))
    }
    // Aggregate by unitPrice and sort ascending
    const map = new Map()
    for (const r of rows) {
      if (!Number.isFinite(r.unitPrice) || !Number.isFinite(r.quantity)) {continue}
      map.set(r.unitPrice, (map.get(r.unitPrice) || 0) + r.quantity)
    }
    const ladder = [...map.entries()].map(([price, qty]) => ({ price, qty })).sort((a,b) => a.price - b.price)
    const totalQty = ladder.reduce((s, x) => s + x.qty, 0)
    return { ladder, totalQty, source: Array.isArray(comm) && comm.length ? 'commodities' : 'auctions' }
  }

  // Helper: estimate sell-through rate (qty/day)
  function estimateSoldPerDay(itemId, hoursWindow) {
    const hours = Math.max(1, Number(hoursWindow || 48))
    const agg = aggregateLocalSales(hours)
    const v = agg.get(Number(itemId))
    const qty = Number(v?.qty || 0)
    return qty / Math.max(1e-6, hours / 24)
  }

  // GET /market/eta?itemId=&stack=&price=&hoursWindow=
  router.get('/market/eta', (req, res) => {
    try {
      const itemId = Number(req.query.itemId)
      const stack = Math.max(1, Number(req.query.stack || 1))
      let price = Math.max(0, Number(req.query.price || 0))
      const hoursWindow = Math.max(1, Number(req.query.hoursWindow || 48))
      if (!itemId) {return res.status(400).json({ error: 'missing_itemId' })}
      const { ladder } = buildLadder(itemId)
      if ((price <= 0 || !Number.isFinite(price)) && ladder && ladder.length) {
        price = ladder[0].price
      }
      // Determine queue position at given price (cumulative qty strictly cheaper + same price tie)
      let ahead = 0
      let same = 0
      for (const r of ladder) {
        if (r.price < price) {ahead += r.qty}
        else if (r.price === price) {same += r.qty}
        if (r.price > price) {break}
      }
      const rate = estimateSoldPerDay(itemId, hoursWindow)
      const effRatePerHour = rate / 24
      const p50 = effRatePerHour > 0 ? (ahead / effRatePerHour) : Infinity
      const p90 = effRatePerHour > 0 ? ((ahead + same + stack) / effRatePerHour) : Infinity
      const preview = ladder.slice(0, 10)
      return res.json({
        itemId,
        stack,
        price,
        hoursWindow,
        soldPerDay: Number(rate.toFixed(3)),
        queue: { aheadQty: ahead, samePriceQty: same },
        etaHours: { p50: isFinite(p50) ? Number(p50.toFixed(2)) : null, p90: isFinite(p90) ? Number(p90.toFixed(2)) : null },
        ladderPreview: preview,
      })
    } catch (e) {
      return res.status(500).json({ error: 'eta_failed', message: e?.message || String(e) })
    }
  })

  // GET /ai/surge-alerts?source=items|commodities&threshold=0.25&limit=30
  router.get('/ai/surge-alerts', (req, res) => {
    try {
      const source = String(req.query.source || 'commodities')
      const threshold = Math.max(0.01, Math.min(1.0, Number(req.query.threshold || 0.25)))
      const limit = Math.max(1, Math.min(200, Number(req.query.limit || 30)))
      const cache = getAuctionsCache()
      const prev = cache?.prev
      const now = cache?.data
      if (!prev || !now) {return res.json({ source, items: [] })}
      const summarize = (payload) => {
        const out = new Map()
        const comm = payload?.commodities
        if (source === 'commodities' && Array.isArray(comm) && comm.length) {
          for (const x of comm) {
            const id = Number(x?.item?.id || x?.itemId || 0)
            const q = Number(x?.quantity ?? x?.quantity_total ?? 0)
            const p = Number(x?.unit_price ?? x?.unitPrice ?? 0)
            if (!id) {continue}
            const v = out.get(id) || { min: Infinity, qty: 0 }
            v.min = Math.min(v.min, p)
            v.qty += q
            out.set(id, v)
          }
        } else {
          const flat = normalizeAuctions(payload)
          for (const a of flat) {
            const id = Number(a.itemId || 0)
            const q = Number(a.quantity || 0)
            const p = Number(a.unitPrice || 0)
            if (!id) {continue}
            const v = out.get(id) || { min: Infinity, qty: 0 }
            v.min = Math.min(v.min, p)
            v.qty += q
            out.set(id, v)
          }
        }
        return out
      }
      const mPrev = summarize(prev)
      const mNow = summarize(now)
      const events = []
      for (const [id, a] of mNow.entries()) {
        const b = mPrev.get(id)
        if (!b) {continue}
        const minDelta = (a.min - b.min) / Math.max(1, b.min)
        const qtyDelta = (a.qty - b.qty) / Math.max(1, b.qty)
        const score = Math.abs(minDelta) * 0.7 + Math.abs(qtyDelta) * 0.3
        if (score >= threshold) {
          events.push({ itemId: id, minPricePrev: b.min, minPriceNow: a.min, qtyPrev: b.qty, qtyNow: a.qty, score: Number(score.toFixed(3)) })
        }
      }
      events.sort((x,y) => y.score - x.score)
      return res.json({ source, count: events.length, items: events.slice(0, limit) })
    } catch (e) {
      return res.status(500).json({ error: 'surge_failed', message: e?.message || String(e) })
    }
  })

  // GET /ai/opportunities?hoursWindow=48&limit=20
  router.get('/ai/opportunities', (req, res) => {
    try {
      const hoursWindow = Math.max(1, Math.min(24*14, Number(req.query.hoursWindow || 48)))
      const limit = Math.max(1, Math.min(100, Number(req.query.limit || 20)))
      const cache = getAuctionsCache()
      const payload = cache?.data
      if (!payload) {return res.json({ items: [] })}
      // Build ladders for many items cheaply using normalizeAuctions
      const flat = normalizeAuctions(payload)
      const byItem = new Map()
      for (const a of flat) {
        const id = Number(a.itemId || 0)
        if (!id) {continue}
        const arr = byItem.get(id) || []
        arr.push({ unitPrice: Number(a.unitPrice||0), quantity: Number(a.quantity||0) })
        byItem.set(id, arr)
      }
      const demand = aggregateLocalSales(hoursWindow) // itemId -> { qty }
      const out = []
      for (const [id, arr] of byItem.entries()) {
        if (!arr || arr.length === 0) {continue}
        const m = new Map()
        for (const r of arr) { if (r.unitPrice>0 && r.quantity>0) {m.set(r.unitPrice, (m.get(r.unitPrice)||0)+r.quantity)} }
        const ladder = [...m.entries()].map(([price, qty]) => ({ price, qty })).sort((a,b)=>a.price-b.price)
        if (ladder.length < 2) {continue}
        const first = ladder[0], second = ladder[1]
        const gap = (second.price - first.price) / Math.max(1, first.price)
        const soldPerDay = (demand.get(id)?.qty || 0) / Math.max(1e-6, hoursWindow/24)
        if (soldPerDay <= 0) {continue}
        const estHoursAtFirst = first.qty / (soldPerDay/24)
        // Score favors big price gaps, low first-qty (thin), and decent demand
        const score = gap * 0.7 + Math.max(0, 1 - Math.tanh(first.qty / (soldPerDay*0.5))) * 0.3
        out.push({ itemId: id, bestPrice: first.price, nextPrice: second.price, gapPct: Number((gap*100).toFixed(2)), firstQty: first.qty, soldPerDay: Number(soldPerDay.toFixed(2)), etaHoursAtBest: Number(estHoursAtFirst.toFixed(1)), score: Number(score.toFixed(3)) })
      }
      out.sort((a,b)=> b.score - a.score)
      return res.json({ hoursWindow, count: out.length, items: out.slice(0, limit) })
    } catch (e) {
      return res.status(500).json({ error: 'opportunities_failed', message: e?.message || String(e) })
    }
  })

  // GET /ai/price-advice?itemId=&hoursWindow=48
  router.get('/ai/price-advice', async (req, res) => {
    try {
      const itemId = Number(req.query.itemId || 0)
      const hoursWindow = Math.max(1, Math.min(24*14, Number(req.query.hoursWindow || 48)))
      if (!itemId) {return res.status(400).json({ error: 'missing_itemId' })}
      const { ladder } = buildLadder(itemId)
      const soldPerDay = estimateSoldPerDay(itemId, hoursWindow)
      const slug = getDefaultSlug()
      let fair = null
      try { fair = await buildFairMap([itemId], slug) } catch {}
      const fairVal = fair ? Number(fair[itemId] || fair[String(itemId)] || 0) : 0
      let target = ladder && ladder.length ? ladder[0].price : fairVal
      if (fairVal>0 && target>0) {
        // Blend toward fair within 60%-105%
        const low = Math.floor(fairVal*0.60)
        const high = Math.floor(fairVal*1.05)
        target = Math.max(low, Math.min(high, target))
      }
      const stack = Math.min(200, Math.max(1, Math.round(Math.max(5, soldPerDay*2))))
      const ahead = ladder.reduce((s,r)=> s + (r.price < target ? r.qty : 0), 0)
      const same = ladder.reduce((s,r)=> s + (r.price === target ? r.qty : 0), 0)
      const etaP50 = soldPerDay>0 ? (ahead / (soldPerDay/24)) : null
      const etaP90 = soldPerDay>0 ? ((ahead + same + stack) / (soldPerDay/24)) : null
      return res.json({ itemId, fair: fairVal||null, targetPrice: target||null, stack, soldPerDay: Number(soldPerDay.toFixed(2)), etaHours: { p50: etaP50!=null?Number(etaP50.toFixed(1)):null, p90: etaP90!=null?Number(etaP90.toFixed(1)):null }, ladderPreview: (ladder||[]).slice(0,10) })
    } catch (e) {
      return res.status(500).json({ error: 'price_advice_failed', message: e?.message || String(e) })
    }
  })

  // POST /ml/policy/recommend { itemId, targetHours, maxStack, hoursWindow }
  router.post('/ml/policy/recommend', express.json(), (req, res) => {
    try {
      const { itemId, targetHours = 12, maxStack = 200, hoursWindow = 48 } = req.body || {}
      if (!itemId) {return res.status(400).json({ error: 'missing_itemId' })}
      const { ladder } = buildLadder(Number(itemId))
      const rate = estimateSoldPerDay(Number(itemId), Number(hoursWindow))
      const effRatePerHour = rate / 24
      if (!(effRatePerHour > 0)) {
        return res.json({ itemId: Number(itemId), recommend: null, rationale: 'Insufficient sell-through' })
      }
      // Find lowest price where ETA p90 <= targetHours for a single stack; allow limited undercut
      let cum = 0
      let chosen = null
      for (const r of ladder) {
        const etaP90 = (cum + r.qty + Math.min(maxStack, r.qty)) / effRatePerHour
        if (etaP90 <= targetHours) { chosen = r.price; break }
        cum += r.qty
      }
      // If not found, slightly undercut the best price and compute ETA at that level
      if (chosen == null && ladder.length) {
        chosen = Math.max(0, ladder[0].price - 1)
      }
      const stack = Math.min(maxStack,  stackSizeHint(Number(itemId)))
      const ahead = ladder.reduce((s, r) => s + (r.price < chosen ? r.qty : 0), 0)
      const same = ladder.reduce((s, r) => s + (r.price === chosen ? r.qty : 0), 0)
      const etaP50 = ahead / effRatePerHour
      const etaP90 = (ahead + same + stack) / effRatePerHour
      return res.json({
        itemId: Number(itemId),
        recommend: chosen != null ? { price: chosen, stack } : null,
        etaHours: { p50: isFinite(etaP50) ? Number(etaP50.toFixed(2)) : null, p90: isFinite(etaP90) ? Number(etaP90.toFixed(2)) : null },
        used: { targetHours: Number(targetHours), hoursWindow: Number(hoursWindow), soldPerDay: Number(rate.toFixed(3)) },
        rationale: chosen != null ? 'Chosen to meet target ETA by queue position and sell-through' : 'No viable price found; market too slow',
      })
    } catch (e) {
      return res.status(500).json({ error: 'policy_failed', message: e?.message || String(e) })
    }
  })

  // Simple heuristic for commodity stack sizes
  function stackSizeHint(itemId) {
    // Could look up max stack size from catalog later; default to commodity-friendly sizes
    const common = new Set([
      124444, // Infernal Brimstone (example)
    ])
    return common.has(Number(itemId)) ? 200 : 200
  }

  // GET /ml/detect/change-points?source=items|commodities&threshold=0.2
  router.get('/ml/detect/change-points', (req, res) => {
    try {
      const source = String(req.query.source || 'commodities')
      const threshold = Math.max(0.01, Math.min(1.0, Number(req.query.threshold || 0.2)))
      const cache = getAuctionsCache()
      const prev = cache?.prev
      const now = cache?.data
      if (!prev || !now) {return res.json({ source, events: [] })}
      // Compute change score per item: combine min price delta and quantity delta
      const summarize = (payload) => {
        const out = new Map() // itemId -> { min, qty }
        const comm = payload?.commodities
        if (Array.isArray(comm) && comm.length) {
          for (const x of comm) {
            const id = Number(x?.item?.id || x?.itemId || 0)
            const q = Number(x?.quantity ?? x?.quantity_total ?? 0)
            const p = Number(x?.unit_price ?? x?.unitPrice ?? 0)
            if (!id) {continue}
            const v = out.get(id) || { min: Infinity, qty: 0 }
            v.min = Math.min(v.min, p)
            v.qty += q
            out.set(id, v)
          }
        } else {
          const flat = normalizeAuctions(payload)
          for (const a of flat) {
            const id = Number(a.itemId || 0)
            const q = Number(a.quantity || 0)
            const p = Number(a.unitPrice || 0)
            if (!id) {continue}
            const v = out.get(id) || { min: Infinity, qty: 0 }
            v.min = Math.min(v.min, p)
            v.qty += q
            out.set(id, v)
          }
        }
        return out
      }
      const mPrev = summarize(prev)
      const mNow = summarize(now)
      const events = []
      for (const [id, a] of mNow.entries()) {
        const b = mPrev.get(id)
        if (!b) {continue}
        const minDelta = (a.min - b.min) / Math.max(1, b.min)
        const qtyDelta = (a.qty - b.qty) / Math.max(1, b.qty)
        const score = Math.abs(minDelta) * 0.7 + Math.abs(qtyDelta) * 0.3
        if (score >= threshold) {
          events.push({ itemId: id, minPricePrev: b.min, minPriceNow: a.min, qtyPrev: b.qty, qtyNow: a.qty, score: Number(score.toFixed(3)) })
        }
      }
      events.sort((x,y) => y.score - x.score)
      return res.json({ source, count: events.length, events: events.slice(0, 100) })
    } catch (e) {
      return res.status(500).json({ error: 'changepoints_failed', message: e?.message || String(e) })
    }
  })

  app.use(router)
}
