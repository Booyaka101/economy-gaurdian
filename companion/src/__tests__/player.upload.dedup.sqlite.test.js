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

suite('upload dedup across buckets (sales/payouts) via SQLite', () => {
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

  it('re-uploading identical payload does not change stats or awaiting results', async () => {
    const { default: registerPlayerRoutes } = await import('../routes/player.js');
    const sqlite = await import('../db/sqlite.js');
    sqlite.resetForTests();

    const now = Math.floor(Date.now() / 1000);
    const saleMatched = { t: now - 45 * 60, itemId: 501, qty: 1, unit: 1000, saleId: 'SAME-1' };
    const payoutMatched = { t: now - 30 * 60, itemId: 501, qty: 1, gross: 1000, cut: 50, net: 950, saleId: 'SAME-1' };
    const saleUnmatched = { t: now - 40 * 60, itemId: 502, qty: 2, unit: 200 };

    const payload = {
      version: 1,
      realms: {
        R: {
          C: {
            postings: [],
            sales: [saleMatched, saleUnmatched],
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
      const upload = async () => {
        const u = `${base}/player/accounting/upload`;
        const resp = await fetch(u, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(payload) });
        expect(resp.status).toBe(200);
      };

      // First upload populates DB
      await upload();

      const statsUrl = `${base}/player/stats?realm=R&char=C&sinceHours=4`;
      const awaitingUrl = `${base}/player/payouts/awaiting?realm=R&char=C&windowMin=120&limit=50&offset=0`;

      const s1 = await fetch(statsUrl);
      expect(s1.status).toBe(200);
      const stats1 = await s1.json();

      const a1 = await fetch(awaitingUrl);
      expect(a1.status).toBe(200);
      const awaiting1 = await a1.json();

      expect(stats1?.totals?.salesCount).toBeGreaterThan(0);
      expect(stats1?.totals?.gross).toBeGreaterThan(0);
      expect(stats1?.totals?.net).toBeGreaterThan(0);

      // Awaiting should include only the unmatched sale (itemId 502)
      expect(awaiting1.count).toBe(1);
      expect(awaiting1.items.length).toBe(1);
      expect(awaiting1.items[0].itemId).toBe(502);

      // Re-upload same payload — INSERT OR IGNORE should prevent duplicates
      await upload();

      const s2 = await fetch(statsUrl);
      const stats2 = await s2.json();
      const a2 = await fetch(awaitingUrl);
      const awaiting2 = await a2.json();

      // Stats unchanged
      expect(stats2?.totals?.salesCount).toBe(stats1?.totals?.salesCount);
      expect(stats2?.totals?.gross).toBe(stats1?.totals?.gross);
      expect(stats2?.totals?.ahCut).toBe(stats1?.totals?.ahCut);
      expect(stats2?.totals?.net).toBe(stats1?.totals?.net);

      // Awaiting unchanged (still only unmatched sale once)
      expect(awaiting2.count).toBe(1);
      expect(awaiting2.items.length).toBe(1);
      expect(awaiting2.items[0].itemId).toBe(502);
    });
  });
});
