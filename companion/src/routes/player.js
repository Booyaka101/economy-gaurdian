import fs from 'fs'
import path from 'path'
import express from 'express'
import { fileURLToPath } from 'url'
import * as sqlite from '../db/sqlite.js'

// Simple local storage for player accounting data
// File format: {
//   version: 1,
//   realms: { [realm]: { [character]: { postings:[], sales:[], payouts:[], buys:[], cancels:[], expires:[] } } }
// }

// ESM-compatible __filename/__dirname
const __filename = fileURLToPath(import.meta.url)
const __dirname = path.dirname(__filename)

export default function registerPlayerRoutes(app, _deps = {}) {
  const router = express.Router()
  // Always use companion/data irrespective of current working directory
  const dataDir = path.join(__dirname, '..', '..', 'data')
  const storePath = path.join(dataDir, 'accounting.json')
  const modelDir = path.join(dataDir, 'models')
  const modelPath = path.join(modelDir, 'player-models.json')

  function ensureDir(p) { try { fs.mkdirSync(p, { recursive: true }) } catch {} }

  let loadStore = function() {
    try {
      const raw = fs.readFileSync(storePath, 'utf8')
      return JSON.parse(raw)
    } catch { return { version: 1, realms: {} } }
  }
  let saveStore = function(db) {
    try { ensureDir(dataDir); fs.writeFileSync(storePath, JSON.stringify(db, null, 2)) } catch {}
  }

  let loadModels = function() {
    try { return JSON.parse(fs.readFileSync(modelPath, 'utf8')) } catch { return { version: 1, items: {}, updatedAt: 0 } }
  }
  let saveModels = function(m) {
    try { ensureDir(modelDir); fs.writeFileSync(modelPath, JSON.stringify(m, null, 2)) } catch {}
  }

  // Allow dependency injection for tests
  if (_deps && typeof _deps === 'object') {
    if (typeof _deps.loadStore === 'function') {loadStore = _deps.loadStore}
    if (typeof _deps.saveStore === 'function') {saveStore = _deps.saveStore}
    if (typeof _deps.loadModels === 'function') {loadModels = _deps.loadModels}
    if (typeof _deps.saveModels === 'function') {saveModels = _deps.saveModels}
  }

  // Helpers: deduplication by composite key preserving first occurrence
  function dedupeByKey(arr = [], keyFn) {
    try {
      const seen = new Set()
      const out = []
      for (let i = 0; i < arr.length; i++) {
        const x = arr[i]
        const k = keyFn(x)
        if (k && !seen.has(k)) { seen.add(k); out.push(x) }
      }
      return out
    } catch { return Array.isArray(arr) ? arr : [] }
  }
  function normalizeNum(v, d = 0) { const n = Number(v); return Number.isFinite(n) ? n : d }
  function payoutKey(p) {
    if (!p || typeof p !== 'object') {return ''}
    if (p.saleId) {return String(p.saleId)}
    const t = normalizeNum(p.t || p.time, 0)
    const nm = String(p.itemName || p.item || '')
    const g = normalizeNum(p.gross, 0), n = normalizeNum(p.net, 0), c = normalizeNum(p.cut, 0), q = normalizeNum(p.qty, 0)
    return `${t}|${nm}|${g}|${n}|${c}|${q}`
  }
  function saleKey(s) {
    if (!s || typeof s !== 'object') {return ''}
    const t = normalizeNum(s.t || s.time, 0)
    const nm = String(s.itemName || s.item || s.itemId || '')
    const q = normalizeNum(s.qty || s.quantity, 0)
    const u = normalizeNum(s.unit || s.unitPrice || s.price, 0)
    return `${t}|${nm}|${q}|${u}`
  }
  function buyKey(b) {
    if (!b || typeof b !== 'object') {return ''}
    const t = normalizeNum(b.t || b.time, 0)
    const nm = String(b.itemName || b.item || b.itemId || '')
    const q = normalizeNum(b.qty || b.quantity, 0)
    const u = normalizeNum(b.unit || b.unitPrice || b.price, 0)
    return `${t}|${nm}|${q}|${u}`
  }
  function postingKey(p) {
    if (!p || typeof p !== 'object') {return ''}
    const t = normalizeNum(p.t || p.time, 0)
    const nm = String(p.itemName || p.item || p.itemId || '')
    const q = normalizeNum(p.qty || p.quantity, 0)
    const u = normalizeNum(p.unit || p.unitPrice || p.buyout || p.price, 0)
    return `${t}|${nm}|${q}|${u}`
  }
  function simpleKey(x) {
    if (!x || typeof x !== 'object') {return ''}
    const t = normalizeNum(x.t || x.time, 0)
    const nm = String(x.itemName || x.item || x.itemId || '')
    const q = normalizeNum(x.qty || x.quantity, 0)
    return `${t}|${nm}|${q}`
  }

  // Upload endpoint: accept JSON body in our normalized shape
  router.post('/player/accounting/upload', express.json({ limit: '5mb' }), (req, res) => {
    try {
      const body = req.body || {}
      if (!body || typeof body !== 'object') {return res.status(400).json({ error: 'bad_body' })}
      const db = loadStore()
      // Merge realms/characters shallowly by concatenating arrays
      for (const [realm, chars] of Object.entries(body.realms || {})) {
        db.realms[realm] = db.realms[realm] || {}
        for (const [charName, buckets] of Object.entries(chars || {})) {
          const dst = (db.realms[realm][charName] = db.realms[realm][charName] || { postings: [], sales: [], payouts: [], buys: [], cancels: [], expires: [] })
          for (const k of ['postings','sales','payouts','buys','cancels','expires']) {
            if (Array.isArray(buckets[k])) {dst[k] = dst[k].concat(buckets[k])}
          }
          // Deduplicate after merge to avoid growth due to repeated uploads
          dst.postings = dedupeByKey(dst.postings, postingKey)
          dst.sales = dedupeByKey(dst.sales, saleKey)
          dst.payouts = dedupeByKey(dst.payouts, payoutKey)
          dst.buys = dedupeByKey(dst.buys, buyKey)
          dst.cancels = dedupeByKey(dst.cancels, simpleKey)
          dst.expires = dedupeByKey(dst.expires, simpleKey)
          // Also persist into SQLite when enabled for scalable querying
          try { if (sqlite.isEnabled()) { sqlite.upsertBuckets(realm, charName, buckets) } } catch {}
        }
      }
      saveStore(db)
      return res.json({ ok: true })
    } catch (e) { return res.status(500).json({ error: 'upload_failed', message: e?.message || String(e) }) }
  })

  // GET /player/payouts/unmatched?realm=&char=&olderThanMin=120&graceMin=10
  router.get('/player/payouts/unmatched', (req, res) => {
    try {
      const realm = req.query.realm ? String(req.query.realm) : null
      const character = req.query.char ? String(req.query.char) : null
      const olderThanMin = Math.max(10, Math.min(7*24*60, Number(req.query.olderThanMin || 120)))
      const graceMin = Math.max(0, Math.min(6*60, Number(req.query.graceMin || 10)))
      const now = Date.now()
      const olderCutoff = now - olderThanMin * 60 * 1000
      const graceCutoff = now - graceMin * 60 * 1000
      const db = loadStore()
      const { sales, payouts } = filterScope(db, realm, character)
      const paidKeys = new Set(payouts.map(p => p.saleId || `${p.itemId}|${p.t}|${p.qty}|${p.unit}`))
      const pending = []
      for (const s of sales) {
        const key = s.saleId || `${s.itemId}|${s.t}|${s.qty}|${s.unit}`
        const tsMs = (Number(s.t || 0)) * 1000
        if (paidKeys.has(key)) { continue }
        if (!Number.isFinite(tsMs)) { continue }
        // only include sales older than threshold, and also older than grace to avoid fresh noise
        if (tsMs <= olderCutoff && tsMs <= graceCutoff) {
          const qty = Number(s.qty || 0)
          const unit = Number(s.unit || s.unitPrice || s.price || 0)
          const gross = unit * qty
          pending.push({ t: s.t, itemId: Number(s.itemId), qty, unit, gross })
        }
      }
      pending.sort((a,b)=> (a.t||0) - (b.t||0))
      return res.json({ count: pending.length, items: pending })
    } catch (e) { try { console.error('[player] unmatched_failed', e) } catch {} return res.status(500).json({ error: 'unmatched_failed', message: e?.message || String(e) }) }
  })

  // GET /player/ledger?realm=&char=&sinceHours=168&type=all&limit=200&offset=0
  router.get('/player/ledger', (req, res) => {
    try {
      const realm = req.query.realm ? String(req.query.realm) : null
      const character = req.query.char ? String(req.query.char) : null
      const sinceHours = Math.max(1, Math.min(365*24, Number(req.query.sinceHours || 168)))
      const type = String(req.query.type || 'all').toLowerCase()
      const limit = Math.max(1, Math.min(2000, Number(req.query.limit || 200)))
      const offset = Math.max(0, Number(req.query.offset || 0))
      const sinceTs = Date.now() - sinceHours * 3600 * 1000
      const db = loadStore()
      const scope = filterScope(db, realm, character)
      const rows = []
      const pushRow = (row) => { if (row && Number.isFinite(row.t)) {rows.push(row)} }
      // postings
      if (type === 'all' || type === 'postings') {
        for (const p of scope.postings) {
          const t = Number(p.t || p.time || 0)
          if (!Number.isFinite(t) || t * 1000 < sinceTs) { continue }
          pushRow({ type: 'posting', t, itemId: Number(p.itemId), itemName: p.itemName || p.item || '', qty: Number(p.qty || p.quantity || 0), unit: Number(p.unit || p.unitPrice || p.buyout || p.price || 0) })
        }
      }
      // sales
      if (type === 'all' || type === 'sales' || type === 'sale') {
        for (const s of scope.sales) {
          const t = Number(s.t || s.time || 0)
          if (!Number.isFinite(t) || t * 1000 < sinceTs) { continue }
          const qty = Number(s.qty || 0)
          const unit = Number(s.unit || s.unitPrice || s.price || 0)
          const gross = unit * qty
          const cut = Math.round(gross * 0.05)
          const net = gross - cut
          pushRow({ type: 'sale', t, itemId: Number(s.itemId), itemName: s.itemName || s.item || '', qty, unit, gross, cut, net })
        }
      }
      // buys
      if (type === 'all' || type === 'buys' || type === 'buy') {
        for (const b of scope.buys) {
          const t = Number(b.t || b.time || 0)
          if (!Number.isFinite(t) || t * 1000 < sinceTs) { continue }
          const qty = Number(b.qty || b.quantity || 0)
          const unit = Number(b.unit || b.unitPrice || b.price || 0)
          const gross = unit * qty
          const cut = 0
          const net = -gross
          pushRow({ type: 'buy', t, itemId: Number(b.itemId), itemName: b.itemName || b.item || '', qty, unit, gross, cut, net })
        }
      }
      // payouts
      if (type === 'all' || type === 'payouts' || type === 'payout') {
        for (const p of scope.payouts) {
          const t = Number(p.t || p.time || 0)
          if (!Number.isFinite(t) || t * 1000 < sinceTs) { continue }
          const qty = Number(p.qty || 0)
          const unit = Number(p.unit || p.unitPrice || p.price || 0)
          const gross = Number.isFinite(p.gross) ? Number(p.gross) : (unit * qty)
          const cut = Number.isFinite(p.cut) ? Number(p.cut) : Math.round(gross * 0.05)
          const net = Number.isFinite(p.net) ? Number(p.net) : (gross - cut)
          pushRow({ type: 'payout', t, itemId: Number(p.itemId), itemName: p.itemName || p.item || '', qty, unit, gross, cut, net })
        }
      }
      // cancels
      if (type === 'all' || type === 'cancels' || type === 'cancel') {
        for (const c of scope.cancels) {
          const t = Number(c.t || c.time || 0)
          if (!Number.isFinite(t) || t * 1000 < sinceTs) { continue }
          pushRow({ type: 'cancel', t, itemId: Number(c.itemId), itemName: c.itemName || c.item || '', qty: Number(c.qty || c.quantity || 0) })
        }
      }
      // expires
      if (type === 'all' || type === 'expires' || type === 'expire') {
        for (const x of scope.expires) {
          const t = Number(x.t || x.time || 0)
          if (!Number.isFinite(t) || t * 1000 < sinceTs) { continue }
          pushRow({ type: 'expire', t, itemId: Number(x.itemId), itemName: x.itemName || x.item || '', qty: Number(x.qty || x.quantity || 0) })
        }
      }
      rows.sort((a,b)=> (b.t||0) - (a.t||0))
      const total = rows.length
      const items = rows.slice(offset, offset + limit)
      return res.json({ realm: realm || 'all', character: character || 'all', sinceHours, type, total, offset, limit, count: items.length, items })
    } catch (e) { try { console.error('[player] ledger_failed', e) } catch {} return res.status(500).json({ error: 'ledger_failed', message: e?.message || String(e) }) }
  })

  // GET /player/summary?realm=&char=&windowDays=30
  router.get('/player/summary', (req, res) => {
    try {
      const realm = req.query.realm ? String(req.query.realm) : null
      const character = req.query.char ? String(req.query.char) : null
      const windowDays = Math.max(1, Math.min(365, Number(req.query.windowDays || 30)))
      const since = Date.now() - windowDays * 86400 * 1000
      const db = loadStore()
      const { sales, payouts } = filterScope(db, realm, character)
      const byDay = new Map()
      const dayKey = (ms) => { const d = new Date(ms); return d.toISOString().slice(0,10) }
      const addDay = (key, field, v) => { const o = byDay.get(key) || { gross:0, ahCut:0, netSales:0, netPayouts:0, salesCount:0, payoutsCount:0 }; o[field] += v; byDay.set(key, o) }
      const incDay = (key, field) => { const o = byDay.get(key) || { gross:0, ahCut:0, netSales:0, netPayouts:0, salesCount:0, payoutsCount:0 }; o[field] += 1; byDay.set(key, o) }
      for (const s of sales) {
        const ms = Number(s.t || s.time || 0) * 1000
        if (!Number.isFinite(ms) || ms < since) {continue}
        const qty = Number(s.qty || 0)
        const unit = Number(s.unit || s.unitPrice || s.price || 0)
        const gross = unit * qty
        const cut = Math.round(gross * 0.05)
        const net = gross - cut
        const k = dayKey(ms)
        addDay(k,'gross',gross); addDay(k,'ahCut',cut); addDay(k,'netSales',net); incDay(k,'salesCount')
      }
      for (const p of payouts) {
        const ms = Number(p.t || p.time || 0) * 1000
        if (!Number.isFinite(ms) || ms < since) {continue}
        const net = Number(p.net || 0)
        if (Number.isFinite(net)) { const k = dayKey(ms); addDay(k,'netPayouts',net); incDay(k,'payoutsCount') }
      }
      const days = [...byDay.entries()].map(([day, v])=>({ day, gross: v.gross, ahCut: v.ahCut, netSales: v.netSales, netPayouts: v.netPayouts, salesCount: v.salesCount, payoutsCount: v.payoutsCount }))
      days.sort((a,b)=> a.day.localeCompare(b.day))
      return res.json({ windowDays, realm: realm || 'all', character: character || 'all', days, totalDays: days.length })
    } catch (e) { try { console.error('[player] summary_failed', e) } catch {} return res.status(500).json({ error: 'summary_failed', message: e?.message || String(e) }) }
  })

  // GET /player/current — infer most recently active character
  router.get('/player/current', (req, res) => {
    try {
      const db = loadStore()
      const realms = db.realms || {}
      let best = { realm: '', character: '', lastTs: 0 }
      const getMaxTs = (arr=[]) => {
        let m = 0
        for (const x of arr) {
          const t = Number(x.t || x.time || 0)
          if (Number.isFinite(t) && t > m) {m = t}
        }
        return m
      }
      for (const r of Object.keys(realms)) {
        const chars = realms[r] || {}
        for (const c of Object.keys(chars)) {
          const v = chars[c] || {}
          const t1 = getMaxTs(v.postings)
          const t2 = getMaxTs(v.sales)
          const t3 = getMaxTs(v.payouts)
          const t4 = getMaxTs(v.cancels)
          const t5 = getMaxTs(v.expires)
          const t6 = getMaxTs(v.buys)
          const last = Math.max(t1,t2,t3,t4,t5,t6)
          if (last > best.lastTs) {best = { realm: r, character: c, lastTs: last }}
        }
      }
      return res.json({ current: best })
    } catch (e) { return res.status(500).json({ error: 'current_failed', message: e?.message || String(e) }) }
  })

  // Helpers
  function canonRealm(s) {
    try {
      return String(s || '').replace(/[\s']/g, '').toLowerCase()
    } catch { return String(s || '') }
  }
  function filterScope(db, realm, character) {
    const out = { postings: [], sales: [], payouts: [], buys: [], cancels: [], expires: [] }
    const realms = db.realms || {}
    // Build canonical mapping from stored realm keys -> grouped by canonical name
    const realmCanonMap = new Map()
    for (const r of Object.keys(realms)) {
      const cr = canonRealm(r)
      const arr = realmCanonMap.get(cr) || []
      arr.push(r)
      realmCanonMap.set(cr, arr)
    }
    const targetCanon = realm ? canonRealm(realm) : null
    const realmsKeys = targetCanon ? (realmCanonMap.get(targetCanon) || []) : Object.keys(realms)
    for (const r of realmsKeys) {
      const chars = realms[r] || {}
      const charKeys = character ? [character] : Object.keys(chars)
      for (const c of charKeys) {
        const v = chars[c] || {}
        for (const k of ['postings','sales','payouts','buys','cancels','expires']) {
          if (Array.isArray(v[k])) {out[k].push(...v[k])}
        }
      }
    }
    return out
  }

  // GET /player/stats?realm=&char=&sinceHours=168
  router.get('/player/stats', (req, res) => {
    try {
      const sinceHours = Math.max(1, Math.min(365*24, Number(req.query.sinceHours || 168)))
      const realm = req.query.realm ? String(req.query.realm) : null
      const character = req.query.char ? String(req.query.char) : null
      const db = loadStore()
      const { sales, payouts } = filterScope(db, realm, character)
      const sinceTs = Date.now() - sinceHours * 3600 * 1000
      let gross = 0, ahCut = 0, salesCount = 0
      let netFromSales = 0, netFromPayouts = 0
      let hasPayoutNets = false
      // Fallback accumulators from payouts in case sales bucket is empty
      let grossFromPayouts = 0, ahCutFromPayouts = 0, payoutCount = 0
      for (const s of sales) {
        const t = Number(s.t || s.time || 0)
        if (!Number.isFinite(t) || t * 1000 < sinceTs) {continue}
        const qty = Number(s.qty || 0)
        const unit = Number(s.unit || s.unitPrice || s.price || 0)
        const g = unit * qty
        const cut = Math.round(g * 0.05)
        const n = g - cut
        gross += g; ahCut += cut; netFromSales += n; salesCount += 1
      }
      // If payouts contain explicit net, prefer them for net totals
      for (const p of payouts) {
        const t = Number(p.t || p.time || 0)
        if (!Number.isFinite(t) || t * 1000 < sinceTs) {continue}
        if (p.net != null) {
          netFromPayouts += Number(p.net || 0)
          hasPayoutNets = true
        }
        // Also collect gross/AH cut from payouts as a fallback if sales are missing
        const gP = Number(p.gross || 0)
        const cP = Number(p.cut || 0)
        if (Number.isFinite(gP)) { grossFromPayouts += gP }
        if (Number.isFinite(cP)) { ahCutFromPayouts += cP }
        payoutCount += 1
      }
      // Prefer sales for gross/ahCut/count if present, otherwise fallback to payouts
      const usePayoutFallback = salesCount === 0 && payoutCount > 0
      const grossOut = usePayoutFallback ? grossFromPayouts : gross
      const ahCutOut = usePayoutFallback ? ahCutFromPayouts : ahCut
      const countOut = usePayoutFallback ? payoutCount : salesCount
      return res.json({
        realm: realm || 'all', character: character || 'all', sinceHours,
        totals: { salesCount: countOut, gross: grossOut, ahCut: ahCutOut, net: (hasPayoutNets ? netFromPayouts : netFromSales) }
      })
    } catch (e) { try { console.error('[player] stats_failed', e) } catch {} return res.status(500).json({ error: 'stats_failed', message: e?.message || String(e) }) }
  })

  // GET /player/payouts/awaiting?realm=&char=&windowMin=60&limit=500&offset=0
  router.get('/player/payouts/awaiting', (req, res) => {
    try {
      const realm = req.query.realm ? String(req.query.realm) : null
      const character = req.query.char ? String(req.query.char) : null
      const windowMin = Math.max(10, Math.min(24*60, Number(req.query.windowMin || 60)))
      const limit = Math.max(1, Math.min(2000, Number(req.query.limit || 500)))
      const offset = Math.max(0, Number(req.query.offset || 0))
      // If SQLite is enabled, use it for efficient querying
      if (sqlite.isEnabled()) {
        const { items } = sqlite.queryAwaiting({ realm, character, windowMin, limit, offset })
        return res.json({ limit, offset, count: items.length, items })
      }
      const db = loadStore()
      const { sales, payouts } = filterScope(db, realm, character)
      const cutoff = Date.now() - windowMin * 60 * 1000
      // Build paidKeys only from recent payouts to avoid scanning entire history.
      // Look back up to 6x the window (min 1h, max 7d) — safe for matching nearby payouts.
      const lookbackMs = Math.max(60*60*1000, Math.min(7*24*60*60*1000, windowMin * 60 * 1000 * 6))
      const paidKeys = new Set()
      for (const p of payouts) {
        const tsMs = (Number(p.t || p.time || 0)) * 1000
        if (!Number.isFinite(tsMs) || tsMs < (cutoff - lookbackMs)) { continue }
        const key = p.saleId || `${p.itemId}|${p.t}|${p.qty}|${p.unit}`
        paidKeys.add(key)
      }
      const pending = []
      for (const s of sales) {
        const key = s.saleId || `${s.itemId}|${s.t}|${s.qty}|${s.unit}`
        const tsMs = (Number(s.t || 0)) * 1000
        if (!paidKeys.has(key) && Number.isFinite(tsMs) && tsMs >= cutoff) {
          const qty = Number(s.qty || 0)
          const unit = Number(s.unit || s.unitPrice || s.price || 0)
          const gross = unit * qty
          pending.push({
            t: s.t, itemId: Number(s.itemId), qty, unit, gross,
            etaMinutes: 60, // default; refine when we learn distribution
          })
        }
      }
      pending.sort((a,b)=> (a.t||0) - (b.t||0))
      const items = pending.slice(offset, offset + limit)
      return res.json({ limit, offset, count: items.length, items })
    } catch (e) { try { console.error('[player] awaiting_failed', e) } catch {} return res.status(500).json({ error: 'awaiting_failed', message: e?.message || String(e) }) }
  })

  // --- Learning & Recommendations ---
  function rebuildModels(db, sinceDays = 30) {
    const sinceTs = Date.now() - Math.max(1, Math.min(3650, sinceDays)) * 86400 * 1000
    const items = {}
    const push = (obj, k, v) => { (obj[k] = obj[k] || []).push(v) }
    const _add = (obj, k, v) => { obj[k] = (obj[k] || 0) + v }
    const realms = db.realms || {}
    for (const r of Object.keys(realms)) {
      for (const c of Object.keys(realms[r] || {})) {
        const sales = (realms[r][c]?.sales) || []
        for (const s of sales) {
          const tMs = Number(s.t || s.time || 0) * 1000
          if (!Number.isFinite(tMs) || tMs < sinceTs) {continue}
          const itemId = Number(s.itemId)
          const qty = Number(s.qty || 0)
          const unit = Number(s.unit || s.unitPrice || s.price || 0)
          if (!Number.isFinite(itemId) || !Number.isFinite(qty) || !Number.isFinite(unit)) {continue}
          const rec = (items[itemId] = items[itemId] || { units: [], qty: 0, gross: 0, count: 0, hourHist: new Array(24).fill(0) })
          push(rec, 'units', unit)
          rec.qty += qty
          rec.gross += unit * qty
          rec.count += 1
          const h = new Date(tMs).getHours()
          rec.hourHist[h] = (rec.hourHist[h] || 0) + 1
        }
      }
    }
    // finalize stats
    for (const [itemId, rec] of Object.entries(items)) {
      const arr = rec.units.slice().sort((a,b)=>a-b)
      const n = arr.length || 1
      const mean = rec.gross / Math.max(1, rec.qty)
      const p50 = arr[Math.floor((n-1)*0.5)]
      const p25 = arr[Math.floor((n-1)*0.25)]
      const p75 = arr[Math.floor((n-1)*0.75)]
      const bestHours = rec.hourHist
        .map((v,i)=>({i,v}))
        .sort((a,b)=>b.v-a.v)
        .slice(0,3)
        .map(x=>x.i)
      items[itemId] = { count: rec.count, qty: rec.qty, meanUnit: Math.round(mean), p25, p50, p75, bestHours, hourHist: rec.hourHist }
    }
    const out = { version: 1, updatedAt: Date.now(), items }
    saveModels(out)
    return out
  }

  // POST /player/learn/rebuild { sinceDays?: number }
  router.post('/player/learn/rebuild', express.json(), (req, res) => {
    try {
      const sinceDays = Number(req.body?.sinceDays || 30)
      const db = loadStore()
      const models = rebuildModels(db, sinceDays)
      const itemCount = Object.keys(models.items || {}).length
      return res.json({ ok: true, updatedAt: models.updatedAt, itemCount })
    } catch (e) { return res.status(500).json({ error: 'learn_failed', message: e?.message || String(e) }) }
  })

  // GET /player/recommend/price?itemId=&targetHours=12&maxStack=200
  router.get('/player/recommend/price', (req, res) => {
    try {
      const itemId = Number(req.query.itemId)
      if (!Number.isFinite(itemId)) {return res.status(400).json({ error: 'bad_itemId' })}
      const targetHours = Math.max(1, Math.min(72, Number(req.query.targetHours || 12)))
      const maxStack = Math.max(1, Math.min(10000, Number(req.query.maxStack || 200)))
      let models = loadModels()
      if (!models.updatedAt) { models = rebuildModels(loadStore(), 30) }
      const rec = models.items?.[itemId]
      // Simple policy: use p50, with small adjustment toward mean if very sparse
      let unit = rec?.p50 || rec?.meanUnit
      if (!Number.isFinite(unit)) {
        // cold start: fall back to zero, caller should blend with fair value on client if desired
        unit = 0
      }
      const stack = Math.max(1, Math.min(maxStack, rec?.qty && rec?.count ? Math.round(rec.qty / rec.count) : maxStack))
      const gross = unit * stack
      const ahCut = Math.round(gross * 0.05)
      const net = gross - ahCut
      const expectedETA = targetHours // placeholder until we model ETA
      return res.json({
        itemId, targetHours, recommended: { unit, stack, gross, ahCut, net, expectedETA },
        basis: rec || null
      })
    } catch (e) { return res.status(500).json({ error: 'recommend_failed', message: e?.message || String(e) }) }
  })

  // GET /player/insights?windowDays=7
  router.get('/player/insights', (req, res) => {
    try {
      const windowDays = Math.max(1, Math.min(90, Number(req.query.windowDays || 7)))
      const realmFilter = (req.query.realm||'').toString()
      const charFilter = (req.query.character||'').toString()
      const since = Date.now() - windowDays * 86400 * 1000
      const db = loadStore()
      const byItem = {}
      const _add = (obj, k, v) => { obj[k] = (obj[k] || 0) + v }
      const realms = db.realms || {}
      for (const r of Object.keys(realms)) {
        if (realmFilter && r !== realmFilter) {continue}
        for (const c of Object.keys(realms[r] || {})) {
          if (charFilter && c !== charFilter) {continue}
          const sales = (realms[r][c]?.sales) || []
          for (const s of sales) {
            const tMs = Number(s.t || s.time || 0) * 1000
            if (!Number.isFinite(tMs) || tMs < since) {continue}
            const itemId = Number(s.itemId)
            const qty = Number(s.qty || 0)
            const unit = Number(s.unit || s.unitPrice || s.price || 0)
            const gross = unit * qty
            const cut = Math.round(gross * 0.05)
            const net = gross - cut
            if (!byItem[itemId]) {byItem[itemId] = { itemId, salesCount: 0, qty: 0, gross: 0, net: 0 }}
            byItem[itemId].salesCount += 1
            byItem[itemId].qty += qty
            byItem[itemId].gross += gross
            byItem[itemId].net += net
          }
        }
      }
      const items = Object.values(byItem).sort((a,b)=> b.net - a.net).slice(0, 50)
      const models = loadModels()
      // aggregate best posting hours from models
      const hourScore = new Array(24).fill(0)
      for (const it of Object.values(models.items || {})) {
        const hist = it.hourHist || []
        for (let h=0; h<24; h++) {hourScore[h] += Number(hist[h] || 0)}
      }
      const bestHours = hourScore.map((v,i)=>({i,v})).sort((a,b)=> b.v - a.v).slice(0, 5).map(x=>x.i)
      return res.json({ windowDays, items, bestHours })
    } catch (e) { return res.status(500).json({ error: 'insights_failed', message: e?.message || String(e) }) }
  })

  // GET /player/characters
  router.get('/player/characters', (req, res) => {
    try {
      const db = loadStore()
      const realms = db.realms || {}
      const out = {}
      for (const r of Object.keys(realms)) {
        out[r] = Object.keys(realms[r] || {})
      }
      return res.json({ realms: out })
    } catch (e) { return res.status(500).json({ error: 'characters_failed', message: e?.message || String(e) }) }
  })

  // GET /player/top-items?windowDays=7&limit=50
  router.get('/player/top-items', (req, res) => {
    try {
      const windowDays = Math.max(1, Math.min(365, Number(req.query.windowDays || 7)))
      const limit = Math.max(1, Math.min(500, Number(req.query.limit || 50)))
      const realmFilter = (req.query.realm||'').toString()
      const charFilter = (req.query.character||'').toString()
      const since = Date.now() - windowDays * 86400 * 1000
      const db = loadStore()
      const byItem = {}
      const add = (obj, k, v) => { obj[k] = (obj[k] || 0) + v }
      const realms = db.realms || {}
      for (const r of Object.keys(realms)) {
        if (realmFilter && r !== realmFilter) {continue}
        for (const c of Object.keys(realms[r] || {})) {
          if (charFilter && c !== charFilter) {continue}
          const sales = (realms[r][c]?.sales) || []
          for (const s of sales) {
            const tMs = Number(s.t || s.time || 0) * 1000
            if (!Number.isFinite(tMs) || tMs < since) {continue}
            const itemId = Number(s.itemId)
            const qty = Number(s.qty || 0)
            const unit = Number(s.unit || s.unitPrice || s.price || 0)
            const gross = unit * qty
            const cut = Math.round(gross * 0.05)
            const net = gross - cut
            if (!byItem[itemId]) {byItem[itemId] = { itemId, salesCount: 0, qty: 0, gross: 0, net: 0 }}
            byItem[itemId].salesCount += 1
            add(byItem[itemId], 'qty', qty)
            add(byItem[itemId], 'gross', gross)
            add(byItem[itemId], 'net', net)
          }
        }
      }
      const items = Object.values(byItem).sort((a,b)=> b.net - a.net).slice(0, limit)
      return res.json({ windowDays, limit, items })
    } catch (e) { return res.status(500).json({ error: 'top_items_failed', message: e?.message || String(e) }) }
  })

  // GET /player/recommend/window?targetHours=2
  router.get('/player/recommend/window', (req, res) => {
    try {
      const targetHours = Math.max(1, Math.min(8, Number(req.query.targetHours || 2)))
      const models = loadModels()
      const hourScore = new Array(24).fill(0)
      for (const it of Object.values(models.items || {})) {
        const hist = it.hourHist || []
        for (let h=0; h<24; h++) {hourScore[h] += Number(hist[h] || 0)}
      }
      const ranked = hourScore.map((v,i)=>({ hour:i, score:v })).sort((a,b)=> b.score - a.score)
      const bestHour = ranked.length ? ranked[0].hour : 18
      // suggest the next occurrence of bestHour as a starting time window
      const now = new Date()
      const start = new Date(now)
      start.setMinutes(0,0,0)
      if (now.getHours() >= bestHour) {
        // move to next day bestHour
        start.setDate(start.getDate() + 1)
      }
      start.setHours(bestHour)
      const end = new Date(start)
      end.setHours(end.getHours() + targetHours)
      return res.json({ targetHours, bestHour, window: { start: start.toISOString(), end: end.toISOString() }, ranked: ranked.slice(0, 6) })
    } catch (e) { return res.status(500).json({ error: 'window_failed', message: e?.message || String(e) }) }
  })

  // GET /player/accounting/status
  router.get('/player/accounting/status', (req, res) => {
    try {
      const db = loadStore()
      const realms = db.realms || {}
      const summary = {}
      for (const r of Object.keys(realms)) {
        summary[r] = {}
        for (const c of Object.keys(realms[r] || {})) {
          const v = realms[r][c] || {}
          summary[r][c] = {
            postings: (v.postings||[]).length,
            sales: (v.sales||[]).length,
            payouts: (v.payouts||[]).length,
            buys: (v.buys||[]).length,
            cancels: (v.cancels||[]).length,
            expires: (v.expires||[]).length,
          }
        }
      }
      return res.json({ version: 1, summary })
    } catch (e) { return res.status(500).json({ error: 'status_failed', message: e?.message || String(e) }) }
  })

  app.use(router)
}
