/* eslint curly: ["error", "multi-line"], no-console: ["error", { "allow": ["error", "warn", "info", "debug"] }], no-empty: ["error", { "allowEmptyCatch": true }] */
import express from 'express'
import dotenv from 'dotenv'
import path from 'path'
import fs from 'fs'
import axios from 'axios'
import http from 'http'
import https from 'https'
import { fileURLToPath } from 'url'
import { loadConfig } from './config.js'
import { searchConnectedRealmByRealmSlug, getConnectedRealm, getConnectedRealmAuctions, getItemCached, getItemMediaCached, getCommoditiesAuctions } from './integrations/blizzard.js'
import { getTSMStatus } from './integrations/tsm.js'
import { getTUJStatus } from './integrations/tuj.js'
import { getNexusHubStatus, getNexusHubRegionSold } from './integrations/nexushub.js'
import { computeFallbackFromAuctions } from './utils/pricing.js'
import { rebuildItemCatalog, getCatalogStatus, loadCatalogFromDisk } from './catalog/items.js'
import registerDebugRoutes from './routes/debug.js'
import registerBlizzardRoutes from './routes/blizzard.js'
import registerStatsRoutes from './routes/stats.js'
// Deals routes removed (sniper will live in addon)
import registerCatalogRoutes from './routes/catalog.js'
import registerSystemRoutes from './routes/system.js'
import registerItemsRoutes from './routes/items.js'
import registerPricesRoutes from './routes/prices.js'
import registerIntegrationsRoutes from './routes/integrations.js'
import registerAIRoutes from './routes/ai.js'
import registerPlayerRoutes from './routes/player.js'
import { startSavedVarsWatcher } from './utils/savedvars.js'

// Load .env from project root regardless of current working directory
const __filename = fileURLToPath(import.meta.url)
const __dirname = path.dirname(__filename)
dotenv.config({ path: path.join(__dirname, '..', '.env') })

const cfg = loadConfig()

const app = express()
app.set('trust proxy', 1)
app.use(express.json())
app.disable('x-powered-by')
// Upstream HTTP keep-alive for axios
try {
  axios.defaults.httpAgent = new http.Agent({ keepAlive: true, maxSockets: 50 })
  axios.defaults.httpsAgent = new https.Agent({ keepAlive: true, maxSockets: 50 })
  console.info('[EG] Axios keep-alive agents enabled')
} catch {}

// Lightweight ETag/304 for GET JSON responses
app.use((req, res, next) => {
  if (req.method !== 'GET') { return next() }
  const ifNone = req.headers['if-none-match']
  const origJson = res.json.bind(res)
  const hashString = (str) => {
    // Fast non-crypto 32-bit hash
    let h = 2166136261 >>> 0
    for (let i = 0; i < str.length; i++) {
      h ^= str.charCodeAt(i)
      h = Math.imul(h, 16777619) >>> 0
    }
    return (h >>> 0).toString(16)
  }
  res.json = (data) => {
    try {
      const body = JSON.stringify(data)
      const tag = 'W/"' + hashString(body) + '"'
      if (ifNone && ifNone === tag) {
        res.status(304)
        return res.end()
      }
      res.set('ETag', tag)
    } catch {}
    return origJson(data)
  }
  return next()
})
// Optional: gzip compression if 'compression' is available
;(async () => {
  try {
    const mod = await import('compression').catch(() => null)
    const compression = mod && (mod.default || mod)
    if (compression) {
      app.use(compression())
      console.info('[EG] Compression middleware enabled')
    } else {
      console.info('[EG] Compression middleware not installed; skipping')
    }
  } catch {}
})()
// Optional: security headers via 'helmet' if available
;(async () => {
  try {
    const mod = await import('helmet').catch(() => null)
    const helmet = mod && (mod.default || mod)
    if (helmet) {
      const isProd = String(process.env.NODE_ENV || '').toLowerCase() === 'production'
      // Keep CSP/COEP off to avoid breaking inline scripts and local assets
      app.use(helmet({ contentSecurityPolicy: false, crossOriginEmbedderPolicy: false, hsts: isProd ? undefined : false }))
      console.info('[EG] Helmet security headers enabled')
    } else {
      console.info('[EG] Helmet not installed; skipping')
    }
  } catch {}
})()
// Serve static dashboard
const publicDir = path.join(__dirname, '..', 'public')
if (fs.existsSync(publicDir)) {
  const isProd = String(process.env.NODE_ENV || '').toLowerCase() === 'production'
  // Cache policy: dev=no-store for quick iteration; prod=long cache for assets, no-cache for HTML
  app.use((req, res, next) => {
    try {
      const p = req.path || ''
      if (!isProd) {
        if (p.endsWith('.html') || p.endsWith('.js') || p.endsWith('.css')) {
          res.set('Cache-Control', 'no-store')
          res.set('Pragma', 'no-cache')
          res.set('Expires', '0')
        }
      } else {
        if (p.endsWith('.html')) {
          // HTML: allow validation but avoid staleness
          res.set('Cache-Control', 'no-cache')
        } else if (/(\.js|\.css|\.png|\.jpg|\.jpeg|\.webp|\.gif|\.svg)$/i.test(p)) {
          // Immutable static assets (filenames should change on deploys)
          res.set('Cache-Control', 'public, max-age=31536000, immutable')
        }
      }
    } catch {}
    next()
  })
  app.use(express.static(publicDir))
}

try {
  const mod = await import('express-rate-limit').catch(() => null)
  const rateLimit = mod && (mod.default || mod)
  if (rateLimit) {
    // General API limiter (skip health/metrics)
    const apiLimiter = rateLimit({
      windowMs: 60 * 1000,
      max: Number(process.env.RATE_LIMIT_MAX || 120),
      standardHeaders: true,
      legacyHeaders: false,
      skip: (req) => req.path === '/health' || req.path === '/metrics',
    })
    app.use(apiLimiter)

    // Stricter limiter for heavy actions (catalog rebuilds, exports)
    const strictLimiter = rateLimit({
      windowMs: 60 * 1000,
      max: Number(process.env.RATE_LIMIT_STRICT_MAX || 10),
      standardHeaders: true,
      legacyHeaders: false,
    })
    app.use(['/catalog/rebuild', '/blizzard/items/catalog/rebuild', '/prices/export'], strictLimiter)

    // Moderate limiter for region-wide top sold (remote integrations)
    const moderateLimiter = rateLimit({
      windowMs: 60 * 1000,
      max: Number(process.env.RATE_LIMIT_MODERATE_MAX || 30),
      standardHeaders: true,
      legacyHeaders: false,
    })
    app.use(['/stats/top-sold-region'], moderateLimiter)

    console.info('[EG] Rate limiting enabled')
  } else {
    console.info('[EG] express-rate-limit not installed; skipping')
  }
} catch {}

