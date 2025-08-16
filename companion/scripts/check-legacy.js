#!/usr/bin/env node
// Guardrail check for legacy fallback patterns in companion/public
// Fails if forbidden patterns are present (legacy quick helpers or window fallbacks)

/* eslint-env node */
/* eslint-disable no-console */

import fs from 'fs';
import path from 'path';
import url from 'url';

const __filename = url.fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const ROOT = path.resolve(__dirname, '..');
const PUBLIC_DIR = path.join(ROOT, 'public');
// Exclude any explicitly legacy-suffixed files from guardrail scanning.
// These files are retained only for historical reference and are not imported.
const EXCLUDE = [/\.legacy\.js$/i];

const FORBIDDEN = [
  /\bcopyVisibleIdsQuick\b/,
  /\bexportVisibleCsvQuick\b/,
  /\bexportVisibleJsonQuick\b/,
  /\bcopyVisibleTsmQuick\b/,
  // Any window-based legacy export/copy helpers
  /window\.(copyVisible\w*|exportVisible\w*)/,
  // Optional-chaining fallbacks on centralized services/controllers (fail-fast required)
  /window\.EGTopServices\?\./,
  /window\.EGTopController\?\./,
];

function walk(dir) {
  const out = [];
  for (const name of fs.readdirSync(dir)) {
    const p = path.join(dir, name);
    const st = fs.statSync(p);
    if (st.isDirectory()) {
      out.push(...walk(p));
    } else {
      out.push(p);
    }
  }
  return out;
}

function main() {
  if (!fs.existsSync(PUBLIC_DIR)) {
    return;
  }
  const files = walk(PUBLIC_DIR)
    .filter((f) => (f.endsWith('.js') || f.endsWith('.html')) && !EXCLUDE.some((rx) => rx.test(f)));
  const violations = [];
  for (const f of files) {
    const txt = fs.readFileSync(f, 'utf8');
    for (const rx of FORBIDDEN) {
      if (rx.test(txt)) {
        violations.push({ file: f, pattern: rx.toString() });
      }
    }

    // Enforce: DOM event bindings must live in *.controller.js (except sw.js)
    const isController = /\.controller\.js$/.test(f);
    const isServiceWorker = /(^|\\|\/)sw\.js$/.test(f);
    const isEntry = /\.entry\.js$/.test(f);
    const isHtml = f.endsWith('.html');
    const hasDomBinding = /\baddEventListener\s*\(\s*['"][a-zA-Z]+['"]\s*,/.test(txt);
    if (hasDomBinding && !isController) {
      // Allow service worker file bindings
      if (isServiceWorker) {
        // ok
      } else if (isHtml) {
        // Allow window load registration for SW only
        const isOnlySwReg =
          /window\.addEventListener\(\s*['"]load['"]/.test(txt) &&
          /navigator\.serviceWorker\.register\(/.test(txt);
        if (!isOnlySwReg) {
          violations.push({
            file: f,
            pattern: 'DOM event binding outside controller (*.controller.js)',
          });
        }
      } else if (!isEntry) {
        violations.push({
          file: f,
          pattern: 'DOM event binding outside controller (*.controller.js)',
        });
      }
    }

    // Enforce: window.lastVisible should be accessed only from controllers or services
    const usesLastVisible = /\bwindow\.lastVisible\b/.test(txt);
    const isServices = /\.services\.js$/.test(f);
    if (usesLastVisible && !(isController || isServices)) {
      violations.push({ file: f, pattern: 'window.lastVisible used outside controller/services' });
    }
  }
  if (violations.length) {
    console.error('\nLegacy patterns detected (guardrail failed):');
    for (const v of violations) {
      console.error(`- ${v.file} :: ${v.pattern}`);
    }
    console.error(
      '\nPlease remove legacy quick helpers/fallbacks and rely on EGTopServices + controller bindings.',
    );
    process.exit(1);
  } else {
    console.log('OK: no legacy patterns found in companion/public');
    return;
  }
}

main();
