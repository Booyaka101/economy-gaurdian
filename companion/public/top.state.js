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
  const useAll = !!(e.allCatalogEl && e.allCatalogEl.checked);
  const includeZero = !!(e.includeZeroEl && e.includeZeroEl.checked);
  const minSold = Math.max(0, pickNum(e.minSoldEl?.value, 0));
  const quality = e.qualityEl && e.qualityEl.value !== '' ? pickNum(e.qualityEl.value, null) : null;
  const query = e.searchEl ? String(e.searchEl.value || '').trim() : '';
  return { src, hours, limit, useAll, includeZero, minSold, quality, query };
}

// Mutators
export function setFilters(p = {}) {
  ControllerState.filters = { ...ControllerState.filters, ...p };
}

export function setSort(p = {}) {
  ControllerState.sort = { ...ControllerState.sort, ...p };
}
