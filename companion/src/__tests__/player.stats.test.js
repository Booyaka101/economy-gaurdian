import { describe, it, expect } from 'vitest'
import express from 'express'
import registerPlayerRoutes from '../routes/player.js'

function makeAppWithDB(db) {
  const app = express()
  // Inject in-memory store impls to avoid touching disk
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

describe('player stats', () => {
  it('computes totals from sales (net = gross - ahCut, 5% fee)', async () => {
    const now = Math.floor(Date.now() / 1000)
    const db = {
      version: 1,
      realms: {
        R: {
          C: {
            postings: [],
            sales: [
              { t: now - 3600, itemId: 123, qty: 3, unit: 200 },
              { t: now - 7200, itemId: 124, qty: 1, unitPrice: 5000 },
            ],
            payouts: [],
          },
        },
      },
    }
    const app = makeAppWithDB(db)
    await withServer(app, async (base) => {
      const url = `${base}/player/stats?realm=R&char=C&sinceHours=24`
      const resp = await fetch(url)
      const data = await resp.json()
      expect(data?.totals?.salesCount).toBe(2)
      const gross = 3 * 200 + 1 * 5000
      const ahCut = Math.round(gross * 0.05)
      expect(data?.totals?.gross).toBe(gross)
      expect(data?.totals?.ahCut).toBe(ahCut)
      expect(data?.totals?.net).toBe(gross - ahCut)
    })
  })

  it("merges realm variants by canonical form and prefers payouts' net when present", async () => {
    const now = Math.floor(Date.now() / 1000)
    const db = {
      version: 1,
      realms: {
        "Twilight's Hammer": {
          Dronkbuffel: {
            postings: [],
            sales: [],
            payouts: [
              { t: now - 100, itemId: 1, qty: 1, gross: 1000, cut: 50, net: 950 },
            ],
          },
        },
        "Twilight'sHammer": {
          Dronkbuffel: {
            postings: [],
            sales: [],
            payouts: [
              { t: now - 200, itemId: 2, qty: 2, gross: 2000, cut: 100, net: 1900 },
            ],
          },
        },
      },
    }
    const app = makeAppWithDB(db)
    await withServer(app, async (base) => {
      const u1 = `${base}/player/stats?realm=Twilight%27s%20Hammer&char=Dronkbuffel&sinceHours=168`
      const u2 = `${base}/player/stats?realm=Twilight%27sHammer&char=Dronkbuffel&sinceHours=168`
      const d1 = await (await fetch(u1)).json()
      const d2 = await (await fetch(u2)).json()
      const grossSum = 1000 + 2000
      const cutSum = 50 + 100
      const netSum = 950 + 1900
      expect(d1?.totals?.gross).toBe(grossSum)
      expect(d1?.totals?.ahCut).toBe(cutSum)
      expect(d1?.totals?.net).toBe(netSum)
      expect(d1?.totals?.salesCount).toBe(2)
      expect(d2?.totals?.gross).toBe(grossSum)
      expect(d2?.totals?.ahCut).toBe(cutSum)
      expect(d2?.totals?.net).toBe(netSum)
      expect(d2?.totals?.salesCount).toBe(2)
    })
  })
})
