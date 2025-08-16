import axios from 'axios'
import http from 'http'
import https from 'https'
import fs from 'fs'
import path from 'path'
import { fileURLToPath } from 'url'
import { loadConfig } from '../config.js'

// Use global OAuth endpoint to avoid region-specific auth issues
const OAUTH_URL = `https://oauth.battle.net/token`
const LOCALE = 'en_GB'

let tokenCache = { access_token: '', expires_at: 0 }

// Commodities-only, region-wide auctions (conditional GET)
export async function getCommoditiesAuctions() {
  const cfg = loadConfig()
  const token = await getAccessToken()
  const API_BASE = `https://${cfg.REGION}.api.blizzard.com`
  const NAMESPACE = `dynamic-${cfg.REGION}`
  const commoditiesUrl = `${API_BASE}/data/wow/auctions/commodities`
  const res = await getWithRetryConditional(commoditiesUrl, {
    params: { namespace: NAMESPACE, locale: LOCALE },
    headers: { Authorization: `Bearer ${token}` },
    key: commoditiesUrl,
  })
  return { commodities: res?.data?.auctions || [], notModified: !!res?.notModified }
}
// Keep-alive and compression for faster repeated requests
const keepAliveHttp = new http.Agent({ keepAlive: true, maxSockets: 20 })
const keepAliveHttps = new https.Agent({ keepAlive: true, maxSockets: 20 })
const ax = axios.create({
  httpAgent: keepAliveHttp,
  httpsAgent: keepAliveHttps,
  decompress: true,
  headers: { 'Accept-Encoding': 'gzip, deflate, br' },
  timeout: 30000,
})

// In-flight GET coalescing to dedupe concurrent identical requests
const inflightGet = new Map() // key -> Promise
function inflightKey(url, params) {
  try { return url + '|' + JSON.stringify(params || {}) } catch { return url }
}
function coalesceGet(key, fn) {
  const p = inflightGet.get(key)
  if (p) {return p}
  const np = (async () => {
    try { return await fn() } finally { inflightGet.delete(key) }
  })()
  inflightGet.set(key, np)
  return np
}

// ETag/Last-Modified persistence for conditional GETs
const __filename = fileURLToPath(import.meta.url)
const __dirname = path.dirname(__filename)
const cacheDir = path.join(__dirname, '..', '.cache')
const etagPath = path.join(cacheDir, 'blizzard-etags.json')
let etags = {}
try {
  if (fs.existsSync(etagPath)) {etags = JSON.parse(fs.readFileSync(etagPath, 'utf8')) || {}}
} catch { etags = {} }
function saveEtags() {
  try {
    if (!fs.existsSync(cacheDir)) {fs.mkdirSync(cacheDir, { recursive: true })}
    fs.writeFileSync(etagPath, JSON.stringify(etags), 'utf8')
  } catch {}
}
function getCondHeaders(key) {
  const rec = etags[key]
  const h = {}
  if (rec?.etag) {h['If-None-Match'] = rec.etag}
  if (rec?.lm) {h['If-Modified-Since'] = rec.lm}
  return h
}
function setCondFromResponse(key, res) {
  try {
    const et = res?.headers?.etag
    const lm = res?.headers?.['last-modified']
    if (!et && !lm) {return}
    etags[key] = { etag: et || etags[key]?.etag || '', lm: lm || etags[key]?.lm || '' }
    saveEtags()
  } catch {}
}

// Fetch item media (icon URL) from Static namespace
export async function getItemMedia(itemId) {
  const cfg = loadConfig()
  const token = await getAccessToken()
  const API_BASE = `https://${cfg.REGION}.api.blizzard.com`
  const NAMESPACE = `static-${cfg.REGION}`
  const url = `${API_BASE}/data/wow/media/item/${itemId}`
  const res = await getWithRetryConditional(url, {
    params: { namespace: NAMESPACE, locale: LOCALE },
    headers: { Authorization: `Bearer ${token}` },
    key: url,
  })
  return res?.data || null
}

