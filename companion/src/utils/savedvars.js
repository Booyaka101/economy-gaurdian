import fs from 'fs'
import path from 'path'
import { fileURLToPath } from 'url'

// ESM-compatible __filename/__dirname
const __filename = fileURLToPath(import.meta.url)
const __dirname = path.dirname(__filename)

function luaTableToJson(luaStr) {
  let s = luaStr
  try {
    // Remove comments
    s = s.replace(/--.*$/gm, '')
    // Normalize newlines/spaces
    s = s.replace(/\r\n?/g, '\n')
    // Strip Lua comments: -- line comments and --[[ block comments ]]
    s = s.replace(/--\[\[[\s\S]*?\]\]/g, '')
    s = s.replace(/--[^\n]*\n/g, '\n')
    // Replace ["key"] = with "key":
    s = s.replace(/\[\s*"([^"\n]+)"\s*\]\s*=/g, '"$1":')
    // Replace ['key'] = with "key":
    s = s.replace(/\[\s*'([^'\n]+)'\s*\]\s*=/g, '"$1":')
    // Replace [1] = with "1": for numeric indices
    s = s.replace(/\[\s*(\d+)\s*\]\s*=/g, '"$1":')
    // Replace bareword keys: key = -> "key": (avoid numbers)
    s = s.replace(/([A-Za-z_][A-Za-z0-9_]*)\s*=/g, '"$1":')
    // Lua booleans/nil
    s = s.replace(/\bnil\b/g, 'null')
    s = s.replace(/\btrue\b/g, 'true')
    s = s.replace(/\bfalse\b/g, 'false')
    // Convert single-quoted string literals to double-quoted JSON strings safely (do not touch apostrophes inside double-quoted strings)
    const convertSingleQuotedLiterals = (str) => {
      let out = ''
      let i = 0
      let inQ = null // '"' when inside a double-quoted string
      let esc = false
      while (i < str.length) {
        const ch = str[i]
        if (!inQ) {
          if (ch === '"') {
            inQ = '"'
            out += ch
            i++
          } else if (ch === '\'') {
            // start single-quoted literal
            let j = i + 1
            let buf = ''
            let e2 = false
            while (j < str.length) {
              const c = str[j]
              if (e2) { buf += c; e2 = false; j++; continue }
              if (c === '\\') { buf += c; e2 = true; j++; continue }
              if (c === '\'') { j++; break }
              buf += c; j++
            }
            out += '"' + buf.replace(/"/g, '\\"') + '"'
            i = j
          } else {
            out += ch
            i++
          }
        } else {
          // inside double-quoted string; copy verbatim until it ends
          out += ch
          if (esc) { esc = false; i++; continue }
          if (ch === '\\') { esc = true; i++; continue }
          if (ch === '"') { inQ = null; i++; continue }
          i++
        }
      }
      return out
    }
    s = convertSingleQuotedLiterals(s)
    // Convert Lua array-like tables (value position) into JSON arrays by replacing outer {} with []
    // Trigger only for value contexts '...': {' and when inner has no top-level '=' (i.e., purely list elements)
    const convertArrayLikeTables = (str) => {
      // Target only known buckets to be extra safe
      const re = /"(postings|sales|payouts|cancels|expires|buys)"\s*:\s*\{/g
      let out = ''
      let last = 0
      let m
      while ((m = re.exec(str))) {
        const braceStart = m.index + m[0].lastIndexOf('{')
        // Find matching closing brace for this '{'
        let i = braceStart
        let depth = 0
        let inQ = null
        let prev = ''
        for (; i < str.length; i++) {
          const ch = str[i]
          if (!inQ) {
            if (ch === '"' || ch === '\'') { inQ = ch }
            else if (ch === '{') {depth++}
            else if (ch === '}') { depth--; if (depth === 0) { i++; break } }
          } else {
            if (ch === inQ && prev !== '\\') {inQ = null}
          }
          prev = ch
        }
        if (depth !== 0) {break}
        const inner = str.slice(braceStart + 1, i - 1)
        // Heuristic: if the first non-space char inside is '{', it's an array of tables => use []
        let j = 0
        while (j < inner.length && /\s/.test(inner[j])) {j++}
        const startsWithTable = inner[j] === '{'
        out += str.slice(last, braceStart)
        if (startsWithTable) {
          out += '[' + inner + ']'
        } else {
          out += '{' + inner + '}'
        }
        last = i
      }
      out += str.slice(last)
      return out
    }
    // Apply array-like conversion; repeat until stable in case multiple buckets appear
    {
      let prev
      do {
        prev = s
        s = convertArrayLikeTables(s)
      } while (s !== prev)
    }
    // Ensure trailing commas removed before } or ]
    s = s.replace(/,\s*([}\]])/g, '$1')
    let obj = JSON.parse(s)
    // Recursively convert numeric-keyed objects to arrays
    const toArrayIfNumericKeys = (v) => {
      if (Array.isArray(v)) {
        for (let i = 0; i < v.length; i++) {v[i] = toArrayIfNumericKeys(v[i])}
        return v
      }
      if (v && typeof v === 'object') {
        const keys = Object.keys(v)
        if (keys.length > 0 && keys.every(k => /^\d+$/.test(k))) {
          const arr = []
          keys.sort((a,b) => Number(a) - Number(b))
          for (const k of keys) {arr.push(toArrayIfNumericKeys(v[k]))}
          return arr
        }
        for (const k of keys) {v[k] = toArrayIfNumericKeys(v[k])}
        return v
      }
      return v
    }
    obj = toArrayIfNumericKeys(obj)
    return obj
  } catch (e) {
    try {
      const preview = (s || '').slice(0, 400).replace(/\n/g, '\\n')
      console.warn('[player] Lua->JSON preview:', preview)
    } catch {}
    try {
      // Targeted snippet around buckets to help debugging array/object detection
      try {
        const key = '"payouts"'
        const idx = (s || '').indexOf(key)
        if (idx >= 0) {
          const seg = (s || '').slice(Math.max(0, idx - 40), Math.min((s || '').length, idx + 220)).replace(/\n/g, '\\n')
          const hasBracket = /"payouts"\s*:\s*\[/.test(s || '')
          console.warn('[player] Lua->JSON key-segment payouts:', seg, ' bracketed=', hasBracket)
        }
      } catch {}
      const preview = (s || '').slice(0, 400).replace(/\n/g, '\\n')
      throw new Error('Lua->JSON parse failed: ' + (e?.message || String(e)) + ' preview=' + preview)
    } catch {
      throw new Error('Lua->JSON parse failed: ' + (e?.message || String(e)))
    }
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
  // Always write under companion/data (stable path regardless of current working directory)
  const dataDir = path.join(__dirname, '..', '..', 'data')
  const storePath = path.join(dataDir, 'accounting.json')
  let db = { version: 1, realms: {} }
  try { db = JSON.parse(fs.readFileSync(storePath, 'utf8')) } catch {}
  const src = json || {}
  const realms = src.realms || src.Realms || src.REALMS || {}
  for (const [realm, chars] of Object.entries(realms)) {
    db.realms[realm] = db.realms[realm] || {}
    for (const [charName, buckets] of Object.entries(chars || {})) {
      const dst = (db.realms[realm][charName] = db.realms[realm][charName] || { postings: [], sales: [], payouts: [], cancels: [], expires: [], buys: [] })
      for (const k of ['postings','sales','payouts','cancels','expires','buys']) {
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
  let lastSize = -1
  let timer = null
  const tick = () => {
    try {
      const st = fs.statSync(luaPath)
      if (st.size !== lastSize) {
        lastSize = st.size
        const tableStr = extractEGTable(luaPath)
        const obj = luaTableToJson(tableStr)
        mergeAccountingJSON(null, obj)
        try { console.info('[player] SavedVariables ingested -> companion/data/accounting.json updated; bytes=', st.size) } catch {}
      }
    } catch (e) {
      try { console.warn('[player] SavedVariables ingest error:', e?.message || String(e)) } catch {}
    } finally {
      timer = setTimeout(tick, intervalMs)
    }
  }
  // Run once immediately to force an initial ingest on startup
  tick()
  return { running: true, stop: () => { if (timer) {clearTimeout(timer)} } }
}