// Catalog endpoints moved to routes/catalog.js
app.get('/stats/top-sold-local/all', async (req, res) => {
  try {
    const hours = Math.max(1, Math.min(24 * 365, Number(req.query.hours || 48)))
    const includeZero = String(req.query.includeZero ?? '1') === '1'
    const limit = Math.max(1, Math.min(5000, Number(req.query.limit || 400)))
    let page = Math.max(1, Number(req.query.page || 1))
    const pageSize = Math.max(1, Math.min(1000, Number(req.query.pageSize || limit)))
    // Optional UI compatibility: support offset
    const hasOffset = (typeof req.query.offset !== 'undefined')
    const offset = hasOffset ? Math.max(0, Number(req.query.offset || 0)) : 0
    if (hasOffset) page = Math.floor(offset / pageSize) + 1

    const windowDays = hours / 24
    const localMap = aggregateLocalSales(hours) // Map(itemId -> { qty, cnt })
    const catalog = loadCatalogFromDisk()
    const catItems = Array.isArray(catalog.items) ? catalog.items : []
    const nameById = new Map()
    for (const it of catItems) nameById.set(Number(it.id), it.name || '')

    const list = []
    for (const it of catItems) {
      const itemId = Number(it.id)
      if (!itemId) continue
      const v = localMap.get(itemId)
      const soldQty = Number(v?.qty || 0)
      const soldPerDay = soldQty / Math.max(0.01, windowDays)
      if (!includeZero && soldPerDay <= 0) continue
      const name = nameById.get(itemId) || ''
      list.push({ itemId, name, soldPerDay: Number(soldPerDay.toFixed(3)), mediaId: it.mediaId || null })
    }
    list.sort((a,b) => b.soldPerDay - a.soldPerDay)
    const total = list.length
    const start = (page - 1) * pageSize
    const items = list.slice(start, start + pageSize).slice(0, limit)
    return res.json({ source: 'local-all', hours, includeZero, limit, total, page, pageSize, count: items.length, items })
  } catch (e) {
    return res.status(500).json({ error: 'top_sold_local_all_failed', message: e?.message || String(e) })
  }
})

app.post('/catalog/rebuild', async (req, res) => {
  try {
    if (catalogRebuildState.running) {
      return res.json({ ok: true, running: true, message: 'already running' })
    }
    catalogRebuildState.running = true
    catalogRebuildState.lastStart = Math.floor(Date.now()/1000)
    catalogRebuildState.lastError = null
    // Kick async to avoid blocking the request
    ;(async () => {
      try {
        await rebuildItemCatalog({ resume: true, pageLimit: 0 })
      } catch (e) {
        catalogRebuildState.lastError = e?.message || String(e)
        console.warn('[EG] Manual catalog rebuild error', catalogRebuildState.lastError)
      } finally {
        catalogRebuildState.running = false
        catalogRebuildState.lastEnd = Math.floor(Date.now()/1000)
      }
    })()
    return res.json({ ok: true, running: true })
  } catch (e) {
    return res.status(500).json({ ok: false, error: 'catalog_rebuild_failed', message: e?.message || String(e) })
  }
})

// Quiet favicon errors if no icon is present
app.get('/favicon.ico', (_req, res) => res.status(204).end())

// Optional background refresher for auctions
const AUTO_REFRESH_MINUTES = Number(process.env.AUTO_REFRESH_MINUTES || 0)
// Rapid polling configuration (seconds). Uses conditional GETs, safe to keep small.
const ITEMS_POLL_SECONDS_BASE = Number(process.env.ITEMS_POLL_SECONDS || 60)
const COMMODITIES_POLL_SECONDS_BASE = Number(process.env.COMMODITIES_POLL_SECONDS || 45)
const POLL_JITTER_MS = Number(process.env.POLL_JITTER_MS || 3000)
// Optional peak-hour overrides (local time, 0-23). If start==end, peak off.
const PEAK_START_HOUR = Number(process.env.PEAK_START_HOUR ?? 18)
const PEAK_END_HOUR = Number(process.env.PEAK_END_HOUR ?? 23)
const ITEMS_POLL_SECONDS_PEAK = Number(process.env.ITEMS_POLL_SECONDS_PEAK || 45)
const COMMODITIES_POLL_SECONDS_PEAK = Number(process.env.COMMODITIES_POLL_SECONDS_PEAK || 30)

let autoRefreshTimer = null
let isShuttingDown = false

// Lightweight polling status for diagnostics
const pollingStatus = {
  items: { intervalSec: ITEMS_POLL_SECONDS_BASE, lastPoll: 0, lastChange: 0, polls: 0, changes: 0, nextAt: 0 },
  commodities: { intervalSec: COMMODITIES_POLL_SECONDS_BASE, lastPoll: 0, lastChange: 0, polls: 0, changes: 0, nextAt: 0 },
}
async function refreshAuctionsNow(slug) {
  try {
    // Reuse logic similar to /blizzard/auctions
    const search = await searchConnectedRealmByRealmSlug(slug)
    if (!search.results || !search.results.length) return
    const first = search.results[0]
    const conn = await getConnectedRealm(first.key.href)
    const data = await getConnectedRealmAuctions(conn.id)
    if (data && data.notModified && getAuctionsCache().data) {
      // No change: skip processing to save CPU/memory
      return
    }
    auctionsCache.connectedRealmId = conn.id
    // track ended between previous cache and new data
    const prev = auctionsCache.data
    auctionsCache.prev = prev
    auctionsCache.data = data
    auctionsCache.lastFetched = Math.floor(Date.now() / 1000)
    if (prev) trackEndedAuctions(prev, data)
    saveAuctionsToDisk()
    console.info(`[EG] Background auctions refreshed for ${slug} @ ${new Date(auctionsCache.lastFetched*1000).toISOString()}`)
  } catch (e) {
    console.warn('[EG] Background refresh failed:', e?.message)
  }
}
if (AUTO_REFRESH_MINUTES > 0) {
  const slug = (cfg.REALM_SLUGS && cfg.REALM_SLUGS[0]) || ''
  const intervalMs = Math.max(1, AUTO_REFRESH_MINUTES) * 60 * 1000
  autoRefreshTimer = setInterval(() => { if (!isShuttingDown) refreshAuctionsNow(slug) }, intervalMs)
  console.info(`[EG] Auto-refresh enabled every ${AUTO_REFRESH_MINUTES} min for slug ${slug}`)
}

