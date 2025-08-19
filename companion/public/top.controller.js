// TopController: orchestrates loading existing top.js (Phase 1/2) and prepares for modularization
// Future phases will move logic from top.js into services/renderer/ui.
import EGTopServices, {
  getJSON as svcGetJSON,
  postJSON as svcPostJSON,
  copyText as svcCopyText,
  showToast as svcShowToast,
  fmtInt as svcFmtInt,
} from './top.services.js';
// Load renderer (side-effect export to window.EGTopRenderer)
import './top.renderer.js';
import Perf from './top.perf.js';
import { ControllerState, LS, readControls, setFilters, setSort } from './top.state.js';

import { attachHandlers as attachHandlersDI } from './top.handlers.controller.js';
// Phase 4: New modular controller API (optional, safe to ignore by legacy)
// Provides: init, refresh, setFilters, setSort, fetchSalesSeries, attachHandlers

// Apply client-side filters and sorting for query/minSold/quality
function filterAndSortItems(items) {
  try {
    const arr = Array.isArray(items) ? items.slice() : [];
    const { minSold, quality, query } = readControls();
    const q = String(query || '')
      .toLowerCase()
      .trim();
    const isDigits = q && /^\d+$/.test(q);
    const toks = q ? Array.from(new Set(q.split(/\s+/).filter(Boolean))) : [];
    const nameCache = EGTopServices && EGTopServices.nameCache;
    const qualityCache = EGTopServices && EGTopServices.qualityCache;
    const matchQuery = (it) => {
      if (!q) {
        return true;
      }
      const id = Number(it?.itemId);
      if (isDigits) {
        return String(id).includes(q);
      }
      // name tokens: require all tokens to be present
      let nm = '';
      try {
        nm = (nameCache && nameCache.get && nameCache.get(id)) || (it?.name ?? it?.itemName ?? '');
      } catch {}
      let s = '';
      try {
        const nn =
          EGTopServices && EGTopServices.normalizeName
            ? EGTopServices.normalizeName(nm)
            : String(nm || '');
        s = String(nn || '')
          .toLowerCase()
          .trim();
      } catch {
        s = String(nm || '')
          .toLowerCase()
          .trim();
      }
      if (!s) {
        return false;
      }
      for (const t of toks) {
        if (!s.includes(t)) {
          return false;
        }
      }
      return true;
    };
    const matchMinSold = (it) => {
      const v = Number(it?.soldPerDay || 0);
      return v >= Math.max(0, Number(minSold || 0));
    };
    const matchQuality = (it) => {
      if (quality == null) {
        return true;
      }
      const id = Number(it?.itemId);
      try {
        const ql = qualityCache && qualityCache.get && qualityCache.get(id);
        return Number(ql) === Number(quality);
      } catch {
        return false;
      }
    };
    const out = arr.filter((it) => matchQuery(it) && matchMinSold(it) && matchQuality(it));
    // Sort by soldPerDay with current direction
    const dir = (ControllerState.sort && ControllerState.sort.dir) === 'asc' ? 1 : -1;
    out.sort((a, b) => (Number(a?.soldPerDay || 0) - Number(b?.soldPerDay || 0)) * dir);
    return out;
  } catch {
    return Array.isArray(items) ? items : [];
  }
}

