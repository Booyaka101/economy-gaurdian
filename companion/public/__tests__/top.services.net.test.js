import { describe, it, expect, beforeEach, vi } from 'vitest';
import { getJSON, postJSON, etagCache, jsonCache } from '../top.services.js';

function makeRes({ ok = true, status = 200, json = {}, headers = {} } = {}) {
  const hdrs = {
    get: (k) => headers[k] ?? null,
  };
  return {
    ok,
    status,
    headers: hdrs,
    json: async () => json,
  };
}

describe('EGTopServices network helpers (getJSON/postJSON)', () => {
  beforeEach(() => {
    vi.restoreAllMocks();
    etagCache.clear();
    jsonCache.clear();
    // Ensure clean DOM and storage
    document.body.innerHTML = '';
    try {
      localStorage.clear();
    } catch {}
  });

  it('getJSON caches ETag and JSON, uses 304 with cache, and sends If-None-Match', async () => {
    const url = '/api/test';
    const fetchSpy = vi
      .fn()
      // First call: 200 with ETag and body
      .mockResolvedValueOnce(
        makeRes({ ok: true, status: 200, json: { a: 1 }, headers: { ETag: 'W/"123"' } }),
      )
      // Second call: 304 (ok=false) should return cached JSON
      .mockResolvedValueOnce(makeRes({ ok: false, status: 304, json: {}, headers: {} }));
    globalThis.fetch = fetchSpy;

    const first = await getJSON(url);
    expect(first).toEqual({ a: 1 });
    expect(etagCache.get(url)).toBe('W/"123"');
    expect(jsonCache.get(url)).toEqual({ a: 1 });

    const second = await getJSON(url);
    expect(second).toEqual({ a: 1 }); // served from cache

    // Verify If-None-Match header on second call
    const [, opts] = fetchSpy.mock.calls[1];
    const h = opts && opts.headers;
    // In JSDOM Headers is available; accept either Headers instance or plain
    const ifNone = typeof h?.get === 'function' ? h.get('If-None-Match') : h?.['If-None-Match'];
    expect(ifNone).toBe('W/"123"');
  });

  it('getJSON throws on non-ok (non-304) response', async () => {
    globalThis.fetch = vi.fn().mockResolvedValue(makeRes({ ok: false, status: 500 }));
    await expect(getJSON('/api/fail')).rejects.toThrow('GET /api/fail -> 500');
  });

  it('postJSON sends JSON body and returns parsed data', async () => {
    const spy = vi.fn().mockResolvedValue(makeRes({ ok: true, status: 200, json: { ok: 1 } }));
    globalThis.fetch = spy;
    const body = { x: 1 };
    const res = await postJSON('/api/ok', body);
    expect(res).toEqual({ ok: 1 });
    const [, opts] = spy.mock.calls[0];
    expect(opts.method).toBe('POST');
    expect(opts.headers['Content-Type']).toBe('application/json');
    expect(opts.body).toBe(JSON.stringify(body));
  });

  it('postJSON throws on non-ok response', async () => {
    globalThis.fetch = vi.fn().mockResolvedValue(makeRes({ ok: false, status: 400 }));
    await expect(postJSON('/api/bad', { a: 1 })).rejects.toThrow('POST /api/bad -> 400');
  });
});