// Jittered scheduler helper
function schedule(nextMs, fn) {
  if (isShuttingDown) return
  setTimeout(() => { if (!isShuttingDown) fn() }, Math.max(0, nextMs) + Math.floor(Math.random() * POLL_JITTER_MS))
}

// Start rapid polling loops (items + commodities) with conditional GETs
(function startRapidPolling() {
  try {
    const slug = (cfg.REALM_SLUGS && cfg.REALM_SLUGS[0]) || ''
    if (!slug) return

    const inPeak = () => {
      const h = new Date().getHours()
      const s = ((PEAK_START_HOUR % 24) + 24) % 24
      const e = ((PEAK_END_HOUR % 24) + 24) % 24
      if (s === e) return false
      return s < e ? (h >= s && h < e) : (h >= s || h < e)
    }
    const getIntervals = () => {
      if (inPeak()) {
        return {
          items: Math.max(1, ITEMS_POLL_SECONDS_PEAK),
          commodities: Math.max(1, COMMODITIES_POLL_SECONDS_PEAK),
        }
      }
      return {
        items: Math.max(1, ITEMS_POLL_SECONDS_BASE),
        commodities: Math.max(1, COMMODITIES_POLL_SECONDS_BASE),
      }
    }

    // Items/connected-realm auctions loop
    const itemsLoop = async () => {
      const now = Math.floor(Date.now()/1000)
      pollingStatus.items.lastPoll = now
      pollingStatus.items.polls++
      try {
        const before = getAuctionsCache().lastFetched || 0
        await refreshAuctionsNow(slug)
        const after = getAuctionsCache().lastFetched || 0
        if (after && after !== before) {
          pollingStatus.items.lastChange = Math.floor(Date.now()/1000)
          pollingStatus.items.changes++
        }
      } catch (e) {
        console.warn('[EG] Items poll error:', e?.message || e)
      } finally {
        const { items } = getIntervals()
        pollingStatus.items.intervalSec = items
        const nextMs = Math.max(1, items) * 1000
        pollingStatus.items.nextAt = Math.floor((Date.now() + nextMs) / 1000)
        schedule(nextMs, itemsLoop)
      }
    }

    // Commodities (region-wide) loop with cheap conditional GETs
    let lastCommoditiesHash = 0
    const commoditiesLoop = async () => {
      const now = Math.floor(Date.now()/1000)
      pollingStatus.commodities.lastPoll = now
      pollingStatus.commodities.polls++
      try {
        const res = await getCommoditiesAuctions()
        if (!res?.notModified) {
          // Compute a quick content hash over (id, unit_price, quantity)
          let h = 0 >>> 0
          const arr = Array.isArray(res?.commodities) ? res.commodities : []
          for (let i = 0; i < arr.length; i++) {
            const x = arr[i]
            const id = Number(x?.item?.id || x?.itemId || 0) >>> 0
            const q = Number(x?.quantity || x?.quantity_total || 0) >>> 0
            const u = Number(x?.unit_price || x?.unitPrice || x?.buyout || 0) >>> 0
            h = (h * 1103515245 + ((id * 31 + u * 7 + q * 13) >>> 0) + 12345) >>> 0
          }
          if (h !== lastCommoditiesHash) {
            lastCommoditiesHash = h >>> 0
            pollingStatus.commodities.lastChange = Math.floor(Date.now()/1000)
            pollingStatus.commodities.changes++
            // Optionally refresh estimator by syncing commodities into cache (best-effort)
            try {
              const c = getAuctionsCache()
              if (c && c.data) {
                c.data.commodities = arr
              }
            } catch {}
          }
        }
      } catch (e) {
        console.warn('[EG] Commodities poll error:', e?.message || e)
      } finally {
        const { commodities } = getIntervals()
        pollingStatus.commodities.intervalSec = commodities
        const nextMs = Math.max(1, commodities) * 1000
        pollingStatus.commodities.nextAt = Math.floor((Date.now() + nextMs) / 1000)
        schedule(nextMs, commoditiesLoop)
      }
    }

    // Kick off with small stagger
    schedule(500, itemsLoop)
    schedule(1500, commoditiesLoop)
    const ii = getIntervals()
    console.info(`[EG] Rapid polling enabled: items=${ii.items}s, commodities=${ii.commodities}s (peak-aware), jitter<=${POLL_JITTER_MS}ms`)
  } catch (e) {
    console.warn('[EG] Rapid polling init failed:', e?.message || e)
  }
})()

// Simple in-memory cache for latest auctions
const auctionsCache = {
  connectedRealmId: null,
  lastFetched: 0,
  data: null,
}

// Persisted cache paths
const cacheDir = path.join(__dirname, '..', '.cache')
const auctionsCachePath = path.join(cacheDir, 'auctions.json')
const fairCachePath = path.join(cacheDir, 'fair-values.json')
const salesPath = path.join(cacheDir, 'sales.json')
if (!fs.existsSync(cacheDir)) {
  try { fs.mkdirSync(cacheDir, { recursive: true }) } catch {}
}

// Catalog auto-rebuild controls
const AUTO_CATALOG_REBUILD = String(process.env.AUTO_CATALOG_REBUILD || '1') === '1'
const CATALOG_MIN_COUNT = Number(process.env.CATALOG_MIN_COUNT || 300000)
const CATALOG_REFRESH_HOURS = Number(process.env.CATALOG_REFRESH_HOURS || (7*24)) // weekly
const catalogRebuildState = { running: false, lastStart: 0, lastEnd: 0, lastError: null }

async function maybeRebuildCatalog(reason = 'startup') {
  try {
    if (!AUTO_CATALOG_REBUILD) return
    if (catalogRebuildState.running) return
    const status = getCatalogStatus()
    const now = Math.floor(Date.now()/1000)
    const ageHours = status.lastBuilt ? Math.floor((now - status.lastBuilt)/3600) : 999999
    const needs = (status.count < CATALOG_MIN_COUNT) || (ageHours >= CATALOG_REFRESH_HOURS)
    if (!needs) return
    catalogRebuildState.running = true
    catalogRebuildState.lastStart = now
    catalogRebuildState.lastError = null
    console.info(`[EG] Catalog rebuild starting (${reason}) - current count=${status.count}, lastBuilt=${status.lastBuilt}`)
    try {
      await rebuildItemCatalog({ resume: true, pageLimit: 0 })
    } catch (e) {
      catalogRebuildState.lastError = e?.message || String(e)
      console.warn('[EG] Catalog rebuild error', catalogRebuildState.lastError)
    } finally {
      catalogRebuildState.running = false
      catalogRebuildState.lastEnd = Math.floor(Date.now()/1000)
      const st2 = getCatalogStatus()
      console.info(`[EG] Catalog rebuild finished - new count=${st2.count}`)
    }
  } catch {}
}