function buildUrlWithHours(hoursOverride, limitOverride) {
  const e = ControllerState.els;
  const { src, useAll, includeZero, minSold, quality, query, limit: _uiLimit } = readControls();
  const hours = Math.max(1, Number(hoursOverride ?? e.hoursEl?.value ?? 48));
  const userLimit = Number(limitOverride ?? e.limitEl?.value ?? 400);
  const filtersActive =
    (!!query && String(query).trim().length > 0) || Number(minSold || 0) > 0 || quality != null;
  // Effective All-Catalog when filters are active to search across full dataset (local)
  const useAllEffective = src === 'local' && (useAll || filtersActive);
  // Increase fetch size to avoid missing matches due to server pagination
  const limit =
    src === 'local'
      ? useAllEffective && filtersActive
        ? Math.max(userLimit, 10000)
        : userLimit
      : filtersActive
        ? Math.max(userLimit, 5000)
        : userLimit;
  const sort = ControllerState.sort.key;
  const dir = ControllerState.sort.dir;
  if (src === 'local') {
    const base = useAllEffective ? '/stats/top-sold-local/all' : '/stats/top-sold-local';
    const params = new URLSearchParams();
    params.set('limit', String(limit));
    if (useAllEffective) {
      // When filters are active, disable server pagination to avoid missing matches
      const offset = filtersActive ? 0 : Math.max(0, ControllerState.filters.offset || 0);
      params.set('offset', String(offset));
    }
    params.set('hours', String(hours));
    params.set('includeZero', String(includeZero ? 1 : 0));
    params.set('minSold', String(minSold));
    params.set('sort', String(sort));
    params.set('dir', String(dir));
    return `${base}?${params.toString()}`;
  } else {
    const base = '/stats/top-sold-region';
    const params = new URLSearchParams();
    params.set('limit', String(limit));
    params.set('sort', String(sort));
    params.set('dir', String(dir));
    return `${base}?${params.toString()}`;
  }
}

async function fetchSalesSeries(itemId, hours) {
  const queries = [
    `/debug/sales/raw-item?itemId=${encodeURIComponent(itemId)}&hours=${encodeURIComponent(hours)}`,
    `/debug/sales/raw-item?itemId=${encodeURIComponent(itemId)}`,
    `/debug/sales?itemId=${encodeURIComponent(itemId)}&hours=${encodeURIComponent(hours)}`,
  ];
  for (const url of queries) {
    try {
      const resp = await svcGetJSON(url);
      let ev = [];
      if (Array.isArray(resp)) {
        ev = resp;
      } else if (Array.isArray(resp?.events)) {
        ev = resp.events;
      } else if (Array.isArray(resp?.series)) {
        ev = resp.series.map((x) => ({ ts: x.t ?? x.ts, qty: x.v ?? x.qty }));
      }
      const norm = ev
        .map((x) => ({
          t: Number(x.ts ?? x.t ?? x.time ?? 0),
          v: Number(x.qty ?? x.v ?? x.value ?? 0),
        }))
        .filter((x) => Number.isFinite(x.t) && Number.isFinite(x.v))
        .sort((a, b) => a.t - b.t);
      if (norm.length >= 2) {
        return norm.map((x) => [x.t, x.v]);
      }
    } catch {}
  }
  return null;
}

