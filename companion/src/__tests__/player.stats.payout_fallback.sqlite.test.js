import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import express from 'express';

const RUN = process.env.EG_SQLITE_TESTS === '1';
const suite = RUN ? describe.sequential : describe.skip;

const OLD_SQLITE = process.env.EG_SQLITE;
const OLD_SQLITE_DEBUG = process.env.EG_SQLITE_DEBUG;
const OLD_SQLITE_RESET = process.env.EG_SQLITE_RESET;

async function withServer(app, fn) {
  return await new Promise((resolve, reject) => {
    const server = app.listen(0, async () => {
      try {
        const addr = server.address();
        const base = `http://127.0.0.1:${addr.port}`;
        const res = await fn(base);
        server.close(() => resolve(res));
      } catch (e) {
        try { server.close(() => reject(e)); } catch {}
        reject(e);
      }
    });
  });
}

function makeAppWithMemoryStore(db, registerPlayerRoutes) {
  const app = express();
  registerPlayerRoutes(app, {
    loadStore: () => db,
    saveStore: () => {},
    loadModels: () => ({ version: 1, items: {}, updatedAt: 0 }),
    saveModels: () => {},
  });
  return app;
}

suite('player stats payout fallback via SQLite', () => {
  beforeAll(() => {
    process.env.EG_SQLITE = '1';
    process.env.EG_SQLITE_DEBUG = '1';
    process.env.EG_SQLITE_RESET = '1';
  });
  afterAll(async () => {
    try {
      const sqlite = await import('../db/sqlite.js');
      sqlite.resetForTests();
    } catch {}
    if (OLD_SQLITE === undefined) delete process.env.EG_SQLITE; else process.env.EG_SQLITE = OLD_SQLITE;
    if (OLD_SQLITE_DEBUG === undefined) delete process.env.EG_SQLITE_DEBUG; else process.env.EG_SQLITE_DEBUG = OLD_SQLITE_DEBUG;
    if (OLD_SQLITE_RESET === undefined) delete process.env.EG_SQLITE_RESET; else process.env.EG_SQLITE_RESET = OLD_SQLITE_RESET;
  });

  it('uses payout aggregates when there are payouts but no sales', async () => {
    const { default: registerPlayerRoutes } = await import('../routes/player.js');
    const sqlite = await import('../db/sqlite.js');
    sqlite.resetForTests();

    const now = Math.floor(Date.now() / 1000);
    const payouts = [
      { t: now - 2 * 3600, itemId: 8001, qty: 1, gross: 1000, cut: 50, net: 950, saleId: 'P1' },
      { t: now - 3 * 3600, itemId: 8002, qty: 2, gross: 600, cut: 30, net: 570 },
      // duplicate with same sale_key as previous (composite on itemId|t|qty|unit when no saleId)
      { t: now - 3 * 3600, itemId: 8002, qty: 2, unit: 300 },
    ];

    const payload = {
      version: 1,
      realms: {
        R: {
          C: { postings: [], sales: [], payouts, buys: [], cancels: [], expires: [] },
        },
      },
    };

    const app = makeAppWithMemoryStore({ version: 1, realms: {} }, registerPlayerRoutes);

    await withServer(app, async (base) => {
      const u = `${base}/player/accounting/upload`;
      const resp = await fetch(u, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(payload) });
      expect(resp.status).toBe(200);

      const url = `${base}/player/stats?realm=R&char=C&sinceHours=24`;
      const sResp = await fetch(url);
      expect(sResp.status).toBe(200);
      const data = await sResp.json();

      // Expect fallback to payouts (since no sales), with dedup over sale_key
      // Distinct sale_keys: 'P1' for first payout, and composite for the second/third (deduped -> 2 total)
      expect(data?.totals?.salesCount).toBe(2);
      // Gross and ahCut should come from payouts
      expect(data?.totals?.gross).toBe(1000 + 600);
      expect(data?.totals?.ahCut).toBe(50 + 30);
      expect(data?.totals?.net).toBe(950 + 570);
    });
  });
});
