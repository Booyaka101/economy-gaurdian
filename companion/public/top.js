// Density toggle
// Promote shared DOM refs to outer scope so top-level helpers can access them safely.
// They will be assigned inside the main IIFE below.
let aiModal, aiModalTitle, aiModalBody, aiModalClose;
let _alertsStatusEl, _alertsListEl, _refreshAlertsBtn;
// Top tab controls referenced by various top-level helpers
let rowsEl, statusEl, limitEl, sourceEl, _hoursWrapEl, hoursEl, searchEl;
let _catalogSearchEl, _catalogResultsEl, minSoldEl, qualityEl, allCatalogEl, includeZeroEl;
let prevBtn, nextBtn, exportBtn, copyIdsBtn, _copyTsmBtn, _pageInfoEl, rootTable, thead;
let _scrollEl;
const densityLSKey = 'eg_top_density_compact';
// Safe, gated debug logger. If a global dbg exists, use it; otherwise define a gated no-op by default.
const dbg =
  typeof window !== 'undefined' && typeof window.dbg === 'function'
    ? window.dbg
    : function (...args) {
        try {
          if (typeof localStorage !== 'undefined' && localStorage.getItem('eg_debug_top') === '1') {
            /* eslint-disable-next-line no-console */
            if (console && (console.debug || console.log)) {
              /* eslint-disable-next-line no-console */
              (console.debug || console.log).apply(console, args);
            }
          }
        } catch {}
      };
// Fail-fast: EGTopServices must be available on the Top tab
if (typeof window === 'undefined' || !window.EGTopServices) {
  throw new Error('[Top] EGTopServices not available');
}
function applyDensity(compact) {
  const root = document.body;
  if (!root) {
    return;
  }
  if (compact) {
    root.classList.add('density-compact');
  } else {
    root.classList.remove('density-compact');
  }
  const btn = document.getElementById('densityToggle');
  if (btn) {
    btn.textContent = compact ? 'Comfortable' : 'Compact';
  }
}

// Local quick fallback (removed: catalog search now centralized in controller)

// Catalog extras state removed (handled by controller)

// ensureExtrasFor removed (handled by controller)

// AI modal helpers
function _openAIModal(title, html) {
  try {
    if (!aiModal || !aiModalTitle || !aiModalBody) {
      return;
    }
    aiModalTitle.textContent = String(title || 'AI');
    aiModalBody.innerHTML = String(html || '');
    aiModal.removeAttribute('hidden');
    if (aiModalClose) {
      aiModalClose.focus();
    }
  } catch {}
}
function _closeAIModal() {
  try {
    if (aiModal) {
      aiModal.setAttribute('hidden', '');
    }
  } catch {}
}
// Modal close bindings moved to controller

// Small helpers for UX
function _focusSearch() {
  try {
    const el = document.getElementById('searchTop') || document.getElementById('search');
    if (el) {
      el.focus();
      el.select && el.select();
    }
  } catch {}
}

// Alerts UI removed (centralized in controller)
// Alerts bindings removed (handled by controller)
// Global keyboard shortcuts removed (handled by controller)
// Delegate clicks in alerts list for ETA/AI/Copy buttons (guard when controller active)
// Legacy alerts click delegation removed; handled by controller's attachHandlers()
// Legacy export JSON button handler removed; centralized in controller
(() => {
  try {
    const saved = localStorage.getItem(densityLSKey);
    applyDensity(saved === '1');
  } catch {}
})();
// Legacy density toggle handler removed; handled by controller's attachHandlers()

// Initialize sparkline hover/focus listeners (independent of density toggle)
// Connectivity HUD removed (handled by controller)
(function initSparkHover() {
  /* handled by controller */
})();

// Polling status widget removed (handled by controller)

