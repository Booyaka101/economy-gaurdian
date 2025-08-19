import { describe, it, expect, beforeEach, vi } from 'vitest';

function el(tag, attrs = {}, html = '') {
  const e = document.createElement(tag);
  Object.entries(attrs).forEach(([k, v]) => {
    if (k === 'class') {
      e.className = String(v || '');
    } else if (k in e) {
      try { e[k] = v; } catch {}
    } else {
      try { e.setAttribute(k, String(v)); } catch {}
    }
  });
  if (html) { e.innerHTML = html; }
  return e;
}

// Simple EventSource stub used by the controller
class MockEventSource {
  constructor(url) {
    this.url = url;
    this.handlers = {};
    (window.__sse_instances || (window.__sse_instances = [])).push(this);
  }
  addEventListener(type, fn) {
    (this.handlers[type] || (this.handlers[type] = [])).push(fn);
  }
  emit(type, ev) {
    (this.handlers[type] || []).forEach((fn) => fn(ev));
  }
  close() {}
}

describe('top.handlers.controller.js smoke', () => {
  let deps;

  beforeEach(() => {
    vi.resetModules();
    vi.useFakeTimers();
    document.body.innerHTML = '';
    // Reset localStorage between tests
    try { localStorage.clear(); } catch {}

    // Avoid creating real intervals/timeouts
    vi.spyOn(globalThis, 'setInterval').mockImplementation(() => 123);
    vi.spyOn(globalThis, 'clearInterval').mockImplementation(() => {});

    // EventSource + fetch stubs
    globalThis.EventSource = MockEventSource;
    globalThis.fetch = vi.fn(async (_url) => ({ ok: true, json: async () => ({}) }));

    // Minimal DOM for Top tab
    const tabTop = el('div', { id: 'tab-top' }); // visible by default
    const rowsEl = el('tbody', { id: 'rows' });

    // Controls (wired via ControllerState.els)
    const minSoldEl = el('input', { id: 'minSold', value: '10' });
    const qualityEl = el('select', { id: 'quality' });
    qualityEl.appendChild(el('option', { value: '' }, 'Any'));
    qualityEl.appendChild(el('option', { value: '2' }, 'Uncommon'));
    const searchEl = el('input', { id: 'searchTop', type: 'text', value: '' });
    const limitEl = el('input', { id: 'limit', value: '400' });
    const hoursWrapEl = el('div', { id: 'hoursWrap' });
    const hoursEl = el('input', { id: 'hours', value: '48' });
    hoursWrapEl.appendChild(hoursEl);
    const sourceEl = el('select', { id: 'source' });
    sourceEl.appendChild(el('option', { value: 'local' }, 'Local'));
    sourceEl.appendChild(el('option', { value: 'region' }, 'Region'));
    const allCatalogEl = el('input', { id: 'allCatalog', type: 'checkbox' });
    const includeZeroEl = el('input', { id: 'includeZero', type: 'checkbox' });

    // Pagination buttons
    const prevPage = el('button', { id: 'prevPage' });
    const nextPage = el('button', { id: 'nextPage' });

    // Refresh button
    const refreshBtn = el('button', { id: 'refreshTop' });

    // Export/Copy buttons
    const exportTop = el('button', { id: 'exportTop' });
    const exportJsonTop = el('button', { id: 'exportJsonTop' });
    const copyIdsTop = el('button', { id: 'copyIdsTop' });
    const copyTsmTop = el('button', { id: 'copyTsmTop' });

    // Sort header
    const thead = el('thead');
    const tr = el('tr');
    const th = el('th', { 'data-sort': 'sold' }, 'Sold');
    tr.appendChild(th);
    thead.appendChild(tr);
    const table = el('table', { id: 'topTable' });
    table.appendChild(thead);
    table.appendChild(rowsEl);

    // Density toggle
    const densityToggle = el('button', { id: 'densityToggle' });

    // Help modal
    const helpBtn = el('button', { id: 'helpTop' });
    const helpModal = el('div', { id: 'helpModal', hidden: '' });
    const helpModalBody = el('div', { id: 'helpModalBody' });
    const helpModalClose = el('button', { id: 'helpModalClose' });
    helpModal.appendChild(helpModalBody);
    helpModal.appendChild(helpModalClose);

    // Connectivity HUD
    const connDot = el('div', { id: 'connDot' });

    // Alerts UI
    const alertsStatus = el('div', { id: 'alertsStatus' });
    const alertsList = el('div', { id: 'alertsList' });
    const refreshAlerts = el('button', { id: 'refreshAlerts' });

    document.body.append(
      tabTop,
      minSoldEl,
      qualityEl,
      searchEl,
      limitEl,
      hoursWrapEl,
      sourceEl,
      allCatalogEl,
      includeZeroEl,
      prevPage,
      nextPage,
      refreshBtn,
      exportTop,
      exportJsonTop,
      copyIdsTop,
      copyTsmTop,
      densityToggle,
      helpBtn,
      helpModal,
      connDot,
      alertsStatus,
      alertsList,
      refreshAlerts,
      table,
    );

    // Globals used by keyboard shortcuts and debug
    window.showToast = vi.fn();
    window.EGTopRenderer = { toggleDebug: vi.fn() };
    window.lastVisible = [{ itemId: 123 }];

    // Controller state and deps
    const ControllerState = {
      filters: {
        query: '',
        minSold: 0,
        quality: null,
        hours: 48,
        source: 'local',
        limit: 400,
        useAll: false,
        includeZero: false,
        offset: 0,
      },
      sort: { key: '', dir: 'desc' },
      els: {
        minSoldEl,
        qualityEl,
        searchEl,
        limitEl,
        hoursEl,
        hoursWrapEl,
        sourceEl,
        allCatalogEl,
        includeZeroEl,
        rowsEl,
      },
    };

    const setFilters = vi.fn((patch) => Object.assign(ControllerState.filters, patch));
    const setSort = vi.fn(({ key, dir }) => (ControllerState.sort = { key, dir }));
    const refresh = vi.fn();

    const nameCache = new Map([[123, 'Foo']]);
    const iconCache = new Map([[123, 'https://example/icon.png']]);
    const qualityCache = new Map([[123, 4]]);

    deps = {
      ControllerState,
      LS: {
        minSold: 'eg_minSold',
        quality: 'eg_quality',
        all: 'eg_all',
        inc0: 'eg_inc0',
        source: 'eg_source',
        hours: 'eg_hours',
        limit: 'eg_limit',
        // New persisted keys under test
        query: 'eg_query',
        sortKey: 'eg_sort_key',
        sortDir: 'eg_sort_dir',
      },
      setFilters,
      setSort,
      refresh,
      svcGetJSON: vi.fn(async (url) => {
        if (String(url).includes('/ml/detect/change-points')) {
          return { events: [{ itemId: 123, minPricePrev: 10, minPriceNow: 15, qtyPrev: 5, qtyNow: 8 }] };
        }
        return {};
      }),
      svcPostJSON: vi.fn(async () => ({})),
      svcCopyText: vi.fn(async () => {}),
      svcShowToast: vi.fn(),
      svcFmtInt: (n) => String(Math.floor(Number(n) || 0)),
      EGTopServices: {
        exportCsv: vi.fn(),
        exportJson: vi.fn(),
        copyIds: vi.fn(async () => {}),
        copyTsmGroup: vi.fn(async () => {}),
        bootstrapItemMetaStatic: vi.fn(async () => true),
        nameCache,
        iconCache,
        qualityCache,
      },
      init: vi.fn(() => {}),
    };
  });

  it('binds handlers and triggers key actions', async () => {
    const mod = await import('../top.handlers.controller.js');
    expect(mod.attachHandlers).toBeTypeOf('function');

    // Attach handlers with DI deps
    mod.attachHandlers(deps);

    // 1) Filters -> minSold change should setFilters and refresh(userTriggered)
    const minSoldEl = document.getElementById('minSold');
    minSoldEl.value = '25';
    minSoldEl.dispatchEvent(new Event('change'));
    expect(deps.setFilters).toHaveBeenCalledWith(expect.objectContaining({ minSold: 25, offset: 0 }));
    expect(deps.refresh).toHaveBeenCalledWith({ userTriggered: true });

    // 2) Pagination next/prev uses limit and offset
    deps.ControllerState.filters.offset = 0;
    document.getElementById('nextPage').click();
    expect(deps.setFilters).toHaveBeenCalledWith(expect.objectContaining({ offset: 400 }));
    document.getElementById('prevPage').click();
    expect(deps.setFilters).toHaveBeenCalledWith(expect.objectContaining({ offset: 0 }));

    // 3) Sort header click
    document.querySelector('th[data-sort="sold"]').dispatchEvent(new MouseEvent('click', { bubbles: true }));
    expect(deps.setSort).toHaveBeenCalledWith({ key: 'sold', dir: 'desc' });
    expect(deps.refresh).toHaveBeenCalledWith({ userTriggered: true });
    // sort persisted
    expect(localStorage.getItem(deps.LS.sortKey)).toBe('sold');
    expect(localStorage.getItem(deps.LS.sortDir)).toBe('desc');

    // 4) Search debounce
    const searchEl = document.getElementById('searchTop');
    searchEl.value = 'abc';
    searchEl.dispatchEvent(new Event('input', { bubbles: true }));
    await vi.advanceTimersByTimeAsync(220);
    expect(deps.setFilters).toHaveBeenCalledWith(expect.objectContaining({ query: 'abc', offset: 0 }));
    expect(deps.refresh).toHaveBeenCalledWith({ userTriggered: true });
    // query persisted
    expect(localStorage.getItem(deps.LS.query)).toBe('abc');

    // 5) Export/Copy buttons use EGTopServices with window.lastVisible
    document.getElementById('exportTop').click();
    document.getElementById('exportJsonTop').click();
    document.getElementById('copyIdsTop').click();
    document.getElementById('copyTsmTop').click();
    expect(deps.EGTopServices.exportCsv).toHaveBeenCalled();
    expect(deps.EGTopServices.exportJson).toHaveBeenCalled();
    expect(deps.EGTopServices.copyIds).toHaveBeenCalled();
    expect(deps.EGTopServices.copyTsmGroup).toHaveBeenCalled();

    // 6) Density toggle toggles body class and persists
    document.getElementById('densityToggle').click();
    expect(document.body.classList.contains('density-compact')).toBe(true);
    expect(localStorage.getItem('eg_top_density_compact')).toBe('1');

    // 7) Help modal open/close via button and ESC
    document.getElementById('helpTop').click();
    const helpModal = document.getElementById('helpModal');
    expect(helpModal.hasAttribute('hidden')).toBe(false);
    // ESC key should close
    document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape' }));
    expect(helpModal.hasAttribute('hidden')).toBe(true);
    // ESC also clears search and persists empty query
    expect(localStorage.getItem(deps.LS.query)).toBe('');

    // 8) Keyboard shortcut '/' prevents default (focus search path exercised)
    const ev = new KeyboardEvent('keydown', { key: '/', bubbles: true, cancelable: true });
    document.dispatchEvent(ev);
    expect(ev.defaultPrevented).toBe(true);

    // 9) Connectivity HUD initial ping after 1000ms sets dot online
    const dot = document.getElementById('connDot');
    await vi.advanceTimersByTimeAsync(1005);
    expect(dot.classList.contains('online') || dot.classList.contains('offline')).toBe(true);

    // 10) SSE message triggers debounced refresh(false) when tab top visible
    const sse = (window.__sse_instances || [])[0];
    expect(sse).toBeTruthy();
    const prevCalls = deps.refresh.mock.calls.length;
    sse.emit('message', { data: JSON.stringify({ type: 'change' }) });
    // 1500ms for SSE debounce + additional time to pass the 2.5s gate interval
    await vi.advanceTimersByTimeAsync(1600);
    await vi.advanceTimersByTimeAsync(1000);
    expect(deps.refresh.mock.calls.length).toBeGreaterThan(prevCalls);

    // 11) Alerts refresh renders status
    document.getElementById('refreshAlerts').click();
    // Await microtasks
    await Promise.resolve();
    const alertsStatus = document.getElementById('alertsStatus');
    expect(alertsStatus.textContent).toMatch(/alerts/);
  });
});
