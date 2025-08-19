// System routes: health and metrics

import fs from 'fs'
import path from 'path'
import { fileURLToPath } from 'url'
import * as sqlite from '../db/sqlite.js'

export default function registerSystemRoutes(app, deps) {
  const { getMetricsPayload, getAuctionsCache, getLocalTopCache, aggregateLocalSales, getCatalogMap } = deps

  app.get('/health', (_req, res) => {
    res.json({ ok: true, ts: Math.floor(Date.now()/1000) })
  })

  app.get('/metrics', (_req, res) => {
    try {
      res.json(getMetricsPayload())
    } catch (e) {
      res.status(500).json({ error: 'metrics_failed', message: e?.message || String(e) })
    }
  })

  // SQLite status endpoint for diagnostics
  app.get('/system/sqlite', (_req, res) => {
    try {
      const st = typeof sqlite.status === 'function' ? sqlite.status() : { enabled: false, initialized: false, path: null }
      res.json(st)
    } catch (e) {
      res.status(500).json({ error: 'sqlite_status_failed', message: e?.message || String(e) })
    }
  })

  // Server-Sent Events: emits when auction snapshot content changes (hash)
  app.get('/events/auctions', (req, res) => {
    res.setHeader('Content-Type', 'text/event-stream')
    res.setHeader('Cache-Control', 'no-cache, no-transform')
    res.setHeader('Connection', 'keep-alive')
    res.flushHeaders?.()
    let closed = false
    const send = (data) => {
      if (closed) {return}
      res.write(`data: ${JSON.stringify(data)}\n\n`)
    }
    // Helper to compute a simple fingerprint of the current snapshot
    function fingerprint() {
      try {
        const c = typeof getAuctionsCache === 'function' ? getAuctionsCache() : null
        const snap = c?.data || null
        const itemsArr = Array.isArray(snap?.auctions?.auctions) ? snap.auctions.auctions : (Array.isArray(snap?.auctions) ? snap.auctions : [])
        const commsArr = Array.isArray(snap?.commodities) ? snap.commodities : []
        let qtyItems = 0, qtyComms = 0
        let hashItems = 0, hashComms = 0
        for (let i = 0; i < itemsArr.length; i++) {
          const x = itemsArr[i]
          const id = Number(x?.item?.id || x?.itemId || 0)
          const q = Number(x?.quantity || 0)
          const u = Number(x?.unit_price || x?.unitPrice || x?.buyout || 0)
          qtyItems += q
          hashItems = (hashItems * 1103515245 + ((id * 31 + u * 7 + q * 13) >>> 0) + 12345) >>> 0
        }
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
          qtyItems,
          qtyCommodities: qtyComms,
          itemsHash: hashItems >>> 0,
          commoditiesHash: hashComms >>> 0,
          totalHash: ((hashItems ^ hashComms) >>> 0),
        }
      } catch { return null }
    }
    let last = fingerprint()
    // Initial event with current fingerprint
    send({ type: 'hello', ts: Date.now(), fp: last })
    // Poll fingerprint and emit only on change
    const iv = setInterval(() => {
      try {
        const cur = fingerprint()
        if (!cur) {return}
        const changed = !(last && last.totalHash === cur.totalHash && last.itemsHash === cur.itemsHash && last.commoditiesHash === cur.commoditiesHash)
        if (changed) {
          last = cur
          send({ type: 'change', ts: Date.now(), fp: cur })
        }
      } catch {}
    }, 10_000)
    req.on('close', () => { closed = true; clearInterval(iv); try { res.end() } catch {} })
  })

  // Serve Top page with embedded bootstrap JSON for zero-RTT initial render
  async function serveTop(req, res) {
    try {
      const hours = Math.max(1, Math.min(24 * 365, Number(req.query.hours || 48)))
      const limit = Math.max(1, Math.min(5000, Number(req.query.limit || 400)))
      // Load base HTML
      const __filename = fileURLToPath(import.meta.url)
      const __dirname = path.dirname(__filename)
      const htmlPath = path.join(__dirname, '..', '..', 'public', 'top.html')
      let html = fs.readFileSync(htmlPath, 'utf8')
      // Build bootstrap payload from cache or quick compute
      let items = []
      try {
        const ltc = typeof getLocalTopCache === 'function' ? getLocalTopCache() : null
        const cached = ltc?.byHours?.get(hours)
        if (cached?.items?.length) {
          items = cached.items.slice(0, limit)
        }
      } catch {}
      if (!items.length) {
        try {
          const agg = typeof aggregateLocalSales === 'function' ? aggregateLocalSales(hours) : new Map()
          const cmap = typeof getCatalogMap === 'function' ? getCatalogMap() : new Map()
          const arr = []
          for (const [id, v] of agg.entries()) {
            const qty = v?.qty || 0
            const soldPerDay = Number(qty / Math.max(1e-6, hours/24))
            const it = { itemId: id, soldPerDay }
            const nm = cmap && cmap.get ? cmap.get(id) : ''
            if (nm) {it.name = nm}
            arr.push(it)
          }
          arr.sort((a,b) => b.soldPerDay - a.soldPerDay)
          items = arr.slice(0, limit)
        } catch {}
      }
      const payload = { source: 'local-embed', hours, limit, count: items.length, items }
      const json = JSON.stringify(payload).replace(/<\//g, '<\\/')
      const script = `\n<script id="bootstrap" type="application/json">${json}</script>\n`
      // Inject before </head> if possible, else at end of body
      if (html.includes('</head>')) {html = html.replace('</head>', `${script}</head>`)} 
      else if (html.includes('</body>')) {html = html.replace('</body>', `${script}</body>`)} 
      else {html += script}
      res.set('Cache-Control', 'no-store')
      res.set('Pragma', 'no-cache')
      res.set('Expires', '0')
      return res.type('html').send(html)
    } catch (e) {
      return res.status(500).send('Failed to render Top page')
    }
  }
  app.get('/', serveTop)
  app.get('/top', serveTop)
}
