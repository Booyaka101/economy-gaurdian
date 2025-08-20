import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import express from 'express';

// Gate running under EG_SQLITE_TESTS to avoid env leakage in normal unit runs
const RUN = process.env.EG_SQLITE_TESTS === '1';
const suite = RUN ? describe.sequential : describe.skip;

const OLD_SQLITE = process.env.EG_SQLITE;
const OLD_SQLITE_DEBUG = process.env.EG_SQLITE_DEBUG;
const OLD_SQLITE_RESET = process.env.EG_SQLITE_RESET;
const OLD_CACHE_STATS = process.env.EG_CACHE_STATS_TTL_SEC;
const OLD_CACHE_AWAIT = process.env.EG_CACHE_AWAITING_TTL_SEC;

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

function makeAppWithMemoryStore(db, registerPlayerRoutes, injectedMetrics) {
  const app = express();
  registerPlayerRoutes(app, {
    metrics: injectedMetrics,
    loadStore: () => db,
    saveStore: () => {},
    loadModels: () => ({ version: 1, items: {}, updatedAt: 0 }),
    saveModels: () => {},
  });
  return app;
}

suite('metrics and cache behavior via SQLite', () => {
  beforeAll(() => {
    process.env.EG_SQLITE = '1';
    process.env.EG_SQLITE_DEBUG = '1';
    process.env.EG_SQLITE_RESET = '1';
    // Enable caches so we can assert cacheHits on second call
    process.env.EG_CACHE_STATS_TTL_SEC = '60';
    process.env.EG_CACHE_AWAITING_TTL_SEC = '60';
  });

  afterAll(async () => {
    try {
      const sqlite = await import('../db/sqlite.js');
      sqlite.resetForTests();
    } catch {}
    if (OLD_SQLITE === undefined) delete process.env.EG_SQLITE; else process.env.EG_SQLITE = OLD_SQLITE;
    if (OLD_SQLITE_DEBUG === undefined) delete process.env.EG_SQLITE_DEBUG; else process.env.EG_SQLITE_DEBUG = OLD_SQLITE_DEBUG;
    if (OLD_SQLITE_RESET === undefined) delete process.env.EG_SQLITE_RESET; else process.env.EG_SQLITE_RESET = OLD_SQLITE_RESET;
    if (OLD_CACHE_STATS === undefined) delete process.env.EG_CACHE_STATS_TTL_SEC; else process.env.EG_CACHE_STATS_TTL_SEC = OLD_CACHE_STATS;
    if (OLD_CACHE_AWAIT === undefined) delete process.env.EG_CACHE_AWAITING_TTL_SEC; else process.env.EG_CACHE_AWAITING_TTL_SEC = OLD_CACHE_AWAIT;
  });

  it('increments uploads, stats, and awaiting metrics; caches on second call', async () => {
    const { default: registerPlayerRoutes } = await import('../routes/player.js');
    const sqlite = await import('../db/sqlite.js');
    sqlite.resetForTests();

    const now = Math.floor(Date.now() / 1000);
    const payload = {
      version: 1,
      realms: {
        R: {
          C: {
            postings: [],
            sales: [
              { t: now - 30 * 60, itemId: 9001, qty: 1, unit: 1000 },
              { t: now - 90 * 60, itemId: 9002, qty: 2, unit: 200 },
            ],
            payouts: [
              { t: now - 25 * 60, itemId: 9001, qty: 1, gross: 1000, cut: 50, net: 950 },
            ],
            buys: [],
            cancels: [],
            expires: [],
          },
        },
      },
    };

    // Minimal metrics structure mirroring server.js shape
    const metrics = {
      players: {
        uploads: { count: 0, bytes: 0 },
        stats: { requests: 0, sqliteQueries: 0, jsonQueries: 0, cacheHits: 0, cacheMisses: 0 },
        awaiting: { requests: 0, sqliteQueries: 0, jsonQueries: 0, cacheHits: 0, cacheMisses: 0 },
      },
    };

    const app = makeAppWithMemoryStore({ version: 1, realms: {} }, registerPlayerRoutes, metrics);

    await withServer(app, async (base) => {
      // Upload to populate SQLite
      const u = `${base}/player/accounting/upload`;
      const uResp = await fetch(u, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(payload) });
      expect(uResp.status).toBe(200);
      expect(metrics.players.uploads.count).toBe(1);
      expect(metrics.players.uploads.bytes).toBeGreaterThan(0);

      // Stats: first call -> cache miss + sqlite query
      const s1 = await fetch(`${base}/player/stats?realm=R&char=C&sinceHours=24`);
      expect(s1.status).toBe(200);
      expect(metrics.players.stats.requests).toBe(1);
      expect(metrics.players.stats.cacheMisses).toBe(1);
      expect(metrics.players.stats.sqliteQueries).toBe(1);

      // Stats: second call same params -> cache hit, no new sqliteQueries
      const s2 = await fetch(`${base}/player/stats?realm=R&char=C&sinceHours=24`);
      expect(s2.status).toBe(200);
      expect(metrics.players.stats.requests).toBe(2);
      expect(metrics.players.stats.cacheHits).toBe(1);
      expect(metrics.players.stats.sqliteQueries).toBe(1);

      // Awaiting: first call -> cache miss + sqlite query
      const a1 = await fetch(`${base}/player/payouts/awaiting?realm=R&char=C&windowMin=120&limit=50&offset=0`);
      expect(a1.status).toBe(200);
      expect(metrics.players.awaiting.requests).toBe(1);
      expect(metrics.players.awaiting.cacheMisses).toBe(1);
      expect(metrics.players.awaiting.sqliteQueries).toBe(1);

      // Awaiting: second call -> cache hit, no new sqliteQueries
      const a2 = await fetch(`${base}/player/payouts/awaiting?realm=R&char=C&windowMin=120&limit=50&offset=0`);
      expect(a2.status).toBe(200);
      expect(metrics.players.awaiting.requests).toBe(2);
      expect(metrics.players.awaiting.cacheHits).toBe(1);
      expect(metrics.players.awaiting.sqliteQueries).toBe(1);
    });
  });
});
