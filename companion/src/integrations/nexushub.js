import axios from 'axios'
import { loadConfig } from '../config.js'

// Simple caches
const cache = new Map() // key: realmSlug, value: { ts, data: { [itemId]: price } }
const regionCache = new Map() // key: region, value: { ts, data: { [itemId]: soldPerDay } }

function nowSec() { return Math.floor(Date.now() / 1000) }

function normalizePriceMap(payload) {
  if (!payload) {return {}}
  const src = payload.prices && typeof payload.prices === 'object' ? payload.prices : payload
  const out = {}
  for (const [k, v] of Object.entries(src || {})) {
    const id = Number(k)
    const val = Number(v)
    if (!Number.isNaN(id) && val > 0) {out[id] = Math.floor(val)}
  }
  return out
}

// Returns a map: { [itemId]: priceInCopper }
export async function getNexusHubPriceMap(itemIds = [], realmSlugOverride) {
  const cfg = loadConfig()
  const realm = (realmSlugOverride || cfg.REALM_SLUGS[0])
  const ttl = Math.max(0, Number(cfg.INTEGRATIONS_TTL || 900))
  const urlTpl = cfg.NEXUSHUB_API_URL || ''

  // Serve fresh cache if available
  const entry = cache.get(realm)
  if (entry && ttl > 0 && (nowSec() - entry.ts) < ttl) {
    if (itemIds && itemIds.length) {
      const subset = {}
      for (const id of itemIds) {if (entry.data[id]) {subset[id] = entry.data[id]}}
      return subset
    }
    return entry.data
  }

  if (!urlTpl) {return {}}

  try {
    const url = urlTpl.replace('{region}', cfg.REGION).replace('{realm}', realm)
    const { data } = await axios.get(url, { timeout: 10000 })
    const map = normalizePriceMap(data)
    cache.set(realm, { ts: nowSec(), data: map })

    if (itemIds && itemIds.length) {
      const subset = {}
      for (const id of itemIds) {if (map[id]) {subset[id] = map[id]}}
      return subset
    }
    return map
  } catch (err) {
    console.error('[EG] NexusHub fetch failed', err?.response?.data || err?.message)
    return entry?.data || {}
  }
}

export function getNexusHubStatus(realmSlugOverride) {
  const cfg = loadConfig()
  const realm = (realmSlugOverride || cfg.REALM_SLUGS[0])
  const entry = cache.get(realm)
  return {
    realm,
    configured: !!cfg.NEXUSHUB_API_URL,
    lastFetched: entry?.ts || 0,
    cachedCount: entry ? Object.keys(entry.data || {}).length : 0,
    ttl: Number(cfg.INTEGRATIONS_TTL || 0),
  }
}

// Returns a map: { [itemId]: soldPerDay } for the configured region
export async function getNexusHubRegionSold(limit) {
  const cfg = loadConfig()
  const region = cfg.REGION
  const ttl = Math.max(0, Number(cfg.INTEGRATIONS_TTL || 900))
  const urlTpl = cfg.NEXUSHUB_REGION_SALES_URL || ''
  if (!urlTpl) {return {}}

  const entry = regionCache.get(region)
  if (entry && ttl > 0 && (Math.floor(Date.now()/1000) - entry.ts) < ttl) {
    // Return possibly truncated copy
    const src = entry.data || {}
    const pairs = Object.entries(src).map(([k,v]) => [Number(k), Number(v)])
    pairs.sort((a,b) => b[1] - a[1])
    const sliced = typeof limit === 'number' && limit > 0 ? pairs.slice(0, limit) : pairs
    const map = {}
    for (const [id, val] of sliced) {map[id] = val}
    return map
  }

  try {
    const url = urlTpl.replace('{region}', region)
    const { data } = await axios.get(url, { timeout: 12000 })
    const out = {}
    if (Array.isArray(data?.items)) {
      for (const it of data.items) {
        const id = Number(it.itemId ?? it.id)
        const rate = Number(it.soldPerDay ?? it.sold_day ?? it.salesPerDay ?? it.sold)
        if (!Number.isNaN(id) && rate > 0) {out[id] = rate}
      }
    } else if (typeof data === 'object' && data) {
      const src = data.sold || data.regionSold || data
      for (const [k,v] of Object.entries(src)) {
        const id = Number(k)
        const rate = Number(v?.soldPerDay ?? v)
        if (!Number.isNaN(id) && rate > 0) {out[id] = rate}
      }
    }
    regionCache.set(region, { ts: Math.floor(Date.now()/1000), data: out })
    // Return limited map if requested
    const pairs = Object.entries(out).map(([k,v]) => [Number(k), Number(v)])
    pairs.sort((a,b) => b[1] - a[1])
    const sliced = typeof limit === 'number' && limit > 0 ? pairs.slice(0, limit) : pairs
    const map = {}
    for (const [id, val] of sliced) {map[id] = val}
    return map
  } catch (err) {
    console.error('[EG] NexusHub region sold fetch failed', err?.response?.data || err?.message)
    return entry?.data || {}
  }
}
