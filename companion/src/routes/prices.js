// Prices routes
// Provides: /prices/export (fair value map JSON or Lua)

export default function registerPricesRoutes(app, deps) {
  const {
    getAuctionsCache,
    getDefaultSlug,
    normalizeAuctions,
    searchConnectedRealmByRealmSlug,
    getConnectedRealm,
    getConnectedRealmAuctions,
    buildFairMap,
  } = deps

  // Export fair values as JSON or Lua table
  app.get('/prices/export', async (req, res) => {
    try {
      const slug = (req.query.slug || getDefaultSlug()).trim()
      const format = String(req.query.format || 'json').toLowerCase()
      // Ensure snapshot for fallback fair values
      if (!getAuctionsCache().data) {
        const search = await searchConnectedRealmByRealmSlug(slug)
        if (!search.results || !search.results.length) {
          return res.status(404).json({ error: 'not_found', message: `No connected realm for slug ${slug}` })
        }
        const conn = await getConnectedRealm(search.results[0].key.href)
        const data = await getConnectedRealmAuctions(conn.id)
        const cache = getAuctionsCache()
        cache.connectedRealmId = conn.id
        cache.data = data
        cache.lastFetched = Math.floor(Date.now()/1000)
      }
      const normalized = normalizeAuctions(getAuctionsCache().data)
      const itemIds = [...new Set(normalized.map(a => a.itemId).filter(Boolean))]
      const metric = String(req.query.metric || 'median').toLowerCase()
      const p = Number(req.query.p ?? 0.5)
      const fairMap = await buildFairMap(itemIds, slug, { metric, p })
      if (format === 'lua') {
        const lines = ['EG_Prices = {']
        for (const [k,v] of Object.entries(fairMap)) {
          lines.push(`  [${k}] = ${v},`)
        }
        lines.push('}')
        res.setHeader('Content-Type', 'text/plain; charset=utf-8')
        return res.send(lines.join('\n'))
      }
      return res.json({ connectedRealmId: getAuctionsCache().connectedRealmId, lastFetched: getAuctionsCache().lastFetched, count: Object.keys(fairMap).length, prices: fairMap })
    } catch (e) {
      return res.status(500).json({ error: 'prices_export_failed', message: e?.message || String(e) })
    }
  })
}
