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

suite('player stats via SQLite (larger window)', () => {
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

  it('aggregates correctly across multiple days and ignores out-of-window', async () => {
    const { default: registerPlayerRoutes } = await import('../routes/player.js');
    const sqlite = await import('../db/sqlite.js');
    sqlite.resetForTests();

    const now = Math.floor(Date.now() / 1000);
    // Build sales/payouts across ~3 days, one outside 3-day window
    const mk = (dHours, itemId, qty, unit, saleId) => ({ t: now - dHours * 3600, itemId, qty, unit, saleId });
    const mkP = (dHours, itemId, qty, gross, cut, net, saleId) => ({ t: now - dHours * 3600, itemId, qty, gross, cut, net, saleId });

    const payload = {
      version: 1,
      realms: {
        R: {
          C: {
            postings: [],
            sales: [
              mk(6, 100, 1, 1000, 'S1'), // inside 72h
              mk(30, 101, 2, 500, 'S2'), // inside 72h
              mk(80, 102, 1, 2000, 'S3'), // outside 72h
            ],
            payouts: [
              mkP(5, 100, 1, 1000, 50, 950, 'S1'),
              mkP(29, 101, 2, 1000, 50, 950, 'S2'),
              mkP(79, 102, 1, 2000, 100, 1900, 'S3'),
            ],
            buys: [],
            cancels: [],
            expires: [],
          },
        },
      },
    };

    const app = makeAppWithMemoryStore({ version: 1, realms: {} }, registerPlayerRoutes);

    await withServer(app, async (base) => {
      const u = `${base}/player/accounting/upload`;
      const uResp = await fetch(u, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(payload) });
      expect(uResp.status).toBe(200);

      // 72-hour window
      const url = `${base}/player/stats?realm=R&char=C&sinceHours=72`;
      const r = await fetch(url);
      expect(r.status).toBe(200);
      const data = await r.json();
      expect(data.totals.salesCount).toBe(2);
      const gross = 1 * 1000 + 2 * 500; // 2000
      const ahCut = Math.round(gross * 0.05); // 100
      expect(data.totals.gross).toBe(gross);
      expect(data.totals.ahCut).toBe(ahCut);
      expect(data.totals.net).toBe(gross - ahCut);

      // 12-hour window should include only S1
      const r2 = await fetch(`${base}/player/stats?realm=R&char=C&sinceHours=12`);
      const d2 = await r2.json();
      expect(d2.totals.salesCount).toBe(1);
      expect(d2.totals.gross).toBe(1000);
      expect(d2.totals.ahCut).toBe(50);
      expect(d2.totals.net).toBe(950);
    });
  });
});