async function refresh(_opts = {}) {
  try {
    Perf.start('top.refresh');
    const e = ControllerState.els;
    if (!e.rowsEl) {
      return;
    }
    const { src, hours, limit, useAll, minSold, quality, query } = readControls();
    if (e.statusEl) {
      e.statusEl.textContent = src === 'local' ? 'Loading local…' : 'Loading region…';
    }
    const url = buildUrlWithHours(hours, limit);
    Perf.start('top.refresh.fetch');
    const data = await svcGetJSON(url);
    Perf.end('top.refresh.fetch', { url });
    const rawItems = Array.isArray(data?.items) ? data.items : [];
    // If a non-numeric name query or a quality filter is active,
    // populate names/icons/qualities first for accurate client-side filtering
    try {
      Perf.start('top.refresh.prefetchMeta');
      const q = String(query || '').trim();
      const isDigits = !!q && /^\d+$/.test(q);
      if (
        ((q && !isDigits) || quality != null) &&
        EGTopServices &&
        typeof EGTopServices.fetchNamesIcons === 'function'
      ) {
        const allIds = rawItems.map((it) => Number(it?.itemId)).filter((v) => Number.isFinite(v));
        if (allIds.length) {
          await EGTopServices.fetchNamesIcons(allIds);
        }
      }
      Perf.end('top.refresh.prefetchMeta');
    } catch {}
    const filtersActive =
      (!!query && String(query).trim().length > 0) || Number(minSold || 0) > 0 || quality != null;
    // Apply client-side filtering and re-slice to the user limit
    Perf.start('top.refresh.clientFilter');
    const filteredAll = filtersActive ? filterAndSortItems(rawItems) : rawItems;
    Perf.end('top.refresh.clientFilter', {
      filtersActive,
      total: rawItems.length,
      kept: filteredAll.length,
    });
    const items = filteredAll.slice(0, limit);
    // Keep legacy export/copy helpers working by exposing last visible items
    try {
      window.lastVisible = items;
    } catch {}
    // Ensure names/icons/qualities are populated before rendering
    try {
      Perf.start('top.refresh.ensureMetaVisible');
      const ids = items.map((it) => Number(it?.itemId)).filter((v) => Number.isFinite(v));
      if (ids.length && EGTopServices && typeof EGTopServices.fetchNamesIcons === 'function') {
        await EGTopServices.fetchNamesIcons(ids);
      }
      Perf.end('top.refresh.ensureMetaVisible', { ids: ids.length });
    } catch {}
    // Delegate rendering to EGTopRenderer
    const R = window.EGTopRenderer;
    const loadSpark = (el) => {
      try {
        if (R && typeof R.loadSparkIfNeeded === 'function') {
          R.loadSparkIfNeeded(el, hours, fetchSalesSeries);
        }
      } catch {}
    };
    const buildRow = (it) => {
      try {
        return R && typeof R.buildRow === 'function'
          ? R.buildRow(it)
          : document.createElement('tr');
      } catch {
        return document.createElement('tr');
      }
    };
    if (R && typeof R.appendRowsChunked === 'function') {
      Perf.start('top.refresh.renderSchedule');
      R.appendRowsChunked(e.rowsEl, items, { buildRow, loadSpark });
      Perf.end('top.refresh.renderSchedule', { count: items.length });
    } else {
      // Fallback: simple sync render (rare)
      Perf.start('top.refresh.renderSync');
      e.rowsEl.innerHTML = '';
      const frag = document.createDocumentFragment();
      for (const it of items) {
        frag.appendChild(buildRow(it));
      }
      e.rowsEl.appendChild(frag);
      Perf.end('top.refresh.renderSync', { count: items.length });
    }
    // HUDs
    if (e.footerInfo) {
      const showing = Math.min(items.length, limit);
      const total = filtersActive ? filteredAll.length : Number(data?.total || items.length);
      const cachedNote = '';
      e.footerInfo.textContent = `Showing ${showing} of ${total} items · Source: ${src}${cachedNote}`;
    }
    if (e.pageInfoEl) {
      try {
        const total = filtersActive ? filteredAll.length : Number(data?.total || items.length);
        const offset = filtersActive
          ? 0
          : Number(data?.offset || ControllerState.filters.offset || 0);
        const useAllEffective = src === 'local' && (useAll || filtersActive);
        if (window.EGTopRenderer && typeof window.EGTopRenderer.updatePageInfo === 'function') {
          window.EGTopRenderer.updatePageInfo(e.pageInfoEl, {
            src,
            useAll: useAllEffective,
            offset,
            count: items.length,
            total,
          });
        }
      } catch {}
    }
    if (e.statusEl) {
      e.statusEl.textContent = '';
    }
    Perf.end('top.refresh', { items: items.length });
  } catch (e) {
    try {
      const el = ControllerState.els.statusEl;
      const msg = `Failed to load: ${e?.message || e}`;
      if (el) {
        el.textContent = msg;
      }
      // Fallback: also update common status element IDs directly
      try {
        const direct =
          (typeof document !== 'undefined' && document &&
            (document.getElementById('statusTop') || document.getElementById('status'))) || null;
        if (direct && direct !== el) {
          direct.textContent = msg;
        }
      } catch {}
    } catch {}
    // Signal to observers/tests that an error occurred and HUD was updated
    try {
      // Record latest status and error details for deterministic testing/diagnostics
      try {
        const el = ControllerState.els.statusEl;
        if (typeof window !== 'undefined') {
          window.__eg_last_status__ = el ? String(el.textContent || '') : '';
          window.__eg_last_error_message__ = e?.message || String(e);
        }
      } catch {}
      if (typeof document !== 'undefined' && document && document.dispatchEvent) {
        // Use a basic Event for broad compatibility
        document.dispatchEvent(new Event('egtop:refresh:error'));
      }
    } catch {}
    try {
      Perf.end('top.refresh', { error: e?.message || String(e) });
    } catch {}
  }
}

