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

describe('/player/ledger', () => {
  it('returns mixed ledger rows ordered by time desc and supports pagination', async () => {
    const now = Math.floor(Date.now() / 1000)
    const db = {
      version: 1,
      realms: {
        R1: {
          C1: {
            postings: [
              { t: now - 100, itemId: 10, qty: 1, unit: 100 },
            ],
            sales: [
              { t: now - 50, itemId: 11, qty: 2, unit: 200 },
            ],
            payouts: [
              { t: now - 40, itemId: 11, qty: 2, net: 380, gross: 400, cut: 20 },
            ],
            cancels: [
              { t: now - 30, itemId: 12, qty: 1 },
            ],
            expires: [
              { t: now - 20, itemId: 13, qty: 3 },
            ],
          },
        },
      },
    }
    const app = makeAppWithDB(db)
    await withServer(app, async (base) => {
      const url = `${base}/player/ledger?realm=R1&char=C1&sinceHours=24&type=all`
      const data = await (await fetch(url)).json()
      expect(Array.isArray(data.items)).toBe(true)
      // Expect 5 items total
      expect(data.total).toBe(5)
      expect(data.count).toBe(5)
      // Check order: newest first (expire at -20, cancel at -30, payout -40, sale -50, posting -100)
      const typesOrder = data.items.map((r) => r.type)
      expect(typesOrder).toEqual(['expire','cancel','payout','sale','posting'])
      // Pagination
      const page = await (await fetch(`${base}/player/ledger?realm=R1&char=C1&sinceHours=24&type=all&limit=2&offset=1`)).json()
      expect(page.total).toBe(5)
      expect(page.count).toBe(2)
      // Starting from offset=1 -> ['cancel','payout']
      expect(page.items.map(r=>r.type)).toEqual(['cancel','payout'])
    })
  })

  it('filters by type and computes sale fields correctly', async () => {
    const now = Math.floor(Date.now() / 1000)
    const db = {
      version: 1,
      realms: {
        R: {
          C: {
            postings: [],
            sales: [ { t: now - 10, itemId: 7, qty: 3, unit: 100 } ],
            payouts: [],
            cancels: [],
            expires: [],
          },
        },
      },
    }
    const app = makeAppWithDB(db)
    await withServer(app, async (base) => {
      const data = await (await fetch(`${base}/player/ledger?realm=R&char=C&type=sales&sinceHours=1`)).json()
      expect(data.count).toBe(1)
      const row = data.items[0]
      expect(row.type).toBe('sale')
      expect(row.gross).toBe(300)
      expect(row.cut).toBe(Math.round(300 * 0.05))
      expect(row.net).toBe(300 - Math.round(300 * 0.05))
    })
  })
  it('filters by type=buys and computes buy fields correctly', async () => {
    const now = Math.floor(Date.now() / 1000)
    const db = {
      version: 1,
      realms: {
        R: {
          C: {
            postings: [],
            sales: [],
            payouts: [],
            buys: [ { t: now - 10, itemId: 8, qty: 4, unit: 50 } ],
            cancels: [],
            expires: [],
          },
        },
      },
    }
    const app = makeAppWithDB(db)
    await withServer(app, async (base) => {
      const data = await (await fetch(`${base}/player/ledger?realm=R&char=C&type=buys&sinceHours=1`)).json()
      expect(data.count).toBe(1)
      const row = data.items[0]
      expect(row.type).toBe('buy')
      expect(row.gross).toBe(200)
      expect(row.cut).toBe(0)
      expect(row.net).toBe(-200)
    })
  })
})