async function fetchSalesSeries(itemId, hours) {
  // Prefer controller API when available
  try {
    if (
      window &&
      window.EGTopController &&
      typeof window.EGTopController.fetchSalesSeries === 'function'
    ) {
      return await window.EGTopController.fetchSalesSeries(itemId, hours);
    }
  } catch {}
  // Legacy fallback: hit endpoints directly
  const queries = [
    `/debug/sales/raw-item?itemId=${encodeURIComponent(itemId)}&hours=${encodeURIComponent(hours)}`,
    `/debug/sales/raw-item?itemId=${encodeURIComponent(itemId)}`,
    `/debug/sales?itemId=${encodeURIComponent(itemId)}&hours=${encodeURIComponent(hours)}`,
  ];
  for (const url of queries) {
    try {
      const resp = await window.EGTopServices.getJSON(url);
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

(() => {
  const _$ = (sel) => document.querySelector(sel);
  // Prefer elements inside the Top tab when embedded in index.html
  rowsEl = document.getElementById('rowsTop') || document.getElementById('rows');
  statusEl = document.getElementById('statusTop') || document.getElementById('status');
  limitEl = document.getElementById('limitTop') || document.getElementById('limit');
  sourceEl = document.getElementById('sourceTop');
  _hoursWrapEl = document.getElementById('hoursTopWrap');
  hoursEl = document.getElementById('hoursTop');
  searchEl = document.getElementById('searchTop');
  // New: catalog-wide search elements
  _catalogSearchEl = document.getElementById('catalogSearch');
  _catalogResultsEl = document.getElementById('catalogResults');
  minSoldEl = document.getElementById('minSoldTop');
  qualityEl = document.getElementById('qualityTop');
  allCatalogEl = document.getElementById('allCatalog');
  includeZeroEl = document.getElementById('includeZero');
  prevBtn = document.getElementById('prevPage');
  try {
    const _hasCtlHandlers = !!(
      window &&
      window.EGTopController &&
      typeof window.EGTopController.attachHandlers === 'function'
    );
    // No legacy button listeners; controller owns all export/copy bindings
  } catch {}
  nextBtn = document.getElementById('nextPage');
  exportBtn = document.getElementById('exportTop');
  copyIdsBtn = document.getElementById('copyIdsTop');
  _copyTsmBtn = document.getElementById('copyTsmTop');
  _pageInfoEl = document.getElementById('pageInfo');
  rootTable = rowsEl ? rowsEl.closest('table') : document.querySelector('table');
  // AI modal + alerts elements
  aiModal = document.getElementById('aiModal');
  aiModalTitle = document.getElementById('aiModalTitle');
  aiModalBody = document.getElementById('aiModalBody');
  aiModalClose = document.getElementById('aiModalClose');
  _alertsStatusEl = document.getElementById('alertsStatus');
  _alertsListEl = document.getElementById('alertsList');
  _refreshAlertsBtn = document.getElementById('refreshAlerts');
  thead = rootTable ? rootTable.querySelector('thead') : document.querySelector('thead');
  // Help modal elements
  const helpBtn = document.getElementById('helpTop');
  const helpModal = document.getElementById('helpModal');
  const _helpModalClose = document.getElementById('helpModalClose');
  const helpModalBody = document.getElementById('helpModalBody');
  function _openHelpModal() {
    try {
      if (!helpModal || !helpModalBody) {
        return;
      }
      helpModalBody.innerHTML = `
        <div class="status">Keyboard shortcuts</div>
        <ul>
          <li><strong>/</strong> Focus search</li>
          <li><strong>ESC</strong> Clear search / close modals</li>
          <li><strong>Ctrl+Shift+E</strong> Export CSV</li>
          <li><strong>Ctrl+Shift+C</strong> Copy visible IDs</li>
          <li><strong>Ctrl+Shift+G</strong> Copy visible items as TSM group</li>
          <li><strong>?</strong> Open this Help</li>
          <li><strong>R</strong> (Ctrl+Shift) Toggle render debug</li>
          <li><strong>D</strong> (Ctrl+Shift) Toggle Top debug</li>
        </ul>
        <div class="status">Tips</div>
        <ul>
          <li>Hover item rows to load sales sparklines.</li>
          <li>Use search to filter by name or item ID.</li>
          <li>Export JSON for programmatic pipelines.</li>
        </ul>`;
      helpModal.removeAttribute('hidden');
    } catch {}
  }
  function _closeHelpModal() {
    try {
      if (helpModal) {
        helpModal.setAttribute('hidden', '');
      }
    } catch {}
  }
  // Legacy help modal bindings removed; handled by controller's attachHandlers()
  // Control titles (discoverability)
  try {
    const refreshBtn = document.getElementById('refreshTop') || document.getElementById('refresh');
    if (refreshBtn) {
      refreshBtn.setAttribute('title', 'Refresh data');
    }
    if (searchEl) {
      searchEl.setAttribute('title', 'Search items (ESC to clear, / to focus)');
    }
    if (exportBtn) {
      exportBtn.setAttribute('title', 'Export visible rows to CSV (Ctrl+Shift+E)');
    }
    try {
      const ej = document.getElementById('exportJsonTop');
      if (ej) {
        ej.setAttribute('title', 'Export visible rows to JSON');
      }
    } catch {}
    try {
      const ct = document.getElementById('copyTsmTop');
      if (ct) {
        ct.setAttribute('title', 'Copy visible items as TSM group (Ctrl+Shift+G)');
      }
    } catch {}
    if (copyIdsBtn) {
      copyIdsBtn.setAttribute('title', 'Copy visible item IDs (Ctrl+Shift+C)');
    }
    try {
      if (helpBtn) {
        helpBtn.setAttribute('title', 'Show keyboard shortcuts and tips (?)');
      }
    } catch {}
    if (prevBtn) {
      prevBtn.setAttribute('title', 'Previous page');
    }
    if (nextBtn) {
      nextBtn.setAttribute('title', 'Next page');
    }
    if (includeZeroEl) {
      includeZeroEl.setAttribute('title', 'Include items with zero sold/day');
    }
    if (minSoldEl) {
      minSoldEl.setAttribute('title', 'Minimum sold/day filter');
    }
    if (qualityEl) {
      qualityEl.setAttribute('title', 'Filter by item quality');
    }
    if (allCatalogEl) {
      allCatalogEl.setAttribute('title', 'Paginate all local items');
    }
    if (hoursEl) {
      hoursEl.setAttribute('title', 'Local source: window length in hours');
    }
    if (sourceEl) {
      sourceEl.setAttribute('title', 'Data source');
    }
  } catch {}
  // Virtualization state
  _scrollEl =
    (rowsEl && rowsEl.closest('section.card')) ||
    document.scrollingElement ||
    document.documentElement;
  const _virtual = { enabled: true, rowH: 28, total: 0, start: 0, end: 0 };
  // A11y: table semantics
  if (rootTable) {
    rootTable.setAttribute('role', 'table');
  }
  if (thead) {
    thead.setAttribute('role', 'rowgroup');
  }
  // Client-side ETag caches for JSON GETs (unused in legacy fallback)
  const _etagCache = new Map(); // key -> etag
  const _jsonCache = new Map(); // key -> last JSON response
  const inflightCache = new Map(); // key -> Promise
  if (thead) {
    thead.querySelectorAll('th').forEach((th) => {
      th.setAttribute('scope', 'col');
      th.setAttribute('role', 'columnheader');
      const sortKeyAttr = th.getAttribute('data-sort');
      if (sortKeyAttr) {
        th.setAttribute('aria-sort', 'none');
      }
    });
  }
  // Hide pagination controls for single-page default
  if (prevBtn) {
    prevBtn.style.display = 'none';
  }
  if (nextBtn) {
    nextBtn.style.display = 'none';
  }
  // A11y: live status region
  if (statusEl) {
    statusEl.setAttribute('role', 'status');
    statusEl.setAttribute('aria-live', 'polite');
  }

  const _sortKey = 'soldPerDay';
  const _sortDir = 'desc';
  const nameCache = window.EGTopServices.nameCache; // id -> string
  const iconCache = window.EGTopServices.iconCache; // id -> url or {icon}
  const qualityCache = window.EGTopServices.qualityCache;
  const _compareSold = new Map(); // id -> prev sold/day estimate for trend
  const _offset = 0;
  const _DISPLAY_LIMIT = 400;
  const _renderSeq = 0; // guards async chunked renders against stale updates

  // Frontend per-ID request deduplication across callers of fetchNamesIcons
  const inflightItemMeta = new Map(); // id -> { promise, resolve, reject }
  function _createDeferred() {
    let resolve, reject;
    const promise = new Promise((res, rej) => {
      resolve = res;
      reject = rej;
    });
    return { promise, resolve, reject };
  }
  const noNameUntil = new Map(); // id -> epoch ms when we can try again
  const NO_NAME_TTL_MS = 10 * 60 * 1000; // 10 minutes
  // Refresh control
  const _lastSig = null; // signature of last rendered dataset
  const _lastAuctionRefreshAt = 0; // epoch ms when we last called /blizzard/auctions/refresh
  // SWR bootstrap cache
  const _LS_BOOT = 'eg_top_bootstrap_v1';
  const _BOOT_TTL_MS = 15 * 60 * 1000;
  let _firstRun = true;
  // Last seen auctions fingerprint from SSE
  const _lastFp = null;
  // UI/Timing constants (hoisted for readability)
  const AUTO_REFRESH_MS = 90 * 1000;
  const _SSE_REFRESH_DEBOUNCE_MS = 1000;
  const _SAVE_NAMEICON_DEBOUNCE_MS = 800;
  const _SAVE_QUALITIES_DEBOUNCE_MS = 600;
  const _REFRESH_LOCAL_MIN_INTERVAL = 120000; // 120s between local refresh calls

  // Sparkline hover/focus loader — hoisted to top-level so it's always defined
  const _SPARK_HOVER_THROTTLE_MS = 120;
  const _sparkCache = new Map(); // id -> svg string
  const _sparkInflight = new Set(); // ids currently being fetched
  const _sparkHoverTs = new Map(); // id -> last hover timestamp
  async function _loadSparkIfNeeded(sparkEl) {
    try {
      if (
        window &&
        window.EGTopRenderer &&
        typeof window.EGTopRenderer.loadSparkIfNeeded === 'function'
      ) {
        const hours = Number(hoursEl?.value || 48);
        return await window.EGTopRenderer.loadSparkIfNeeded(sparkEl, hours, fetchSalesSeries);
      }
    } catch {}
    // Controller-required: no legacy fallback
    return null;
  }

  // Ensure consistent numeric keys for caches
  function idNum(x) {
    const n = Number(x);
    return Number.isFinite(n) ? n : null;
  }
  function isBadName(v) {
    if (typeof v !== 'string') {
      return true;
    }
    const s = v.trim();
    if (!s) {
      return true;
    }
    if (/^\[object\b/i.test(s)) {
      return true;
    }
    if (/^\d+$/.test(s)) {
      return true;
    } // don't accept pure numeric ID as name
    if (/^https?:\/\//i.test(s)) {
      return true;
    } // don't accept URLs
    if (/\.(png|jpg|jpeg|webp|gif)(\?.*)?$/i.test(s)) {
      return true;
    } // don't accept image filenames
    return false;
  }

  // Small helper: debounce to avoid spamming refresh
  function _debounce(fn, ms) {
    let t;
    return (...args) => {
      clearTimeout(t);
      t = setTimeout(() => fn(...args), ms);
    };
  }
  // Persist qualities in localStorage so quality classes can show on first load if already known
  const LS_QUAL = 'eg_top_quality_cache_v1';
  (function loadQualityCache() {
    try {
      const raw = localStorage.getItem(LS_QUAL);
      if (!raw) {
        return;
      }
      const obj = JSON.parse(raw);
      if (!obj || typeof obj !== 'object') {
        return;
      }
      for (const [k, v] of Object.entries(obj)) {
        const id = Number(k);
        if (!Number.isNaN(id)) {
          qualityCache.set(id, Number(v) || 0);
        }
      }
      dbg('[Top] loaded quality cache entries:', qualityCache.size);
    } catch {}
  })();
  // Persist names/icons in localStorage to speed up reloads (cap size to avoid large writes)
  const LS_NAMEICON = 'eg_top_name_icon_cache_v1';
  (function loadNameIconCache() {
    try {
      const raw = localStorage.getItem(LS_NAMEICON);
      if (!raw) {
        return;
      }
      const obj = JSON.parse(raw);
      if (!obj || typeof obj !== 'object') {
        return;
      }
      let loaded = 0;
      for (const [k, arr] of Object.entries(obj)) {
        const id = Number(k);
        if (Number.isNaN(id) || !Array.isArray(arr)) {
          continue;
        }
        const nm = String(arr[0] ?? '');
        const ic = arr[1] != null ? String(arr[1]) : '';
        if (nm && !isBadName(nm)) {
          nameCache.set(id, nm);
          loaded++;
        }
        if (ic) {
          iconCache.set(id, ic);
        }
      }
      if (loaded) {
        dbg('[Top] loaded name/icon cache entries:', loaded);
      }
    } catch {}
  })();
  // Cleanup: remove legacy rarity cache key from previous versions
  (function cleanupOldRarityLS() {
    try {
      localStorage.removeItem('eg_top_rarity_cache_v1');
    } catch {}
  })();
  const _fmtSold = (v) => {
    const n = Number(v);
    if (!Number.isFinite(n)) {
      return '0';
    }
    return Math.ceil(n).toLocaleString();
  };
  const _fmtPct = (v) => `${(Number(v) || 0).toFixed(1)}%`;

  // Persistence helpers for Top tab settings
  const LS = {
    source: 'eg_top_source',
    hours: 'eg_top_hours',
    limit: 'eg_top_limit',
    all: 'eg_top_all_catalog',
    inc0: 'eg_top_include_zero',
    minSold: 'eg_top_min_sold',
    quality: 'eg_top_quality',
  };

  // Helpers for negative cache (avoid spamming unresolved IDs)
  function _isNoNameBlocked(id) {
    const t = noNameUntil.get(id);
    if (!t) {
      return false;
    }
    if (Date.now() > t) {
      noNameUntil.delete(id);
      return false;
    }
    return true;
  }
  function _blockNoName(ids) {
    const until = Date.now() + NO_NAME_TTL_MS;
    ids.forEach((id) => noNameUntil.set(id, until));
  }

  // Batch-fetch names and icons for missing item IDs.
  // Returns number of new cache inserts (names or icons).
  async function fetchNamesIcons(ids) {
    try {
      return await window.EGTopServices.fetchNamesIcons(ids);
    } catch (e) {
      try {
        console.error('[Top] fetchNamesIcons failed', e);
      } catch {}
      return 0;
    }
  }

  // Toast + copy helpers (delegate to services when available)
  function _showToast(msg, ms = 1600) {
    try {
      // Services version already manages its own timeout
      window.EGTopServices.showToast(msg);
    } catch {}
    try {
      const el = document.getElementById('toast');
      if (!el) {
        return;
      }
      el.textContent = String(msg || '');
      el.classList.add('show');
      setTimeout(() => {
        try {
          el.classList.remove('show');
        } catch {}
      }, ms);
    } catch {}
  }
  async function _copyText(t) {
    try {
      return await window.EGTopServices.copyText(t);
    } catch {}
    try {
      if (navigator.clipboard && navigator.clipboard.writeText) {
        await navigator.clipboard.writeText(String(t));
        return true;
      }
    } catch {}
    try {
      const ta = document.createElement('textarea');
      ta.value = String(t);
      ta.setAttribute('readonly', '');
      ta.style.position = 'absolute';
      ta.style.left = '-9999px';
      document.body.appendChild(ta);
      ta.select();
      const ok = document.execCommand('copy');
      document.body.removeChild(ta);
      return !!ok;
    } catch {
      return false;
    }
  }

  function loadSettings() {
    try {
      const s = localStorage.getItem(LS.source);
      const h = localStorage.getItem(LS.hours);
      const l = localStorage.getItem(LS.limit);
      const a = localStorage.getItem(LS.all);
      const z = localStorage.getItem(LS.inc0);
      const m = localStorage.getItem(LS.minSold);
      const qv = localStorage.getItem(LS.quality);
      if (sourceEl && s) {
        sourceEl.value = s;
      }
      if (hoursEl) {
        hoursEl.value = String(Math.max(1, Math.min(336, Number(h || 48))));
      }
      // Enforce a sensible minimum to avoid tiny results
      const lim = Math.max(100, Math.min(5000, Number(l || 400)));
      if (limitEl) {
        limitEl.value = String(lim);
      }
      // Default catalog/zero to ON if not set yet
      if (allCatalogEl) {
        allCatalogEl.checked = a == null ? true : a === '1';
      }
      if (includeZeroEl) {
        includeZeroEl.checked = z == null ? true : z === '1';
      }
      if (minSoldEl) {
        minSoldEl.value = String(Math.max(0, Number(m || 0)));
      }
      if (qualityEl) {
        qualityEl.value = qv == null ? '' : String(qv);
      }
    } catch {}
  }

  function _persistSettings() {
    try {
      if (sourceEl) {
        localStorage.setItem(LS.source, String(sourceEl.value || ''));
      }
      if (hoursEl) {
        localStorage.setItem(LS.hours, String(hoursEl.value || ''));
      }
      if (limitEl) {
        localStorage.setItem(LS.limit, String(limitEl.value || ''));
      }
      if (allCatalogEl) {
        localStorage.setItem(LS.all, allCatalogEl.checked ? '1' : '0');
      }
      if (includeZeroEl) {
        localStorage.setItem(LS.inc0, includeZeroEl.checked ? '1' : '0');
      }
      if (minSoldEl) {
        localStorage.setItem(LS.minSold, String(minSoldEl.value || '0'));
      }
      if (qualityEl) {
        localStorage.setItem(LS.quality, String(qualityEl.value || ''));
      }
    } catch {}
  }

  async function getJSON(url) {
    try {
      return await window.EGTopServices.getJSON(url);
    } catch {}
    // Fallback: simple no-store GET with in-flight dedupe
    const reqUrl = new URL(url, window.location.origin);
    reqUrl.searchParams.set('_ts', String(Date.now()));
    const cacheKeyUrl = new URL(reqUrl);
    cacheKeyUrl.searchParams.delete('_ts');
    const key = cacheKeyUrl.toString();
    const existing = inflightCache.get(key);
    if (existing) {
      return existing;
    }
    const fetchPromise = (async () => {
      const res = await fetch(reqUrl.toString(), { cache: 'no-store' });
      if (!res.ok) {
        throw new Error(`GET ${url} -> ${res.status}`);
      }
      return res.json();
    })();
    inflightCache.set(key, fetchPromise);
    try {
      return await fetchPromise;
    } finally {
      inflightCache.delete(key);
    }
  }

  async function _postJSON(url, body) {
    try {
      return await window.EGTopServices.postJSON(url, body);
    } catch {}
    // Fallback POST
    const u = new URL(url, window.location.origin);
    u.searchParams.set('_ts', String(Date.now()));
    const res = await fetch(u.toString(), {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body || {}),
    });
    if (!res.ok) {
      throw new Error(`POST ${url} -> ${res.status}`);
    }
    return res.json();
  }

  function _fmtInt(n) {
    try {
      return window.EGTopServices.fmtInt(n);
    } catch {}
    return Math.round(Number(n) || 0).toLocaleString();
  }

  function _normalizeName(v) {
    try {
      return window.EGTopServices.normalizeName(v);
    } catch {}
    if (v == null) {
      return '';
    }
    if (typeof v === 'string') {
      return v;
    }
    if (typeof v === 'number') {
      return '';
    }
    try {
      return String(v);
    } catch {
      return '';
    }
  }

  // Skeleton loading helpers
  function _renderSkeleton(count = 10) {
    if (!rowsEl) {
      return;
    }
    rowsEl.innerHTML = '';
    for (let i = 0; i < count; i++) {
      const tr = document.createElement('tr');
      tr.className = 'skeleton-row';
      tr.innerHTML = `<td><span class="skeleton icon"></span><span class="skeleton" style="width:${120 + (i % 5) * 20}px"></span></td><td class="mono"><span class="skeleton" style="width:60px"></span></td>`;
      rowsEl.appendChild(tr);
    }
  }

  const _qualityLabel = (n) => {
    switch (Number(n) || 0) {
      case 0:
        return 'Poor';
      case 1:
        return 'Common';
      case 2:
        return 'Uncommon';
      case 3:
        return 'Rare';
      case 4:
        return 'Epic';
      case 5:
        return 'Legendary';
      default:
        return 'Common';
    }
  };

  // Legacy ESC-to-clear handler removed; controller owns search input behavior

  // Catalog search rendering removed (handled by controller)
  // Catalog search runner removed (handled by controller)
  // Catalog search listeners removed (handled by controller)
  // Filter/pagination event listeners removed — now centralized in EGTopController.attachHandlers()

  // Settings hydration is owned by EGTopController; only use legacy loadSettings if controller is unavailable
  try {
    const hasCtl = !!(
      window &&
      window.EGTopController &&
      typeof window.EGTopController.init === 'function'
    );
    if (!hasCtl) {
      loadSettings();
    }
    if (hasCtl) {
      window.EGTopController.init();
    }
  } catch {}

  // Helpers
  /** Max number of visible rows to inspect for a re-render nudge. */
  const VISIBLE_CHECK_LIMIT = 60;
  /** Selector to find visible item action buttons carrying data-id. */
  const TOOL_BTN_SELECTOR = '.tool-btn[data-act="copy"]';
  /**
   * Get a small list of currently visible item IDs from the DOM.
   * @param {number} limit
   * @returns {number[]}
   */
  function getVisibleItemIds(limit = VISIBLE_CHECK_LIMIT) {
    try {
      if (!rowsEl) {
        return [];
      }
      const btns = Array.from(rowsEl.querySelectorAll(TOOL_BTN_SELECTOR)).slice(
        0,
        Math.max(0, limit),
      );
      return btns.map((b) => Number(b.getAttribute('data-id'))).filter((n) => Number.isFinite(n));
    } catch {
      return [];
    }
  }

  /**
   * If visible rows benefit from newly applied meta, schedule a UI refresh.
   */
  function _nudgeRerenderIfVisibleBenefits() {
    try {
      const ids = getVisibleItemIds();
      const anyOk = ids.some(
        (id) => (!isBadName(nameCache.get(id)) && iconCache.has(id)) || qualityCache.has(id),
      );
      if (anyOk) {
        setTimeout(() => {
          try {
            if (
              window &&
              window.EGTopController &&
              typeof window.EGTopController.refresh === 'function'
            ) {
              return window.EGTopController.refresh(false);
            }
          } catch {}
          try {
            if (typeof window !== 'undefined' && typeof window.refresh === 'function') {
              window.refresh(false);
            }
          } catch {}
          return undefined;
        }, 0);
      }
    } catch {}
  }

  // Initial load: controller owns first refresh; legacy only if controller unavailable
  (async function initialLoad() {
    try {
      const hasCtl = !!(
        window &&
        window.EGTopController &&
        typeof window.EGTopController.refresh === 'function'
      );
      if (!hasCtl) {
        try {
          if (typeof window !== 'undefined' && typeof window.refresh === 'function') {
            await window.refresh(false);
          }
        } catch {}
      }
    } finally {
      _firstRun = false;
    }
  })();

  // Auto-refresh Top tab every 90s when visible (legacy fallback only)
  if (!(window && window.__egTopAutoRefresh__)) {
    const tabTop = document.getElementById('tab-top');
    setInterval(() => {
      const visible = tabTop && !tabTop.classList.contains('hidden');
      if (visible) {
        try {
          if (
            window &&
            window.EGTopController &&
            typeof window.EGTopController.refresh === 'function'
          ) {
            return window.EGTopController.refresh(false);
          }
        } catch {}
        try {
          if (typeof window !== 'undefined' && typeof window.refresh === 'function') {
            window.refresh(false);
          }
        } catch {}
      }
      return undefined;
    }, AUTO_REFRESH_MS);
  }

  // SSE subscription moved to controller

  // QA/Test hooks (non-intrusive): expose internals only when debug flag is on
  try {
    const dbgOn =
      typeof localStorage !== 'undefined' && localStorage.getItem('eg_debug_top') === '1';
    if (dbgOn) {
      const eg = (window.__egTest = window.__egTest || {});
      eg.fetchNamesIcons = fetchNamesIcons;
      eg.getJSON = getJSON;
      eg.nameCache = nameCache;
      eg.iconCache = iconCache;
      eg.qualityCache = qualityCache;
      // QA: manually unblock a specific ID from the no-name cooldown
      eg.unblockNoName = (raw) => {
        try {
          const nid = idNum(raw);
          if (nid != null) {
            noNameUntil.delete(nid);
          }
          return true;
        } catch {
          return false;
        }
      };
      // QA: wait until specified IDs have meta cached (or timeout)
      eg.waitItemMeta = async (ids, timeout = 5000) => {
        try {
          const start = Date.now();
          const arr = Array.from(
            new Set((Array.isArray(ids) ? ids : [ids]).map(idNum).filter((v) => v != null)),
          );
          const hasAll = () =>
            arr.every(
              (id) => (!isBadName(nameCache.get(id)) && iconCache.has(id)) || qualityCache.has(id),
            );
          if (hasAll()) {
            return true;
          }
          const waitOne = (id) =>
            new Promise((resolve) => {
              try {
                if (!isBadName(nameCache.get(id)) && iconCache.has(id)) {
                  return resolve(true);
                }
                let d = inflightItemMeta.get(id);
                if (!d) {
                  d = {};
                  d.p = new Promise((r) => (d.r = r));
                  inflightItemMeta.set(id, d);
                }
                d.p.then(() => resolve(true)).catch(() => resolve(false));
              } catch {
                resolve(false);
              }
              return undefined;
            });
          while (Date.now() - start < timeout) {
            if (hasAll()) {
              return true;
            }
            await Promise.race([
              Promise.all(arr.map(waitOne)),
              new Promise((r) => setTimeout(r, 150)),
            ]);
          }
          return hasAll();
        } catch {
          return false;
        }
      };
    }
  } catch {}

  // Export and Copy handlers
  function _getVisibleItems() {
    try {
      if (
        window &&
        window.EGTopRenderer &&
        typeof window.EGTopRenderer.getVisibleItems === 'function'
      ) {
        const arr = window.EGTopRenderer.getVisibleItems();
        return Array.isArray(arr) ? arr : [];
      }
    } catch {}
    return [];
  }
  function _getRealmLabel() {
    try {
      const el = document.getElementById('realmTop') || document.getElementById('realm');
      const txt = el && el.textContent ? el.textContent : '';
      const ls =
        typeof localStorage !== 'undefined' ? localStorage.getItem('eg_realm_label') || '' : '';
      const raw = txt || ls;
      const cleaned = String(raw)
        .replace(/^Realm\s*/, '')
        .replace(/[^A-Za-z0-9_-]+/g, '')
        .trim();
      return cleaned || null;
    } catch {
      return null;
    }
  }
  function _buildTopCsvFilename() {
    return window.EGTopServices.buildTopCsvFilename();
  }
  function _visibleToCSV() {
    const items = _getVisibleItems();
    return window.EGTopServices.itemsToCSV(items);
  }

  // JSON export helpers (used by Export JSON button and hotkey)
  function _buildTopJsonFilename() {
    return window.EGTopServices.buildTopJsonFilename();
  }

  function _visibleToJSON() {
    const items = _getVisibleItems();
    return window.EGTopServices.itemsToJSON(items);
  }

  // TSM group helpers (proper scope)
  function _buildTsmGroupText() {
    const items = _getVisibleItems();
    return window.EGTopServices.buildTsmGroupText(items);
  }

  // Legacy export/copy button listeners removed; handled by controller's attachHandlers()
})();
