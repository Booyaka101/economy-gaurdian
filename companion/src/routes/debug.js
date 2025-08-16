// Debug routes module
// Provides: /debug/sales, /debug/sales/raw, /debug/sales/raw-item
//           /debug/auctions/kinds, /debug/auctions/item, /debug/auctions/sample

export default function registerDebugRoutes(app, deps) {
  const {
    getAuctionsCache,
    normalizeAuctions,
    getSalesEvents,
    getLastTrackSummary,
    aggregateLocalSales,
  } = deps

  // Lightweight fingerprint of prev/now snapshots for change detection
  // Returns counts and simple quantity sums without materializing large normalized arrays
  app.get('/debug/auctions/fingerprint', (_req, res) => {
    try {
      const cache = getAuctionsCache()
      const prev = cache?.prev || null
      const now = cache?.data || null
      const fp = (snap) => {
        if (!snap) {return null}
        const itemsArr = Array.isArray(snap?.auctions?.auctions) ? snap.auctions.auctions : (Array.isArray(snap?.auctions) ? snap.auctions : [])
        const commsArr = Array.isArray(snap?.commodities) ? snap.commodities : []
        let qtyItems = 0
        let hashItems = 0
        for (let i = 0; i < itemsArr.length; i++) {
          const x = itemsArr[i]
          const id = Number(x?.item?.id || x?.itemId || 0)
          const q = Number(x?.quantity || 0)
          const u = Number(x?.unit_price || x?.unitPrice || x?.buyout || 0)
          qtyItems += q
          // simple rolling hash
          hashItems = (hashItems * 1103515245 + ((id * 31 + u * 7 + q * 13) >>> 0) + 12345) >>> 0
        }
        let qtyComms = 0
        let hashComms = 0
        for (let i = 0; i < commsArr.length; i++) {
          const x = commsArr[i]
          const id = Number(x?.item?.id || x?.itemId || 0)
          const q = Number(x?.quantity || x?.quantity_total || 0)
          const u = Number(x?.unit_price || x?.unitPrice || x?.buyout || 0)
          qtyComms += q
          hashComms = (hashComms * 1103515245 + ((id * 31 + u * 7 + q * 13) >>> 0) + 12345) >>> 0
        }
        return {
          lastFetched: cache?.lastFetched || 0,
          items: itemsArr.length,
          commodities: commsArr.length,
          total: itemsArr.length + commsArr.length,
          qtyItems,
          qtyCommodities: qtyComms,
          qtyTotal: qtyItems + qtyComms,
          itemsHash: hashItems >>> 0,
          commoditiesHash: hashComms >>> 0,
          totalHash: ((hashItems ^ hashComms) >>> 0),
        }
      }
      return res.json({ prev: fp(prev), now: fp(now) })
    } catch (e) {
      return res.status(500).json({ error: 'fingerprint_failed', message: e?.message || String(e) })
    }
  })

  // Sales debug: summary and last tracking info
  app.get('/debug/sales', (req, res) => {
    try {
      const hours = Math.max(1, Math.min(24 * 7, Number(req.query.hours || 48)))
      const agg = aggregateLocalSales(hours)
      const top = [...agg.entries()]
        .map(([itemId, v]) => ({ itemId: Number(itemId), qty: v.qty, cnt: v.cnt }))
        .sort((a,b) => b.qty - a.qty)
        .slice(0, 50)
      return res.json({ hours, events: getSalesEvents().length, lastTrackSummary: getLastTrackSummary(), top })
    } catch (e) {
      return res.status(500).json({ error: 'sales_debug_failed', message: e?.message || String(e) })
    }
  })

  // RAW arrays: delta preview without normalization
  app.get('/debug/auctions/delta/preview-raw', (req, res) => {
    try {
      const cache = getAuctionsCache()
      const prev = cache?.prev || null
      const now = cache?.data || null
      if (!prev || !now) {return res.status(404).json({ error: 'no_prev_or_now', message: 'Need at least two snapshots' })}
      const concat = (snap) => {
        const arr = []
        const a1 = Array.isArray(snap?.auctions) ? snap.auctions : []
        const a2 = Array.isArray(snap?.commodities) ? snap.commodities : []
        for (let i = 0; i < a1.length; i++) {arr.push(a1[i])}
        for (let i = 0; i < a2.length; i++) {arr.push(a2[i])}
        return arr
      }
      const prevArr = concat(prev)
      const nowArr = concat(now)
      const ended = (() => {
        const nowIds = new Set()
        for (let i = 0; i < nowArr.length; i++) {nowIds.add(nowArr[i]?.id || nowArr[i]?.auctionId)}
        let c = 0
        for (let i = 0; i < prevArr.length; i++) {
          const id = prevArr[i]?.id || prevArr[i]?.auctionId
          if (!nowIds.has(id)) {c++}
        }
        return c
      })()
      // itemId:unitPrice buckets by summing quantities
      const sumIP = (arr) => {
        const m = new Map()
        for (let i = 0; i < arr.length; i++) {
          const x = arr[i]
          const id = Number(x?.item?.id || x?.itemId)
          const qty = Number(x?.quantity || x?.quantity_total || 0)
          const unit = Number(x?.unit_price || x?.unitPrice || x?.buyout || 0)
          if (!id || !Number.isFinite(qty) || qty <= 0) {continue}
          const key = `${id}:${unit}`
          m.set(key, (m.get(key) || 0) + qty)
        }
        return m
      }
      const prevIP = sumIP(prevArr)
      const nowIP = sumIP(nowArr)
      let priceBucketDrops = 0
      for (const [k, v] of prevIP.entries()) {
        const c = Number(nowIP.get(k) || 0)
        if (Number.isFinite(v) && Number.isFinite(c) && c < v) {priceBucketDrops++}
      }
      const sumItem = (arr) => {
        const m = new Map()
        for (let i = 0; i < arr.length; i++) {
          const x = arr[i]
          const id = Number(x?.item?.id || x?.itemId)
          const qty = Number(x?.quantity || x?.quantity_total || 0)
          if (!id || !Number.isFinite(qty) || qty <= 0) {continue}
          m.set(id, (m.get(id) || 0) + qty)
        }
        return m
      }
      const prevItem = sumItem(prevArr)
      const nowItem = sumItem(nowArr)
      let itemTotalDrops = 0
      for (const [id, v] of prevItem.entries()) {
        const c = Number(nowItem.get(id) || 0)
        if (Number.isFinite(v) && Number.isFinite(c) && c < v) {itemTotalDrops++}
      }
      return res.json({ prevCount: prevArr.length, nowCount: nowArr.length, endedCount: ended, priceBucketDrops, itemTotalDrops })
    } catch (e) {
      return res.status(500).json({ error: 'delta_preview_raw_failed', message: e?.message || String(e) })
    }
  })

  // RAW arrays: per-item diff
  app.get('/debug/auctions/preview-diff-raw', (req, res) => {
    try {
      const itemId = Number(req.query.itemId || 0)
      if (!itemId) {return res.status(400).json({ error: 'missing_itemId' })}
      const cache = getAuctionsCache()
      const prev = cache?.prev || null
      const now = cache?.data || null
      if (!prev || !now) {return res.status(404).json({ error: 'no_prev_or_now', message: 'Need at least two snapshots' })}
      const concat = (snap) => {
        const a1 = Array.isArray(snap?.auctions) ? snap.auctions : []
        const a2 = Array.isArray(snap?.commodities) ? snap.commodities : []
        return { a1, a2 }
      }
      const { a1: p1, a2: p2 } = concat(prev)
      const { a1: n1, a2: n2 } = concat(now)
      const filterByItem = (arr) => {
        const out = []
        for (let i = 0; i < arr.length; i++) {
          const x = arr[i]
          const id = Number(x?.item?.id || x?.itemId)
          if (id === itemId) {out.push(x)}
        }
        return out
      }
      const prevArr = [...filterByItem(p1), ...filterByItem(p2)]
      const nowArr = [...filterByItem(n1), ...filterByItem(n2)]
      const sumQty = (arr) => arr.reduce((s, x) => s + Number(x?.quantity || x?.quantity_total || 0), 0)
      const prevQty = sumQty(prevArr)
      const nowQty = sumQty(nowArr)
      const bucket = (arr) => {
        const m = new Map()
        for (let i = 0; i < arr.length; i++) {
          const x = arr[i]
          const unit = Number(x?.unit_price || x?.unitPrice || x?.buyout || 0)
          const q = Number(x?.quantity || x?.quantity_total || 0)
          if (!Number.isFinite(q) || q <= 0) {continue}
          const key = `${itemId}:${unit}`
          m.set(key, (m.get(key) || 0) + q)
        }
        return m
      }
      const prevIP = bucket(prevArr)
      const nowIP = bucket(nowArr)
      const priceBuckets = []
      for (const [k, v] of prevIP.entries()) {
        const c = Number(nowIP.get(k) || 0)
        if (Number.isFinite(v) && Number.isFinite(c) && c < v) {priceBuckets.push({ key: k, prevQty: v, nowQty: c, delta: v - c })}
      }
      return res.json({ itemId, prevQty, nowQty, totalDelta: prevQty - nowQty, priceBuckets })
    } catch (e) {
      return res.status(500).json({ error: 'preview_diff_raw_failed', message: e?.message || String(e) })
    }
  })

  // Preview prev->now deltas (diagnostics only; does not mutate state)
  app.get('/debug/auctions/delta/preview', (req, res) => {
    try {
      const cache = getAuctionsCache()
      const prev = cache?.prev || null
      const now = cache?.data || null
      if (!prev || !now) {return res.status(404).json({ error: 'no_prev_or_now', message: 'Need at least two snapshots' })}
      const prevList = normalizeAuctions(prev)
      const nowList = normalizeAuctions(now)
      const nowById = new Map(nowList.map(a => [a.auctionId, a]))
      const nowIds = new Set(nowList.map(a => a.auctionId))
      const ended = prevList.filter(a => !nowIds.has(a.auctionId))
      let partialAdds = 0
      for (const p of prevList) {
        const cur = nowById.get(p.auctionId)
        if (!cur) {continue}
        const pQty = Number(p.quantity || 0)
        const cQty = Number(cur.quantity || 0)
        if (Number.isFinite(pQty) && Number.isFinite(cQty) && cQty < pQty) {partialAdds++}
      }
      const sumByIP = (arr) => {
        const m = new Map()
        for (let i = 0; i < arr.length; i++) {
          const a = arr[i]
          const id = a && a.itemId
          const q = Number(a && a.quantity || 0)
          const p = Number(a && a.unitPrice || 0)
          if (!id || !Number.isFinite(q) || q <= 0) {continue}
          const key = `${id}:${p}`
          m.set(key, (m.get(key) || 0) + q)
        }
        return m
      }
      const prevIP = sumByIP(prevList)
      const nowIP = sumByIP(nowList)
      let ipDrops = 0
      for (const [k, v] of prevIP.entries()) {
        const c = Number(nowIP.get(k) || 0)
        if (Number.isFinite(v) && Number.isFinite(c) && c < v) {ipDrops++}
      }
      const sumByItem = (arr) => {
        const m = new Map()
        for (let i = 0; i < arr.length; i++) {
          const a = arr[i]
          const id = a && a.itemId
          const q = Number(a && a.quantity || 0)
          if (!id || !Number.isFinite(q) || q <= 0) {continue}
          m.set(id, (m.get(id) || 0) + q)
        }
        return m
      }
      const prevByItem = sumByItem(prevList)
      const nowByItem = sumByItem(nowList)
      let itemDrops = 0
      const sample = []
      for (const [itemId, pQty] of prevByItem.entries()) {
        const cQty = Number(nowByItem.get(itemId) || 0)
        if (Number.isFinite(pQty) && Number.isFinite(cQty) && cQty < pQty) {
          itemDrops++
          if (sample.length < 20) {sample.push({ itemId: Number(itemId), delta: pQty - cQty, prevQty: pQty, nowQty: cQty })}
        }
      }
      return res.json({ prevCount: prevList.length, nowCount: nowList.length, endedCount: ended.length, partialAdds, priceBucketDrops: ipDrops, itemTotalDrops: itemDrops, sample })
    } catch (e) {
      return res.status(500).json({ error: 'delta_preview_failed', message: e?.message || String(e) })
    }
  })

  // Per-item preview diff (does not mutate state)
  app.get('/debug/sales/preview-diff', (req, res) => {
    try {
      const itemId = Number(req.query.itemId || 0)
      if (!itemId) {return res.status(400).json({ error: 'missing_itemId' })}
      const cache = getAuctionsCache()
      const prev = cache?.prev || null
      const now = cache?.data || null
      if (!prev || !now) {return res.status(404).json({ error: 'no_prev_or_now', message: 'Need at least two snapshots' })}
      const prevList = normalizeAuctions(prev).filter(a => Number(a.itemId) === itemId)
      const nowList = normalizeAuctions(now).filter(a => Number(a.itemId) === itemId)
      const nowById = new Map(nowList.map(a => [a.auctionId, a]))
      const partial = []
      for (const p of prevList) {
        const cur = nowById.get(p.auctionId)
        if (!cur) {continue}
        const pQty = Number(p.quantity || 0)
        const cQty = Number(cur.quantity || 0)
        if (Number.isFinite(pQty) && Number.isFinite(cQty) && cQty < pQty) {partial.push({ auctionId: p.auctionId, prevQty: pQty, nowQty: cQty, delta: pQty - cQty })}
      }
      const sumByIP = (arr) => {
        const m = new Map()
        for (let i = 0; i < arr.length; i++) {
          const a = arr[i]
          const q = Number(a && a.quantity || 0)
          const p = Number(a && a.unitPrice || 0)
          const key = `${itemId}:${p}`
          if (!Number.isFinite(q) || q <= 0) {continue}
          m.set(key, (m.get(key) || 0) + q)
        }
        return m
      }
      const prevIP = sumByIP(prevList)
      const nowIP = sumByIP(nowList)
      const priceBuckets = []
      for (const [k, v] of prevIP.entries()) {
        const c = Number(nowIP.get(k) || 0)
        if (Number.isFinite(v) && Number.isFinite(c) && c < v) {priceBuckets.push({ key: k, prevQty: v, nowQty: c, delta: v - c })}
      }
      const sum = (arr) => arr.reduce((s, a) => s + Number(a.quantity || 0), 0)
      const prevQty = sum(prevList)
      const nowQty = sum(nowList)
      const totalDelta = prevQty - nowQty
      return res.json({ itemId, partialCount: partial.length, priceBucketDrops: priceBuckets.length, totalDelta: totalDelta > 0 ? totalDelta : 0, partial, priceBuckets })
    } catch (e) {
      return res.status(500).json({ error: 'preview_diff_failed', message: e?.message || String(e) })
    }
  })

  // Inspect a raw commodity auction element by itemId
  app.get('/debug/auctions/commodities/raw-sample', (req, res) => {
    try {
      const itemId = Number(req.query.itemId)
      if (!itemId) {return res.status(400).json({ error: 'missing_itemId' })}
      const cache = getAuctionsCache()
      const payload = cache?.data
      if (!payload) {return res.status(404).json({ error: 'no_snapshot' })}
      const coTop = payload && payload.commodities
      const coArr = Array.isArray(coTop) ? coTop : (coTop && Array.isArray(coTop.auctions) ? coTop.auctions : [])
      let found = null
      for (let i = 0; i < coArr.length; i++) {
        const a = coArr[i]
        if (!a || typeof a !== 'object') {continue}
        const it = a.item
        const id = (it && typeof it === 'object' && it.id != null) ? Number(it.id)
          : (a.itemId != null ? Number(a.itemId) : (a.item_id != null ? Number(a.item_id) : 0))
        if (id === itemId) { found = a; break }
      }
      if (!found) {return res.json({ itemId, found: false })}
      const keys = Object.keys(found)
      const diag = {
        has_item_obj: !!found.item,
        item_keys: found.item ? Object.keys(found.item) : [],
        has_quantity: Object.prototype.hasOwnProperty.call(found, 'quantity'),
        has_unit_price: Object.prototype.hasOwnProperty.call(found, 'unit_price'),
        has_buyout: Object.prototype.hasOwnProperty.call(found, 'buyout'),
        type_of_item: typeof found.item,
      }
      // return a trimmed element to avoid huge payloads
      const trimmed = {}
      for (const k of keys) {
        if (k === 'item' || k === 'quantity' || k === 'unit_price' || k === 'buyout' || k === 'id' || k === 'auction_id') {
          trimmed[k] = found[k]
        }
      }
      return res.json({ itemId, found: true, keys, diag, trimmed })
    } catch (e) {
      return res.status(500).json({ error: 'commodities_raw_sample_failed', message: e?.message || String(e) })
    }
  })

  // Deep normalization diagnostics
  app.get('/debug/auctions/normalize/diag', (req, res) => {
    try {
      const payload = getAuctionsCache().data
      if (!payload) {return res.status(404).json({ error: 'no_snapshot' })}
      const au1 = payload?.auctions
      const co1 = payload?.commodities
      const lenAu = Array.isArray(au1) ? au1.length : (Array.isArray(au1?.auctions) ? au1.auctions.length : 0)
      const lenCo = Array.isArray(co1) ? co1.length : (Array.isArray(co1?.auctions) ? co1.auctions.length : 0)
      return res.json({
        au_is_array: Array.isArray(au1),
        au_has_nested: Array.isArray(au1?.auctions),
        co_is_array: Array.isArray(co1),
        co_has_nested: Array.isArray(co1?.auctions),
        len_au: lenAu,
        len_co: lenCo,
        note: 'normalized_count omitted (heavy) to avoid stack issues; use sample endpoint total as estimate',
      })
    } catch (e) {
      return res.status(500).json({ error: 'normalize_diag_failed', message: e?.message || String(e) })
    }
  })

  // Auctions debug: sample normalized-like entries and total count (lightweight, no heavy normalization)
  app.get('/debug/auctions/normalized/sample', (req, res) => {
    try {
      const n = Math.max(1, Math.min(20, Number(req.query.n || 5)))
      const cache = getAuctionsCache()
      if (!cache.data) {return res.status(404).json({ error: 'no_snapshot' })}
      const payload = cache.data
      const auTop = payload && payload.auctions
      const coTop = payload && payload.commodities
      const auArr = Array.isArray(auTop) ? auTop : (auTop && Array.isArray(auTop.auctions) ? auTop.auctions : [])
      const coArr = Array.isArray(coTop) ? coTop : (coTop && Array.isArray(coTop.auctions) ? coTop.auctions : [])
      const diag = {
        hasAuctions: !!auTop,
        hasCommodities: !!coTop,
        auctionsIsArray: Array.isArray(auTop),
        auctionsHasAuctionsArray: Array.isArray(auTop?.auctions),
        commoditiesIsArray: Array.isArray(coTop),
        commoditiesHasAuctionsArray: Array.isArray(coTop?.auctions),
        lenAu: auArr.length,
        lenCo: coArr.length,
      }
      const mapOne = (a) => {
        try {
          if (!a || typeof a !== 'object') {return null}
          const auctionId = Number(a.id != null ? a.id : (a.auction_id != null ? a.auction_id : (a.auctionId != null ? a.auctionId : 0)))
          let itemId = 0
          const it = a.item
          if (it && typeof it === 'object' && it.id != null) {itemId = Number(it.id)}
          else if (a.itemId != null) {itemId = Number(a.itemId)}
          else if (a.item_id != null) {itemId = Number(a.item_id)}
          const quantity = Number(a.quantity != null ? a.quantity : 0)
          const unitPrice = Number(a.unit_price != null ? a.unit_price : (a.buyout != null ? a.buyout : 0))
          if (!itemId || !quantity) {return null}
          return { auctionId, itemId, quantity, unitPrice }
        } catch { return null }
      }
      const sample = []
      for (let i = 0; i < auArr.length && sample.length < n; i++) { const m = mapOne(auArr[i]); if (m) {sample.push(m)} }
      for (let i = 0; i < coArr.length && sample.length < n; i++) { const m = mapOne(coArr[i]); if (m) {sample.push(m)} }
      // Estimate total by counting entries with minimally valid shape without materializing an intermediate array
      let total = 0
      for (let i = 0; i < auArr.length; i++) { if (mapOne(auArr[i])) {total++} }
      for (let i = 0; i < coArr.length; i++) { if (mapOne(coArr[i])) {total++} }
      return res.json({ total, sample, diag })
    } catch (e) {
      return res.status(500).json({ error: 'auctions_normalized_sample_failed', message: e?.message || String(e) })
    }
  })

  // Auctions debug: check presence across raw arrays and normalized
  app.get('/debug/auctions/has-item', (req, res) => {
    try {
      const cache = getAuctionsCache()
      const itemId = Number(req.query.itemId || 0)
      if (!itemId) {return res.status(400).json({ error: 'missing_itemId' })}
      if (!cache.data) {return res.status(404).json({ error: 'no_snapshot' })}
      const itemsRaw = cache.data?.auctions?.auctions || cache.data?.auctions || []
      const commsRaw = cache.data?.commodities || []
      const inItems = itemsRaw.filter(a => Number(a?.item?.id || a?.itemId || a?.item_id) === itemId).length
      const inComms = commsRaw.filter(a => Number(a?.item?.id || a?.itemId || a?.item_id) === itemId).length
      const norm = normalizeAuctions(cache.data)
      const inNorm = norm.filter(a => Number(a.itemId) === itemId).length
      return res.json({ itemId, inItems, inCommodities: inComms, inNormalized: inNorm })
    } catch (e) {
      return res.status(500).json({ error: 'auctions_has_item_failed', message: e?.message || String(e) })
    }
  })

  // Sales debug: raw recent events
  app.get('/debug/sales/raw', (req, res) => {
    try {
      const limit = Math.max(1, Math.min(5000, Number(req.query.limit || 200)))
      const ev = getSalesEvents()
      const out = ev.slice(-limit)
      return res.json({ count: out.length, items: out })
    } catch (e) {
      return res.status(500).json({ error: 'sales_raw_failed', message: e?.message || String(e) })
    }
  })

  // Sales debug: raw recent events for a specific item
  app.get('/debug/sales/raw-item', (req, res) => {
    try {
      const itemId = Number(req.query.itemId || 0)
      if (!itemId) {return res.status(400).json({ error: 'missing_itemId' })}
      const limit = Math.max(1, Math.min(1000, Number(req.query.limit || 50)))
      const ev = getSalesEvents()
      const filtered = []
      for (let i = ev.length - 1; i >= 0 && filtered.length < limit; i--) {
        const e = ev[i]
        if (Number(e.itemId) === itemId) {filtered.push(e)}
      }
      return res.json({ count: filtered.length, items: filtered })
    } catch (e) {
      return res.status(500).json({ error: 'sales_raw_item_failed', message: e?.message || String(e) })
    }
  })

  // Auctions debug: split counts for items vs commodities
  app.get('/debug/auctions/kinds', (_req, res) => {
    try {
      const cache = getAuctionsCache()
      if (!cache.data) {return res.json({ items: 0, commodities: 0, total: 0 })}
      const a1 = cache.data?.auctions?.auctions || cache.data?.auctions || []
      const a2 = cache.data?.commodities || []
      const items = Array.isArray(a1) ? a1.length : 0
      const commodities = Array.isArray(a2) ? a2.length : 0
      return res.json({ items, commodities, total: items + commodities })
    } catch (e) {
      return res.status(500).json({ error: 'auctions_kinds_failed', message: e?.message || String(e) })
    }
  })

  // Auctions debug: sample raw entries (items or commodities)
  app.get('/debug/auctions/sample', (req, res) => {
    try {
      const cache = getAuctionsCache()
      if (!cache.data) {return res.status(404).json({ error: 'no_snapshot' })}
      const type = String(req.query.type || 'any').toLowerCase()
      const n = Math.max(1, Math.min(20, Number(req.query.n || 5)))
      const items = cache.data?.auctions?.auctions || cache.data?.auctions || []
      const comms = cache.data?.commodities || []
      let src = []
      if (type === 'items') {src = items}
      else if (type === 'commodities') {src = comms}
      else {src = [...(Array.isArray(items) ? items : []), ...(Array.isArray(comms) ? comms : [])]}
      const out = []
      for (let i = 0; i < Math.min(n, src.length); i++) {
        const a = src[i]
        out.push({
          keys: Object.keys(a || {}),
          id: a?.id ?? a?.auction_id ?? a?.auctionId,
          itemId: a?.item?.id ?? a?.itemId ?? a?.item_id,
          quantity: a?.quantity,
          unit_price: a?.unit_price,
          buyout: a?.buyout,
        })
      }
      return res.json({ type, count: out.length, items: out })
    } catch (e) {
      return res.status(500).json({ error: 'auctions_sample_failed', message: e?.message || String(e) })
    }
  })

  // Auctions debug: check presence and summarize a specific item in current snapshot
  app.get('/debug/auctions/item', (req, res) => {
    try {
      const cache = getAuctionsCache()
      const itemId = Number(req.query.itemId || 0)
      if (!itemId) {return res.status(400).json({ error: 'missing_itemId' })}
      if (!cache.data) {return res.status(404).json({ error: 'no_snapshot' })}
      const list = normalizeAuctions(cache.data)
      const hits = list.filter(a => Number(a.itemId) === itemId)
      const count = hits.length
      const totalQty = hits.reduce((s, a) => s + Number(a.quantity || 0), 0)
      const minUnit = hits.reduce((m, a) => Math.min(m, Number(a.unitPrice || Infinity)), Infinity)
      const maxUnit = hits.reduce((m, a) => Math.max(m, Number(a.unitPrice || 0)), 0)
      return res.json({ itemId, count, totalQty, minUnitPrice: isFinite(minUnit) ? minUnit : 0, maxUnitPrice: maxUnit })
    } catch (e) {
      return res.status(500).json({ error: 'auctions_item_failed', message: e?.message || String(e) })
    }
  })
}