function loadAuctionsFromDisk() {
  try {
    if (fs.existsSync(auctionsCachePath)) {
      const { connectedRealmId, lastFetched, data } = JSON.parse(fs.readFileSync(auctionsCachePath, 'utf8'))
      if (data) {
        auctionsCache.connectedRealmId = connectedRealmId || null
        auctionsCache.lastFetched = lastFetched || 0
        auctionsCache.data = data
        console.info('[EG] Loaded auctions cache from disk')
      }
    }
  } catch (e) {
    console.warn('[EG] Failed to load auctions cache', e?.message)
  }
}
function saveAuctionsToDisk() {
  try {
    fs.writeFileSync(auctionsCachePath, JSON.stringify({
      connectedRealmId: auctionsCache.connectedRealmId,
      lastFetched: auctionsCache.lastFetched,
      data: auctionsCache.data,
    }), 'utf8')
  } catch (e) {
    console.warn('[EG] Failed to save auctions cache', e?.message)
  }
}

const fairValuesCache = {
  slug: null,
  lastBuilt: 0,
  data: null, // { connectedRealmId, lastFetched, count, prices, sources }
}

// Build a fair value map for given itemIds and a realm slug.
// Currently Blizzard-only fallback: median/percentile from current snapshot.
async function buildFairMap(itemIds = [], slug, { metric = 'median', p = 0.5 } = {}) {
  // ensure we have auctions cached
  if (!auctionsCache.data) {
    const search = await searchConnectedRealmByRealmSlug(slug)
    if (!search?.results?.length) throw new Error(`No connected realm for slug ${slug}`)
    const conn = await getConnectedRealm(search.results[0].key.href)
    const data = await getConnectedRealmAuctions(conn.id)
    auctionsCache.connectedRealmId = conn.id
    const prev = auctionsCache.data
    auctionsCache.prev = prev
    auctionsCache.data = data
    auctionsCache.lastFetched = Math.floor(Date.now()/1000)
    if (prev) trackEndedAuctions(prev, data)
    saveAuctionsToDisk()
  }
  const normalized = normalizeAuctions(auctionsCache.data)
  const fallback = computeFallbackFromAuctions(normalized, { metric, p })
  // Limit to requested itemIds if provided
  if (itemIds && itemIds.length) {
    const out = {}
    for (const id of itemIds) { if (fallback[id] != null) out[id] = fallback[id] }
    return out
  }
  return fallback
}
// Helper: normalize Blizzard auctions payload to a flat list
function normalizeAuctions(payload) {
  try {
    // payload may be:
    // - direct Blizzard shapes: { auctions: [...] } or { auctions: { auctions: [...] } }
    // - combined shape we cache: { auctions: [...], commodities: [...] } or { commodities: { auctions: [...] } }
    const out = []
    // Extract auctions array
    let auArr = []
    const auTop = payload && payload.auctions
    if (Array.isArray(auTop)) auArr = auTop
    else if (auTop && Array.isArray(auTop.auctions)) auArr = auTop.auctions
    // Extract commodities array
    let coArr = []
    const coTop = payload && payload.commodities
    if (Array.isArray(coTop)) coArr = coTop
    else if (coTop && Array.isArray(coTop.auctions)) coArr = coTop.auctions

    // Normalize items (non-commodity)
    for (let i = 0; i < auArr.length; i++) {
      const a = auArr[i]
      if (!a || typeof a !== 'object') continue
      const auctionId = Number(a.id != null ? a.id : (a.auction_id != null ? a.auction_id : (a.auctionId != null ? a.auctionId : 0)))
      let itemId = 0
      const it = a.item
      if (it && typeof it === 'object' && it.id != null) itemId = Number(it.id)
      else if (a.itemId != null) itemId = Number(a.itemId)
      else if (a.item_id != null) itemId = Number(a.item_id)
      const quantity = Number(a.quantity != null ? a.quantity : 0)
      const unitPrice = Number(a.unit_price != null ? a.unit_price : (a.buyout != null ? a.buyout : 0))
      if (!itemId || !quantity) continue
      out.push({ auctionId, itemId, quantity, unitPrice })
    }

    // Normalize commodities
    for (let i = 0; i < coArr.length; i++) {
      const a = coArr[i]
      if (!a || typeof a !== 'object') continue
      const auctionId = Number(a.id != null ? a.id : (a.auction_id != null ? a.auction_id : (a.auctionId != null ? a.auctionId : 0)))
      let itemId = 0
      const it = a.item
      if (it && typeof it === 'object' && it.id != null) itemId = Number(it.id)
      else if (a.itemId != null) itemId = Number(a.itemId)
      else if (a.item_id != null) itemId = Number(a.item_id)
      const quantity = Number(a.quantity != null ? a.quantity : 0)
      const unitPrice = Number(a.unit_price != null ? a.unit_price : (a.buyout != null ? a.buyout : 0))
      if (!itemId || !quantity) continue
      out.push({ auctionId, itemId, quantity, unitPrice })
    }
    return out
  } catch (e) {
    console.warn('[EG] normalizeAuctions failed:', e?.message)
    return []
  }
}

function loadFairFromDisk() {
  try {
    if (fs.existsSync(fairCachePath)) {
      const obj = JSON.parse(fs.readFileSync(fairCachePath, 'utf8'))
      if (obj && obj.data) {
        fairValuesCache.slug = obj.slug || null
        fairValuesCache.lastBuilt = obj.lastBuilt || 0
        fairValuesCache.data = obj.data
        console.info('[EG] Loaded fair-values cache from disk')
      }
    }
  } catch (e) {
    console.warn('[EG] Failed to load fair-values cache', e?.message)
  }
}
function _saveFairToDisk() {
  try {
    fs.writeFileSync(fairCachePath, JSON.stringify({
      slug: fairValuesCache.slug,
      lastBuilt: fairValuesCache.lastBuilt,
      data: fairValuesCache.data,
    }), 'utf8')
  } catch (e) {
    console.warn('[EG] Failed to save fair-values cache', e?.message)
  }
}

// Load caches at startup (if present)
loadAuctionsFromDisk()
loadFairFromDisk()

// Sales tracking (approx by ended auctions between snapshots)
let salesEvents = [] // [{ t: secs, itemId, quantity }]
let lastTrackSummary = null // { ts, prevCount, nowCount, endedCount, partialAdds }
function loadSalesFromDisk() {
  try {
    if (fs.existsSync(salesPath)) {
      const arr = JSON.parse(fs.readFileSync(salesPath, 'utf8'))
      if (Array.isArray(arr)) salesEvents = arr
    }
  } catch {}
}
function saveSalesToDisk() {
  try { fs.writeFileSync(salesPath, JSON.stringify(salesEvents), 'utf8') } catch {}
}
loadSalesFromDisk()

