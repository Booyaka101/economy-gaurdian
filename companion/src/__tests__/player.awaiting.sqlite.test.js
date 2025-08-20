import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import express from 'express';

// Gate under EG_SQLITE_TESTS to avoid env leakage
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

suite('player awaiting via SQLite', () => {
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

  it('returns unmatched sales within the window and excludes matched ones', async () => {
    const { default: registerPlayerRoutes } = await import('../routes/player.js');
    const sqlite = await import('../db/sqlite.js');
    sqlite.resetForTests();

    const now = Math.floor(Date.now() / 1000);
    const saleUnmatched = { t: now - 50 * 60, itemId: 3001, qty: 1, unit: 1000 }; // 50 min ago
    const saleMatched = { t: now - 55 * 60, itemId: 3002, qty: 2, unit: 200, saleId: 'S-MATCH' }; // 55 min ago
    const payoutMatched = {
      t: now - 20 * 60, // 20 min ago, within lookback so should match and exclude the sale
      itemId: 3002,
      qty: 2,
      gross: 400,
      cut: 20,
      net: 380,
      saleId: 'S-MATCH',
    };

    const payload = {
      version: 1,
      realms: {
        R: {
          C: {
            postings: [],
            sales: [saleUnmatched, saleMatched],
            payouts: [payoutMatched],
            buys: [],
            cancels: [],
            expires: [],
          },
        },
      },
    };

    const app = makeAppWithMemoryStore({ version: 1, realms: {} }, registerPlayerRoutes);

    await withServer(app, async (base) => {
      // Upload payload to populate SQLite
      const u = `${base}/player/accounting/upload`;
      const uResp = await fetch(u, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(payload) });
      expect(uResp.status).toBe(200);

      // Awaiting within 60 minutes should include only the unmatched sale
      const aUrl = `${base}/player/payouts/awaiting?realm=R&char=C&windowMin=60&limit=10&offset=0`;
      const aResp = await fetch(aUrl);
      expect(aResp.status).toBe(200);
      const data = await aResp.json();
      expect(data.count).toBe(1);
      expect(data.items.length).toBe(1);
      expect(data.items[0].itemId).toBe(3001);
      expect(data.items[0].gross).toBe(1000);

      // Offset beyond should be empty
      const aResp2 = await fetch(`${base}/player/payouts/awaiting?realm=R&char=C&windowMin=60&limit=10&offset=1`);
      const data2 = await aResp2.json();
      expect(data2.count).toBe(0);
      expect(data2.items.length).toBe(0);
    });
  });
});
