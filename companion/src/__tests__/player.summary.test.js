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

describe('/player/summary', () => {
  it('aggregates daily series for sales and payouts', async () => {
    const nowSec = Math.floor(Date.now() / 1000)
    const day = (ms) => new Date(ms).toISOString().slice(0,10)
    const d1Ms = (nowSec - 36 * 3600) * 1000 // about 1.5 days ago
    const d2Ms = (nowSec - 12 * 3600) * 1000 // 12h ago
    const db = {
      version: 1,
      realms: {
        R: {
          C: {
            postings: [],
            sales: [
              { t: Math.floor(d1Ms/1000), itemId: 1, qty: 2, unit: 100 }, // gross 200 cut 10 net 190
              { t: Math.floor(d2Ms/1000), itemId: 2, qty: 1, unitPrice: 300 }, // gross 300 cut 15 net 285
            ],
            payouts: [
              { t: Math.floor((nowSec - 10*3600)), itemId: 3, net: 150 },
              { t: Math.floor((nowSec - 40*3600)), itemId: 4, net: 50 },
            ],
            cancels: [],
            expires: [],
          },
        },
      },
    }
    const app = makeAppWithDB(db)
    await withServer(app, async (base) => {
      const data = await (await fetch(`${base}/player/summary?realm=R&char=C&windowDays=3`)).json()
      expect(Array.isArray(data.days)).toBe(true)
      // Expect at least two days represented
      const keys = data.days.map(d => d.day)
      const k1 = day(d1Ms), k2 = day(d2Ms)
      expect(keys).toContain(k1)
      expect(keys).toContain(k2)
      const m = Object.fromEntries(data.days.map(d=>[d.day, d]))
      // Day1 checks (net 190, gross 200, cut 10)
      expect(m[k1].gross).toBe(200)
      expect(m[k1].ahCut).toBe(Math.round(200*0.05))
      expect(m[k1].netSales).toBe(200 - Math.round(200*0.05))
      // Day2 checks
      expect(m[k2].gross).toBe(300)
      expect(m[k2].ahCut).toBe(Math.round(300*0.05))
      expect(m[k2].netSales).toBe(300 - Math.round(300*0.05))
      // Payouts net distributed to their days
      const p1day = day((nowSec - 10*3600)*1000)
      const p2day = day((nowSec - 40*3600)*1000)
      expect(m[p1day].netPayouts).toBeGreaterThanOrEqual(150)
      expect(m[p2day].netPayouts).toBeGreaterThanOrEqual(50)
    })
  })
})