// Trigger catalog rebuild shortly after startup
setTimeout(() => { maybeRebuildCatalog('startup') }, 2000)

// Register modular routes (Debug, Blizzard) after initialization
// Provide dependencies via lightweight accessors to avoid import cycles
const getAuctionsCache = () => auctionsCache
const getDefaultSlug = () => (cfg.REALM_SLUGS && cfg.REALM_SLUGS[0]) || ''
const getSalesEvents = () => salesEvents
const getLastTrackSummary = () => lastTrackSummary

registerDebugRoutes(app, {
  getAuctionsCache,
  normalizeAuctions,
  getSalesEvents,
  getLastTrackSummary,
  aggregateLocalSales,
})

registerBlizzardRoutes(app, {
  getAuctionsCache,
  normalizeAuctions,
  refreshAuctionsNow,
  getDefaultSlug,
  pollingStatus,
})

// Lightweight accessors for route modules
const getItemIcon = (id) => getCachedItemIcon(Number(id))
const getMetricsPayload = () => ({
  auctions: auctionsCache ? { connectedRealmId: auctionsCache.connectedRealmId, lastFetched: auctionsCache.lastFetched, hasData: !!auctionsCache.data } : {},
  metrics,
  localTop: { versions: { current: localTopVersion }, cachedWindows: [...localTopCache.byHours.keys()] },
  catalog: { status: getCatalogStatus(), rebuild: catalogRebuildState, config: { AUTO_CATALOG_REBUILD, CATALOG_MIN_COUNT, CATALOG_REFRESH_HOURS } },
})
const getLocalTopCache = () => localTopCache

// Register remaining modular routes BEFORE inline endpoints (so these take precedence)
registerCatalogRoutes(app, {
  getCatalogStatus,
  catalogRebuildState,
  AUTO_CATALOG_REBUILD,
  CATALOG_MIN_COUNT,
  CATALOG_REFRESH_HOURS,
  maybeRebuildCatalog,
  loadCatalogFromDisk,
  rebuildItemCatalog,
})

registerSystemRoutes(app, { getMetricsPayload, getAuctionsCache, getLocalTopCache, aggregateLocalSales, getCatalogMap })

registerIntegrationsRoutes(app, {
  getTSMStatus,
  getTUJStatus,
  getNexusHubStatus,
})

registerItemsRoutes(app, {
  getItem: getItemCached,
  getItemMedia: getItemMediaCached,
  getCachedItemName,
  getCachedItemIcon,
  setCachedItemName,
  setCachedItemIcon,
})

registerStatsRoutes(app, {
  aggregateLocalSales,
  getCatalogMap,
  getItemIcon,
  getLocalTopCache,
  getNexusHubRegionSold,
})



registerPricesRoutes(app, {
  getAuctionsCache,
  getDefaultSlug,
  normalizeAuctions,
  searchConnectedRealmByRealmSlug,
  getConnectedRealm,
  getConnectedRealmAuctions,
  buildFairMap,
})

// AI/ML routes (ETA, policy recommend, change-points)
registerAIRoutes(app, {
  getAuctionsCache,
  normalizeAuctions,
  aggregateLocalSales,
  getDefaultSlug,
  buildFairMap,
})

// Player stats routes (accounting ingestion, stats, awaiting payouts)
registerPlayerRoutes(app, {})

let savedVarsWatcher = null
// Optional: watch WoW SavedVariables to auto-ingest EG_AccountingDB
try {
  const savedVarsPath = process.env.SAVEDVARS_PATH
  if (savedVarsPath) {
    savedVarsWatcher = startSavedVarsWatcher({ path: savedVarsPath, intervalMs: process.env.SAVEDVARS_WATCH_MS || 30000 })
    console.info('[player] SavedVariables watcher', savedVarsWatcher.running ? 'started' : 'not started', 'path=', savedVarsPath)
  } else {
    console.info('[player] SAVEDVARS_PATH not set; skipping SavedVariables watcher')
  }
} catch (e) {
  console.warn('[player] SavedVariables watcher failed to start:', e?.message || e)
}

function trackEndedAuctions(prevPayload, newPayload) {
  try {
    const prev = normalizeAuctions(prevPayload || {})
    const nowList = normalizeAuctions(newPayload || {})
    const nowById = new Map(nowList.map(a => [a.auctionId, a]))
    const nowIds = new Set(nowList.map(a => a.auctionId))
    const ended = prev.filter(a => !nowIds.has(a.auctionId))
    const nowSec = Math.floor(Date.now()/1000)

    // Record fully ended auctions
    let added = 0
    for (const a of ended) {
      if (!a.itemId) continue
      salesEvents.push({ t: nowSec, itemId: a.itemId, quantity: a.quantity || 0 })
      added++
    }

    // Record partial sales when the same auction persists but with reduced quantity (common for commodities)
    for (const p of prev) {
      const cur = nowById.get(p.auctionId)
      if (!cur) continue
      const pQty = Number(p.quantity || 0)
      const cQty = Number(cur.quantity || 0)
      if (Number.isFinite(pQty) && Number.isFinite(cQty) && cQty < pQty && p.itemId) {
        const delta = pQty - cQty
        if (delta > 0) { salesEvents.push({ t: nowSec, itemId: p.itemId, quantity: delta }); added++ }
      }
    }

    // Fallbacks for commodities when auctionIds churn
    if (!ended.length && added === 0) {
      // 1) Per (itemId, unitPrice) bucket deltas
      const sumByItemPrice = (arr) => {
        const m = new Map() // key: `${itemId}:${unitPrice}` -> qty
        for (let i = 0; i < arr.length; i++) {
          const a = arr[i]
          const id = a && a.itemId
          const q = Number(a && a.quantity || 0)
          const p = Number(a && a.unitPrice || 0)
          if (!id || !Number.isFinite(q) || q <= 0) continue
          const key = `${id}:${p}`
          m.set(key, (m.get(key) || 0) + q)
        }
        return m
      }
      const prevByIP = sumByItemPrice(prev)
      const nowByIP = sumByItemPrice(nowList)
      let fallbackAdds = 0
      for (const [key, pQty] of prevByIP.entries()) {
        const cQty = Number(nowByIP.get(key) || 0)
        if (Number.isFinite(pQty) && Number.isFinite(cQty) && cQty < pQty) {
          const delta = pQty - cQty
          if (delta > 0) {
            const [idStr] = key.split(':')
            const itemId = Number(idStr)
            if (itemId) { salesEvents.push({ t: nowSec, itemId, quantity: delta }); fallbackAdds++ }
          }
        }
      }
      // 2) If still nothing, fall back to total-per-item deltas
      if (fallbackAdds === 0) {
        const sumByItem = (arr) => {
          const m = new Map()
          for (let i = 0; i < arr.length; i++) {
            const a = arr[i]
            const id = a && a.itemId
            const q = Number(a && a.quantity || 0)
            if (!id || !Number.isFinite(q) || q <= 0) continue
            m.set(id, (m.get(id) || 0) + q)
          }
          return m
        }
        const prevByItem = sumByItem(prev)
        const nowByItem = sumByItem(nowList)
        for (const [itemId, pQty] of prevByItem.entries()) {
          const cQty = Number(nowByItem.get(itemId) || 0)
          if (Number.isFinite(pQty) && Number.isFinite(cQty) && cQty < pQty) {
            const delta = pQty - cQty
            if (delta > 0) { salesEvents.push({ t: nowSec, itemId: Number(itemId), quantity: delta }); fallbackAdds++ }
          }
        }
      }
      if (fallbackAdds === 0) {
        // still nothing to do
        lastTrackSummary = { ts: nowSec, prevCount: prev.length, nowCount: nowList.length, endedCount: 0, partialAdds: 0 }
        if (process.env.DEBUG_SALES === '1') {
          console.debug(`[EG] SalesTrack: prev=${prev.length} now=${nowList.length} ended=0 partialAdds=0 (no changes)`) 
        }
        return
      }
      added += fallbackAdds
    }
    // keep last 72h to bound size
    const cutoff = nowSec - (72*3600)
    salesEvents = salesEvents.filter(e => e.t >= cutoff)
    saveSalesToDisk()
    // bump version and rebuild local cache in background
    localTopVersion++
    lastTrackSummary = { ts: nowSec, prevCount: prev.length, nowCount: nowList.length, endedCount: ended.length, partialAdds: added }
    if (process.env.DEBUG_SALES === '1') {
      console.debug(`[EG] SalesTrack: prev=${prev.length} now=${nowList.length} ended=${ended.length} partialAdds=${added} version=${localTopVersion}`)
    }
    setTimeout(rebuildLocalTopCache, 0)
  } catch {}
}

