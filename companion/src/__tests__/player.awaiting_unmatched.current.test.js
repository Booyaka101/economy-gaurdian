import { describe, it, expect } from 'vitest'
import express from 'express'
import registerPlayerRoutes from '../routes/player.js'

function makeAppWithDB(db) {
  const app = express()
  // Inject in-memory implementations so tests don't touch disk
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

describe('player awaiting/unmatched/current/characters', () => {
  it('returns awaiting payouts from recent sales not yet paid (SQLite disabled path)', async () => {
    const now = Math.floor(Date.now() / 1000)
    const db = {
      version: 1,
      realms: {
        R1: {
          C1: {
            postings: [],
            sales: [
              // within 60m window, not paid -> should be included
              { t: now - 30 * 60, itemId: 101, qty: 2, unit: 100 },
              // outside 60m window -> excluded
              { t: now - 120 * 60, itemId: 102, qty: 1, unitPrice: 500 },
              // within window but paid via saleId -> excluded
              { t: now - 20 * 60, itemId: 103, qty: 1, unit: 250, saleId: 'X-103' },
            ],
            payouts: [
              // matches the sale above via saleId (route matches by saleId first)
              { t: now - 10 * 60, itemId: 103, qty: 1, unit: 250, saleId: 'X-103', gross: 250, cut: 13, net: 237 },
            ],
            payouts_extra: [],
            cancels: [],
            expires: [],
            buys: [],
          },
        },
      },
    }
    const app = makeAppWithDB(db)
    await withServer(app, async (base) => {
      const data = await (await fetch(`${base}/player/payouts/awaiting?realm=R1&char=C1&windowMin=60`)).json()
      expect(data.count).toBe(1)
      expect(data.items.length).toBe(1)
      const row = data.items[0]
      expect(row.itemId).toBe(101)
      expect(row.qty).toBe(2)
      expect(row.unit).toBe(100)
      expect(row.gross).toBe(200)
      // server adds a placeholder ETA for now
      expect(row.etaMinutes).toBe(60)
    })
  })

  it('returns unmatched payouts only for sufficiently old unpaid sales (olderThanMin & graceMin)', async () => {
    const now = Math.floor(Date.now() / 1000)
    const db = {
      version: 1,
      realms: {
        Realm: {
          Char: {
            postings: [],
            sales: [
              // paid -> must be excluded (matched by saleId)
              { t: now - 200 * 60, itemId: 1, qty: 1, unit: 100, saleId: 'paid-1' },
              // old enough and unpaid -> included
              { t: now - 180 * 60, itemId: 2, qty: 2, unit: 50 },
              // recent (< olderThanMin) -> excluded
              { t: now - 30 * 60, itemId: 3, qty: 1, unitPrice: 300 },
              // older than olderThanMin but within graceMin -> excluded
              { t: now - 70 * 60, itemId: 4, qty: 1, unit: 400 },
            ],
            payouts: [
              // matches the first sale via saleId, therefore excludes it from unmatched
              { t: now - 150 * 60, itemId: 1, qty: 1, unit: 100, saleId: 'paid-1', gross: 100, cut: 5, net: 95 },
            ],
            cancels: [],
            expires: [],
            buys: [],
          },
        },
      },
    }
    const app = makeAppWithDB(db)
    await withServer(app, async (base) => {
      const olderThanMin = 120 // 2h
      const graceMin = 60 // 1h grace
      const url = `${base}/player/payouts/unmatched?realm=Realm&char=Char&olderThanMin=${olderThanMin}&graceMin=${graceMin}`
      const data = await (await fetch(url)).json()
      // Ensure paid sale is excluded and the old unpaid sale is present
      expect(data.count).toBeGreaterThanOrEqual(1)
      const ids = data.items.map(i => i.itemId)
      expect(ids).toContain(2)
      expect(ids).not.toContain(1)
      const row = data.items.find(i => i.itemId === 2)
      expect(row.gross).toBe(100)
      // verify ascending order by t for consistency
      if (data.items.length > 1) {
        const times = data.items.map(i => i.t)
        expect([...times].sort((a,b)=>a-b)).toEqual(times)
      }
    })
  })

  it('infers current character by latest activity across all buckets', async () => {
    const now = Math.floor(Date.now() / 1000)
    const db = {
      version: 1,
      realms: {
        A: {
          Alice: {
            postings: [{ t: now - 500, itemId: 1, qty: 1, unit: 10 }],
            sales: [], payouts: [], cancels: [], expires: [], buys: [],
          },
        },
        B: {
          Bob: {
            postings: [],
            sales: [{ t: now - 100, itemId: 2, qty: 1, unit: 20 }],
            payouts: [], cancels: [], expires: [], buys: [],
          },
          Carol: {
            postings: [], sales: [], payouts: [{ t: now - 50, itemId: 3, net: 10 }],
            cancels: [], expires: [], buys: [],
          }
        }
      }
    }
    const app = makeAppWithDB(db)
    await withServer(app, async (base) => {
      const data = await (await fetch(`${base}/player/current`)).json()
      expect(data?.current?.realm).toBe('B')
      expect(data?.current?.character).toBe('Carol')
    })
  })

  it('lists characters and accounting status counts', async () => {
    const now = Math.floor(Date.now() / 1000)
    const db = {
      version: 1,
      realms: {
        R: {
          C: {
            postings: [{ t: now - 10, itemId: 1, qty: 1, unit: 5 }],
            sales: [{ t: now - 9, itemId: 2, qty: 1, unit: 10 }],
            payouts: [{ t: now - 8, itemId: 2, qty: 1, gross: 10, cut: 1, net: 9 }],
            buys: [{ t: now - 7, itemId: 3, qty: 2, unit: 4 }],
            cancels: [{ t: now - 6, itemId: 4, qty: 1 }],
            expires: [{ t: now - 5, itemId: 5, qty: 3 }],
          },
        },
      },
    }
    const app = makeAppWithDB(db)
    await withServer(app, async (base) => {
      const chars = await (await fetch(`${base}/player/characters`)).json()
      expect(chars?.realms?.R).toContain('C')

      const status = await (await fetch(`${base}/player/accounting/status`)).json()
      expect(status?.summary?.R?.C?.postings).toBe(1)
      expect(status?.summary?.R?.C?.sales).toBe(1)
      expect(status?.summary?.R?.C?.payouts).toBe(1)
      expect(status?.summary?.R?.C?.buys).toBe(1)
      expect(status?.summary?.R?.C?.cancels).toBe(1)
      expect(status?.summary?.R?.C?.expires).toBe(1)
    })
  })
})
