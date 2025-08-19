import fs from 'fs'
import path from 'path'
import { fileURLToPath } from 'url'
import { loadConfig } from '../config.js'
import { getAccessToken } from '../integrations/blizzard.js'
import axios from 'axios'

const __filename = fileURLToPath(import.meta.url)
const __dirname = path.dirname(__filename)
const cacheDir = path.join(__dirname, '..', '..', '.cache')
const catalogPath = path.join(cacheDir, 'item-catalog.json')
const checkpointPath = path.join(cacheDir, 'item-catalog.checkpoint.json')

function ensureCacheDir() { try { if (!fs.existsSync(cacheDir)) {fs.mkdirSync(cacheDir, { recursive: true })} } catch {} }

export function loadCatalogFromDisk() {
  try {
    if (fs.existsSync(catalogPath)) {
      const data = JSON.parse(fs.readFileSync(catalogPath, 'utf8'))
      return data && Array.isArray(data.items) ? data : { items: [], lastBuilt: 0, totalPages: 0 }
    }
  } catch (e) { console.warn('[EG] Failed to load item catalog', e?.message) }
  return { items: [], lastBuilt: 0, totalPages: 0 }
}

export function saveCatalogToDisk(data) {
  ensureCacheDir()
  try {
    fs.writeFileSync(catalogPath, JSON.stringify(data), 'utf8')
  } catch (e) { console.warn('[EG] Failed to save item catalog', e?.message) }
}

function saveCheckpoint(cp) {
  ensureCacheDir()
  try { fs.writeFileSync(checkpointPath, JSON.stringify(cp), 'utf8') } catch {}
}
function loadCheckpoint() {
  try { if (fs.existsSync(checkpointPath)) {return JSON.parse(fs.readFileSync(checkpointPath, 'utf8'))} } catch {}
  return null
}