export async function getAccessToken() {
  const cfg = loadConfig()
  const now = Date.now() / 1000
  if (tokenCache.access_token && tokenCache.expires_at > now + 30) {
    return tokenCache.access_token
  }
  const params = new URLSearchParams()
  params.append('grant_type', 'client_credentials')
  const { data } = await ax.post(OAUTH_URL, params, {
    auth: { username: cfg.BLIZZARD_CLIENT_ID, password: cfg.BLIZZARD_CLIENT_SECRET },
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
  })
  tokenCache = {
    access_token: data.access_token,
    expires_at: now + (data.expires_in || 1800),
  }
  return tokenCache.access_token
}

async function getWithRetry(url, { params = {}, headers = {}, retries = 3, backoffMs = 500 } = {}) {
  let lastErr
  const key = inflightKey(url, params)
  return await coalesceGet(key, async () => {
    for (let i = 0; i <= retries; i++) {
      try {
        const { data } = await ax.get(url, { params, headers })
        return data
      } catch (e) {
        lastErr = e
        const status = e?.response?.status
        const code = e?.code
        // Auto-refresh token on 401 once per attempt
        if (status === 401 && headers && headers.Authorization) {
          try {
            tokenCache = { access_token: '', expires_at: 0 }
            const t = await getAccessToken()
            headers = { ...headers, Authorization: `Bearer ${t}` }
            continue
          } catch {}
        }
        const retryableNetwork = !status && (code === 'ECONNRESET' || code === 'ETIMEDOUT' || code === 'ENOTFOUND' || code === 'EAI_AGAIN' || code === 'ESOCKETTIMEDOUT')
        if (i === retries || (!retryableNetwork && status && status < 500 && status !== 429)) {break}
        // Honor Retry-After when present, add jitter
        let delay = backoffMs * Math.pow(2, i)
        const ra = Number(e?.response?.headers?.['retry-after'] || 0)
        if (Number.isFinite(ra) && ra > 0) {delay = Math.max(delay, ra * 1000)}
        delay = Math.floor(delay * (1 + Math.random() * 0.25))
        await new Promise(r => setTimeout(r, delay))
      }
    }
    throw lastErr
  })
}

// Extended: conditional GET with 304 support
async function getWithRetryConditional(url, { params = {}, headers = {}, key = url, retries = 3, backoffMs = 500 } = {}) {
  let lastErr
  // coalesce by url+params too, but keep ETag key for conditional headers
  const inflight = inflightKey(url, params)
  return await coalesceGet(inflight, async () => {
    let baseHeaders = { ...headers, ...getCondHeaders(key) }
    for (let i = 0; i <= retries; i++) {
      try {
        const res = await ax.get(url, { params, headers: baseHeaders, validateStatus: s => (s >= 200 && s < 300) || s === 304 })
        if (res.status === 304) {
          return { notModified: true, data: null }
        }
        setCondFromResponse(key, res)
        return { notModified: false, data: res.data }
      } catch (e) {
        lastErr = e
        const status = e?.response?.status
        const code = e?.code
        if (status === 401 && baseHeaders && baseHeaders.Authorization) {
          try {
            tokenCache = { access_token: '', expires_at: 0 }
            const t = await getAccessToken()
            baseHeaders = { ...baseHeaders, Authorization: `Bearer ${t}` }
            continue
          } catch {}
        }
        const retryableNetwork = !status && (code === 'ECONNRESET' || code === 'ETIMEDOUT' || code === 'ENOTFOUND' || code === 'EAI_AGAIN' || code === 'ESOCKETTIMEDOUT')
        if (i === retries || (!retryableNetwork && status && status < 500 && status !== 429)) {break}
        let delay = backoffMs * Math.pow(2, i)
        const ra = Number(e?.response?.headers?.['retry-after'] || 0)
        if (Number.isFinite(ra) && ra > 0) {delay = Math.max(delay, ra * 1000)}
        delay = Math.floor(delay * (1 + Math.random() * 0.25))
        await new Promise(r => setTimeout(r, delay))
      }
    }
    throw lastErr
  })
}

export async function searchConnectedRealmByRealmSlug(slug) {
  const cfg = loadConfig()
  const token = await getAccessToken()
  const API_BASE = `https://${cfg.REGION}.api.blizzard.com`
  const NAMESPACE = `dynamic-${cfg.REGION}`
  const url = `${API_BASE}/data/wow/search/connected-realm`
  return await getWithRetry(url, {
    params: {
      namespace: NAMESPACE,
      locale: LOCALE,
      'realms.slug': slug,
      orderby: 'id',
      _page: 1,
    },
    headers: { Authorization: `Bearer ${token}` },
  })
}

