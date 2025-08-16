import fs from 'fs'
import path from 'path'

function luaTableToJson(luaStr) {
  try {
    let s = luaStr
    // Remove comments
    s = s.replace(/--.*$/gm, '')
    // Normalize newlines/spaces
    s = s.replace(/\r\n?/g, '\n')
    // Replace ["key"] = with "key":
    s = s.replace(/\[\s*"([^"\n]+)"\s*\]\s*=/g, '"$1":')
    // Replace ['key'] = with "key":
    s = s.replace(/\[\s*'([^'\n]+)'\s*\]\s*=/g, '"$1":')
    // Replace bareword keys: key = -> "key": (avoid numbers)
    s = s.replace(/([A-Za-z_][A-Za-z0-9_]*)\s*=/g, '"$1":')
    // Replace single quotes with double quotes
    s = s.replace(/'/g, '"')
    // Lua booleans/nil
    s = s.replace(/\bnil\b/g, 'null')
    s = s.replace(/\btrue\b/g, 'true')
    s = s.replace(/\bfalse\b/g, 'false')
    // Ensure trailing commas removed before } or ]
    s = s.replace(/,\s*([}\]])/g, '$1')
    return JSON.parse(s)
  } catch (e) {
    throw new Error('Lua->JSON parse failed: ' + (e?.message || String(e)))
  }
}

function extractEGTable(luaFile) {
  const txt = fs.readFileSync(luaFile, 'utf8')
  const startIdx = txt.indexOf('EG_AccountingDB')
  if (startIdx < 0) {throw new Error('EG_AccountingDB not found')}
  const eqIdx = txt.indexOf('=', startIdx)
  if (eqIdx < 0) {throw new Error('Assignment not found')}
  const braceIdx = txt.indexOf('{', eqIdx)
  if (braceIdx < 0) {throw new Error('Table start not found')}
  // find matching closing brace
  let depth = 0
  for (let i = braceIdx; i < txt.length; i++) {
    const ch = txt[i]
    if (ch === '{') {depth++}
    else if (ch === '}') {
      depth--
      if (depth === 0) {
        const tableStr = txt.slice(braceIdx, i + 1)
        return tableStr
      }
    }
  }
  throw new Error('Table end not found')
}

function mergeAccountingJSON(dstPath, json) {
  const ensureDir = p => { try { fs.mkdirSync(p, { recursive: true }) } catch {} }
  const dataDir = path.join(process.cwd(), 'data')
  const storePath = path.join(dataDir, 'accounting.json')
  let db = { version: 1, realms: {} }
  try { db = JSON.parse(fs.readFileSync(storePath, 'utf8')) } catch {}
  const src = json || {}
  const realms = src.realms || src.Realms || src.REALMS || {}
  for (const [realm, chars] of Object.entries(realms)) {
    db.realms[realm] = db.realms[realm] || {}
    for (const [charName, buckets] of Object.entries(chars || {})) {
      const dst = (db.realms[realm][charName] = db.realms[realm][charName] || { postings: [], sales: [], payouts: [] })
      for (const k of ['postings','sales','payouts']) {
        const arr = buckets[k] || buckets[k?.toUpperCase?.()] || []
        if (Array.isArray(arr) && arr.length) {
          dst[k] = dst[k].concat(arr)
        }
      }
    }
  }
  ensureDir(dataDir)
  fs.writeFileSync(storePath, JSON.stringify(db, null, 2))
}

export function startSavedVarsWatcher(opts = {}) {
  const luaPath = opts.path
  const intervalMs = Math.max(5000, Number(opts.intervalMs || 30000))
  if (!luaPath) {return { running: false }}
  let lastSize = 0
  let timer = null
  const tick = () => {
    try {
      const st = fs.statSync(luaPath)
      if (st.size !== lastSize) {
        lastSize = st.size
        const tableStr = extractEGTable(luaPath)
        const obj = luaTableToJson(tableStr)
        mergeAccountingJSON(null, obj)
      }
    } catch (e) {
      // swallow, will retry
    } finally {
      timer = setTimeout(tick, intervalMs)
    }
  }
  timer = setTimeout(tick, intervalMs)
  return { running: true, stop: () => { if (timer) {clearTimeout(timer)} } }
}