export async function rebuildItemCatalog({ resume = true, pageLimit = 0 } = {}) {
  const cfg = loadConfig()
  const API_BASE = `https://${cfg.REGION}.api.blizzard.com`
  const url = `${API_BASE}/data/wow/search/item`
  const token = await getAccessToken()
  const headers = { Authorization: `Bearer ${token}` }

  // Load existing to allow true resume without losing prior pages
  const existing = resume ? loadCatalogFromDisk() : { items: [], lastBuilt: 0, totalPages: 0 }
  const items = Array.isArray(existing.items) ? existing.items.slice() : []
  const seen = new Set(items.map(x => x.id))
  let totalPages = 0

  // Resume state
  const cp = resume ? loadCheckpoint() : null
  let lastId = Number(cp?.lastId || 0)
  if (!lastId && items.length) {
    try { lastId = Math.max(...items.map(x => Number(x.id)||0)) } catch {}
  }
  let variantName = cp?.variant || null
  let batches = Number(cp?.batches || 0)

  // Candidate filter builders for id greater-than. We will try until one works.
  const variants = [
    { name: 'id_gt_param', build: (lastId, page) => ({ namespace: `static-${cfg.REGION}`, locale: 'en_GB', orderby: 'id', _page: page, _pageSize: 100, id: `gt:${lastId}` }) },
    { name: 'id_range_square', build: (lastId, page) => ({ namespace: `static-${cfg.REGION}`, locale: 'en_GB', orderby: 'id', _page: page, _pageSize: 100, id: `]${lastId},` }) },
    { name: 'id_range_paren', build: (lastId, page) => ({ namespace: `static-${cfg.REGION}`, locale: 'en_GB', orderby: 'id', _page: page, _pageSize: 100, id: `(${lastId},` }) },
    { name: 'id_min', build: (lastId, page) => ({ namespace: `static-${cfg.REGION}`, locale: 'en_GB', orderby: 'id', _page: page, _pageSize: 100, min_id: String(lastId + 1) }) },
    // Fallback: no filter (will cap ~1000)
    { name: 'none', build: (_lastId, page) => ({ namespace: `static-${cfg.REGION}`, locale: 'en_GB', orderby: 'id', _page: page, _pageSize: 100 }) },
  ]

  // Class/subclass filter variants
  const classVariants = [
    { name: 'class_item_class', build: (classId, subId, page) => ({ namespace: `static-${cfg.REGION}`, locale: 'en_GB', orderby: 'id', _page: page, _pageSize: 100, 'item_class.id': String(classId) }) },
    { name: 'class_itemClassDot', build: (classId, subId, page) => ({ namespace: `static-${cfg.REGION}`, locale: 'en_GB', orderby: 'id', _page: page, _pageSize: 100, 'itemClass.id': String(classId) }) },
    { name: 'class_item_class_plain', build: (classId, subId, page) => ({ namespace: `static-${cfg.REGION}`, locale: 'en_GB', orderby: 'id', _page: page, _pageSize: 100, item_class: String(classId) }) },
    { name: 'class_classDot', build: (classId, subId, page) => ({ namespace: `static-${cfg.REGION}`, locale: 'en_GB', orderby: 'id', _page: page, _pageSize: 100, 'class.id': String(classId) }) },
    // subclass attempts
    { name: 'sub_item_subclass', build: (classId, subId, page) => ({ namespace: `static-${cfg.REGION}`, locale: 'en_GB', orderby: 'id', _page: page, _pageSize: 100, 'item_class.id': String(classId), 'item_subclass.id': String(subId) }) },
    { name: 'sub_itemSubclassDot', build: (classId, subId, page) => ({ namespace: `static-${cfg.REGION}`, locale: 'en_GB', orderby: 'id', _page: page, _pageSize: 100, 'itemClass.id': String(classId), 'itemSubclass.id': String(subId) }) },
  ]

  async function fetchItemClassShards() {
    try {
      const idxUrl = `${API_BASE}/data/wow/item-class/index`
      const { data: idx } = await axios.get(idxUrl, { params: { namespace: `static-${cfg.REGION}`, locale: 'en_GB' }, headers })
      const classes = Array.isArray(idx?.item_classes) ? idx.item_classes : []
      const shards = []
      for (const c of classes) {
        const cid = c?.id
        const href = c?.key?.href
        if (!cid || !href) {continue}
        try {
          const { data: cd } = await axios.get(href, { headers })
          const subs = Array.isArray(cd?.item_subclasses) ? cd.item_subclasses : []
          if (!subs.length) {shards.push({ classId: cid, subId: null })}
          else {for (const s of subs) { if (s?.id != null) {shards.push({ classId: cid, subId: s.id })} }}
          // Throttle
          await new Promise(r => setTimeout(r, 100))
        } catch (e) { console.warn('[EG] Failed to fetch item-class detail', cid, e?.message) }
      }
      return shards
    } catch (e) {
      console.warn('[EG] Failed to fetch item-class index', e?.message)
      return []
    }
  }

  async function findWorkingClassVariant(classId, subId) {
    for (const v of classVariants) {
      try {
        const params = v.build(classId, subId, 1)
        const { data } = await axios.get(url, { params, headers })
        const results = data?.results || []
        if (results.length > 0) {
          // Validate that most results match the class/subclass
          let match = 0
          for (const r of results) {
            const cid = r?.data?.item_class?.id
            const sid = r?.data?.item_subclass?.id
            if (cid === classId && (subId == null || sid === subId)) {match++}
          }
          // Slightly relax the threshold to avoid false negatives on mixed first pages
          if (match >= Math.max(1, Math.floor(results.length * 0.5))) {return v.name}
        }
      } catch {}
    }
    return null
  }

  // Determine working variant
  async function findWorkingVariant(startLastId) {
    for (const v of variants) {
      try {
        const params = v.build(startLastId, 1)
        const { data } = await axios.get(url, { params, headers })
        const results = data?.results || []
        if (Array.isArray(results) && results.length > 0) {
          // Validate that this variant actually advances past startLastId
          let minId = Infinity
          for (const r of results) {
            const id = r?.data?.id || r?.id || r?.key?.href?.match(/item\/(\d+)/)?.[1]
            const nId = Number(id||0)
            if (nId && nId < minId) {minId = nId}
          }
          if (isFinite(minId) && minId > startLastId) {return v.name}
        }
      } catch {}
    }
    return 'none'
  }

  if (!variantName) {
    variantName = await findWorkingVariant(lastId)
  }
  const buildParams = (lastId, page) => (variants.find(v => v.name === variantName) || variants[variants.length-1]).build(lastId, page)

  console.info('[EG] Item catalog rebuild starting with variant', variantName, 'resume lastId', lastId, 'existing', items.length)

  // Try class/subclass sharding first to avoid the 1000-cap, falling back to id-batching
  const shardCp = cp && cp.mode === 'classShard' ? { index: Number(cp.shardIndex||0), page: Number(cp.page||1), variant: cp.classVariant||null } : { index: 0, page: 1, variant: null }
  const shards = await fetchItemClassShards()
  if (shards.length) {
    const baseCount = items.length
    let shardAdds = 0
    let shardMisses = 0
    console.info('[EG] Catalog class sharding with', shards.length, 'shards; resume at', shardCp.index)
    for (let i = shardCp.index; i < shards.length; i++) {
      const { classId, subId } = shards[i]
      let cVar = (i === shardCp.index && shardCp.variant) ? shardCp.variant : await findWorkingClassVariant(classId, subId)
      // Fallback: if subclass filter fails, retry with class-only
      let usedClassOnly = false
      if (!cVar && subId != null) {
        cVar = await findWorkingClassVariant(classId, null)
        usedClassOnly = !!cVar
      }
      if (!cVar) { console.info('[EG] No class filter works for class', classId, 'sub', subId, '- skipping shard'); shardMisses++; continue }
      let page = (i === shardCp.index) ? Math.max(1, shardCp.page) : 1
      // eslint-disable-next-line no-constant-condition
      while (true) {
        if (pageLimit > 0 && page > pageLimit) {break}
        try {
          const params = (classVariants.find(v => v.name === cVar) || classVariants[0]).build(classId, usedClassOnly ? null : subId, page)
          const { data } = await axios.get(url, { params, headers })
          const results = data?.results || []
          totalPages = Math.max(totalPages, Number(data?.pageCount || 0))
          if (!results.length) {break}
          for (const r of results) {
            const id = r?.data?.id || r?.id || r?.key?.href?.match(/item\/(\d+)/)?.[1]
            if (!id) {continue}
            const nId = Number(id)
            if (!seen.has(nId)) {
              const name = r?.data?.name || r?.name || r?.data?.name?.en_GB || r?.data?.name?.en_US
              const mediaId = r?.data?.media?.id || null
              items.push({ id: nId, name: name || '', mediaId })
              seen.add(nId)
              shardAdds += 1
            }
          }
          saveCatalogToDisk({ items, lastBuilt: Math.floor(Date.now()/1000), totalPages })
          saveCheckpoint({ mode: 'classShard', shardIndex: i, page: page + 1, classVariant: cVar })
          console.info(`[EG] Item catalog classShard c=${classId}${subId!=null?`/s=${subId}`:''} page ${page} fetched ${results.length} (total ${items.length})`)
          page += 1
          await new Promise(r => setTimeout(r, 200))
        } catch (e) {
          const status = e?.response?.status
          console.warn('[EG] Item catalog class shard error c', classId, 's', subId, 'page', page, status || '', e?.message || e)
          await new Promise(r => setTimeout(r, 800))
          if (status && status >= 400 && status !== 429) {break}
        }
      }
      // Move to next shard
      saveCheckpoint({ mode: 'classShard', shardIndex: i + 1, page: 1, classVariant: cVar })
    }
    // Completed all shards; decide whether to finalize or fall back to id-batching
    saveCheckpoint({ mode: 'classShard', shardIndex: shards.length, page: 1 })
    console.info('[EG] Class sharding summary:', { baseCount, shardAdds, shardMisses, total: items.length })
    // Heuristic: if sharding added a decent amount of items, finalize; else continue to id-batching
    if (shardAdds >= 300) {
      const final = { items, lastBuilt: Math.floor(Date.now()/1000), totalPages }
      saveCatalogToDisk(final)
      console.info('[EG] Item catalog rebuild complete via class sharding with', items.length, 'items')
      return final
    }
    console.info('[EG] Class sharding yielded few results; falling back to id-window batching to fill remaining items...')
  }

  let _globalFetched = 0
  let safetyBatches = 0
  // Iterate batches by id window: fetch pages until empty, then advance lastId to max seen and repeat
  // eslint-disable-next-line no-constant-condition
  while (true) {
    let page = 1
    let batchFetched = 0
    let batchMaxId = lastId
    // eslint-disable-next-line no-constant-condition
    while (true) {
      if (pageLimit > 0 && page > pageLimit) {break}
      try {
        const params = buildParams(lastId, page)
        const { data } = await axios.get(url, { params, headers })
        const results = data?.results || []
        totalPages = Math.max(totalPages, Number(data?.pageCount || 0))
        if (!results.length) {break}
        for (const r of results) {
          const id = r?.data?.id || r?.id || r?.key?.href?.match(/item\/(\d+)/)?.[1]
          if (!id) {continue}
          const nId = Number(id)
          if (!seen.has(nId)) {
            const name = r?.data?.name || r?.name || r?.data?.name?.en_GB || r?.data?.name?.en_US
            const mediaId = r?.data?.media?.id || null
            items.push({ id: nId, name: name || '', mediaId })
            seen.add(nId)
          }
          if (nId > batchMaxId) {batchMaxId = nId}
        }
        batchFetched += results.length
        _globalFetched += results.length
        saveCatalogToDisk({ items, lastBuilt: Math.floor(Date.now()/1000), totalPages })
        saveCheckpoint({ lastId, variant: variantName, batches, page: page + 1 })
        console.info(`[EG] Item catalog ${variantName} lastId=${lastId} page ${page} fetched ${results.length} (total ${items.length})`)
        page += 1
        await new Promise(r => setTimeout(r, 200))
      } catch (e) {
        const status = e?.response?.status
        console.warn('[EG] Item catalog page error', variantName, 'lastId', lastId, 'page', page, status || '', e?.message || e)
        await new Promise(r => setTimeout(r, 1000))
        if (status && status >= 400 && status !== 429) {break} // break batch and try next variant or advance
      }
    }

    if (batchFetched === 0) {
      // If we used a filtered variant and got nothing new, try switching variant once; else end.
      if (variantName !== 'none' && safetyBatches < 2) {
        // Try to find a different working variant
        const alt = await findWorkingVariant(lastId)
        if (alt && alt !== variantName) {
          console.info('[EG] Switching catalog search variant', variantName, '=>', alt)
          variantName = alt
          continue
        }
      }
      // No progress possible; end.
      break
    }
    // Advance window. If no growth in max id, stop to avoid looping.
    if (batchMaxId <= lastId) {
      console.info('[EG] Catalog batch produced no id growth; stopping. lastId=', lastId, 'batchMaxId=', batchMaxId)
      break
    }
    lastId = batchMaxId
    batches += 1
    saveCheckpoint({ lastId, variant: variantName, batches, page: 1 })
    // Gentle pause between batches
    await new Promise(r => setTimeout(r, 300))
    safetyBatches += 1
    if (safetyBatches > 2000) {break} // hard safety

    // If variant provides no filtering ('none'), only one batch makes sense; stop after first.
    if (variantName === 'none') {
      console.info('[EG] Catalog search has no supported id filter; completed single pass.')
      break
    }
  }

  // Finalize
  saveCheckpoint({ lastId, variant: variantName, batches, page: 1 })
  const final = { items, lastBuilt: Math.floor(Date.now()/1000), totalPages }
  saveCatalogToDisk(final)
  console.info('[EG] Item catalog rebuild complete with', items.length, 'items; variant', variantName, 'batches', batches)
  return final
}

