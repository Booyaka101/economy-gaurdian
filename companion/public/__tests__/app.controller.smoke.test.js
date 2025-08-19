import { describe, it, beforeEach, expect, vi } from 'vitest';

function el(tag, attrs = {}, html = '') {
  const e = document.createElement(tag);
  Object.entries(attrs).forEach(([k, v]) => {
    if (k === 'class') { e.className = String(v || ''); }
    else if (k in e) {
      try { e[k] = v; } catch {}
    } else {
      try { e.setAttribute(k, String(v)); } catch {}
    }
  });
  if (html) { e.innerHTML = html; }
  return e;
}

describe('app.controller.js smoke', () => {
  beforeEach(() => {
    vi.resetModules();
    vi.useFakeTimers();
    document.body.innerHTML = '';

    // Minimal DOM expected by controller
    const refresh = el('button', { id: 'refresh' });
    const exportBtn = el('button', { id: 'export' });
    const refreshAuctions = el('button', { id: 'refreshAuctions' });
    const presetCommodities = el('button', { id: 'presetCommodities' });
    const presetItems = el('button', { id: 'presetItems' });

    const search = el('input', { id: 'searchDeals', type: 'text', value: '' });
    const th = el('th', { 'data-sort': 'soldPerDay' });
    const thead = el('thead');
    thead.appendChild(el('tr', {}, ''));
    thead.querySelector('tr').appendChild(th);
    const rows = el('tbody');
    const table = el('table');
    table.appendChild(thead);
    table.appendChild(rows);

    document.body.append(
      refresh,
      exportBtn,
      refreshAuctions,
      presetCommodities,
      presetItems,
      search,
      table,
    );

    // Stubs for timers to avoid real timers
    vi.spyOn(globalThis, 'setInterval').mockImplementation(() => 123);
    vi.spyOn(globalThis, 'clearInterval').mockImplementation(() => {});

    // Stub EGDeals API expected by controller
    globalThis.EGDeals = {
      refreshDeals: vi.fn(),
      exportLua: vi.fn(),
      refreshAuctions: vi.fn(),
      applyPresetCommodity: vi.fn(),
      applyPresetItems: vi.fn(),
      renderDeals: vi.fn(),
      setSort: vi.fn(),
      refreshMetrics: vi.fn(),
      refreshStatus: vi.fn().mockResolvedValue(undefined),
    };
  });

  it('binds handlers, performs initial load, debounce search, and header sort', async () => {
    await import('../app.controller.js');

    // Initial load after refreshStatus resolves
    await Promise.resolve();
    expect(globalThis.EGDeals.refreshStatus).toHaveBeenCalledTimes(1);
    expect(globalThis.EGDeals.applyPresetCommodity).toHaveBeenCalledTimes(1);
    expect(globalThis.EGDeals.refreshDeals).toHaveBeenCalled();
    expect(globalThis.EGDeals.refreshMetrics).toHaveBeenCalled();

    // Click presets and buttons -> handlers bound
    document.getElementById('presetCommodities').click();
    document.getElementById('presetItems').click();
    document.getElementById('refresh').click();
    document.getElementById('refreshAuctions').click();
    document.getElementById('export').click();

    expect(globalThis.EGDeals.applyPresetCommodity).toHaveBeenCalledTimes(2);
    expect(globalThis.EGDeals.applyPresetItems).toHaveBeenCalledTimes(1);
    expect(globalThis.EGDeals.refreshDeals).toHaveBeenCalledTimes(4); // initial + presetCommodities + presetItems + refresh
    expect(globalThis.EGDeals.refreshAuctions).toHaveBeenCalledTimes(1);
    expect(globalThis.EGDeals.exportLua).toHaveBeenCalledTimes(1);

    // Header sort click
    document.querySelector('th[data-sort="soldPerDay"]').dispatchEvent(new MouseEvent('click', { bubbles: true }));
    expect(globalThis.EGDeals.setSort).toHaveBeenCalledWith('soldPerDay');

    // Search debounce -> renderDeals after 150ms
    const search = document.getElementById('searchDeals');
    search.value = 'abc';
    search.dispatchEvent(new Event('input', { bubbles: true }));
    await vi.advanceTimersByTimeAsync(160);
    expect(globalThis.EGDeals.renderDeals).toHaveBeenCalled();
  });
});
