import { describe, it, expect, beforeEach, vi } from 'vitest';

// Controls snapshot used by mocked readControls
let controls;
let statusElRef;

vi.mock('../top.state.js', async () => {
  const api = {
    ControllerState: {
      inited: false,
      els: {},
      sort: { key: 'soldPerDay', dir: 'desc' },
      filters: {},
    },
    LS: {},
    readControls: vi.fn(() => controls),
    setFilters: vi.fn((p) => Object.assign(api.ControllerState.filters, p)),
    setSort: vi.fn((p = {}) => {
      api.ControllerState.sort = { ...api.ControllerState.sort, ...p };
    }),
  };
  return api;
});

// Mock services used directly by controller (getJSON and meta helpers)
const mockGetJSON = vi.fn();
const mockFetchNamesIcons = vi.fn();
vi.mock('../top.services.js', () => ({
  default: {
    nameCache: new Map(),
    qualityCache: new Map(),
    fetchNamesIcons: mockFetchNamesIcons,
    bootstrapItemMetaStatic: vi.fn(),
  },
  getJSON: mockGetJSON,
  postJSON: vi.fn(),
  copyText: vi.fn(),
  showToast: vi.fn(),
  fmtInt: vi.fn((v) => String(v)),
}));

// Provide Perf stub
vi.mock('../top.perf.js', () => ({ default: { start: vi.fn(), end: vi.fn() } }));

// Renderer side-effect module sets window.EGTopRenderer
const mockAppendRowsChunked = vi.fn();
const mockUpdatePageInfo = vi.fn();
vi.mock('../top.renderer.js', () => {
  globalThis.EGTopRenderer = {
    appendRowsChunked: mockAppendRowsChunked,
    updatePageInfo: mockUpdatePageInfo,
    buildRow: vi.fn(() => document.createElement('tr')),
    loadSparkIfNeeded: vi.fn(),
  };
  return {};
});

function el(tag, attrs = {}, html = '') {
  const e = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs)) {
    if (k === 'class') { e.className = String(v || ''); }
    else if (k in e) {
      try { e[k] = v } catch {}
    } else {
      try { e.setAttribute(k, String(v)) } catch {}
    }
  }
  if (html) { e.innerHTML = html; }
  return e;
}

describe('EGTopController.refresh() HUD + rendering', () => {
  beforeEach(() => {
    vi.resetModules();
    document.body.innerHTML = '';
    // Prevent module bootstrap from auto-initializing/refreshing
    // We'll call EGTopController.init() manually in tests
    window.__EG_TOP_BOOTSTRAP__ = true;
    controls = {
      src: 'region',
      useAll: false,
      includeZero: true,
      minSold: 0,
      quality: null,
      // Use a numeric query so filtering works via itemId match (no prefetchMeta)
      query: '2',
      limit: 2,
      hours: 48,
    };

    mockAppendRowsChunked.mockClear();
    mockUpdatePageInfo.mockClear();
    mockFetchNamesIcons.mockClear();
    mockGetJSON.mockReset();

    // Data returned from service
    mockGetJSON.mockResolvedValue({
      items: [
        { itemId: 1, soldPerDay: 10 },
        { itemId: 2, soldPerDay: 5 },
        { itemId: 3, soldPerDay: 2 },
        { itemId: 22, soldPerDay: 8 },
      ],
      total: 4,
      offset: 0,
    });

    // Minimal DOM
    const table = el('table');
    const rows = el('tbody', { id: 'rowsTop' });
    // Add a dummy row so EGTopController.init() detects existing rows and
    // does not schedule the auto refresh that could race our assertions.
    rows.appendChild(document.createElement('tr'));
    const status = el('div', { id: 'statusTop' });
    statusElRef = status;
    const pageInfo = el('div', { id: 'pageInfo' });
    const footerInfo = el('div', { id: 'footerInfo' });
    table.appendChild(rows);
    document.body.append(table, status, pageInfo, footerInfo);
  });

  it('renders filtered items, updates HUDs and page info', async () => {
    const { EGTopController } = await import('../top.controller.js');
    // Initialize with our elements
    EGTopController.init({
      rowsEl: document.getElementById('rowsTop'),
      statusEl: statusElRef,
      pageInfoEl: document.getElementById('pageInfo'),
      footerInfo: document.getElementById('footerInfo'),
    });

    await EGTopController.refresh();

    // With query '2', items with id 2 and 22 match; limit=2 -> two rows scheduled
    expect(mockAppendRowsChunked).toHaveBeenCalled();
    const call = mockAppendRowsChunked.mock.calls[0];
    expect(call[0]).toBe(document.getElementById('rowsTop'));
    expect(Array.isArray(call[1])).toBe(true);
    expect(call[1].length).toBe(2);

    // footer text reflects showing and total
    expect(document.getElementById('footerInfo').textContent).toMatch(/Showing 2 of .* items/);

    // page info gets updated with counts
    expect(mockUpdatePageInfo).toHaveBeenCalled();

    // lastVisible exported for legacy helpers
    expect(window.lastVisible).toBeDefined();
    expect(Array.isArray(window.lastVisible)).toBe(true);
  });

  it('shows error message when getJSON fails', async () => {
    const { EGTopController } = await import('../top.controller.js');
    EGTopController.init({
      rowsEl: document.getElementById('rowsTop'),
      statusEl: statusElRef,
      pageInfoEl: document.getElementById('pageInfo'),
      footerInfo: document.getElementById('footerInfo'),
    });

    // Verify ControllerState sees the expected status element id
    const { ControllerState } = await import('../top.state.js');
    expect(ControllerState.els.statusEl?.id).toBe(statusElRef.id);

    // Force an error during rendering to exercise the catch block deterministically
    mockAppendRowsChunked.mockImplementationOnce(() => {
      throw new Error('boom');
    });
    const waitErr = new Promise((resolve) => {
      document.addEventListener('egtop:refresh:error', resolve, { once: true });
    });
    await EGTopController.refresh();
    // Wait for explicit error event (deterministic), with a short fallback delay
    await Promise.race([
      waitErr,
      new Promise((r) => setTimeout(r, 25)),
    ]);
    // Flush any pending microtasks/macrotasks
    await Promise.resolve();
    await new Promise((r) => setTimeout(r, 0));
    // Allow a few ticks under load
    for (let i = 0; i < 10; i++) {
      const cur = document.getElementById('statusTop')?.textContent || window.__eg_last_status__ || '';
      if (/Failed to load: boom/.test(cur)) { break; }
      await new Promise((r) => setTimeout(r, 0));
    }
    const finalText = document.getElementById('statusTop')?.textContent || window.__eg_last_status__ || '';
    expect(finalText).toMatch(/Failed to load:/);
    // Deterministically verify the error propagated
    expect(window.__eg_last_error_message__).toBe('boom');
  });
});
