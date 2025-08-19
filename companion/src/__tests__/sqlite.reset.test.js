import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { isEnabled, resetForTests, upsertBuckets, queryStats } from '../db/sqlite.js';

const OLD_SQLITE = process.env.EG_SQLITE;
const OLD_SQLITE_DEBUG = process.env.EG_SQLITE_DEBUG;

const RUN = process.env.EG_SQLITE_TESTS === '1';
const suite = RUN ? describe.sequential : describe.skip;

suite('sqlite.resetForTests()', () => {
  beforeAll(() => {
    process.env.EG_SQLITE = '1';
    process.env.EG_SQLITE_DEBUG = '1';
    // Do not set EG_SQLITE_RESET here; the test calls resetForTests() explicitly.
  });

  afterAll(() => {
    try {
      resetForTests();
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
  });

  it('empties the events table after seeding some events', () => {
    expect(isEnabled()).toBe(true);

    // Ensure a clean slate
    resetForTests();

    const now = Math.floor(Date.now() / 1000);
    const realm = 'r1';
    const character = 'c1';

    // Seed a sale and matching payout with the same saleId (unique sale_key)
    upsertBuckets(realm, character, {
      sales: [{ t: now - 10, itemId: 1001, qty: 2, unit: 100, saleId: 'S1' }],
      payouts: [
        {
          t: now - 5,
          itemId: 1001,
          qty: 2,
          unit: 100,
          gross: 200,
          cut: 10,
          net: 190,
          saleId: 'S1',
        },
      ],
    });

    const resBefore = queryStats({ realm, character, sinceHours: 1 });
    expect(resBefore.totals.salesCount).toBe(1);
    expect(resBefore.totals.gross).toBe(200);
    expect(resBefore.totals.ahCut).toBe(10);
    expect(resBefore.totals.net).toBe(190);

    const deleted = resetForTests();
    expect(deleted).toBeGreaterThanOrEqual(2); // at least the sale + payout rows

    const resAfter = queryStats({ realm, character, sinceHours: 1 });
    expect(resAfter.totals.salesCount).toBe(0);
    expect(resAfter.totals.gross).toBe(0);
    expect(resAfter.totals.ahCut).toBe(0);
    expect(resAfter.totals.net).toBe(0);
  });
});