function computeTopSold(hours = 48, limit = 400) {
  const nowSec = Math.floor(Date.now()/1000)
  const cutoff = nowSec - Math.max(1, hours) * 3600
  const agg = new Map() // itemId -> { qty, cnt }
  for (const e of salesEvents) {
    if (e.t < cutoff) continue
    const cur = agg.get(e.itemId) || { qty: 0, cnt: 0 }
    cur.qty += (e.quantity || 0)
    cur.cnt += 1
    agg.set(e.itemId, cur)
  }
  const out = [...agg.entries()].map(([itemId, v]) => ({ itemId: Number(itemId), quantity: v.qty, endedCount: v.cnt }))
  out.sort((a,b) => b.quantity - a.quantity)
  return out.slice(0, limit)
}

// Helper: aggregate full local sales map for a window (no limit)
function aggregateLocalSales(hours = 48) {
  const nowSec = Math.floor(Date.now()/1000)
  const cutoff = nowSec - Math.max(1, hours) * 3600
  const agg = new Map()
  for (const e of salesEvents) {
    if (e.t < cutoff) continue
    const cur = agg.get(e.itemId) || { qty: 0, cnt: 0 }
    cur.qty += (e.quantity || 0)
    cur.cnt += 1
    agg.set(e.itemId, cur)
  }
  return agg // itemId -> { qty, cnt }
}

// Metrics
const metrics = {
  auctions: { refreshCount: 0, lastDurationMs: 0, lastError: null },
  prices: { buildCount: 0, lastDurationMs: 0 },
  requests: { snipeCount: 0, fairValuesCount: 0 },
  items: { cacheHits: 0, cacheMisses: 0, fetchedCount: 0 },
}

// Item metadata caches (in-memory with TTL)
const ITEM_TTL_SEC = 24 * 3600
const itemNameCache = new Map() // itemId -> { name, last }
const itemIconCache = new Map() // itemId -> { icon, last }

function getCachedItemName(id) {
  const v = itemNameCache.get(id)
  const now = Math.floor(Date.now()/1000)
  if (v && (now - v.last) < ITEM_TTL_SEC) { metrics.items.cacheHits++; return v.name }
  if (v) itemNameCache.delete(id)
  metrics.items.cacheMisses++
  return ''
}
function setCachedItemName(id, name) {
  itemNameCache.set(id, { name: String(name||'') || String(id), last: Math.floor(Date.now()/1000) })
}
function getCachedItemIcon(id) {
  const v = itemIconCache.get(id)
  const now = Math.floor(Date.now()/1000)
  if (v && (now - v.last) < ITEM_TTL_SEC) { metrics.items.cacheHits++; return v.icon }
  if (v) itemIconCache.delete(id)
  metrics.items.cacheMisses++
  return ''
}
function setCachedItemIcon(id, icon) {
  itemIconCache.set(id, { icon: String(icon||''), last: Math.floor(Date.now()/1000) })
}

// Lazy-load Blizzard item catalog into a Map(itemId -> name)
let __eg_item_catalog_map = null
let __eg_item_catalog_loaded_at = 0
function getCatalogMap() {
  const now = Math.floor(Date.now()/1000)
  if (!__eg_item_catalog_map || (now - __eg_item_catalog_loaded_at) > 900) {
    try {
      const cat = loadCatalogFromDisk()
      const m = new Map()
      if (cat && Array.isArray(cat.items)) {
        for (const it of cat.items) {
          if (it && it.id) m.set(Number(it.id), String(it.name || ''))
        }
      }
      __eg_item_catalog_map = m
      __eg_item_catalog_loaded_at = now
    } catch {}
  }
  return __eg_item_catalog_map || new Map()
}

// Background-cached TSM Top Sold (true top within a large curated id set)
const _TSM_TOP_TTL_SEC = 6 * 3600
const _tsmTopCache = { lastBuilt: 0, items: [], building: false }

// Background-cached Local Top Sold (by ended auctions). We cache for common windows
const LOCAL_TOP_CACHE_MAX = 5000
let localTopVersion = 0 // incremented whenever salesEvents change
const localTopCache = {
  byHours: new Map(), // hours -> { items, builtAt, version }
}

