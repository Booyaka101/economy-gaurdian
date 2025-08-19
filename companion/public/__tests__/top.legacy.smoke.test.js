import { describe, it, beforeEach, afterEach, expect, vi } from 'vitest';

function el(tag, attrs = {}, children = []) {
  const node = document.createElement(tag);
  Object.entries(attrs).forEach(([k, v]) => {
    if (k === 'text') { node.textContent = v; }
    else { node.setAttribute(k, v); }
  });
  children.forEach((c) => node.appendChild(c));
  return node;
}

// Minimal EGTopServices + EGTopController to satisfy top.js guards
function installTopGlobals() {
  // Prevent auto-refresh interval from being scheduled
  window.__egTopAutoRefresh__ = true;

  window.EGTopServices = {
    nameCache: new Map(),
    iconCache: new Map(),
    qualityCache: new Map(),
    showToast: () => {},
    copyText: async () => true,
    fmtInt: (n) => String(n),
    normalizeName: (v) => (v == null ? '' : String(v)),
    buildTopCsvFilename: () => 'top.csv',
    itemsToCSV: () => 'id,name',
    getJSON: async () => ({}),
    postJSON: async () => ({}),
  };

  window.EGTopController = {
    init: vi.fn(),
    refresh: vi.fn(),
    attachHandlers: vi.fn(),
  };
}

function installMinimalDom() {
  // density toggle button
  const densityBtn = el('button', { id: 'densityToggle' });
  // table structure expected by top.js
  const th1 = el('th', { 'data-sort': 'soldPerDay' });
  const thead = el('thead', {}, [el('tr', {}, [th1])]);
  const rows = el('tbody', { id: 'rowsTop' });
  const table = el('table', {}, [thead, rows]);
  const status = el('div', { id: 'statusTop' });
  document.body.append(densityBtn, table, status);
}

describe('legacy top.js smoke', () => {
  beforeEach(async () => {
    vi.resetModules();
    document.body.innerHTML = '';
    localStorage.clear();
    // Enable debug test hooks in top.js
    localStorage.setItem('eg_debug_top', '1');
    // Force compact density to exercise applyDensity()
    localStorage.setItem('eg_top_density_compact', '1');
    installTopGlobals();
    installMinimalDom();
  });

  afterEach(() => {
    document.body.innerHTML = '';
  });

  it('initializes without throwing and applies compact density + a11y roles', async () => {
    await import('../top.js');

    // Density applied
    expect(document.body.classList.contains('density-compact')).toBe(true);
    expect(document.getElementById('densityToggle').textContent).toBe('Comfortable');

    // A11y roles applied
    const table = document.querySelector('table');
    const thead = document.querySelector('thead');
    expect(table.getAttribute('role')).toBe('table');
    expect(thead.getAttribute('role')).toBe('rowgroup');

    // Sort header aria
    const th = thead.querySelector('th[data-sort="soldPerDay"]');
    expect(th.getAttribute('aria-sort')).toBe('none');

    // Status live region
    const status = document.getElementById('statusTop');
    expect(status.getAttribute('role')).toBe('status');
    expect(status.getAttribute('aria-live')).toBe('polite');

    // Debug test hook exposed
    expect(window.__egTest).toBeTruthy();
    expect(window.__egTest.nameCache instanceof Map).toBe(true);
  });
});
