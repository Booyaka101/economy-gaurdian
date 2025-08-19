// Centralized Top view state and selectors
// Extracted from top.controller.js to prepare for modularization

// Phase 4: New modular controller API state
export const ControllerState = {
  inited: false,
  els: {},
  sort: { key: 'soldPerDay', dir: 'desc' },
  filters: {
    query: '',
    minSold: 0,
    quality: null,
    hours: 48,
    source: 'local',
    limit: 400,
    useAll: true,
    includeZero: true,
    offset: 0,
    total: null,
  },
  perf: null,
};

// Persisted settings keys (kept compatible with legacy top.js)
export const LS = {
  source: 'eg_top_source',
  hours: 'eg_top_hours',
  limit: 'eg_top_limit',
  all: 'eg_top_all_catalog',
  inc0: 'eg_top_include_zero',
  minSold: 'eg_top_min_sold',
  quality: 'eg_top_quality',
  // New persisted keys for Phase 4 modular controller
  query: 'eg_top_query',
  sortKey: 'eg_top_sort_key',
  sortDir: 'eg_top_sort_dir',
};

// Read current control values from bound DOM elements
export function readControls() {
  const e = ControllerState.els;
  const pickNum = (v, d) => {
    const n = Number(v);
    return Number.isFinite(n) ? n : d;
  };
  const src = e.sourceEl ? String(e.sourceEl.value || 'local') : 'local';
  const hours = pickNum(e.hoursEl?.value, 48);
  const limit = Math.max(100, Math.min(5000, pickNum(e.limitEl?.value, 400)));
  const useAll = e.allCatalogEl
    ? !!e.allCatalogEl.checked
    : (() => {
        try {
          const a = typeof localStorage !== 'undefined' ? localStorage.getItem(LS.all) : null;
          return a == null ? true : a === '1';
        } catch {
          return true;
        }
      })();
  const includeZero = e.includeZeroEl
    ? !!e.includeZeroEl.checked
    : (() => {
        try {
          const z = typeof localStorage !== 'undefined' ? localStorage.getItem(LS.inc0) : null;
          return z == null ? true : z === '1';
        } catch {
          return true;
        }
      })();
  const minSold = Math.max(0, pickNum(e.minSoldEl?.value, 0));
  const quality = e.qualityEl && e.qualityEl.value !== '' ? pickNum(e.qualityEl.value, null) : null;
  const query = e.searchEl
    ? String(e.searchEl.value || '').trim()
    : (() => {
        try {
          const q = typeof localStorage !== 'undefined' ? localStorage.getItem(LS.query) : '';
          return String(q || '').trim();
        } catch {
          return '';
        }
      })();
  return { src, hours, limit, useAll, includeZero, minSold, quality, query };
}

// Mutators
export function setFilters(p = {}) {
  ControllerState.filters = { ...ControllerState.filters, ...p };
}

export function setSort(p = {}) {
  ControllerState.sort = { ...ControllerState.sort, ...p };
}
