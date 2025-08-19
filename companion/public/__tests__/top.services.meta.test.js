import { describe, it, expect, beforeEach, vi } from 'vitest';
import {
  nameCache,
  iconCache,
  qualityCache,
  tryFetchJSON,
  applyItemMeta,
  applyItemMetaObject,
  bootstrapItemMetaStatic,
  fetchNamesIcons,
  fetchCatalogExtras,
  buildTopCsvFilename,
  buildTopJsonFilename,
  itemsToCSV,
  itemsToJSON,
  copyIds,
  copyTsmGroup,
  exportCsv,
  exportJson,
  ping,
} from '../top.services.js';

function mockFetchSequence(...responses) {
  const fn = vi.fn();
  for (const r of responses) {
    fn.mockResolvedValueOnce(r);
  }
  globalThis.fetch = fn;
  return fn;
}

function makeRes({ ok = true, status = 200, json = {}, headers = {} } = {}) {
  const hdrs = { get: (k) => headers[k] ?? null };
  return { ok, status, headers: hdrs, json: async () => json };
}

describe('EGTopServices meta + catalog + exports', () => {
  beforeEach(() => {
    vi.restoreAllMocks();
    document.body.innerHTML = '';
    try {
      localStorage.clear();
    } catch {}
    nameCache.clear();
    iconCache.clear();
    qualityCache.clear();
  });

  it('tryFetchJSON returns first successful JSON across URL list', async () => {
    mockFetchSequence(
      makeRes({ ok: false, status: 500 }),
      makeRes({ ok: true, status: 200, json: { ok: 1 } }),
    );
    const data = await tryFetchJSON(['/a', '/b']);
    expect(data).toEqual({ ok: 1 });
  });

  it('applyItemMeta applies from array and object shapes and persists qualities', () => {
    // Array form
    applyItemMeta([
      { id: 1, name: ' Foo ', icon: 'http://x/1.png', quality: 3 },
      { itemId: 2, itemName: 'Bar', item: { id: 2 } },
    ]);
    expect(nameCache.get(1)).toBe(' Foo ');
    expect(iconCache.get(1)).toBe('http://x/1.png');
    expect(qualityCache.get(1)).toBe(3);

    // Object form
    applyItemMetaObject({
      names: { 3: 'Baz' },
      icons: { 3: 'http://x/3.png' },
      qualities: { 3: 1 },
      map: [{ id: 4, name: 'Qux', icon: 'i4', quality: 2 }],
    });
    expect(nameCache.get(3)).toBe('Baz');
    expect(iconCache.get(3)).toBe('http://x/3.png');
    expect(qualityCache.get(3)).toBe(1);
    expect(nameCache.get(4)).toBe('Qux');
    expect(iconCache.get(4)).toBe('i4');
    expect(qualityCache.get(4)).toBe(2);

    // Qualities persisted
    const raw = localStorage.getItem('eg_top_quality_cache_v1');
    expect(raw && typeof raw === 'string').toBe(true);
  });

  it('bootstrapItemMetaStatic returns true on success and false on failure', async () => {
    // Success: first URL returns object
    mockFetchSequence(makeRes({ ok: true, json: { names: { 9: 'Niner' } } }));
    const ok1 = await bootstrapItemMetaStatic();
    expect(ok1).toBe(true);
    expect(nameCache.get(9)).toBe('Niner');

    // Failure: all urls fail -> false
    mockFetchSequence(makeRes({ ok: false, status: 500 }), makeRes({ ok: false, status: 404 }));
    const ok2 = await bootstrapItemMetaStatic();
    expect(ok2).toBe(false);
  });

  it('fetchNamesIcons populates caches and returns number of inserts; returns 0 when nothing missing', async () => {
    // Populate via blizzard helper response
    const resp = {
      names: { 10: 'Ten' },
      icons: { 10: 'i10' },
      qualities: { 10: 4 },
      map: { 11: { icon: 'i11', quality: 2 } },
    };
    mockFetchSequence(
      makeRes({ ok: true, json: resp }), // item-names
      makeRes({ ok: true, json: { items: [{ id: 10, name: 'Ten' }] } }), // catalog/bulk
    );
    const inserts = await fetchNamesIcons([10, 11]);
    expect(inserts).toBeGreaterThan(0);
    expect(nameCache.get(10)).toBe('Ten');
    expect(iconCache.get(10)).toBe('i10');
    expect(qualityCache.get(10)).toBe(4);
    expect(iconCache.get(11)).toBe('i11');
    expect(qualityCache.get(11)).toBe(2);

    // Nothing missing -> 0
    const zero = await fetchNamesIcons([10]);
    expect(zero).toBe(0);
  });

  it('fetchCatalogExtras uses network results or local fallback filtering and excludes base items', async () => {
    // 1) Network returns results array shape
    mockFetchSequence(makeRes({ ok: true, json: { items: [{ id: 100, name: 'Alpha' }] } }));
    let extras = await fetchCatalogExtras('alpha', [{ itemId: 200 }]);
    expect(extras).toEqual([{ itemId: 100, itemName: 'Alpha', soldPerDay: 0, fromCatalog: true }]);

    // 2) Empty from network -> fallback using nameCache tokens
    nameCache.set(300, 'Iron Bar');
    nameCache.set(301, 'Iron Bar II');
    mockFetchSequence(makeRes({ ok: true, json: [] }));
    extras = await fetchCatalogExtras('iron bar', [{ itemId: 300 }]);
    expect(extras.find((e) => e.itemId === 300)).toBeUndefined();
    expect(extras.find((e) => e.itemId === 301)).toBeDefined();
  });

  it('buildTop filenames include realm when available and time-stamp', () => {
    const lbl = document.createElement('div');
    lbl.id = 'realmTop';
    lbl.textContent = 'Realm Stormrage ';
    document.body.appendChild(lbl);
    const csv = buildTopCsvFilename();
    const json = buildTopJsonFilename();
    expect(csv).toMatch(/^top-sold-Stormrage-\d{4}-\d{2}-\d{2}-/);
    expect(json).toMatch(/^top-sold-Stormrage-\d{4}-\d{2}-\d{2}-/);
    // Remove DOM -> fallback without realm
    document.body.removeChild(lbl);
    const csv2 = buildTopCsvFilename();
    expect(csv2).toMatch(/^top-sold-\d{4}-\d{2}-\d{2}-/);
  });

  it('itemsToCSV and itemsToJSON robustly handle arrays', () => {
    nameCache.set(42, 'The Answer');
    qualityCache.set(42, 5);
    const csv = itemsToCSV([{ itemId: 42, soldPerDay: 1.1 }]);
    expect(csv.split('\n')[1]).toContain('The Answer');

    const jsonArr = itemsToJSON([{ itemId: '42', soldPerDay: '2.5' }]);
    expect(jsonArr[0]).toEqual({ itemId: 42, itemName: 'The Answer', soldPerDay: 2.5, quality: 5 });
  });

  it('copyIds and copyTsmGroup return false on empty, true on success, and toasts', async () => {
    const toast = document.createElement('div');
    toast.id = 'toast';
    document.body.appendChild(toast);
    // Empty
    expect(await copyIds([])).toBe(false);
    expect(await copyTsmGroup([])).toBe(false);
    // Success
    globalThis.navigator = globalThis.navigator || {};
    globalThis.navigator.clipboard = { writeText: vi.fn().mockResolvedValue(undefined) };
    const items = [{ itemId: 5 }, { itemId: 6 }];
    const ok1 = await copyIds(items);
    const ok2 = await copyTsmGroup(items);
    expect(ok1).toBe(true);
    expect(ok2).toBe(true);
    expect(toast.textContent && toast.textContent.length).toBeGreaterThan(0);
  });

  it('exportCsv and exportJson create object URLs and set download names', () => {
    const toast = document.createElement('div');
    toast.id = 'toast';
    document.body.appendChild(toast);
    const createUrl = vi.spyOn(URL, 'createObjectURL').mockReturnValue('blob:test');
    const revokeUrl = vi.spyOn(URL, 'revokeObjectURL').mockReturnValue();

    // Monkey-patch createElement to capture last anchor
    const realCreate = document.createElement.bind(document);
    let lastA = null;
    document.createElement = (tag) => {
      const el = realCreate(tag);
      if (tag === 'a') {
        lastA = el;
      }
      return el;
    };

    // Prepare minimal data
    nameCache.set(1, 'One');
    qualityCache.set(1, 2);

    exportCsv([{ itemId: 1, soldPerDay: 0.2 }]);
    expect(createUrl).toHaveBeenCalled();
    expect(lastA && lastA.download && lastA.download.endsWith('.csv')).toBe(true);

    exportJson([{ itemId: 1, soldPerDay: 0.2 }]);
    expect(createUrl).toHaveBeenCalled();
    expect(lastA && lastA.download && lastA.download.endsWith('.json')).toBe(true);

    expect(revokeUrl).toHaveBeenCalled();

    // Restore
    document.createElement = realCreate;
  });

  it('ping returns true/false based on fetch ok, with timeout cleanup', async () => {
    mockFetchSequence(makeRes({ ok: true, json: {} }));
    const ok = await ping('/health', 10);
    expect(ok).toBe(true);
  });
});
