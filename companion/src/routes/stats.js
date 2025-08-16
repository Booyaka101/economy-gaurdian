// Stats routes
// Provides: /stats/top-sold-local, /stats/top-sold-local/all, /stats/local-sales/summary, /stats/top-sold-region

import crypto from 'crypto'

// Simple in-flight request coalescing: key -> Promise resolving to payload
const inFlight = new Map()
function coalesce(key, producer) {
  const _now = Date.now()
  if (inFlight.has(key)) {return inFlight.get(key)}
  const p = (async () => {
    try { return await producer() }
    finally {
      // small timeout to allow immediate follow-on joins (mitigate thundering herd)
      setTimeout(() => inFlight.delete(key), 100)
    }
  })()
  inFlight.set(key, p)
  return p
}

function sendWithETag(req, res, payload, { maxAge = 30 } = {}) {
  try {
    const json = typeof payload === 'string' ? payload : JSON.stringify(payload)
    const etag = 'W/"' + crypto.createHash('sha1').update(json).digest('hex') + '"'
    const inm = req.headers['if-none-match']
    if (inm && inm === etag) {
      res.status(304)
      res.set('ETag', etag)
      res.set('Cache-Control', `public, max-age=${maxAge}`)
      return res.end()
    }
    res.set('ETag', etag)
    res.set('Cache-Control', `public, max-age=${maxAge}`)
    res.type('application/json')
    return res.send(json)
  } catch {
    return res.json(payload)
  }
}

export default function registerStatsRoutes(app, deps) {
  const {
    aggregateLocalSales,
    getCatalogMap,
    getItemIcon,
    getLocalTopCache,
    localTopVersionRef: _localTopVersionRef,
    LOCAL_TOP_CACHE_MAX: _LOCAL_TOP_CACHE_MAX,
    getNexusHubRegionSold,
  } = deps

  // Local Top Sold endpoint (by ended auctions -> soldPerDay)
  app.get('/stats/top-sold-local', async (req, res) => {
    try {
      const hours = Math.max(1, Math.min(24 * 365, Number(req.query.hours || 48)))
      const limit = Math.max(1, Math.min(5000, Number(req.query.limit || 400)))
      const live = String(req.query.mode || '').toLowerCase() === 'live'
      const cacheObj = typeof getLocalTopCache === 'function' ? getLocalTopCache() : null
      const cached = cacheObj?.byHours?.get(hours)
      if (!live && cached && cached.items?.length) {
        const items = cached.items.slice(0, limit)
        return sendWithETag(req, res, { source: 'local-cache', hours, limit, count: items.length, builtAt: cached.builtAt, items })
      }
      const key = `local:${hours}:${limit}`
      const payload = await coalesce(key, async () => {
        const agg = aggregateLocalSales(hours)
        const items = [...agg.entries()].map(([itemId, v]) => ({ itemId: Number(itemId), soldPerDay: Number((v.qty || 0) / Math.max(1e-6, hours/24)) }))
        items.sort((a,b) => b.soldPerDay - a.soldPerDay)
        const out = items.slice(0, limit)
        try {
          const cmap = getCatalogMap()
          if (cmap && cmap.size) {
            for (const it of out) {
              const nm = cmap.get(it.itemId)
              if (nm) {it.name = nm}
              const ic = getItemIcon(it.itemId)
              if (ic) {it.icon = ic.icon || ic}
            }
          }
        } catch {}
        return { source: 'local', hours, limit, count: out.length, cached: false, items: out }
      })
      return sendWithETag(req, res, payload)
    } catch (e) {
      return res.status(500).json({ error: 'top_sold_local_failed', message: e?.message || String(e) })
    }
  })

  // Expose raw local sales aggregates for a window (debug/analytics)
  app.get('/stats/local-sales/summary', async (req, res) => {
    try {
      const hours = Math.max(1, Math.min(24 * 365, Number(req.query.hours || 48)))
      const key = `summary:${hours}`
      const payload = await coalesce(key, async () => {
        const agg = aggregateLocalSales(hours)
        const out = {}
        for (const [itemId, v] of agg.entries()) {out[itemId] = { quantity: v.qty, endedCount: v.cnt }}
        return { hours, count: Object.keys(out).length, items: out }
      })
      return sendWithETag(req, res, payload)
    } catch (e) {
      return res.status(500).json({ error: 'local_sales_summary_failed', message: e?.message || String(e) })
    }
  })

  // Full-catalog Local Top Sold (optionally include zero-sold)
  app.get('/stats/top-sold-local/all', async (req, res) => {
    try {
      const hours = Math.max(1, Math.min(24 * 365, Number(req.query.hours || 48)))
      const includeZero = String(req.query.includeZero || '0') === '1'
      const limit = Math.max(1, Math.min(5000, Number(req.query.limit || 400)))
      const offset = Math.max(0, Number(req.query.offset || 0))

      const key = `localall:${hours}:${includeZero?1:0}`
      const { items } = await coalesce(key, async () => {
        const agg = aggregateLocalSales(hours)
        const cmap = getCatalogMap()
        const items = []

        if (cmap && cmap.size) {
          for (const [id, name] of cmap.entries()) {
            const v = agg.get(id)
            const qty = v?.qty || 0
            const soldPerDay = Number(qty / Math.max(1e-6, hours/24))
            if (!includeZero && soldPerDay <= 0) {continue}
            items.push({ itemId: Number(id), name: String(name || ''), soldPerDay })
          }
        } else {
          for (const [id, v] of agg.entries()) {
            const qty = v?.qty || 0
            const soldPerDay = Number(qty / Math.max(1e-6, hours/24))
            items.push({ itemId: Number(id), soldPerDay })
          }
        }
        items.sort((a,b) => b.soldPerDay - a.soldPerDay)
        return { items }
      })
      const paged = items.slice(offset, offset + limit)
      return sendWithETag(req, res, { source: 'local-all', hours, includeZero, offset, limit, total: items.length, items: paged })
    } catch (e) {
      return res.status(500).json({ error: 'top_sold_local_all_failed', message: e?.message || String(e) })
    }
  })

  // Region Top Sold (NexusHub/TSM)
  app.get('/stats/top-sold-region', async (req, res) => {
    try {
      if (process.env.DISABLE_NEXUSHUB === '1') {
        return res.status(404).json({ error: 'disabled', message: 'NexusHub integration disabled' })
      }
      const limit = Math.max(1, Math.min(5000, Number(req.query.limit || 400)))
      const mode = String(req.query.mode || 'cache')
      const key = `region:${mode}:${limit}`
      const items = await coalesce(key, () => getNexusHubRegionSold?.({ mode, limit }))
      if (!Array.isArray(items) || items.length === 0) {
        return res.status(404).json({ error: 'no_region_data', message: 'No region top-sold data available' })
      }
      return sendWithETag(req, res, { source: 'region', mode, limit, count: Math.min(items.length, limit), items: items.slice(0, limit), cached: mode !== 'fetch' })
    } catch (e) {
      return res.status(500).json({ error: 'top_sold_region_failed', message: e?.message || String(e) })
    }
  })
}
