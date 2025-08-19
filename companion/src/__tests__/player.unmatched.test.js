import { describe, it, expect } from 'vitest'
import express from 'express'
import registerPlayerRoutes from '../routes/player.js'

function makeAppWithDB(db) {
  const app = express()
  registerPlayerRoutes(app, {
    loadStore: () => db,
    saveStore: () => {},
    loadModels: () => ({ version: 1, items: {}, updatedAt: 0 }),
    saveModels: () => {},
  })
  return app
}

async function withServer(app, fn) {
  return await new Promise((resolve, reject) => {
    const server = app.listen(0, async () => {
      try {
        const addr = server.address()
        const base = `http://127.0.0.1:${addr.port}`
        const res = await fn(base)
        server.close(() => resolve(res))
      } catch (e) {
        try { server.close(() => reject(e)) } catch {}
        reject(e)
      }
    })
  })
}

describe('/player/payouts/unmatched', () => {
  it('returns only sales older than both thresholds that have no payout', async () => {
    const now = Math.floor(Date.now() / 1000)
    const s1 = { t: now - (8*3600), itemId: 100, qty: 2, unit: 100 } // old and unpaid -> should appear
    const s2 = { t: now - (5*60), itemId: 101, qty: 1, unit: 200 }   // recent -> should NOT appear
    const s3 = { t: now - (8*3600), itemId: 102, qty: 1, unit: 300, saleId: 'paid-1' } // old but paid -> should NOT appear
    const db = {
      version: 1,
      realms: {
        R: {
          C: {
            postings: [],
            sales: [s1, s2, s3],
            payouts: [ { saleId: 'paid-1', t: s3.t, net: 285 } ],
            cancels: [],
            expires: [],
          },
        },
      },
    }
    const app = makeAppWithDB(db)
    await withServer(app, async (base) => {
      const url = `${base}/player/payouts/unmatched?realm=R&char=C&olderThanMin=120&graceMin=10`
      const data = await (await fetch(url)).json()
      expect(data.count).toBe(1)
      expect(data.items[0].itemId).toBe(100)
      expect(data.items[0].gross).toBe(200)
    })
  })
})
