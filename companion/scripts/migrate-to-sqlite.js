// Migration script: import existing JSON accounting store into SQLite
// Usage (PowerShell):
//   $env:EG_SQLITE=1; node scripts/migrate-to-sqlite.js
// Usage (cmd.exe):
//   set EG_SQLITE=1&& node scripts/migrate-to-sqlite.js

/* eslint-env node */

import fs from 'fs'
import path from 'path'
import { fileURLToPath } from 'url'
import * as sqlite from '../src/db/sqlite.js'

const __filename = fileURLToPath(import.meta.url)
const __dirname = path.dirname(__filename)

function log(...args) { console.info('[migrate-to-sqlite]', ...args) }

async function main() {
  if (!sqlite.isEnabled()) {
    log('SQLite mode is not enabled. Set EG_SQLITE=1 and ensure better-sqlite3 is installed.')
    process.exitCode = 1
    return
  }
  sqlite.init()
  const dataDir = path.join(__dirname, '..', 'data')
  const storePath = path.join(dataDir, 'accounting.json')
  if (!fs.existsSync(storePath)) {
    log('No JSON store found at', storePath, '(nothing to migrate)')
    return
  }
  const raw = fs.readFileSync(storePath, 'utf8')
  const db = JSON.parse(raw || '{}')
  const realms = db.realms || {}
  let chars = 0, rows = 0
  for (const [realm, byChar] of Object.entries(realms)) {
    for (const [character, buckets] of Object.entries(byChar || {})) {
      sqlite.upsertBuckets(realm, character, buckets)
      chars += 1
      for (const k of ['postings','sales','payouts','buys','cancels','expires']) {
        rows += Array.isArray(buckets[k]) ? buckets[k].length : 0
      }
    }
  }
  log(`Migration complete: ${chars} characters, ~${rows} events processed.`)
}

main().catch((e)=>{
  console.error('[migrate-to-sqlite] failed:', e?.stack || e)
  process.exitCode = 1
})