function init(opts = {}) {
  if (ControllerState.inited) {
    return;
  }
  ControllerState.inited = true;
  ControllerState.els = {
    rowsEl: opts.rowsEl || document.getElementById('rowsTop') || document.getElementById('rows'),
    statusEl:
      opts.statusEl || document.getElementById('statusTop') || document.getElementById('status'),
    pageInfoEl: opts.pageInfoEl || document.getElementById('pageInfo'),
    footerInfo: opts.footerInfo || document.getElementById('footerInfo'),
    // controls
    sourceEl:
      opts.sourceEl || document.getElementById('sourceTop') || document.getElementById('source'),
    hoursWrapEl: opts.hoursWrapEl || document.getElementById('hoursTopWrap'),
    hoursEl:
      opts.hoursEl || document.getElementById('hoursTop') || document.getElementById('hours'),
    limitEl:
      opts.limitEl || document.getElementById('limitTop') || document.getElementById('limit'),
    allCatalogEl: opts.allCatalogEl || document.getElementById('allCatalog'),
    includeZeroEl: opts.includeZeroEl || document.getElementById('includeZero'),
    minSoldEl:
      opts.minSoldEl || document.getElementById('minSoldTop') || document.getElementById('minSold'),
    qualityEl:
      opts.qualityEl || document.getElementById('qualityTop') || document.getElementById('quality'),
    searchEl:
      opts.searchEl || document.getElementById('searchTop') || document.getElementById('search'),
  };
  // Hydrate initial control values from localStorage (compat with legacy loadSettings)
  try {
    const e = ControllerState.els;
    const s = typeof localStorage !== 'undefined' ? localStorage.getItem(LS.source) : null;
    const h = typeof localStorage !== 'undefined' ? localStorage.getItem(LS.hours) : null;
    const l = typeof localStorage !== 'undefined' ? localStorage.getItem(LS.limit) : null;
    const a = typeof localStorage !== 'undefined' ? localStorage.getItem(LS.all) : null;
    const z = typeof localStorage !== 'undefined' ? localStorage.getItem(LS.inc0) : null;
    const m = typeof localStorage !== 'undefined' ? localStorage.getItem(LS.minSold) : null;
    const qv = typeof localStorage !== 'undefined' ? localStorage.getItem(LS.quality) : null;
    const qStr = typeof localStorage !== 'undefined' ? localStorage.getItem(LS.query) : null;
    const sk = typeof localStorage !== 'undefined' ? localStorage.getItem(LS.sortKey) : null;
    const sd = typeof localStorage !== 'undefined' ? localStorage.getItem(LS.sortDir) : null;
    if (e.sourceEl && s) {
      e.sourceEl.value = s;
    }
    if (e.hoursEl) {
      e.hoursEl.value = String(Math.max(1, Math.min(336, Number(h || 48))));
    }
    const lim = Math.max(100, Math.min(5000, Number(l || 400)));
    if (e.limitEl) {
      e.limitEl.value = String(lim);
    }
    if (e.allCatalogEl) {
      e.allCatalogEl.checked = a == null ? true : a === '1';
    }
    if (e.includeZeroEl) {
      e.includeZeroEl.checked = z == null ? true : z === '1';
    }
    if (e.minSoldEl) {
      e.minSoldEl.value = String(Math.max(0, Number(m || 0)));
    }
    if (e.qualityEl) {
      e.qualityEl.value = qv == null ? '' : String(qv);
    }
    if (e.searchEl && qStr != null) {
      try {
        e.searchEl.value = String(qStr);
      } catch {}
    }
    // Hydrate sort state if present
    try {
      const next = { ...ControllerState.sort };
      if (sk) {
        next.key = String(sk);
      }
      if (sd && (sd === 'asc' || sd === 'desc')) {
        next.dir = sd;
      }
      ControllerState.sort = next;
    } catch {}
    // Toggle hours visibility based on source
    try {
      const v = e.sourceEl ? String(e.sourceEl.value || 'region') : 'region';
      if (e.hoursWrapEl) {
        e.hoursWrapEl.style.display = v === 'local' ? '' : 'none';
      }
    } catch {}
    // Sync ControllerState.filters with hydrated DOM controls
    const { src, hours, limit, useAll, includeZero, minSold, quality, query } = readControls();
    setFilters({ source: src, hours, limit, useAll, includeZero, minSold, quality, query });
  } catch {}
  // Perform an initial refresh if table is empty (avoids double-load if legacy already renders)
  try {
    const e = ControllerState.els;
    const hasRows = !!(e.rowsEl && e.rowsEl.children && e.rowsEl.children.length);
    if (!hasRows) {
      setTimeout(async () => {
        try {
          // Ensure static item metadata is loaded before first render
          if (!window.__egTopMetaBoot__) {
            window.__egTopMetaBoot__ = true;
            try {
              await EGTopServices.bootstrapItemMetaStatic();
            } catch {}
          }
          await refresh({ userTriggered: false });
        } catch {}
      }, 0);
    }
  } catch {}
}

