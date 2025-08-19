import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import express from 'express';

// Gate running under EG_SQLITE_TESTS to avoid env leakage in normal unit runs
const RUN = process.env.EG_SQLITE_TESTS === '1';
const suite = RUN ? describe.sequential : describe.skip;

// Ensure SQLite is enabled and clean inside the gated suite only
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
        try {
          server.close(() => reject(e));
        } catch {}
        reject(e);
      }
    });
  });
}

function makeAppWithMemoryStore(db, registerPlayerRoutes) {
  const app = express();
  // Inject in-memory store impls to avoid touching JSON file
  registerPlayerRoutes(app, {
    loadStore: () => db,
    saveStore: () => {},
    loadModels: () => ({ version: 1, items: {}, updatedAt: 0 }),
    saveModels: () => {},
  });
  return app;
}

suite('player stats via SQLite', () => {
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
    if (OLD_SQLITE === undefined) {
      delete process.env.EG_SQLITE;
    } else {
      process.env.EG_SQLITE = OLD_SQLITE;
    }
    if (OLD_SQLITE_DEBUG === undefined) {
      delete process.env.EG_SQLITE_DEBUG;
    } else {
      process.env.EG_SQLITE_DEBUG = OLD_SQLITE_DEBUG;
    }
    if (OLD_SQLITE_RESET === undefined) {
      delete process.env.EG_SQLITE_RESET;
    } else {
      process.env.EG_SQLITE_RESET = OLD_SQLITE_RESET;
    }
  });
  it('aggregates totals from SQLite for realm/char within window', async () => {
    const { default: registerPlayerRoutes } = await import('../routes/player.js');
    const sqlite = await import('../db/sqlite.js');

    // Reset DB contents in-process to ensure isolation
    sqlite.resetForTests();

    const now = Math.floor(Date.now() / 1000);
    const payload = {
      version: 1,
      realms: {
        R: {
          C: {
            postings: [],
            sales: [
              { t: now - 3600, itemId: 111, qty: 2, unit: 1000 }, // gross 2000, cut 100, net 1900
              { t: now - 7200, itemId: 222, qty: 1, unitPrice: 500 }, // gross 500, cut 25, net 475
            ],
            payouts: [
              { t: now - 3500, itemId: 111, qty: 2, gross: 2000, cut: 100, net: 1900 },
              { t: now - 7100, itemId: 222, qty: 1, gross: 500, cut: 25, net: 475 },
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
      // Upload to populate SQLite via upsertBuckets()
      const u = `${base}/player/accounting/upload`;
      const resp = await fetch(u, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(payload),
      });
      expect(resp.status).toBe(200);

      const url = `${base}/player/stats?realm=R&char=C&sinceHours=24`;
      const statsResp = await fetch(url);
      const data = await statsResp.json();
      expect(statsResp.status).toBe(200);
      expect(data?.realm).toBe('R');
      expect(data?.character).toBe('C');
      expect(data?.sinceHours).toBe(24);

      const gross = 2000 + 500;
      const ahCut = Math.round(gross * 0.05); // 125
      expect(data?.totals?.salesCount).toBe(2);
      expect(data?.totals?.gross).toBe(gross);
      expect(data?.totals?.ahCut).toBe(ahCut);
      expect(data?.totals?.net).toBe(gross - ahCut);
    });
  });
});