async function rebuildLocalTopCache() {
  try {
    const windows = [6, 12, 24, 48]
    for (const h of windows) {
      const items = computeTopSold(h, LOCAL_TOP_CACHE_MAX).map(it => ({ itemId: it.itemId, soldPerDay: Number((it.quantity || 0) / Math.max(1e-6, h/24)) }))
      // Enrich names from catalog if available (no extra Blizzard calls needed)
      try {
        const cmap = getCatalogMap()
        if (cmap && cmap.size) {
          for (const it of items) {
            const nm = cmap.get(it.itemId)
            if (nm) setCachedItemName(it.itemId, nm)
          }
        }
      } catch {}
      // Prefetch top icons (best effort, throttled, skip if cached)
      try {
        const topForIcons = items.slice(0, 200)
        let fetched = 0
        for (const it of topForIcons) {
          if (getCachedItemIcon(it.itemId)) continue
          try {
            const media = await getItemMediaCached(it.itemId)
            const icon = media?.assets?.[0]?.value || ''
            if (icon) setCachedItemIcon(it.itemId, icon)
            fetched++
            if (fetched % 10 === 0) await new Promise(r => setTimeout(r, 100))
          } catch {}
        }
      } catch {}
      localTopCache.byHours.set(h, { items, builtAt: Math.floor(Date.now()/1000), version: localTopVersion })
    }
  } catch {}
}

// ... (rest of the code remains the same)

// Local Top Sold endpoint (by ended auctions -> soldPerDay)
app.get('/stats/top-sold-local', async (req, res) => {
  try {
    const hours = Math.max(1, Math.min(24 * 365, Number(req.query.hours || 48)))
    const limit = Math.max(1, Math.min(5000, Number(req.query.limit || 400)))
    const live = String(req.query.mode || '').toLowerCase() === 'live'
    // serve from cache if version matches
    const cached = localTopCache.byHours.get(hours)
    if (!live && cached && cached.items?.length) {
      const items = cached.items.slice(0, limit)
      return res.json({ source: 'local-cache', hours, limit, count: items.length, builtAt: cached.builtAt, items })
    }
    const rows = computeTopSold(hours, LOCAL_TOP_CACHE_MAX)
    const items = rows.map(it => ({ itemId: it.itemId, soldPerDay: Number((it.quantity || 0) / Math.max(1e-6, hours/24)) }))
      .sort((a,b) => b.soldPerDay - a.soldPerDay)
      .slice(0, limit)
    // Enrich names and icons from catalog if available (no extra Blizzard calls needed)
    try {
      const cmap = getCatalogMap()
      if (cmap && cmap.size) {
        for (const it of items) {
          const nm = cmap.get(it.itemId)
          if (nm) it.name = nm
          const ic = itemIconCache.get(it.itemId)
          if (ic) it.icon = ic
        }
      }
    } catch {}
    return res.json({ source: 'local', hours, limit, count: items.length, cached: false, items })
  } catch (e) {
    return res.status(500).json({ error: 'top_sold_local_failed', message: e?.message || String(e) })
  }
})

// (moved) /blizzard/auctions/refresh is now registered via routes/blizzard.js



 

// Expose raw local sales aggregates for a window (debug/analytics)
app.get('/stats/local-sales/summary', async (req, res) => {
  try {
    const hours = Math.max(1, Math.min(24 * 365, Number(req.query.hours || 48)))
    const agg = aggregateLocalSales(hours)
    const out = {}
    for (const [itemId, v] of agg.entries()) out[itemId] = { quantity: v.qty, endedCount: v.cnt }
    return res.json({ hours, count: Object.keys(out).length, items: out })
  } catch (e) {
    return res.status(500).json({ error: 'local_sales_summary_failed', message: e?.message || String(e) })
  }
})

// Full local Top view backed by the Blizzard catalog.
// Supports includeZero to list items with zero sales (for full-universe scanning), pagination via offset/limit.
app.get('/stats/top-sold-local/all', async (req, res) => {
  try {
    const hours = Math.max(1, Math.min(24 * 365, Number(req.query.hours || 48)))
    const includeZero = String(req.query.includeZero || '0') === '1'
    const limit = Math.max(1, Math.min(5000, Number(req.query.limit || 400)))
    const offset = Math.max(0, Number(req.query.offset || 0))

    const agg = aggregateLocalSales(hours)
    const cmap = getCatalogMap()
    const items = []

    if (cmap && cmap.size) {
      for (const [id, name] of cmap.entries()) {
        const v = agg.get(id)
        const qty = v?.qty || 0
        const soldPerDay = Number(qty / Math.max(1e-6, hours/24))
        if (!includeZero && soldPerDay <= 0) continue
        const row = { itemId: id, soldPerDay }
        if (name) row.name = name
        const ic = getCachedItemIcon(id)
        if (ic) row.icon = ic
        items.push(row)
      }
    } else {
      // Fallback to only aggregated items if catalog missing
      for (const [id, v] of agg.entries()) {
        const qty = v?.qty || 0
        const soldPerDay = Number(qty / Math.max(1e-6, hours/24))
        items.push({ itemId: id, soldPerDay })
      }
    }

    items.sort((a,b) => b.soldPerDay - a.soldPerDay)
    const paged = items.slice(offset, offset + limit)
    return res.json({ source: 'local-all', hours, includeZero, offset, limit, total: items.length, items: paged })
  } catch (e) {
    return res.status(500).json({ error: 'top_sold_local_all_failed', message: e?.message || String(e) })
  }
})

// Health and metrics
app.get('/health', (req, res) => {
  res.json({ ok: true, ts: Math.floor(Date.now()/1000) })
})
app.get('/metrics', (req, res) => {
  res.json({
    auctions: auctionsCache ? { connectedRealmId: auctionsCache.connectedRealmId, lastFetched: auctionsCache.lastFetched, hasData: !!auctionsCache.data } : {},
    metrics,
    localTop: { versions: { current: localTopVersion }, cachedWindows: [...localTopCache.byHours.keys()] },
    catalog: { status: getCatalogStatus(), rebuild: catalogRebuildState, config: { AUTO_CATALOG_REBUILD, CATALOG_MIN_COUNT, CATALOG_REFRESH_HOURS } },
  })
})

// Catalog search by name (debug helper)
app.get('/catalog/search', (req, res) => {
  try {
    const rawQ = String(req.query.q || '').trim()
    const q = rawQ.toLowerCase()
    if (!q) return res.status(400).json({ error: 'missing_query' })
    const cat = loadCatalogFromDisk()
    const out = []
    const isNum = /^\d+$/.test(rawQ)
    const qId = isNum ? Number(rawQ) : null
    for (const it of cat.items || []) {
      const nm = it?.name?.en_GB || it?.name?.en_US || it?.name || ''
      const nameHit = (typeof nm === 'string' && nm.toLowerCase().includes(q))
      const idHit = (isNum && Number(it?.id) === qId)
      if (nameHit || idHit) {
        out.push({ id: it.id, name: nm })
        if (out.length >= 50) break
      }
    }
    return res.json({ count: out.length, items: out })
  } catch (e) {
    return res.status(500).json({ error: 'catalog_search_failed', message: e?.message || String(e) })
  }
})