function attachHandlers() {
  // Delegate to modular handlers with dependency injection
  try {
    attachHandlersDI({
      ControllerState,
      LS,
      setFilters,
      setSort,
      refresh,
      svcGetJSON,
      svcPostJSON,
      svcCopyText,
      svcShowToast,
      svcFmtInt,
      EGTopServices,
      init,
    });
  } catch {}
}

export const EGTopController = {
  init,
  refresh,
  setFilters,
  setSort,
  fetchSalesSeries,
  buildUrlWithHours,
  attachHandlers,
};
try {
  if (!window.EGTopController) {
    window.EGTopController = EGTopController;
  }
} catch {}

// Bootstrap: ensure handlers are attached after DOM is ready (guarded)
try {
  if (!window.__EG_TOP_BOOTSTRAP__) {
    window.__EG_TOP_BOOTSTRAP__ = true;
    const boot = () => {
      try {
        EGTopController.init();
        EGTopController.attachHandlers();
      } catch {}
    };
    if (document.readyState === 'loading') {
      document.addEventListener('DOMContentLoaded', boot, { once: true });
    } else {
      setTimeout(boot, 0);
    }
  }
} catch {}

export class TopController {
  constructor() {
    this.loaded = false;
  }

  async init() {
    // Avoid double-load
    if (window.__EG_TOP_MODULE_INIT__) {
      return;
    }
    window.__EG_TOP_MODULE_INIT__ = true;

    // If classic top.js already present (from previous loader), do nothing
    if (document.querySelector('script[data-eg-top="core"]')) {
      this.loaded = true;
      return;
    }

    // Provide safe shims so classic script can use centralized helpers if it wants
    this._installShims();

    // Inject the existing classic script to preserve behavior
    await this._loadClassicTop();
    this.loaded = true;
  }

  _installShims() {
    try {
      const w = window;
      if (w && EGTopServices) {
        // Do not overwrite if already defined by page
        if (!w.getJSON) {
          w.getJSON = svcGetJSON;
        }
        if (!w.postJSON) {
          w.postJSON = svcPostJSON;
        }
        if (!w.copyText) {
          w.copyText = svcCopyText;
        }
        if (!w.showToast) {
          w.showToast = svcShowToast;
        }
        if (!w.fmtInt) {
          w.fmtInt = svcFmtInt;
        }
        // Attach services namespace (read-only usage encouraged)
        if (!w.EGTopServices) {
          w.EGTopServices = EGTopServices;
        }
      }
    } catch {}
  }

  _loadClassicTop() {
    return new Promise((resolve, reject) => {
      try {
        const s = document.createElement('script');
        s.src = './top.js?v=esm_phase1&ts=' + String(Date.now());
        s.async = false;
        s.setAttribute('data-eg-top', 'core');
        s.onload = () => resolve();
        s.onerror = (e) => reject(e);
        const cur = document.currentScript;
        if (cur && cur.parentNode) {
          cur.parentNode.insertBefore(s, cur);
        } else {
          document.head.appendChild(s);
        }
      } catch (e) {
        reject(e);
      }
    });
  }
}
