// SQLite backend for accounting data
// Enable with environment variable EG_SQLITE=1

import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

let Database = null;
try {
  // Lazy require to avoid hard dependency if not enabled
  Database = (await import('better-sqlite3')).default;
} catch {}

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const dataDir = path.join(__dirname, '..', '..', 'data');
const dbPath = path.join(dataDir, 'accounting.sqlite');
const DEBUG = String(process.env.EG_SQLITE_DEBUG || '0') === '1';

let db = null;

export function isEnabled() {
  return process?.env?.EG_SQLITE === '1' && Database != null;
}

export function init() {
  if (!isEnabled()) {
    try {
      if (DEBUG) {
        console.info('[sqlite] init: disabled (EG_SQLITE!=1 or module missing)');
      }
    } catch {}
    return false;
  }
  if (db) {
    return true;
  }
  fs.mkdirSync(dataDir, { recursive: true });
  try {
    // If the main DB file is missing but WAL sidecar files exist from a previous run,
    // remove them to avoid resurrecting old data upon opening the database.
    try {
      if (!fs.existsSync(dbPath)) {
        try {
          fs.rmSync(dbPath + '-wal', { force: true });
        } catch {}
        try {
          fs.rmSync(dbPath + '-shm', { force: true });
        } catch {}
      }
    } catch {}
    db = new Database(dbPath);
    db.pragma('journal_mode = WAL');
    db.pragma('synchronous = NORMAL');
    ensureSchema();
    try {
      let total = db.prepare('SELECT COUNT(*) AS c FROM events').get()?.c || 0;
      // Optional hard reset for tests: EG_SQLITE_RESET=1
      if (String(process.env.EG_SQLITE_RESET || '0') === '1') {
        try {
          console.info('[sqlite] reset requested via EG_SQLITE_RESET=1; deleting', total, 'events');
          db.exec('DELETE FROM events');
          total = db.prepare('SELECT COUNT(*) AS c FROM events').get()?.c || 0;
        } catch {}
      }
      console.info('[sqlite] initialized at', dbPath, 'events=', total);
    } catch {}
    return true;
  } catch (e) {
    try {
      console.warn('[sqlite] init failed:', e?.message || e);
    } catch {}
    db = null;
    return false;
  }
}

function ensureSchema() {
  db.exec(`
    CREATE TABLE IF NOT EXISTS events (
      realm TEXT NOT NULL,
      character TEXT NOT NULL,
      type TEXT NOT NULL,
      t INTEGER NOT NULL,
      itemId INTEGER,
      qty INTEGER,
      unit INTEGER,
      gross INTEGER,
      cut INTEGER,
      net INTEGER,
      saleId TEXT,
      sale_key TEXT,
      key TEXT NOT NULL,
      PRIMARY KEY (realm, character, type, key)
    );
    CREATE INDEX IF NOT EXISTS idx_events_rt ON events(realm, character, type, t);
    CREATE INDEX IF NOT EXISTS idx_events_salekey ON events(realm, character, sale_key);
  `);
}