// Single item sales aggregation for a window (debug)
// Catalog status endpoint
app.get('/catalog/status', (req, res) => {
  try {
    return res.json({ status: getCatalogStatus(), rebuild: catalogRebuildState, config: { AUTO_CATALOG_REBUILD, CATALOG_MIN_COUNT, CATALOG_REFRESH_HOURS } })
  } catch (e) {
    return res.status(500).json({ error: 'catalog_status_failed', message: e?.message || String(e) })
  }
})

// Manual trigger for catalog rebuild
app.post('/catalog/rebuild', async (req, res) => {
  try {
    if (catalogRebuildState.running) return res.json({ ok: true, running: true })
    const reason = String(req.query.reason || 'manual')
    setTimeout(() => { maybeRebuildCatalog(reason) }, 0)
    return res.json({ ok: true, scheduled: true })
  } catch (e) {
    return res.status(500).json({ error: 'catalog_rebuild_failed', message: e?.message || String(e) })
  }
})

// Integration statuses
app.get('/integrations/status', async (req, res) => {
  try {
    const [tsm, tuj, nexus] = await Promise.allSettled([
      getTSMStatus?.(),
      getTUJStatus?.(),
      getNexusHubStatus?.(),
    ])
    const unwrap = (r) => r.status === 'fulfilled' ? r.value : { error: r.reason?.message || String(r.reason || 'failed') }
    res.json({
      tsm: unwrap(tsm),
      tuj: unwrap(tuj),
      nexushub: unwrap(nexus),
      features: { DISABLE_NEXUSHUB: process.env.DISABLE_NEXUSHUB === '1' },
    })
  } catch (e) {
    res.status(500).json({ error: 'status_failed', message: e?.message || String(e) })
  }
})

// Region Top Sold (TSM/NexusHub) - cached by default
app.get('/stats/top-sold-region', async (req, res) => {
  try {
    if (process.env.DISABLE_NEXUSHUB === '1') {
      return res.status(404).json({ error: 'disabled', message: 'NexusHub integration disabled' })
    }
    const limit = Math.max(1, Math.min(5000, Number(req.query.limit || 400)))
    const mode = String(req.query.mode || 'cache') // 'cache' or 'fetch'
    // Prefer cached pull; allow provider to decide based on mode
    const items = await getNexusHubRegionSold?.({ mode, limit })
    if (!Array.isArray(items) || items.length === 0) {
      return res.status(404).json({ error: 'no_region_data', message: 'No region top-sold data available' })
    }
    return res.json({ source: 'region', mode, limit, count: Math.min(items.length, limit), items: items.slice(0, limit), cached: mode !== 'fetch' })
  } catch (e) {
    return res.status(500).json({ error: 'top_sold_region_failed', message: e?.message || String(e) })
  }
})

// Blizzard auctions fetch endpoint (ingest + cache + sales tracking)
app.get('/blizzard/auctions', async (req, res) => {
  try {
    const slug = (req.query.slug || cfg.REALM_SLUGS[0]).trim()
    const force = String(req.query.force ?? '0') === '1'
    if (!force && auctionsCache.data) {
      return res.json({ connectedRealmId: auctionsCache.connectedRealmId, lastFetched: auctionsCache.lastFetched, cached: true })
    }
    const search = await searchConnectedRealmByRealmSlug(slug)
    if (!search?.results?.length) return res.status(404).json({ error: 'not_found', message: `No connected realm for slug ${slug}` })
    const conn = await getConnectedRealm(search.results[0].key.href)
    const data = await getConnectedRealmAuctions(conn.id)
    if (data && data.notModified && auctionsCache.data) {
      // Advertise notModified and return cache metadata
      return res.json({ connectedRealmId: auctionsCache.connectedRealmId || conn.id, lastFetched: auctionsCache.lastFetched, cached: true, notModified: true })
    }
    const prev = auctionsCache.data
    auctionsCache.connectedRealmId = conn.id
    auctionsCache.prev = prev
    auctionsCache.data = data
    auctionsCache.lastFetched = Math.floor(Date.now()/1000)
    if (prev) trackEndedAuctions(prev, data)
    saveAuctionsToDisk()
    return res.json({ connectedRealmId: conn.id, lastFetched: auctionsCache.lastFetched, cached: false })
  } catch (e) {
    return res.status(500).json({ error: 'auctions_failed', message: e?.message || String(e) })
  }
})

// Note: /blizzard/item-names is handled in routes/items.js

// Item catalog (Blizzard-only) status
app.get('/blizzard/items/catalog/status', (req, res) => {
  try {
    const s = getCatalogStatus()
    return res.json({ source: 'blizzard', ...s })
  } catch (e) {
    return res.status(500).json({ error: 'catalog_status_failed', message: e?.message || String(e) })
  }
})

// Trigger/resume item catalog rebuild (background)
app.post('/blizzard/items/catalog/rebuild', async (req, res) => {
  try {
    const resume = String(req.query.resume ?? '1') !== '0'
    const pageLimit = Number(req.query.pageLimit || 0)
    setTimeout(async () => {
      try { await rebuildItemCatalog({ resume, pageLimit }) } catch (e) { console.warn('[EG] Catalog rebuild failed', e?.message) }
    }, 0)
    return res.json({ started: true, resume, pageLimit })
  } catch (e) {
    return res.status(500).json({ error: 'catalog_rebuild_failed', message: e?.message || String(e) })
  }
})



// /prices/export handled by routes/prices.js

const port = cfg.PORT
const server = app.listen(port, () => {
  console.info(`[EG] Companion listening on :${port}`)
})

// Graceful shutdown and error handling
function shutdown() {
  if (isShuttingDown) return
  isShuttingDown = true
  console.info('[EG] Shutting down...')
  try { if (autoRefreshTimer) clearInterval(autoRefreshTimer) } catch {}
  try { if (savedVarsWatcher && typeof savedVarsWatcher.stop === 'function') savedVarsWatcher.stop() } catch {}
  try {
    server.close(() => {
      console.info('[EG] Server closed')
      process.exit(0)
    })
    // Fallback hard-exit after timeout
    setTimeout(() => process.exit(0), 5000)
  } catch {
    process.exit(0)
  }
}

process.on('SIGINT', shutdown)
process.on('SIGTERM', shutdown)
process.on('uncaughtException', (e) => { try { console.error('[EG] Uncaught exception:', e?.stack || e) } catch {}
  shutdown()
})
process.on('unhandledRejection', (r) => { try { console.error('[EG] Unhandled rejection:', r) } catch {}
  shutdown()
})
