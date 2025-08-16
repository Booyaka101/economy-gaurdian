#!/usr/bin/env node
/**
 * Economy Guardian - Log Rotation Utility
 * Rotates files in companion/logs/ by size and age, gzips old logs, and prunes old archives.
 *
 * Defaults:
 *   MAX_SIZE_MB = 5
 *   MAX_AGE_DAYS = 7
 *   MAX_ARCHIVES = 10
 *
 * Usage:
 *   node companion/scripts/rotate-logs.js [--dir path] [--size-mb N] [--age-days N] [--keep N]
 */
/* eslint-env node */
/* eslint-disable no-console */
const fs = require('fs');
const fsp = fs.promises;
const path = require('path');
const zlib = require('zlib');

const args = process.argv.slice(2);
function argVal(flag, def) {
  const i = args.indexOf(flag);
  if (i >= 0 && args[i + 1]) {
    return args[i + 1];
  }
  return def;
}

const LOG_DIR = path.resolve(argVal('--dir', path.join(__dirname, '..', 'logs')));
const MAX_SIZE_MB = parseInt(argVal('--size-mb', '5'), 10);
const MAX_AGE_DAYS = parseInt(argVal('--age-days', '7'), 10);
const MAX_ARCHIVES = parseInt(argVal('--keep', '10'), 10);

function nowTs() {
  const d = new Date();
  const pad = (n) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}_${pad(d.getHours())}-${pad(d.getMinutes())}-${pad(d.getSeconds())}`;
}

async function ensureDir(dir) {
  try {
    await fsp.mkdir(dir, { recursive: true });
  } catch {}
}

async function gzipFile(src, dest) {
  await new Promise((resolve, reject) => {
    const inp = fs.createReadStream(src);
    const out = fs.createWriteStream(dest);
    const gz = zlib.createGzip({ level: zlib.constants.Z_BEST_SPEED });
    inp.on('error', reject);
    out.on('error', reject);
    out.on('finish', resolve);
    inp.pipe(gz).pipe(out);
  });
}

async function rotateBySize(entry) {
  const stat = await fsp.stat(entry);
  const maxBytes = MAX_SIZE_MB * 1024 * 1024;
  if (stat.size < maxBytes) {
    return null;
  }
  const ts = nowTs();
  const dir = path.dirname(entry);
  const base = path.basename(entry);
  const rotated = path.join(dir, `${base}.${ts}`);
  await fsp.rename(entry, rotated);
  await gzipFile(rotated, `${rotated}.gz`).catch(() => {});
  await fsp.unlink(rotated).catch(() => {});
  await fsp.writeFile(entry, '');
  return `${base} rotated by size -> ${path.basename(rotated)}.gz`;
}

async function rotateByAge(entry) {
  const stat = await fsp.stat(entry);
  const ageMs = Date.now() - stat.mtimeMs;
  const maxAgeMs = MAX_AGE_DAYS * 24 * 60 * 60 * 1000;
  if (ageMs < maxAgeMs) {
    return null;
  }
  const ts = nowTs();
  const dir = path.dirname(entry);
  const base = path.basename(entry);
  const rotated = path.join(dir, `${base}.${ts}`);
  await fsp.rename(entry, rotated);
  await gzipFile(rotated, `${rotated}.gz`).catch(() => {});
  await fsp.unlink(rotated).catch(() => {});
  await fsp.writeFile(entry, '');
  return `${base} rotated by age -> ${path.basename(rotated)}.gz`;
}

async function pruneArchives(dir) {
  const files = await fsp.readdir(dir).catch(() => []);
  const gz = files.filter((f) => f.endsWith('.gz')).sort();
  if (gz.length <= MAX_ARCHIVES) {
    return null;
  }
  const toDelete = gz.slice(0, gz.length - MAX_ARCHIVES);
  await Promise.all(toDelete.map((f) => fsp.unlink(path.join(dir, f)).catch(() => {})));
  return `pruned ${toDelete.length} old archive(s)`;
}

async function main() {
  await ensureDir(LOG_DIR);
  const files = await fsp.readdir(LOG_DIR);
  const entries = files.filter((f) => !f.endsWith('.gz')).map((f) => path.join(LOG_DIR, f));
  const results = [];
  for (const entry of entries) {
    try {
      const bySize = await rotateBySize(entry);
      if (bySize) {
        results.push(bySize);
      }
      const byAge = await rotateByAge(entry);
      if (byAge) {
        results.push(byAge);
      }
    } catch (e) {
      results.push(`error on ${path.basename(entry)}: ${e.message}`);
    }
  }
  const pruned = await pruneArchives(LOG_DIR);
  if (pruned) {
    results.push(pruned);
  }
  const summary = results.length ? results.join('\n') : 'no rotation needed';
  console.log(`[rotate-logs] ${summary}`);
}

main().catch((e) => {
  console.error('[rotate-logs] failed', e);
  process.exitCode = 1;
});
