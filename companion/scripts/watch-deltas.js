#!/usr/bin/env node
/*
  Watcher: refresh-until-change + delta diagnostics
  Usage:
    node scripts/watch-deltas.js \
      --base http://localhost:4317 \
      --slug twilights-hammer \
      --timeout 300 \
      --interval 15 \
      --items 221754,152512,190394,190312,190330,190331 \
      --iters 12
*/
/* eslint-env node */
/* eslint-disable no-console */

const fs = require('fs');
const path = require('path');

const args = process.argv.slice(2);
function arg(name, def) {
  const i = args.findIndex(a => a === `--${name}`);
  if (i >= 0 && i + 1 < args.length) {return args[i + 1];}
  return def;
}

const BASE = arg('base', process.env.WATCH_BASE || 'http://localhost:4317');
const SLUG = arg('slug', process.env.WATCH_SLUG || 'twilights-hammer');
const TIMEOUT = Number(arg('timeout', process.env.WATCH_TIMEOUT || '300')); // seconds
const INTERVAL = Number(arg('interval', process.env.WATCH_INTERVAL || '15')); // seconds
const ITEMS = (arg('items', process.env.WATCH_ITEMS || '221754,152512,190394,190312')).split(',').map(s => Number(s.trim())).filter(Boolean);
const ITERS = Number(arg('iters', process.env.WATCH_ITERS || '12'));

const logsDir = path.join(process.cwd(), 'logs');
if (!fs.existsSync(logsDir)) {fs.mkdirSync(logsDir, { recursive: true });}
const logPath = path.join(logsDir, `watcher-${Date.now()}.log`);

function log(...a) {
  const line = a.map(x => (typeof x === 'string' ? x : JSON.stringify(x))).join(' ');
  console.log(line);
  try { fs.appendFileSync(logPath, line + '\n'); } catch {}
}

async function getJson(url) {
  try {
    const c = new AbortController();
    const t = setTimeout(() => c.abort(), 300000); // 5m
    const r = await fetch(url, { signal: c.signal });
    clearTimeout(t);
    if (!r.ok) {throw new Error(`HTTP ${r.status}`);}
    return await r.json();
  } catch (e) {
    log('ERR', url, e.message || String(e));
    return null;
  }
}

async function main() {
  log('=== Watcher start ===');
  log('BASE', BASE, 'SLUG', SLUG, 'TIMEOUT', TIMEOUT, 'INTERVAL', INTERVAL, 'ITEMS', ITEMS.join(','), 'ITERS', ITERS);
  for (let i = 1; i <= ITERS; i++) {
    log(`=== Watch Iteration #${i} ===`);
    const ru = `${BASE}/blizzard/auctions/refresh-until-change?slug=${encodeURIComponent(SLUG)}&timeout=${TIMEOUT}&interval=${INTERVAL}`;
    const r = await getJson(ru);
    if (!r) { log('[refresh-until-change] no response'); continue }
    log('[refresh-until-change]', { changed: r.changed, before: r.before?.lastFetched, after: r.after?.lastFetched });

    // Quick fingerprint output for context
    const fp = await getJson(`${BASE}/debug/auctions/fingerprint`);
    if (fp) {log('[fingerprint]', fp.now || fp);}

    // Preview totals
    const prev = await getJson(`${BASE}/debug/auctions/delta/preview-raw`);
    if (prev) {log('[delta/preview-raw]', prev);}

    let hit = false;
    for (const id of ITEMS) {
      const raw = await getJson(`${BASE}/debug/auctions/preview-diff-raw?itemId=${id}`);
      if (raw) {
        log(`[preview-diff-raw itemId=${id}]`, raw);
        if ((raw.totalDelta || 0) > 0) {hit = true;}
      }
      const norm = await getJson(`${BASE}/debug/sales/preview-diff?itemId=${id}`);
      if (norm) {log(`[preview-diff normalized itemId=${id}]`, norm);}
      await new Promise(r => setTimeout(r, 200));
    }

    if (prev && ((prev.itemTotalDrops || 0) > 0 || (prev.priceBucketDrops || 0) > 0 || (prev.endedCount || 0) > 0)) {hit = true;}

    if (hit) { log('=== Delta detected. Stopping watcher ==='); break }
  }
  log('=== Watcher complete ===');
  log('Log file:', logPath);
}

main().catch(e => { log('FATAL', e?.stack || String(e)) });
