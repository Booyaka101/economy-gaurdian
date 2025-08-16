// Deals (sniping) routes
// Provides: GET /deals/snipe, POST /deals/snipe

export default function registerDealsRoutes(app, deps) {
  const { normalizeAuctions, buildFairMap, getDefaultSlug, getAuctionsCache } = deps

  // GET compatibility
  app.get('/deals/snipe', async (req, res) => {
    try {
      const slug = (req.query.slug || getDefaultSlug()).trim()
      const discount = Math.max(0.01, Math.min(0.99, Number(req.query.discount ?? req.query.percent ?? 0.3)))
      const maxResults = Math.max(1, Math.min(2000, Number(req.query.limit ?? 200)))
      if (!getAuctionsCache().data) {return res.status(409).json({ error: 'no_snapshot', message: 'No auctions snapshot yet' })}
      const normalized = normalizeAuctions(getAuctionsCache().data)
      const itemIds = [...new Set(normalized.map(a => a.itemId).filter(Boolean))]
      const fair = await buildFairMap(itemIds, slug, { metric: String(req.query.metric||'median'), p: Number(req.query.p ?? 0.5) })
      const out = []
      for (const a of normalized) {
        const fairUnit = Number(fair[a.itemId] || 0)
        if (fairUnit <= 0 || !a.unitPrice) {continue}
        if (a.unitPrice <= fairUnit * discount) {
          out.push({
            auctionId: a.auctionId,
            itemId: a.itemId,
            unitPrice: a.unitPrice,
            fair: fairUnit,
            discountPct: Number(((1 - (a.unitPrice / Math.max(1, fairUnit))) * 100).toFixed(2)),
            quantity: a.quantity,
          })
        }
      }
      out.sort((x,y) => (y.discountPct - x.discountPct))
      return res.json({ count: Math.min(out.length, maxResults), discount, items: out.slice(0, maxResults) })
    } catch (e) {
      return res.status(500).json({ error: 'snipe_failed', message: e?.message || String(e) })
    }
  })

  // POST version (same logic but params also supported in body)
  app.post('/deals/snipe', async (req, res) => {
    try {
      const slug = (req.query.slug || getDefaultSlug()).trim()
      const discount = Math.max(0.01, Math.min(0.99, Number(req.body?.discount ?? req.query.discount ?? 0.3)))
      const maxResults = Math.max(1, Math.min(2000, Number(req.body?.limit ?? req.query.limit ?? 200)))
      if (!getAuctionsCache().data) {return res.status(409).json({ error: 'no_snapshot', message: 'No auctions snapshot yet' })}
      const normalized = normalizeAuctions(getAuctionsCache().data)
      const itemIds = [...new Set(normalized.map(a => a.itemId).filter(Boolean))]
      const fair = await buildFairMap(itemIds, slug, { metric: String(req.query.metric||'median'), p: Number(req.query.p ?? 0.5) })
      const out = []
      for (const a of normalized) {
        const fairUnit = Number(fair[a.itemId] || 0)
        if (fairUnit <= 0 || !a.unitPrice) {continue}
        if (a.unitPrice <= fairUnit * discount) {
          out.push({
            auctionId: a.auctionId,
            itemId: a.itemId,
            unitPrice: a.unitPrice,
            fair: fairUnit,
            discountPct: Number(((1 - (a.unitPrice / Math.max(1, fairUnit))) * 100).toFixed(2)),
            quantity: a.quantity,
          })
        }
      }
      out.sort((x,y) => (y.discountPct - x.discountPct))
      return res.json({ count: Math.min(out.length, maxResults), discount, items: out.slice(0, maxResults) })
    } catch (e) {
      return res.status(500).json({ error: 'snipe_failed', message: e?.message || String(e) })
    }
  })
}