// --- Key helpers (mirroring routes/player.js) ---
function normalizeNum(v, d = 0) {
  const n = Number(v);
  return Number.isFinite(n) ? n : d;
}
function canonRealm(s) {
  try {
    return String(s || '')
      .replace(/[\s']/g, '')
      .toLowerCase();
  } catch {
    return String(s || '');
  }
}
function payoutKey(p) {
  if (!p || typeof p !== 'object') {
    return '';
  }
  if (p.saleId) {
    return String(p.saleId);
  }
  const t = normalizeNum(p.t || p.time, 0);
  const nm = String(p.itemName || p.item || '');
  const g = normalizeNum(p.gross, 0),
    n = normalizeNum(p.net, 0),
    c = normalizeNum(p.cut, 0),
    q = normalizeNum(p.qty, 0);
  return `${t}|${nm}|${g}|${n}|${c}|${q}`;
}
function saleKey(s) {
  if (!s || typeof s !== 'object') {
    return '';
  }
  const t = normalizeNum(s.t || s.time, 0);
  const nm = String(s.itemName || s.item || s.itemId || '');
  const q = normalizeNum(s.qty || s.quantity, 0);
  const u = normalizeNum(s.unit || s.unitPrice || s.price, 0);
  return `${t}|${nm}|${q}|${u}`;
}
function buyKey(b) {
  if (!b || typeof b !== 'object') {
    return '';
  }
  const t = normalizeNum(b.t || b.time, 0);
  const nm = String(b.itemName || b.item || b.itemId || '');
  const q = normalizeNum(b.qty || b.quantity, 0);
  const u = normalizeNum(b.unit || b.unitPrice || b.price, 0);
  return `${t}|${nm}|${q}|${u}`;
}
function postingKey(p) {
  if (!p || typeof p !== 'object') {
    return '';
  }
  const t = normalizeNum(p.t || p.time, 0);
  const nm = String(p.itemName || p.item || p.itemId || '');
  const q = normalizeNum(p.qty || p.quantity, 0);
  const u = normalizeNum(p.unit || p.unitPrice || p.buyout || p.price, 0);
  return `${t}|${nm}|${q}|${u}`;
}
function simpleKey(x) {
  if (!x || typeof x !== 'object') {
    return '';
  }
  const t = normalizeNum(x.t || x.time, 0);
  const nm = String(x.itemName || x.item || x.itemId || '');
  const q = normalizeNum(x.qty || x.quantity, 0);
  return `${t}|${nm}|${q}`;
}

// Insert batches from buckets (dedupe via PRIMARY KEY)
export function upsertBuckets(realm, character, buckets = {}) {
  if (!init()) {
    return;
  }
  const ins =
    db.prepare(`INSERT OR IGNORE INTO events (realm, character, type, t, itemId, qty, unit, gross, cut, net, saleId, sale_key, key)
    VALUES (@realm, @character, @type, @t, @itemId, @qty, @unit, @gross, @cut, @net, @saleId, @sale_key, @key)`);
  const tx = db.transaction((rows) => {
    for (const r of rows) {
      ins.run(r);
    }
  });

  const rows = [];
  const push = (row) => {
    if (row && Number.isFinite(row.t)) {
      rows.push(row);
    }
  };

  const addSaleKey = (o) => (
    (o.sale_key = o.saleId ? String(o.saleId) : `${o.itemId}|${o.t}|${o.qty}|${o.unit}`),
    o
  );

  for (const p of buckets.postings || []) {
    const t = Number(p.t || p.time || 0);
    if (!Number.isFinite(t)) {
      continue;
    }
    push({
      realm,
      character,
      type: 'posting',
      t,
      itemId: Number(p.itemId),
      qty: Number(p.qty || p.quantity || 0),
      unit: Number(p.unit || p.unitPrice || p.buyout || p.price || 0),
      gross: null,
      cut: null,
      net: null,
      saleId: null,
      sale_key: null,
      key: postingKey(p),
    });
  }
  for (const s of buckets.sales || []) {
    const t = Number(s.t || s.time || 0);
    if (!Number.isFinite(t)) {
      continue;
    }
    const qty = Number(s.qty || 0);
    const unit = Number(s.unit || s.unitPrice || s.price || 0);
    push(
      addSaleKey({
        realm,
        character,
        type: 'sale',
        t,
        itemId: Number(s.itemId),
        qty,
        unit,
        gross: unit * qty,
        cut: Math.round(unit * qty * 0.05),
        net: unit * qty - Math.round(unit * qty * 0.05),
        saleId: s.saleId ? String(s.saleId) : null,
        key: saleKey(s),
      }),
    );
  }
  for (const p of buckets.payouts || []) {
    const t = Number(p.t || p.time || 0);
    if (!Number.isFinite(t)) {
      continue;
    }
    const qty = Number(p.qty || 0);
    const unit = Number(p.unit || p.unitPrice || p.price || 0);
    const gross = Number.isFinite(p.gross) ? Number(p.gross) : unit * qty;
    const cut = Number.isFinite(p.cut) ? Number(p.cut) : Math.round(gross * 0.05);
    const net = Number.isFinite(p.net) ? Number(p.net) : gross - cut;
    const saleId = p.saleId ? String(p.saleId) : null;
    const sale_key = saleId ? saleId : `${Number(p.itemId)}|${t}|${qty}|${unit}`;
    push({
      realm,
      character,
      type: 'payout',
      t,
      itemId: Number(p.itemId),
      qty,
      unit,
      gross,
      cut,
      net,
      saleId,
      sale_key,
      key: payoutKey(p),
    });
  }
  for (const b of buckets.buys || []) {
    const t = Number(b.t || b.time || 0);
    if (!Number.isFinite(t)) {
      continue;
    }
    const qty = Number(b.qty || b.quantity || 0);
    const unit = Number(b.unit || b.unitPrice || b.price || 0);
    push({
      realm,
      character,
      type: 'buy',
      t,
      itemId: Number(b.itemId),
      qty,
      unit,
      gross: unit * qty,
      cut: 0,
      net: -unit * qty,
      saleId: null,
      sale_key: null,
      key: buyKey(b),
    });
  }
  for (const c of buckets.cancels || []) {
    const t = Number(c.t || c.time || 0);
    if (!Number.isFinite(t)) {
      continue;
    }
    push({
      realm,
      character,
      type: 'cancel',
      t,
      itemId: Number(c.itemId),
      qty: Number(c.qty || c.quantity || 0),
      unit: null,
      gross: null,
      cut: null,
      net: null,
      saleId: null,
      sale_key: null,
      key: simpleKey(c),
    });
  }
  for (const x of buckets.expires || []) {
    const t = Number(x.t || x.time || 0);
    if (!Number.isFinite(t)) {
      continue;
    }
    push({
      realm,
      character,
      type: 'expire',
      t,
      itemId: Number(x.itemId),
      qty: Number(x.qty || x.quantity || 0),
      unit: null,
      gross: null,
      cut: null,
      net: null,
      saleId: null,
      sale_key: null,
      key: simpleKey(x),
    });
  }

  tx(rows);
  try {
    const sCount = (buckets.sales || []).length;
    const pCount = (buckets.payouts || []).length;
    const oCount = rows.length - sCount - pCount;
    console.info(
      `[sqlite] upsertBuckets realm=${realm} char=${character} inserted rows=${rows.length} sales=${sCount} payouts=${pCount} other=${oCount}`,
    );
  } catch {}
}

export function queryAwaiting({ realm, character, windowMin, limit, offset }) {
  if (!init()) {
    try {
      if (DEBUG) {
        console.warn('[sqlite] queryAwaiting: init failed (disabled or missing module)');
      }
    } catch {}
    return { items: [] };
  }
  const cutoffSec =
    Math.floor(Date.now() / 1000) - Math.max(10, Math.min(24 * 60, Number(windowMin || 60))) * 60;
  const lookbackSec = Math.floor(
    Math.max(3600, Math.min(7 * 24 * 3600, Number(windowMin || 60) * 60 * 6)),
  );
  const payoutSinceSec = cutoffSec - lookbackSec;
  const lim = Math.max(1, Math.min(2000, Number(limit || 500)));
  const off = Math.max(0, Number(offset || 0));

  const where = ['s.type = ?'];
  const params = ['sale'];
  if (realm) {
    where.push('s.realm = ?');
    params.push(realm);
  }
  if (character) {
    where.push('s.character = ?');
    params.push(character);
  }

  // Build SQL with conditional filters
  const sql = `
    SELECT s.t, s.itemId, s.qty, s.unit, (s.unit * s.qty) AS gross
    FROM events s
    LEFT JOIN events p
      ON p.realm = s.realm AND p.character = s.character
      AND p.type = 'payout'
      AND p.sale_key = s.sale_key
      AND p.t >= ?
    WHERE ${where.join(' AND ')} AND s.t >= ? AND p.rowid IS NULL
    ORDER BY s.t ASC
    LIMIT ? OFFSET ?
  `;
  // Bind params in SQL order: JOIN cutoff (payoutSinceSec), WHERE (...) params, s.t cutoff (cutoffSec), then LIMIT/OFFSET
  const rows = db.prepare(sql).all(payoutSinceSec, ...params, cutoffSec, lim, off);
  try {
    if (DEBUG) {
      console.info(
        `[sqlite] queryAwaiting realm=${realm || 'all'} char=${character || 'all'} windowMin=${windowMin || 60} limit=${lim} offset=${off} rows=${rows.length}`,
      );
    }
  } catch {}
  return {
    items: rows.map((r) => ({
      t: r.t,
      itemId: r.itemId,
      qty: r.qty,
      unit: r.unit,
      gross: r.gross,
    })),
  };
}

// Aggregate totals for /player/stats over a given sinceHours window
export function queryStats({ realm, character, sinceHours }) {
  if (!init()) {
    try {
      if (DEBUG) {
        console.warn('[sqlite] queryStats: init failed (disabled or missing module)');
      }
    } catch {}
    return { totals: { salesCount: 0, gross: 0, ahCut: 0, net: 0 } };
  }
  const cutoffSec =
    Math.floor(Date.now() / 1000) -
    Math.max(1, Math.min(365 * 24, Number(sinceHours || 168))) * 3600;

  const whereBase = ['t >= ?'];
  const paramsBase = [cutoffSec];
  if (realm) {
    // canonicalize realm: LOWER(REPLACE(REPLACE(realm,' ',''),'''',''))
    whereBase.push("LOWER(REPLACE(REPLACE(realm, ' ', ''), '''', '')) = ?");
    paramsBase.push(canonRealm(realm));
  }
  if (character) {
    whereBase.push('character = ?');
    paramsBase.push(character);
  }

  // Sales aggregates — group by sale_key to avoid double counting duplicates
  const salesSql = `
    SELECT COUNT(*) AS salesCount,
           COALESCE(SUM(gross), 0) AS gross,
           COALESCE(SUM(ahCut), 0) AS ahCut
    FROM (
      SELECT sale_key, MAX(gross) AS gross, MAX(cut) AS ahCut
      FROM events
      WHERE type = 'sale' AND ${whereBase.join(' AND ')}
      GROUP BY sale_key
    ) AS s
  `;
  const salesRow = db.prepare(salesSql).get(...paramsBase);
  const salesCount = Number(salesRow?.salesCount || 0);
  const gross = Number(salesRow?.gross || 0);
  const ahCut = Number(salesRow?.ahCut || 0);

  // Payouts aggregates — group by sale_key to avoid double counting duplicates
  const payoutSql = `
    SELECT COUNT(*) AS payoutCount,
           COALESCE(SUM(net), 0) AS netFromPayouts,
           SUM(CASE WHEN net IS NULL THEN 0 ELSE 1 END) AS netRows,
           COALESCE(SUM(gross), 0) AS grossFromPayouts,
           COALESCE(SUM(ahCut), 0) AS ahCutFromPayouts
    FROM (
      SELECT sale_key, MAX(net) AS net, MAX(gross) AS gross, MAX(cut) AS ahCut
      FROM events
      WHERE type = 'payout' AND ${whereBase.join(' AND ')}
      GROUP BY sale_key
    ) AS p
  `;
  const payoutRow = db.prepare(payoutSql).get(...paramsBase);
  const payoutCount = Number(payoutRow?.payoutCount || 0);
  const netFromPayouts = Number(payoutRow?.netFromPayouts || 0);
  const hasPayoutNets = Number(payoutRow?.netRows || 0) > 0;
  const grossFromPayouts = Number(payoutRow?.grossFromPayouts || 0);
  const ahCutFromPayouts = Number(payoutRow?.ahCutFromPayouts || 0);

  const usePayoutFallback = salesCount === 0 && payoutCount > 0;
  const grossOut = usePayoutFallback ? grossFromPayouts : gross;
  const ahCutOut = usePayoutFallback ? ahCutFromPayouts : ahCut;
  const countOut = usePayoutFallback ? payoutCount : salesCount;
  const netFromSales = gross - ahCut;
  const netOut = hasPayoutNets ? netFromPayouts : netFromSales;

  try {
    const where = whereBase.join(' AND ');
    const rawSales =
      db
        .prepare(`SELECT COUNT(*) AS c FROM events WHERE type='sale' AND ${where}`)
        .get(...paramsBase)?.c || 0;
    const distinctSales =
      db
        .prepare(`SELECT COUNT(DISTINCT sale_key) AS c FROM events WHERE type='sale' AND ${where}`)
        .get(...paramsBase)?.c || 0;
    console.info(
      `[sqlite] queryStats realm=${realm || 'all'} char=${character || 'all'} sinceHours=${sinceHours || 168} sales=${salesCount} gross=${grossOut} ahCut=${ahCutOut} net=${netOut} payouts=${payoutCount} usePayoutFallback=${usePayoutFallback} hasPayoutNets=${hasPayoutNets} rawSales=${rawSales} distinctSaleKeys=${distinctSales}`,
    );
  } catch {}
  return { totals: { salesCount: countOut, gross: grossOut, ahCut: ahCutOut, net: netOut } };
}

// Test-only helper to hard reset the events table on demand
export function resetForTests() {
  if (!isEnabled()) {
    return 0;
  }
  if (!init()) {
    return 0;
  }
  try {
    const before = db.prepare('SELECT COUNT(*) AS c FROM events').get()?.c || 0;
    db.exec('DELETE FROM events');
    const after = db.prepare('SELECT COUNT(*) AS c FROM events').get()?.c || 0;
    try {
      if (DEBUG) {
        console.info('[sqlite] resetForTests deleted', before, 'events; remaining', after);
      }
    } catch {}
    return Math.max(0, before - after);
  } catch {
    return 0;
  }
}

// Lightweight status for diagnostics
export function status() {
  return { enabled: isEnabled(), initialized: !!db, path: dbPath };
}
