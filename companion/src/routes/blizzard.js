// Blizzard auctions routes (partial)
// Provides: /blizzard/auctions/status, /blizzard/auctions/refresh

export default function registerBlizzardRoutes(app, deps) {
  const { getAuctionsCache, normalizeAuctions, refreshAuctionsNow, getDefaultSlug, pollingStatus } = deps

  // Auctions cache status
  app.get('/blizzard/auctions/status', (_req, res) => {
    try {
      const payload = getAuctionsCache().data || {}
      const normalized = normalizeAuctions(payload)
      const lastFetched = getAuctionsCache().lastFetched || 0
      if (lastFetched) {
        const lm = new Date(lastFetched * 1000).toUTCString()
        res.set('Last-Modified', lm)
        const ims = _req.headers['if-modified-since']
        if (ims) {
          const since = Date.parse(ims)
          if (Number.isFinite(since) && since >= lastFetched * 1000) {
            res.set('Cache-Control', 'public, max-age=15, stale-while-revalidate=60')
            return res.status(304).end()
          }
        }
      }
      res.set('Cache-Control', 'public, max-age=15, stale-while-revalidate=60')
      return res.json({
        connectedRealmId: getAuctionsCache().connectedRealmId,
        lastFetched,
        count: Array.isArray(normalized) ? normalized.length : 0,
      })
    } catch (e) {
      return res.status(500).json({ error: 'auctions_status_failed', message: e?.message || String(e) })
    }
  })

  // Polling status for diagnostics
  app.get('/blizzard/polling/status', (_req, res) => {
    try {
      const ps = pollingStatus || { items: {}, commodities: {} }
      const now = Math.floor(Date.now()/1000)
      const fmt = (p) => ({
        intervalSec: Number(p?.intervalSec || 0),
        lastPoll: Number(p?.lastPoll || 0),
        lastChange: Number(p?.lastChange || 0),
        nextAt: Number(p?.nextAt || 0),
        inSeconds: Math.max(0, Number(p?.nextAt || 0) - now),
        polls: Number(p?.polls || 0),
        changes: Number(p?.changes || 0),
      })
      res.set('Cache-Control', 'no-store')
      return res.json({
        now,
        items: fmt(ps.items),
        commodities: fmt(ps.commodities),
      })
    } catch (e) {
      return res.status(500).json({ error: 'polling_status_failed', message: e?.message || String(e) })
    }
  })

  // Trigger an immediate auctions refresh and sales tracking update
  app.get('/blizzard/auctions/refresh', async (req, res) => {
    try {
      const slug = (req.query.slug || getDefaultSlug() || '').trim()
      if (!slug) {return res.status(400).json({ ok:false, error:'missing_slug' })}
      await refreshAuctionsNow(slug)
      const cache = getAuctionsCache()
      return res.json({ ok:true, refreshedAt: cache.lastFetched, connectedRealmId: cache.connectedRealmId })
    } catch (e) {
      return res.status(500).json({ ok:false, error:'refresh_failed', message: e?.message || String(e) })
    }
  })

  // Loop refreshes until snapshot changes or timeout
  app.get('/blizzard/auctions/refresh-until-change', async (req, res) => {
    try {
      const slug = (req.query.slug || getDefaultSlug() || '').trim()
      if (!slug) {return res.status(400).json({ ok:false, error:'missing_slug' })}
      const timeoutSec = Math.max(1, Number(req.query.timeout || 600))
      const intervalSec = Math.max(1, Number(req.query.interval || 15))

      const start = Date.now()
      const baseline = () => {
        const c = getAuctionsCache()
        const snap = c?.data || null
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
          lastFetched: c?.lastFetched || 0,
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

      // Consider content changed only when hash differs; counts/timestamps may stay same
      const eq = (a, b) => !!(a && b && a.totalHash === b.totalHash && a.itemsHash === b.itemsHash && a.commoditiesHash === b.commoditiesHash)

      const before = baseline()
      const until = start + timeoutSec * 1000

      while (Date.now() < until) {
        await refreshAuctionsNow(slug)
        const after = baseline()
        if (!eq(before, after)) {
          return res.json({ ok:true, changed:true, before, after, elapsedMs: Date.now() - start })
        }
        await new Promise(r => setTimeout(r, intervalSec * 1000))
      }

      const final = baseline()
      return res.json({ ok:true, changed:false, before, after: final, elapsedMs: Date.now() - start })
    } catch (e) {
      return res.status(500).json({ ok:false, error:'refresh_until_change_failed', message: e?.message || String(e) })
    }
  })
}