export async function getConnectedRealm(connectedHref) {
  const _cfg = loadConfig()
  const token = await getAccessToken()
  return await getWithRetry(connectedHref, {
    params: { locale: LOCALE },
    headers: { Authorization: `Bearer ${token}` },
  })
}

export async function getConnectedRealmAuctions(connectedRealmId) {
  const cfg = loadConfig()
  const token = await getAccessToken()
  const API_BASE = `https://${cfg.REGION}.api.blizzard.com`
  const NAMESPACE = `dynamic-${cfg.REGION}`
  // Fetch both item auctions and commodities auctions and return a combined payload
  const itemsUrl = `${API_BASE}/data/wow/connected-realm/${connectedRealmId}/auctions`
  // Commodities are region-wide, not per connected-realm
  const commoditiesUrl = `${API_BASE}/data/wow/auctions/commodities`
  const common = { params: { namespace: NAMESPACE, locale: LOCALE }, headers: { Authorization: `Bearer ${token}` } }
  const [itRes, coRes] = await Promise.all([
    getWithRetryConditional(itemsUrl, { ...common, key: itemsUrl }).catch(() => ({ notModified: false, data: { auctions: [] } })),
    getWithRetryConditional(commoditiesUrl, { ...common, key: commoditiesUrl }).catch(() => ({ notModified: false, data: { auctions: [] } })),
  ])
  const notModified = !!(itRes?.notModified && coRes?.notModified)
  const items = itRes?.data || {}
  const commodities = coRes?.data || {}
  return { auctions: items?.auctions || [], commodities: commodities?.auctions || [], notModified }
}

// Fetch item details (name) from Static namespace
export async function getItem(itemId) {
  const cfg = loadConfig()
  const token = await getAccessToken()
  const API_BASE = `https://${cfg.REGION}.api.blizzard.com`
  const NAMESPACE = `static-${cfg.REGION}`
  const url = `${API_BASE}/data/wow/item/${itemId}`
  const res = await getWithRetryConditional(url, {
    params: { namespace: NAMESPACE, locale: LOCALE },
    headers: { Authorization: `Bearer ${token}` },
    key: url,
  })
  return res?.data || null
}

// Lightweight TTL memo for static item/meta calls to cut Battle.net traffic further
const ITEM_TTL_MS = Number(process.env.BLIZZ_ITEM_TTL_MS || 6 * 60 * 60 * 1000)
const MEDIA_TTL_MS = Number(process.env.BLIZZ_MEDIA_TTL_MS || 6 * 60 * 60 * 1000)
const ITEM_CACHE_MAX = Number(process.env.BLIZZ_ITEM_CACHE_MAX || 5000)
const MEDIA_CACHE_MAX = Number(process.env.BLIZZ_MEDIA_CACHE_MAX || 5000)
const itemMemo = new Map() // id -> { exp, val }
const mediaMemo = new Map() // id -> { exp, val }

function memoGet(map, id) {
  const e = map.get(id)
  if (e && e.exp > Date.now()) {return e.val}
  if (e) {map.delete(id)}
  return null
}
function memoSet(map, id, val, ttlMs, max) {
  // naive cap eviction: delete oldest inserted
  if (map.size >= max) {
    const k = map.keys().next().value
    if (k !== undefined) {map.delete(k)}
  }
  map.set(id, { exp: Date.now() + ttlMs, val })
}

// Wrap the exported functions with memoization
const _getItem = getItem
const _getItemMedia = getItemMedia
export async function getItemCached(itemId) {
  const id = Number(itemId)
  const hit = memoGet(itemMemo, id)
  if (hit) {return hit}
  const val = await _getItem(id)
  if (val) {memoSet(itemMemo, id, val, ITEM_TTL_MS, ITEM_CACHE_MAX)}
  return val
}
export async function getItemMediaCached(itemId) {
  const id = Number(itemId)
  const hit = memoGet(mediaMemo, id)
  if (hit) {return hit}
  const val = await _getItemMedia(id)
  if (val) {memoSet(mediaMemo, id, val, MEDIA_TTL_MS, MEDIA_CACHE_MAX)}
  return val
}
