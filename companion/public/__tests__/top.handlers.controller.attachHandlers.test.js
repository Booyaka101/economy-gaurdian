import { describe, it, expect, beforeEach, vi } from 'vitest';
import { attachHandlers } from '../top.handlers.controller.js';

function el(tag, attrs = {}, html = '') {
  const e = document.createElement(tag);
  Object.entries(attrs).forEach(([k, v]) => {
    if (k === 'dataset' && v && typeof v === 'object') {
      Object.entries(v).forEach(([dk, dv]) => (e.dataset[dk] = dv));
    } else if (k === 'class') {
      e.className = String(v || '');
    } else if (k === 'style' && v && typeof v === 'object') {
      Object.assign(e.style, v);
    } else if (k in e) {
      try { e[k] = v; } catch {}
    } else {
      try { e.setAttribute(k, String(v)); } catch {}
    }
  });
  if (html) {e.innerHTML = html;}
  return e;
}

describe('top.handlers.controller.attachHandlers(deps)', () => {
  let deps;

  beforeEach(() => {
    vi.useFakeTimers();
    document.body.innerHTML = '';
    try { localStorage.clear(); } catch {}

    // Reset module-level one-time flags
    delete window.__egTopShortcuts__;
    delete window.__egTopAutoRefresh__;
    delete window.__egTopSSE__;

    // Minimal app structure
    const app = el('div', { id: 'app' });

    // Search + clear + help
    const searchEl = el('input', { id: 'searchTop', type: 'text' });
    const clearBtn = el('button', { id: 'clearSearchTop' }, 'Clear');
    const helpBtn = el('button', { id: 'helpTop' }, 'Help');
    const helpModal = el('div', { id: 'helpModal', hidden: '' });
    const helpModalBody = el('div', { id: 'helpModalBody' });
    const helpModalClose = el('button', { id: 'helpModalClose' }, 'Close');

    // Density toggle + toast
    const densityBtn = el('button', { id: 'densityToggle' }, 'Compact');
    const toast = el('div', { id: 'toast' });

    // Export buttons
    const exportBtn = el('button', { id: 'exportTop' }, 'Export CSV');
    const exportJsonBtn = el('button', { id: 'exportJsonTop' }, 'Export JSON');
    const copyIdsBtn = el('button', { id: 'copyIdsTop' }, 'Copy IDs');
    const copyTsmBtn = el('button', { id: 'copyTsmTop' }, 'Copy TSM');

    // Table header for sort
    const table = el('table', { id: 'topTable' });
    const thead = el('thead');
    const th = el('th', { 'data-sort': 'soldPerDay' }, 'Sold/Day');
    const tr = el('tr');
    tr.appendChild(th);
    thead.appendChild(tr);
    table.appendChild(thead);

    app.appendChild(searchEl);
    app.appendChild(clearBtn);
    app.appendChild(helpBtn);
    app.appendChild(helpModal);
    app.appendChild(helpModalBody);
    app.appendChild(helpModalClose);
    app.appendChild(densityBtn);
    app.appendChild(toast);
    app.appendChild(exportBtn);
    app.appendChild(exportJsonBtn);
    app.appendChild(copyIdsBtn);
    app.appendChild(copyTsmBtn);
    app.appendChild(table);
    document.body.appendChild(app);

    // Window globals
    window.lastVisible = [{ itemId: 1 }, { itemId: 2 }];
    window.EGTopRenderer = { toggleDebug: vi.fn() };
    window.showToast = () => {};

    // Dependency injection
    const ControllerState = {
      els: {
        searchEl,
        // only those used by tested paths
      },
      filters: { offset: 0 },
      sort: { key: 'soldPerDay', dir: 'desc' },
    };
    const LS = { source: 'eg_source', all: 'eg_all', inc0: 'eg_inc0', hours: 'eg_hours', limit: 'eg_limit', minSold: 'eg_min', quality: 'eg_quality' };
    const setFilters = vi.fn((o) => Object.assign(ControllerState.filters, o));
    const setSort = vi.fn((o) => { ControllerState.sort = { ...ControllerState.sort, ...o }; });
    const refresh = vi.fn();
    const EGTopServices = {
      exportCsv: vi.fn(),
      exportJson: vi.fn(),
      copyIds: vi.fn().mockResolvedValue(true),
      copyTsmGroup: vi.fn().mockResolvedValue(true),
      nameCache: new Map(),
      iconCache: new Map(),
      qualityCache: new Map(),
      fetchNamesIcons: vi.fn(),
    };
    const svcCopyText = vi.fn().mockResolvedValue(true);
    const svcShowToast = vi.fn();
    const svcFmtInt = (n) => String(n);
    const svcGetJSON = vi.fn();
    const svcPostJSON = vi.fn();
    const init = vi.fn();

    deps = { ControllerState, LS, setFilters, setSort, refresh, svcGetJSON, svcPostJSON, svcCopyText, svcShowToast, svcFmtInt, EGTopServices, init };
  });

  it('binds global keyboard: "/" focuses search, "?" opens help, and Escape clears search & hides help', () => {
    attachHandlers(deps);

    const searchEl = document.getElementById('searchTop');
    const helpModal = document.getElementById('helpModal');
    const helpBtn = document.getElementById('helpTop');

    // "/" focuses search
    document.dispatchEvent(new KeyboardEvent('keydown', { key: '/', ctrlKey: false, shiftKey: false, bubbles: true }));
    expect(document.activeElement).toBe(searchEl);

    // "?" opens help (Shift + "?")
    document.dispatchEvent(new KeyboardEvent('keydown', { key: '?', ctrlKey: false, shiftKey: true, bubbles: true }));
    expect(helpModal.hasAttribute('hidden')).toBe(false);

    // Escape clears search and hides help
    searchEl.value = 'abc';
    document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
    expect(searchEl.value).toBe('');
    expect(helpModal.hasAttribute('hidden')).toBe(true);
  });

  it('keyboard Ctrl+Shift+E/C/G route to EGTopServices with lastVisible', async () => {
    attachHandlers(deps);
    const vis = window.lastVisible;

    document.dispatchEvent(new KeyboardEvent('keydown', { key: 'E', ctrlKey: true, shiftKey: true, bubbles: true }));
    document.dispatchEvent(new KeyboardEvent('keydown', { key: 'C', ctrlKey: true, shiftKey: true, bubbles: true }));
    document.dispatchEvent(new KeyboardEvent('keydown', { key: 'G', ctrlKey: true, shiftKey: true, bubbles: true }));

    expect(deps.EGTopServices.exportCsv).toHaveBeenCalledWith(vis);
    expect(deps.EGTopServices.copyIds).toHaveBeenCalledWith(vis);
    expect(deps.EGTopServices.copyTsmGroup).toHaveBeenCalledWith(vis);
  });

  it('sort header click updates sort, resets offset, and refreshes', () => {
    attachHandlers(deps);
    const th = document.querySelector('th[data-sort="soldPerDay"]');
    th.click();

    expect(deps.setSort).toHaveBeenCalledWith({ key: 'soldPerDay', dir: 'asc' });
    expect(deps.setFilters).toHaveBeenCalledWith({ offset: 0 });
    expect(deps.refresh).toHaveBeenCalled();
  });

  it('density toggle toggles body class, button text, and persists to localStorage', () => {
    attachHandlers(deps);
    const btn = document.getElementById('densityToggle');

    expect(document.body.classList.contains('density-compact')).toBe(false);
    btn.click();
    expect(document.body.classList.contains('density-compact')).toBe(true);
    expect(btn.textContent).toBe('Comfortable');
    expect(localStorage.getItem('eg_top_density_compact')).toBe('1');

    btn.click();
    expect(document.body.classList.contains('density-compact')).toBe(false);
    expect(btn.textContent).toBe('Compact');
    expect(localStorage.getItem('eg_top_density_compact')).toBe('0');
  });

  it('export/copy buttons call EGTopServices with lastVisible', async () => {
    attachHandlers(deps);
    document.getElementById('exportTop').click();
    document.getElementById('exportJsonTop').click();
    await document.getElementById('copyIdsTop').click();
    await document.getElementById('copyTsmTop').click();

    const vis = window.lastVisible;
    expect(deps.EGTopServices.exportCsv).toHaveBeenCalledWith(vis);
    expect(deps.EGTopServices.exportJson).toHaveBeenCalledWith(vis);
    expect(deps.EGTopServices.copyIds).toHaveBeenCalledWith(vis);
    expect(deps.EGTopServices.copyTsmGroup).toHaveBeenCalledWith(vis);
  });
});
