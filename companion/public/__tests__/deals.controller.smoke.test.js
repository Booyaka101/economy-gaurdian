import { describe, it, expect, beforeEach, vi } from 'vitest';

function el(tag, attrs = {}, html = '') {
  const e = document.createElement(tag);
  Object.entries(attrs).forEach(([k, v]) => {
    if (k === 'class') {
      e.className = String(v || '');
    } else if (k in e) {
      try {
        e[k] = v;
      } catch {}
    } else {
      try {
        e.setAttribute(k, String(v));
      } catch {}
    }
  });
  if (html) {
    e.innerHTML = html;
  }
  return e;
}

describe('deals.controller.js smoke', () => {
  beforeEach(() => {
    document.body.innerHTML = '';
    vi.restoreAllMocks();

    // Minimal DOM
    const form = el('div');
    const tbl = el('table');
    const tbody = el('tbody', { id: 'rows' });
    tbl.appendChild(tbody);

    const discount = el('input', { id: 'discount', value: '0.30' });
    const limit = el('input', { id: 'limit', value: '50' });
    const slug = el('input', { id: 'slug', value: 'stormrage' });
    const refresh = el('button', { id: 'refresh' });
    const refreshAuctions = el('button', { id: 'refreshAuctions' });
    const status = el('div', { id: 'status' });

    form.appendChild(discount);
    form.appendChild(limit);
    form.appendChild(slug);
    form.appendChild(refresh);
    form.appendChild(refreshAuctions);
    document.body.appendChild(form);
    document.body.appendChild(status);
    document.body.appendChild(tbl);

    // Stub EGDeals API used by controller
    globalThis.EGDeals = {
      rowHTML: (x) => `<tr data-id="${x.itemId}"><td>${x.itemId}</td></tr>`,
      fetchDeals: vi
        .fn()
        .mockResolvedValue({ items: [{ itemId: 101 }, { itemId: 102 }], meta: {}, discount: 0.3 }),
      refreshAuctions: vi.fn().mockResolvedValue({ refreshedAt: Math.floor(Date.now() / 1000) }),
    };
  });

  it('auto-refreshes on load, renders rows, updates status, and refreshes after auctions', async () => {
    // Import side-effect module (ensure fresh evaluation per test)
    vi.resetModules();
    await import('../deals.controller.js');

    // Allow any microtasks/raf to flush
    await Promise.resolve();
    await new Promise((r) => setTimeout(r, 0));

    const rows = document.getElementById('rows');
    const status = document.getElementById('status');

    // Initial auto-run fetched and rendered
    expect(globalThis.EGDeals.fetchDeals).toHaveBeenCalledTimes(1);
    expect(rows.querySelectorAll('tr').length).toBe(2);
    expect(typeof status.textContent).toBe('string');
    expect(status.textContent).toMatch(/Results: \d+/);

    // Click Refresh Auctions -> should call refreshAuctions; fetchDeals may be suppressed by busy lock
    document.getElementById('refreshAuctions').click();

    // Wait a tick for async chain
    await Promise.resolve();
    await new Promise((r) => setTimeout(r, 0));

    expect(globalThis.EGDeals.refreshAuctions).toHaveBeenCalledTimes(1);

    // Now click plain Refresh to force a new fetchDeals
    document.getElementById('refresh').click();
    await Promise.resolve();
    await new Promise((r) => setTimeout(r, 0));

    expect(globalThis.EGDeals.fetchDeals).toHaveBeenCalledTimes(2);
    expect(rows.querySelectorAll('tr').length).toBe(2); // still rendered
  });
});
