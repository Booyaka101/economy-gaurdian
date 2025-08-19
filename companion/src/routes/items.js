// Item-related routes (Blizzard)
// Provides: /blizzard/item-names

import fs from 'fs'
import path from 'path'
import axios from 'axios'


export default function registerItemsRoutes(app, deps) {
  const { getItem, getItemMedia, getCachedItemName, getCachedItemIcon, setCachedItemName, setCachedItemIcon } = deps
  // Lightweight concurrency limiter for Blizzard/static fetches
  const withLimiter = (() => {
    const MAX = Math.max(1, Number(process.env.BLIZZARD_CONCURRENCY || 6))
    let active = 0
    const q = []
    const run = () => {
      while (active < MAX && q.length) {
        const { fn, resolve, reject } = q.shift()
        active++
        Promise.resolve()
          .then(fn)
          .then(v => { active--; resolve(v); run() })
          .catch(e => { active--; reject(e); run() })
      }
    }
    return (fn) => new Promise((resolve, reject) => { q.push({ fn, resolve, reject }); run() })
  })()
  // Disk-backed name cache
  const dataDir = path.resolve(process.cwd(), 'data')
  const namesFile = path.join(dataDir, 'item-names.json')
  const iconsFile = path.join(dataDir, 'item-icons.json')
  const qualitiesFile = path.join(dataDir, 'item-qualities.json')
  const metaFile = path.join(dataDir, 'item-meta.json')
  const iconsDir = path.join(dataDir, 'icons')
  /** @type {Map<number,string>} */
  const diskNames = new Map()
  /** @type {Map<number,string>} */
  const diskIcons = new Map()
  /** @type {Map<number,number>} */
  const diskQualities = new Map()
  /** @type {Map<number,{name?:string,icon?:string,quality?:number,rarity?:string}>} */
  const diskMeta = new Map()
  const loadDisk = () => {
    try {
      if (fs.existsSync(namesFile)) {
        const raw = fs.readFileSync(namesFile, 'utf8')
        const obj = JSON.parse(raw)
        for (const [k, v] of Object.entries(obj)) {
          const id = Number(k)
          if (Number.isFinite(id) && typeof v === 'string' && v.trim()) {diskNames.set(id, v)}
        }
      }
      if (fs.existsSync(iconsFile)) {
        const rawI = fs.readFileSync(iconsFile, 'utf8')
        const objI = JSON.parse(rawI)
        for (const [k, v] of Object.entries(objI)) {
          const id = Number(k)
          if (Number.isFinite(id) && typeof v === 'string' && v.trim()) {diskIcons.set(id, v)}
        }
      }
      if (fs.existsSync(qualitiesFile)) {
        const rawQ = fs.readFileSync(qualitiesFile, 'utf8')
        const objQ = JSON.parse(rawQ)
        for (const [k, v] of Object.entries(objQ)) {
          const id = Number(k)
          const q = Number(v)
          if (Number.isFinite(id) && Number.isFinite(q)) {diskQualities.set(id, q)}
        }
      }
      if (fs.existsSync(metaFile)) {
        const rawM = fs.readFileSync(metaFile, 'utf8')
        const objM = JSON.parse(rawM)
        for (const [k, v] of Object.entries(objM)) {
          const id = Number(k)
          if (!Number.isFinite(id) || !v || typeof v !== 'object') {continue}
          diskMeta.set(id, v)
          if (typeof v.name === 'string' && v.name.trim()) {diskNames.set(id, v.name)}
          if (typeof v.icon === 'string' && v.icon.trim()) {diskIcons.set(id, v.icon)}
          if (Number.isFinite(v.quality)) {diskQualities.set(id, Number(v.quality))}
        }
      }
    } catch {}
  }
  let saveTimer = null
  const saveDisk = () => {
    try {
      if (!fs.existsSync(dataDir)) {fs.mkdirSync(dataDir, { recursive: true })}
      const obj = {}
      for (const [id, name] of diskNames.entries()) {obj[id] = name}
      fs.writeFileSync(namesFile, JSON.stringify(obj), 'utf8')
      const objI = {}
      for (const [id, icon] of diskIcons.entries()) {objI[id] = icon}
      fs.writeFileSync(iconsFile, JSON.stringify(objI), 'utf8')
      const objQ = {}
      for (const [id, q] of diskQualities.entries()) {objQ[id] = q}
      fs.writeFileSync(qualitiesFile, JSON.stringify(objQ), 'utf8')
      // Consolidated meta file for convenience (non-breaking; keep other files too)
      const objM = {}
      const ids = new Set([
        ...diskNames.keys(),
        ...diskIcons.keys(),
        ...diskQualities.keys(),
        ...diskMeta.keys(),
      ])
      for (const id of ids) {
        const entry = diskMeta.get(id) || {}
        const name = diskNames.get(id) || entry.name || ''
        const icon = diskIcons.get(id) || entry.icon || ''
        const quality = Number.isFinite(entry.quality) ? Number(entry.quality) : (diskQualities.get(id) ?? undefined)
        const rarity = (entry.rarity && String(entry.rarity)) || qualityNameFromNumber(quality)
        objM[id] = { ...(entry || {}), name, icon, ...(Number.isFinite(quality) ? { quality } : {}), ...(rarity ? { rarity } : {}) }
      }
      fs.writeFileSync(metaFile, JSON.stringify(objM), 'utf8')
    } catch {}
  }
  const scheduleSave = () => {
    if (saveTimer) {clearTimeout(saveTimer)}
    saveTimer = setTimeout(saveDisk, 1500)
  }
  const getDiskName = (id) => diskNames.get(id) || ''
  const getDiskIcon = (id) => diskIcons.get(id) || ''
  const getDiskQuality = (id) => diskQualities.get(id) || 0
  const setDiskName = (id, name) => {
    if (typeof name !== 'string' || !name.trim()) {return}
    diskNames.set(id, name)
    scheduleSave()
  }
  const setDiskIcon = (id, icon) => {
    if (typeof icon !== 'string' || !icon.trim()) {return}
    diskIcons.set(id, icon)
    scheduleSave()
  }
  const setDiskQuality = (id, q) => {
    const n = Number(q)
    if (!Number.isFinite(n) || n < 0) {return}
    diskQualities.set(id, n)
    const prev = diskMeta.get(id) || {}
    diskMeta.set(id, { ...prev, quality: n, rarity: qualityNameFromNumber(n) })
    scheduleSave()
  }
  loadDisk()
  // Ensure icons directory exists on startup
  try { if (!fs.existsSync(iconsDir)) {fs.mkdirSync(iconsDir, { recursive: true })} } catch {}

  // Coalescing: ensure only one in-flight fetch per id for item and media
  const pendingItem = new Map() // id -> Promise
  const pendingMedia = new Map() // id -> Promise
  const coalesce = (map, key, fn) => {
    if (map.has(key)) {return map.get(key)}
    const p = Promise.resolve().then(fn).finally(() => { try { map.delete(key) } catch {} })
    map.set(key, p)
    return p
  }
  const getItemCoalesced = (id) => coalesce(pendingItem, id, () => withLimiter(() => getItem(id)))
  const getItemMediaCoalesced = (id) => coalesce(pendingMedia, id, () => withLimiter(() => getItemMedia(id)))
  // Coalesce icon download operations as well
  const pendingIcon = new Map()
  const downloadAndStoreIconCoalesced = (id, url) => coalesce(pendingIcon, id, () => withLimiter(() => downloadAndStoreIcon(id, url)))

  // Local icon helpers
  const ICON_EXTS = ['png','jpg','jpeg','webp','gif']
  const ensureIconsDir = () => { try { if (!fs.existsSync(iconsDir)) {fs.mkdirSync(iconsDir, { recursive: true })} } catch {} }
  const findIconFile = (id) => {
    try {
      for (const ext of ICON_EXTS) {
        const fp = path.join(iconsDir, `${id}.${ext}`)
        if (fs.existsSync(fp)) {return fp}
      }
    } catch {}
    return ''
  }
  const getLocalIconUrl = (id) => {
    const fp = findIconFile(id)
    return fp ? `/static/icons/${id}` : ''
  }
  const inferExtFromContentType = (ct) => {
    if (!ct || typeof ct !== 'string') {return 'png'}
    const t = ct.toLowerCase()
    if (t.includes('image/png')) {return 'png'}
    if (t.includes('image/webp')) {return 'webp'}
    if (t.includes('image/jpeg') || t.includes('image/jpg')) {return 'jpg'}
    if (t.includes('image/gif')) {return 'gif'}
    return 'png'
  }
  const inferExtFromUrl = (u) => {
    try {
      const m = String(u).toLowerCase().match(/\.(png|jpg|jpeg|webp|gif)(\?.*)?$/)
      return m ? m[1] : ''
    } catch { return '' }
  }
  const qualityNameFromNumber = (q) => {
    const n = Number(q)
    if (!Number.isFinite(n)) {return ''}
    // Based on Blizzard item quality: 0 Poor, 1 Common, 2 Uncommon, 3 Rare, 4 Epic, 5 Legendary, 6 Artifact, 7 Heirloom
    switch (n) {
      case 0: return 'poor'
      case 1: return 'common'
      case 2: return 'uncommon'
      case 3: return 'rare'
      case 4: return 'epic'
      case 5: return 'legendary'
      case 6: return 'artifact'
      case 7: return 'heirloom'
      default: return ''
    }
  }
  const downloadAndStoreIcon = async (id, url) => {
    try {
      ensureIconsDir()
      const existing = findIconFile(id)
      if (existing) {return getLocalIconUrl(id)}
      const resp = await axios.get(url, { responseType: 'arraybuffer' })
      if (!resp || !resp.data) {return ''}
      const buf = Buffer.from(resp.data)
      const ct = (resp.headers && (resp.headers['content-type'] || resp.headers['Content-Type'])) || ''
      const ext = inferExtFromContentType(ct) || inferExtFromUrl(url) || 'png'
      const out = path.join(iconsDir, `${id}.${ext}`)
      fs.writeFileSync(out, buf)
      return getLocalIconUrl(id)
    } catch { return '' }
  }
  const ensureLocalIcon = async (id) => {
    try {
      const existing = findIconFile(id)
      if (existing) {return getLocalIconUrl(id)}
      // Try known URLs from caches
      const url = getCachedItemIcon(id) || getDiskIcon(id)
      if (url) {
        const loc = await downloadAndStoreIconCoalesced(id, url)
        if (loc) {return loc}
      }
      // Fallback: fetch media to acquire URL
      try {
        const media = await getItemMediaCoalesced(id)
        const remote = media && Array.isArray(media.assets) && media.assets.length ? (media.assets[0].value || '') : ''
        if (remote) {
          setCachedItemIcon(id, remote)
          setDiskIcon(id, remote)
          const loc = await downloadAndStoreIconCoalesced(id, remote)
          if (loc) {return loc}
        }
      } catch {}
    } catch {}
    return ''
  }
  
  // Warm helper: return data maps so clients can hydrate immediately
  const warmItemNames = async (ids) => {
    if (!Array.isArray(ids) || !ids.length) {return { warmed: 0, names: {}, icons: {}, qualities: {}, rarities: {}, map: {} }}
    let warmed = 0
    const names = {}
    const icons = {}
    const qualities = {}
    const rarities = {}
    const flat = {}
    // Reuse same quality extraction as GET handler
    const qualityFromItem = (item) => {
      try {
        if (!item) {return 0}
        const t = String(item?.quality?.type || item?.quality || '').toUpperCase()
        switch (t) {
          case 'POOR': return 0
          case 'COMMON': return 1
          case 'UNCOMMON': return 2
          case 'RARE': return 3
          case 'EPIC': return 4
          case 'LEGENDARY': return 5
          case 'ARTIFACT': return 6
          case 'HEIRLOOM': return 7
          case 'WOW_TOKEN': return 8
          default: return 0
        }
      } catch { return 0 }
    }
    for (const id of ids) {
      const nid = Number(id)
      if (!Number.isFinite(nid) || nid <= 0) {continue}
      try {
        const haveName = (() => {
          const n1 = getCachedItemName(nid)
          const n2 = getDiskName(nid)
          const n = n1 || n2
          return typeof n === 'string' && n.trim()
        })()
        const haveIcon = !!getCachedItemIcon(nid)
        let name = ''
        let qualityNum = 0
        if (!haveName) {
          const item = await getItemCoalesced(nid)
          if (item) {
            if (typeof item.name === 'string') {name = item.name}
            else if (item.name && typeof item.name === 'object') {
              const langs = ['en_US','en-US','en_GB','en_GB','en']
              for (const k of langs) { if (typeof item.name[k] === 'string' && item.name[k].trim()) { name = item.name[k]; break } }
              if (!name) {
                const first = Object.values(item.name).find(v => typeof v === 'string' && v.trim())
                if (first) {name = first}
              }
            }
            qualityNum = qualityFromItem(item)
          }
          if (name && name.trim()) {
            setCachedItemName(nid, name)
            setDiskName(nid, name)
            names[nid] = name
          }
          if (qualityNum) {qualities[nid] = qualityNum}
        } else {
          const existing = getCachedItemName(nid) || getDiskName(nid) || ''
          if (existing) {names[nid] = existing}
        }
        let iconUrl = getLocalIconUrl(nid) || getCachedItemIcon(nid) || getDiskIcon(nid) || ''
        if (!iconUrl && !haveIcon) {
          try {
            const media = await getItemMediaCoalesced(nid)
            if (media && Array.isArray(media.assets) && media.assets.length) {
              const icon = media.assets[0].value || ''
              if (icon) {
                setCachedItemIcon(nid, icon)
                setDiskIcon(nid, icon)
                const local = await withLimiter(() => downloadAndStoreIcon(nid, icon))
                iconUrl = local || icon
              }
            }
          } catch {}
        }
        if (iconUrl) {icons[nid] = iconUrl}
        if (Number.isFinite(qualities[nid])) {rarities[nid] = qualityNameFromNumber(qualities[nid])}
        flat[nid] = { name: names[nid] || '', icon: icons[nid] || '', quality: qualities[nid] || 0, rarity: rarities[nid] || qualityNameFromNumber(qualities[nid] || 0) }
        warmed++
      } catch {}
    }
    return { warmed, names, icons, qualities, rarities, map: flat }
  }

  // Startup warm from disk-saved IDs (names or those without icons yet)
  ;(async () => {
    try {
      const ids = Array.from(diskNames.keys())
      if (ids.length) {
        const batch = ids.slice(0, 2000)
        const { warmed } = await warmItemNames(batch)
        if (warmed) {console.info(`[items] warmed ${warmed} item(s) from disk cache`)}
      }
    } catch {}
  })()
  // Negative cache for IDs that currently have no valid name
  const noNameUntil = new Map() // id -> epoch ms
  const NO_NAME_TTL_MS = 10 * 60 * 1000 // 10 minutes
  const isBlocked = (id) => {
    const t = noNameUntil.get(id)
    if (!t) {return false}
    if (Date.now() > t) { noNameUntil.delete(id); return false }
    return true
  }

  app.get('/blizzard/item-names', async (req, res) => {
    try {
      const lang = String(req.query.lang || 'en_US')
      const langKeys = [lang, lang.replace('-', '_'), lang.replace('_','-')]
      const fallbacks = ['en_US','en-US','enGB','en_GB','en-GB','en']
      const tryKeys = [...new Set([...langKeys, ...fallbacks])]

      const isBadName = (s) => {
        if (typeof s !== 'string') {return true}
        const t = s.trim()
        if (!t) {return true}
        if (/^\[object\b/i.test(t)) {return true}
        if (/^\d+$/.test(t)) {return true}
        if (/^https?:\/\//i.test(t)) {return true}
        if (/\.(png|jpg|jpeg|webp|gif)(\?.*)?$/i.test(t)) {return true}
        return false
      }

      const normalizeName = (v) => {
        if (!v) {return ''}
        if (typeof v === 'string') {return v}
        if (typeof v !== 'object') {return ''}
        // If localized map
        for (const k of tryKeys) {
          if (typeof v[k] === 'string' && v[k].trim()) {return v[k]}
        }
        if (typeof v.name === 'string' && v.name.trim()) {return v.name}
        if (v.name && typeof v.name === 'object') {
          for (const k of tryKeys) {
            if (typeof v.name[k] === 'string' && v.name[k].trim()) {return v.name[k]}
          }
        }
        // Any first string value
        for (const val of Object.values(v)) {
          if (typeof val === 'string' && val.trim()) {return val}
        }
        return ''
      }

      const idsParam = String(req.query.ids || '').trim()
      if (!idsParam) {return res.json({ names: {}, icons: {}, qualities: {}, rarities: {}, map: {} })}
      const ids = [...new Set(idsParam.split(',').map(s => Number(s.trim())).filter(n => Number.isFinite(n) && n > 0))]
      const names = {}
      const icons = {}
      const qualities = {}
      const rarities = {}
      const flat = {}
      const qualityFromItem = (item) => {
        try {
          if (!item) {return 0}
          // Prefer explicit enum type
          let t = ''
          if (item?.quality?.type && typeof item.quality.type === 'string') {
            t = item.quality.type
          } else if (typeof item?.quality === 'string') {
            t = item.quality
          } else if (item?.quality?.name) {
            // Sometimes only a localized name is provided
            if (typeof item.quality.name === 'string') {
              t = item.quality.name
            } else if (typeof item.quality.name === 'object') {
              const tryKeys = ['en_GB','en_US','en_EU','en','en_AU','en_GB']
              for (const k of tryKeys) {
                if (typeof item.quality.name[k] === 'string' && item.quality.name[k].trim()) { t = item.quality.name[k]; break }
              }
              if (!t) {
                const first = Object.values(item.quality.name).find(v => typeof v === 'string' && v.trim())
                if (first) {t = first}
              }
            }
          } else if (typeof item?.quality === 'number' && Number.isFinite(item.quality)) {
            return item.quality
          }
          const up = String(t).toUpperCase()
          switch (up) {
            case 'POOR': return 0
            case 'COMMON': return 1
            case 'UNCOMMON': return 2
            case 'RARE': return 3
            case 'EPIC': return 4
            case 'LEGENDARY': return 5
            case 'ARTIFACT': return 6
            case 'HEIRLOOM': return 7
            case 'WOW_TOKEN': return 8
            default: return 0
          }
        } catch { return 0 }
      }
      for (const id of ids) {
        const cachedName = getCachedItemName(id)
        const cachedIcon = getCachedItemIcon(id)
        const diskName = getDiskName(id)
        const diskIcon = getDiskIcon(id)
        const localIconUrl = getLocalIconUrl(id)
        const normCached = normalizeName(cachedName || diskName)
        if (normCached && !isBadName(normCached)) {names[id] = normCached}
        if (localIconUrl || cachedIcon || diskIcon) {
          icons[id] = (localIconUrl || cachedIcon || diskIcon)
          // If serving a remote URL, kick off background local cache download
          if (!localIconUrl) {
            const remote = cachedIcon || diskIcon
            if (remote) { downloadAndStoreIconCoalesced(id, remote).catch(()=>{}) }
          }
        }
        if ((normCached && !isBadName(normCached)) || localIconUrl || cachedIcon || diskIcon) {
          const q = getDiskQuality(id)
          if (Number.isFinite(q)) { qualities[id] = q; const r = qualityNameFromNumber(q); if (r) {rarities[id] = r} }
          flat[id] = { name: (!isBadName(normCached) ? normCached : '') || '', icon: (localIconUrl || cachedIcon || diskIcon || ''), quality: q || 0, rarity: qualityNameFromNumber(q || 0) }
        }
      }
      // Fetch for IDs missing a valid name OR missing an icon, unless blocked
      const missing = ids.filter(id => {
        if (isBlocked(id)) {return false}
        const f = flat[id]
        if (!f) {return true}
        if (!f.icon) {return true}
        if (!f.name || isBadName(f.name)) {return true}
        return false
      })
      for (const id of missing) {
        try {
          const item = await getItemCoalesced(id)
          let name = ''
          let qualityNum = 0
          if (item) {
            if (typeof item.name === 'string') {name = item.name}
            else if (item.name && typeof item.name === 'object') {
              // Prefer requested lang, then fallbacks
              for (const k of tryKeys) {
                if (typeof item.name[k] === 'string' && item.name[k].trim()) { name = item.name[k]; break }
              }
              if (!name) {
                const first = Object.values(item.name).find(v => typeof v === 'string' && v.trim())
                if (first) {name = first}
              }
            } else {
              // Sometimes the API may return localized root
              name = normalizeName(item)
            }
            qualityNum = qualityFromItem(item)
          }
          if (name && !isBadName(name)) {
            setCachedItemName(id, name)
            setDiskName(id, name)
            names[id] = name
          }
          let icon = ''
          try {
            const media = await getItemMediaCoalesced(id)
            if (media && Array.isArray(media.assets) && media.assets.length) {
              icon = media.assets[0].value || ''
            }
          } catch {}
          if (icon) {
            setCachedItemIcon(id, icon)
            setDiskIcon(id, icon)
            const localUrl = await downloadAndStoreIconCoalesced(id, icon)
            icons[id] = localUrl || icon
          }
          if (Number.isFinite(qualityNum)) {
            qualities[id] = qualityNum
            const r = qualityNameFromNumber(qualityNum)
            if (r) {rarities[id] = r}
            setDiskQuality(id, qualityNum)
          }
          if (!name || isBadName(name)) {
            // No valid name: block further lookups for a while, but still return icon if any
            noNameUntil.set(id, Date.now() + NO_NAME_TTL_MS)
            if (icon && !name) {
              console.info(`[items] icon present but name missing for id=${id}; temporarily blocking re-fetch`)
            }
          }
          // If we already have a disk name, prefer it as fallback for UI
          const fallback = getDiskName(id)
          const localIconUrl2 = getLocalIconUrl(id)
          const fallbackIcon = localIconUrl2 || icon || getDiskIcon(id) || ''
          flat[id] = { name: (!isBadName(name) ? name : (fallback || '')), icon: fallbackIcon, quality: qualityNum, rarity: qualityNameFromNumber(qualityNum || 0) }
        } catch (e) {
          noNameUntil.set(id, Date.now() + NO_NAME_TTL_MS)
          flat[id] = { name: '', icon: '', quality: 0, rarity: qualityNameFromNumber(0) }
        }
      }
      return res.json({ names, icons, qualities, rarities, map: flat })
    } catch (e) {
      return res.status(500).json({ error: 'item_names_failed', message: e?.message || String(e) })
    }
  })

  // Manual warm endpoint: POST { ids: number[] }
  app.post('/blizzard/warm-item-names', async (req, res) => {
    try {
      const body = req.body || {}
      const ids = Array.isArray(body.ids) ? body.ids : []
      const result = await warmItemNames(ids)
      return res.json(result)
    } catch (e) {
      return res.status(500).json({ error: 'warm_failed', message: e?.message || String(e) })
    }
  })

  // Backfill item meta (names already on disk) with quality and local icon files
  // Usage: POST /blizzard/backfill-item-meta?limit=500&onlyMissing=1&startAfter=0
  app.post('/blizzard/backfill-item-meta', async (req, res) => {
    try {
      // Local helper for this handler
      const extractQualityFromItem = (item) => {
        try {
          if (!item) {return 0}
          // Prefer explicit enum type
          let t = ''
          if (item?.quality?.type && typeof item.quality.type === 'string') {
            t = item.quality.type
          } else if (typeof item?.quality === 'string') {
            t = item.quality
          } else if (item?.quality?.name) {
            if (typeof item.quality.name === 'string') {
              t = item.quality.name
            } else if (typeof item.quality.name === 'object') {
              const tryKeys = ['en_GB','en_US','en_EU','en','en_AU','en_GB']
              for (const k of tryKeys) {
                if (typeof item.quality.name[k] === 'string' && item.quality.name[k].trim()) { t = item.quality.name[k]; break }
              }
              if (!t) {
                const first = Object.values(item.quality.name).find(v => typeof v === 'string' && v.trim())
                if (first) {t = first}
              }
            }
          } else if (typeof item?.quality === 'number' && Number.isFinite(item.quality)) {
            return item.quality
          }
          const up = String(t).toUpperCase()
          switch (up) {
            case 'POOR': return 0
            case 'COMMON': return 1
            case 'UNCOMMON': return 2
            case 'RARE': return 3
            case 'EPIC': return 4
            case 'LEGENDARY': return 5
            case 'ARTIFACT': return 6
            case 'HEIRLOOM': return 7
            case 'WOW_TOKEN': return 8
            default: return 0
          }
        } catch { return 0 }
      }
      const limit = Math.max(1, Math.min(50000, Number(req.query.limit || 1000)))
      const onlyMissing = String(req.query.onlyMissing ?? '1') !== '0'
      const startAfter = Number(req.query.startAfter || 0)
      const allIds = [...diskNames.keys()].sort((a,b) => a-b)
      const target = []
      for (const id of allIds) {
        if (id <= startAfter) {continue}
        if (!onlyMissing) { target.push(id); continue }
        const hasQ = Number.isFinite(getDiskQuality(id)) && getDiskQuality(id) > 0
        const hasIcon = !!getLocalIconUrl(id) || !!getDiskIcon(id)
        if (!hasQ || !hasIcon) {target.push(id)}
        if (target.length >= limit) {break}
      }
      let fetched = 0, updatedQ = 0, updatedIcon = 0, _errs = 0
      const startedAt = Date.now()
      const chunkSize = 50
      for (let off = 0; off < Math.min(target.length, limit); off += chunkSize) {
        const batch = target.slice(off, off + chunkSize)
        try {
          const warmed = await warmItemNames(batch)
          // Apply qualities from warmed map
          const qmap = warmed?.qualities || {}
          for (const [sid, qv] of Object.entries(qmap)) {
            const id = Number(sid)
            const q = Number(qv)
            if (Number.isFinite(id) && Number.isFinite(q) && q >= 0) {
              if (!getDiskQuality(id) || getDiskQuality(id) !== q) {
                setDiskQuality(id, q)
                updatedQ++
              }
            }
          }
          // Ensure local icons exist, and force quality retrieval when needed
          for (const id of batch) {
            try {
              const local = await withLimiter(() => ensureLocalIcon(id))
              if (local) {updatedIcon++}
            } catch {}
            try {
              const needQ = !onlyMissing || !getDiskQuality(id) || getDiskQuality(id) === 0
              if (needQ) {
                const item = await getItemCoalesced(id)
                const q = extractQualityFromItem(item)
                if (Number.isFinite(q) && q >= 0) {
                  if (!getDiskQuality(id) || getDiskQuality(id) !== q) {
                    setDiskQuality(id, q)
                    updatedQ++
                  }
                }
              }
            } catch {}
          }
          fetched += batch.length
          await new Promise(r => setTimeout(r, 100))
        } catch { _errs += batch.length }
      }
      const tookMs = Date.now() - startedAt
      return res.json({
        ok: true,
        scanned: allIds.length,
        considered: target.length,
        processed: fetched,
        updatedQuality: updatedQ,
        updatedIcons: updatedIcon,
        tookMs,
        nextStartAfter: target.length ? target[target.length-1] : startAfter,
      })
    } catch (e) {
      return res.status(500).json({ error: 'backfill_failed', message: e?.message || String(e) })
    }
  })

  // Serve local icons: /static/icons/:id (extension resolved automatically)
  app.get('/static/icons/:id', async (req, res) => {
    try {
      const id = Number(req.params.id)
      if (!Number.isFinite(id) || id <= 0) {return res.status(400).end()}
      let fp = findIconFile(id)
      if (!fp) {
        // Try to fetch and cache on-demand
        const loc = await ensureLocalIcon(id)
        fp = findIconFile(id)
        if (!fp && !loc) {return res.status(404).end()}
      }
      // Strong caching: long-lived immutable cache with ETag/304 support
      try {
        const st = fs.statSync(fp)
        const etag = 'W/"' + st.size + '-' + Number(st.mtimeMs) + '"'
        const inm = req.headers['if-none-match']
        res.set('Cache-Control', 'public, max-age=31536000, immutable')
        res.set('ETag', etag)
        res.set('Last-Modified', new Date(st.mtimeMs).toUTCString())
        if (inm && inm === etag) { return res.status(304).end() }
      } catch {}
      return res.sendFile(fp)
    } catch (e) {
      return res.status(500).end()
    }
  })
}
