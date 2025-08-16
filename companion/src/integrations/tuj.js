import axios from 'axios'
import { loadConfig } from '../config.js'

// Per-realm cache
const cache = new Map() // realm -> { ts, data }
const nowSec = () => Math.floor(Date.now() / 1000)

function normalizePriceMapTUJ(payload) {
  if (!payload) {return {}}
  // Accept { prices: { [itemId]: copper } } or plain map
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
export async function getTUJPriceMap(itemIds = [], realmSlugOverride) {
  const cfg = loadConfig()
  const realm = (realmSlugOverride || cfg.REALM_SLUGS[0])
  const ttl = Math.max(0, Number(cfg.INTEGRATIONS_TTL || 900))
  const urlTpl = cfg.TUJ_API_URL || ''

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
    const map = normalizePriceMapTUJ(data)
    cache.set(realm, { ts: nowSec(), data: map })
    if (itemIds && itemIds.length) {
      const subset = {}
      for (const id of itemIds) {if (map[id]) {subset[id] = map[id]}}
      return subset
    }
    return map
  } catch (err) {
    console.error('[EG] TUJ fetch failed', err?.response?.data || err?.message)
    return entry?.data || {}
  }
}

export function getTUJStatus(realmSlugOverride) {
  const cfg = loadConfig()
  const realm = (realmSlugOverride || cfg.REALM_SLUGS[0])
  const entry = cache.get(realm)
  return {
    realm,
    configured: !!cfg.TUJ_API_URL,
    lastFetched: entry?.ts || 0,
    cachedCount: entry ? Object.keys(entry.data || {}).length : 0,
    ttl: Number(cfg.INTEGRATIONS_TTL || 0),
  }
}