export function getCatalogStatus() {
  const data = loadCatalogFromDisk()
  return { count: data.items.length, lastBuilt: data.lastBuilt, totalPages: data.totalPages }
}

// Attempt to discover supported filter syntax for id greater-than on the Search API.
// Tries a list of candidate parameter patterns against a known low lastId and returns
// the first variant that yields results.
export async function probeSearchIdGtSyntax() {
  const cfg = loadConfig()
  const API_BASE = `https://${cfg.REGION}.api.blizzard.com`
  const url = `${API_BASE}/data/wow/search/item`
  const token = await getAccessToken()
  const headers = { Authorization: `Bearer ${token}` }
  const candidates = [
    // Each entry returns { name, buildParams(lastId, page) }
    { name: 'id_gt_param', build: (lastId, page) => ({ namespace: `static-${cfg.REGION}`, locale: 'en_GB', orderby: 'id', _page: page, 'id': `gt:${lastId}` }) },
    { name: 'id_range_square', build: (lastId, page) => ({ namespace: `static-${cfg.REGION}`, locale: 'en_GB', orderby: 'id', _page: page, 'id': `]${lastId},` }) },
    { name: 'id_range_paren', build: (lastId, page) => ({ namespace: `static-${cfg.REGION}`, locale: 'en_GB', orderby: 'id', _page: page, 'id': `(${lastId},` }) },
    { name: 'id_min', build: (lastId, page) => ({ namespace: `static-${cfg.REGION}`, locale: 'en_GB', orderby: 'id', _page: page, 'min_id': String(lastId + 1) }) },
  ]
  for (const cand of candidates) {
    try {
      const params = cand.build(0, 1)
      const { data } = await axios.get(url, { params, headers })
      const results = data?.results || []
      if (Array.isArray(results) && results.length > 0) {
        return { ok: true, variant: cand.name, sampleCount: results.length }
      }
    } catch (e) {
      // ignore and continue trying
    }
  }
  return { ok: false }
}
