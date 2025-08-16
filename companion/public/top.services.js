// Top Services (Phase 2/4): network helpers, shared caches, bootstrap/meta fetchers, and utilities
// Exposed both as ES module exports and on window.EGTopServices for classic scripts.

/** @typedef {{ itemId: number, itemName?: string, soldPerDay?: number, fromCatalog?: boolean }} TopItem */

const EGTopServices = (() => {
  // Shared caches
  const nameCache = new Map(); // id -> string
  const iconCache = new Map(); // id -> url
  const qualityCache = new Map(); // id -> number
  // Client-side ETag + response caches for GET JSON
  const etagCache = new Map(); // url -> etag
  const jsonCache = new Map(); // url -> json

  const LS_QUAL = 'eg_top_quality_cache_v1';
  const LS_BOOT = 'eg_top_bootstrap_v1';
  const LS_NAMEICON = 'eg_top_nameicon_cache_v1';

  function dbg(...args) {
    try {
      if (typeof localStorage !== 'undefined' && localStorage.getItem('eg_debug_top') === '1') {
        /* eslint-disable-next-line no-console */
        (console.debug || console.log).apply(console, args);
      }
    } catch {}
  }

  // ---------- Small utils shared by classic script ----------
  function normalizeName(s) {
    const str = String(s == null ? '' : s);
    return str.normalize ? str.normalize('NFKC') : str;
  }
  function isBadName(n) {
    const s = String(n == null ? '' : n).trim();
    if (!s) {
      return true;
    }
    if (s === '?' || /^\d+$/.test(s)) {
      return true;
    }
    return false;
  }
  function idNum(v) {
    const n = Number(v);
    return Number.isFinite(n) ? n : null;
  }

  async function getJSON(url, opts) {
    const headers = new Headers((opts && opts.headers) || {});
    // Add ETag
    try {
      const et = etagCache.get(url);
      if (et) {
        headers.set('If-None-Match', et);
      }
    } catch {}
    const res = await fetch(url, { ...opts, headers, cache: 'no-store' });
    if (res.status === 304) {
      const cached = jsonCache.get(url);
      if (cached !== undefined) {
        return cached;
      }
    }
    const et = res.headers && res.headers.get && res.headers.get('ETag');
    if (et) {
      etagCache.set(url, et);
    }
    if (!res.ok) {
      throw new Error(`GET ${url} -> ${res.status}`);
    }
    const j = await res.json();
    jsonCache.set(url, j);
    return j;
  }

  async function postJSON(url, body, opts) {
    const res = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', ...(opts && opts.headers) },
      body: JSON.stringify(body || {}),
    });
    if (!res.ok) {
      throw new Error(`POST ${url} -> ${res.status}`);
    }
    return res.json();
  }

  async function copyText(text) {
    try {
      if (navigator.clipboard && navigator.clipboard.writeText) {
        await navigator.clipboard.writeText(String(text));
        return true;
      }
    } catch {}
    // Fallback via execCommand
    try {
      const ta = document.createElement('textarea');
      ta.value = String(text);
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

  function showToast(msg) {
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
      }, 1500);
    } catch {}
  }

  function fmtInt(n) {
    const v = Number(n);
    if (!Number.isFinite(v)) {
      return '0';
    }
    return v.toLocaleString(undefined, { maximumFractionDigits: 0 });
  }

  // ---------- Export/Copy utilities ----------
  function getRealmLabel() {
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
  function buildTopCsvFilename() {
    const realm = getRealmLabel();
    const ts = new Date().toISOString().replace(/[:T]/g, '-').split('.')[0];
    return realm ? `top-sold-${realm}-${ts}.csv` : `top-sold-${ts}.csv`;
  }
  function buildTopJsonFilename() {
    const realm = getRealmLabel();
    const ts = new Date().toISOString().replace(/[:T]/g, '-').split('.')[0];
    return realm ? `top-sold-${realm}-${ts}.json` : `top-sold-${ts}.json`;
  }
  function itemsToCSV(items) {
    try {
      const rows = [['Item ID', 'Name', 'Sold/Day', 'Quality']];
      const arr = Array.isArray(items) ? items : [];
      for (const it of arr) {
        const id = idNum(it?.itemId);
        const name = normalizeName(id != null ? nameCache.get(id) : '');
        const ql = id != null && qualityCache.has(id) ? Number(qualityCache.get(id)) : '';
        rows.push([
          String(it?.itemId ?? ''),
          name,
          String(Math.ceil(Number(it?.soldPerDay) || 0)),
          String(ql),
        ]);
      }
      return rows
        .map((r) =>
          r
            .map((v) => {
              const s = String(v == null ? '' : v);
              return /[",\n]/.test(s) ? '"' + s.replace(/"/g, '""') + '"' : s;
            })
            .join(','),
        )
        .join('\n');
    } catch {
      return '';
    }
  }
  function itemsToJSON(items) {
    try {
      const arr = Array.isArray(items) ? items : [];
      return arr.map((it) => {
        const id = idNum(it?.itemId);
        const name = normalizeName(
          id != null ? nameCache.get(id) || it?.itemName || '' : it?.itemName || '',
        );
        const ql = id != null && qualityCache.has(id) ? Number(qualityCache.get(id)) : null;
        const itemId = id != null ? id : Number(it?.itemId) || null;
        return { itemId, itemName: name, soldPerDay: Number(it?.soldPerDay || 0), quality: ql };
      });
    } catch {
      return [];
    }
  }
  function buildTsmGroupText(items) {
    try {
      const realm = getRealmLabel();
      const ts = new Date().toISOString().replace(/[:T]/g, '-').split('.')[0];
      const header = realm ? `# TSM Group — ${realm} — ${ts}` : `# TSM Group — ${ts}`;
      const ids = Array.isArray(items)
        ? Array.from(new Set(items.map((x) => Number(x?.itemId)).filter(Boolean)))
        : [];
      const lines = ids.map((id) => `tsm:item:${id}`);
      return [header, ...lines].join('\n');
    } catch {
      return '# TSM Group';
    }
  }
  async function copyIds(items) {
    try {
      const arr = Array.isArray(items) ? items : [];
      if (!arr.length) {
        showToast && showToast('No items to copy');
        return false;
      }
      const ids = arr.map((x) => x.itemId).join(',');
      const ok = await copyText(ids);
      if (ok && showToast) {
        showToast(`Copied ${arr.length} IDs`);
      }
      return ok;
    } catch {
      return false;
    }
  }
  async function copyTsmGroup(items) {
    try {
      const arr = Array.isArray(items) ? items : [];
      if (!arr.length) {
        showToast && showToast('No items to copy');
        return false;
      }
      const text = buildTsmGroupText(arr);
      const ok = await copyText(text);
      if (ok && showToast) {
        showToast(`Copied TSM group (${arr.length} rows)`);
      }
      return ok;
    } catch {
      return false;
    }
  }
  function exportCsv(items) {
    try {
      const csv = itemsToCSV(items);
      if (!csv) {
        showToast && showToast('Nothing to export');
        return;
      }
      const blob = new Blob([csv], { type: 'text/csv;charset=utf-8' });
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = buildTopCsvFilename();
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      URL.revokeObjectURL(url);
      showToast && showToast('Exported CSV');
    } catch {}
  }
  function exportJson(items) {
    try {
      const arr = itemsToJSON(items);
      const blob = new Blob([JSON.stringify(arr, null, 2)], {
        type: 'application/json;charset=utf-8',
      });
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = buildTopJsonFilename();
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      URL.revokeObjectURL(url);
      showToast && showToast('Exported JSON');
    } catch {}
  }

  // ---------- Item-meta bootstrap + caches ----------
  const saveNameIconsDebounced = (() => {
    let t = null;
    const DEBOUNCE_MS = 800;
    return () => {
      try {
        if (t) {
          clearTimeout(t);
        }
      } catch {}
      t = setTimeout(() => {
        try {
          const out = {};
          const ids = new Set([...nameCache.keys(), ...iconCache.keys()]);
          const max = 8000;
          let i = 0;
          for (const id of ids) {
            if (i >= max) {
              break;
            }
            const nm = nameCache.get(id);
            const ic = iconCache.get(id);
            const bad = nm == null || isBadName(nm);
            if (!bad && ic) {
              out[id] = [nm, String(ic)];
              i++;
            }
          }
          localStorage.setItem(LS_NAMEICON, JSON.stringify(out));
        } catch {}
      }, DEBOUNCE_MS);
    };
  })();

  function loadNameIcons() {
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
        dbg('[Top][services] loaded name/icon cache entries:', loaded);
      }
    } catch {}
  }
  loadNameIcons();

  async function tryFetchJSON(urls) {
    for (const u of urls) {
      try {
        dbg('[Top] item-meta: trying', u);
        return await getJSON(u);
      } catch {}
    }
    return null;
  }

  const ITEM_META_URLS = [
    '/data/item-meta.json',
    '/item-meta.json',
    './data/item-meta.json',
    './item-meta.json',
  ];

  function applyItemMetaObject(obj) {
    if (!obj || typeof obj !== 'object') {
      return;
    }
    if (obj.names) {
      for (const [k, v] of Object.entries(obj.names)) {
        const id = Number(k);
        if (!Number.isNaN(id) && v) {
          nameCache.set(id, normalizeName(v));
        }
      }
    }
    if (obj.icons) {
      for (const [k, v] of Object.entries(obj.icons)) {
        const id = Number(k);
        if (!Number.isNaN(id) && v) {
          iconCache.set(id, String(v));
        }
      }
    }
    if (obj.qualities) {
      for (const [k, v] of Object.entries(obj.qualities)) {
        const id = Number(k);
        if (!Number.isNaN(id)) {
          qualityCache.set(id, Number(v) || 0);
        }
      }
      saveQualitiesDebounced();
    }
    if (obj.map && Array.isArray(obj.map)) {
      for (const it of obj.map) {
        try {
          const id = idNum(it?.id ?? it?.itemId ?? it?.item?.id);
          if (id == null) {
            continue;
          }
          const nm = normalizeName(it?.name ?? it?.itemName ?? it?.item?.name ?? '');
          if (nm && !isBadName(nm)) {
            nameCache.set(id, nm);
          }
          const ic = it?.icon ?? it?.item?.icon;
          if (ic) {
            iconCache.set(id, String(ic));
          }
          const ql = Number(it?.quality ?? it?.item?.quality);
          if (Number.isFinite(ql)) {
            qualityCache.set(id, ql);
          }
        } catch {}
      }
    }
    saveNameIconsDebounced();
  }

  function applyItemMeta(meta) {
    if (!meta) {
      return;
    }
    if (Array.isArray(meta)) {
      for (const it of meta) {
        try {
          const id = idNum(it?.id ?? it?.itemId ?? it?.item?.id);
          if (id == null) {
            continue;
          }
          const nm = normalizeName(it?.name ?? it?.itemName ?? it?.item?.name ?? '');
          if (nm && !isBadName(nm)) {
            nameCache.set(id, nm);
          }
          const ic = it?.icon ?? it?.item?.icon;
          if (ic) {
            iconCache.set(id, String(ic));
          }
          const ql = Number(it?.quality ?? it?.item?.quality);
          if (Number.isFinite(ql)) {
            qualityCache.set(id, ql);
          }
        } catch {}
      }
      saveNameIconsDebounced();
      saveQualitiesDebounced();
      return;
    }
    if (typeof meta === 'object') {
      applyItemMetaObject(meta);
    }
  }

  async function bootstrapItemMetaStatic() {
    try {
      const meta = await tryFetchJSON(ITEM_META_URLS);
      if (!meta) {
        return false;
      }
      applyItemMeta(meta);
      return true;
    } catch {
      return false;
    }
  }

  // ---------- Names/Icons/Qualities fetchers ----------
  const noNameUntil = new Map(); // id -> epoch ms cooldown
  const NO_NAME_TTL_MS = 10 * 60 * 1000;

  async function fetchNamesIcons(ids) {
    try {
      const unique = Array.from(new Set((ids || []).map(idNum).filter((v) => v != null)));
      const missing = unique.filter((id) => {
        const cached = nameCache.get(id);
        const badName = cached == null || isBadName(cached);
        const hasIcon = iconCache.has(id);
        return badName || !hasIcon;
      });
      if (!missing.length) {
        return 0;
      }
      // apply cooldown
      const now = Date.now();
      const toFetch = missing.filter((id) => (noNameUntil.get(id) || 0) <= now);
      if (!toFetch.length) {
        return 0;
      }
      // chunk
      const chunks = [];
      const CH = 100;
      for (let i = 0; i < toFetch.length; i += CH) {
        chunks.push(toFetch.slice(i, i + CH));
      }
      let newInserts = 0;
      for (const chunk of chunks) {
        try {
          // Names
          const resp = await getJSON(`/blizzard/item-names?ids=${chunk.join(',')}&lang=en_US`);
          if (resp && resp.names) {
            for (const [k, v] of Object.entries(resp.names)) {
              const id = Number(k);
              if (!Number.isNaN(id) && v) {
                const norm = normalizeName(v);
                const prev = nameCache.get(id);
                if (!prev || prev !== norm) {
                  newInserts += 1;
                }
                nameCache.set(id, norm);
              }
            }
          }
          // Icons + qualities from Blizzard helper response
          try {
            if (resp?.icons && typeof resp.icons === 'object') {
              for (const [k, v] of Object.entries(resp.icons)) {
                const id = Number(k);
                if (!Number.isNaN(id) && v) {
                  const val = String(v);
                  if (!iconCache.has(id) || iconCache.get(id) !== val) {
                    newInserts += 1;
                  }
                  iconCache.set(id, val);
                }
              }
            }
            if (resp?.qualities && typeof resp.qualities === 'object') {
              for (const [k, v] of Object.entries(resp.qualities)) {
                const id = Number(k);
                const ql = Number(v);
                if (!Number.isNaN(id) && Number.isFinite(ql)) {
                  qualityCache.set(id, ql);
                }
              }
            }
            // Fallback: apply flat map if provided
            if (resp?.map && typeof resp.map === 'object') {
              for (const [k, it] of Object.entries(resp.map)) {
                const id = Number(k);
                if (Number.isNaN(id)) {
                  continue;
                }
                const ic = it && it.icon ? String(it.icon) : '';
                const ql = Number(it && it.quality);
                if (ic) {
                  if (!iconCache.has(id) || iconCache.get(id) !== ic) {
                    newInserts += 1;
                  }
                  iconCache.set(id, ic);
                }
                if (Number.isFinite(ql)) {
                  qualityCache.set(id, ql);
                }
              }
            }
            saveQualitiesDebounced();
            saveNameIconsDebounced();
          } catch {}
          // Optional: prime names from local catalog bulk (no icons/qualities there)
          try {
            const r2 = await postJSON('/catalog/bulk', { ids: chunk });
            if (r2 && Array.isArray(r2.items)) {
              for (const it of r2.items) {
                const id = idNum(it?.id ?? it?.itemId ?? it?.item?.id);
                if (id == null) {
                  continue;
                }
                const nm = normalizeName(it?.name ?? it?.item?.name ?? '');
                if (nm && !isBadName(nm)) {
                  const prev = nameCache.get(id);
                  if (!prev || prev !== nm) {
                    newInserts += 1;
                  }
                  nameCache.set(id, nm);
                }
              }
              saveNameIconsDebounced();
            }
          } catch {}
        } catch (e) {
          // Mark cooldown for each failed id
          const until = Date.now() + NO_NAME_TTL_MS;
          for (const id of chunk) {
            noNameUntil.set(id, until);
          }
        }
      }
      return newInserts;
    } catch {
      return 0;
    }
  }

  // ---------- Catalog search helpers ----------
  async function tryCatalogQueries(q) {
    try {
      const raw = String(q || '').trim();
      if (!raw) {
        return [];
      }
      const toks = Array.from(
        new Set(
          raw
            .toLowerCase()
            .split(/\s+/)
            .filter((s) => s && s.length >= 2),
        ),
      );
      const variants = [raw];
      for (const t of toks) {
        variants.push(t);
      }
      if (toks.length > 1) {
        variants.push(toks.join('-'));
      }
      const seen = new Set();
      const merged = [];
      for (const v of variants) {
        try {
          const url = `/catalog/search?q=${encodeURIComponent(v)}&limit=50`;
          const resp = await getJSON(url);
          let arr = [];
          if (Array.isArray(resp)) {
            arr = resp;
          } else if (Array.isArray(resp?.items)) {
            arr = resp.items;
          } else if (Array.isArray(resp?.results)) {
            arr = resp.results;
          } else if (resp?.data && Array.isArray(resp.data.items)) {
            arr = resp.data.items;
          }
          for (const x of arr) {
            const id = Number(x?.id ?? x?.itemId ?? x?.item?.id);
            if (!Number.isFinite(id) || seen.has(id)) {
              continue;
            }
            seen.add(id);
            merged.push(x);
          }
        } catch {}
      }
      dbg('[Top][services] tryCatalogQueries', {
        q: raw,
        variants: variants.length,
        results: merged.length,
      });
      return merged;
    } catch {
      return [];
    }
  }

  async function fetchCatalogExtras(query, baseItems) {
    try {
      let arr = await tryCatalogQueries(query);
      if (!Array.isArray(arr) || arr.length === 0) {
        // client-side fallback using nameCache
        try {
          const raw = String(query || '')
            .toLowerCase()
            .trim();
          const toks = Array.from(new Set(raw.split(/\s+/).filter((s) => s && s.length >= 2)));
          const baseSet = new Set(
            (Array.isArray(baseItems) ? baseItems : []).map((it) => Number(it.itemId || 0)),
          );
          const found = [];
          for (const [id, nm] of nameCache.entries()) {
            const s = String(nm || '').toLowerCase();
            let ok = true;
            for (const t of toks) {
              if (!s.includes(t)) {
                ok = false;
                break;
              }
            }
            if (ok && !baseSet.has(id)) {
              found.push({ id, name: nm });
            }
            if (found.length >= 50) {
              break;
            }
          }
          arr = found;
          dbg('[Top][services] local fallback search used', { query: raw, results: found.length });
        } catch {}
      }
      const extras = (Array.isArray(arr) ? arr : [])
        .map((x) => ({
          id: x.id ?? x.itemId ?? x.item?.id,
          name: x.name ?? x.itemName ?? x.item?.name,
        }))
        .filter((x) => x.id != null)
        .filter(
          (x) =>
            !(Array.isArray(baseItems) ? baseItems : []).find((it) => it.itemId === Number(x.id)),
        )
        .map((x) => ({ itemId: Number(x.id), itemName: x.name, soldPerDay: 0, fromCatalog: true }));
      return extras;
    } catch {
      return [];
    }
  }

  // Health ping util
  async function ping(url, timeoutMs = 2500) {
    const ctl = new AbortController();
    const t = setTimeout(() => ctl.abort(), timeoutMs);
    try {
      const r = await fetch(url, { cache: 'no-store', signal: ctl.signal });
      return !!(r && r.ok);
    } finally {
      clearTimeout(t);
    }
  }

  // Persist/load qualities to LS
  function saveQualitiesDebounced() {
    try {
      const obj = {};
      for (const [k, v] of qualityCache.entries()) {
        obj[k] = v;
      }
      localStorage.setItem(LS_QUAL, JSON.stringify(obj));
    } catch {}
  }
  function loadQualities() {
    try {
      const raw = localStorage.getItem(LS_QUAL);
      if (!raw) {
        return;
      }
      const obj = JSON.parse(raw);
      if (obj && typeof obj === 'object') {
        for (const [k, v] of Object.entries(obj)) {
          qualityCache.set(Number(k), Number(v));
        }
      }
    } catch {}
  }
  loadQualities();

  return {
    // caches
    nameCache,
    iconCache,
    qualityCache,
    etagCache,
    jsonCache,
    // storage keys
    LS_QUAL,
    LS_BOOT,
    LS_NAMEICON,
    // net
    getJSON,
    postJSON,
    ping,
    // utils
    copyText,
    showToast,
    fmtInt,
    normalizeName,
    isBadName,
    idNum,
    // export/copy utils
    getRealmLabel,
    buildTopCsvFilename,
    buildTopJsonFilename,
    itemsToCSV,
    itemsToJSON,
    buildTsmGroupText,
    copyIds,
    copyTsmGroup,
    exportCsv,
    exportJson,
    // bootstrap/meta
    tryFetchJSON,
    ITEM_META_URLS,
    applyItemMetaObject,
    applyItemMeta,
    bootstrapItemMetaStatic,
    // item meta fetchers
    fetchNamesIcons,
    fetchCatalogExtras,
    tryCatalogQueries,
    // persist
    saveQualitiesDebounced,
    saveNameIconsDebounced,
  };
})();

// Attach to window for classic script access
try {
  window.EGTopServices = EGTopServices;
} catch {}

export const nameCache = EGTopServices.nameCache;
export const iconCache = EGTopServices.iconCache;
export const qualityCache = EGTopServices.qualityCache;
export const getJSON = EGTopServices.getJSON;
export const postJSON = EGTopServices.postJSON;
export const copyText = EGTopServices.copyText;
export const showToast = EGTopServices.showToast;
export const fmtInt = EGTopServices.fmtInt;
export const normalizeName = EGTopServices.normalizeName;
export const isBadName = EGTopServices.isBadName;
export const idNum = EGTopServices.idNum;
export const getRealmLabel = EGTopServices.getRealmLabel;
export const buildTopCsvFilename = EGTopServices.buildTopCsvFilename;
export const buildTopJsonFilename = EGTopServices.buildTopJsonFilename;
export const itemsToCSV = EGTopServices.itemsToCSV;
export const itemsToJSON = EGTopServices.itemsToJSON;
export const buildTsmGroupText = EGTopServices.buildTsmGroupText;
export const copyIds = EGTopServices.copyIds;
export const copyTsmGroup = EGTopServices.copyTsmGroup;
export const exportCsv = EGTopServices.exportCsv;
export const exportJson = EGTopServices.exportJson;
export const tryFetchJSON = EGTopServices.tryFetchJSON;
export const ITEM_META_URLS = EGTopServices.ITEM_META_URLS;
export const applyItemMetaObject = EGTopServices.applyItemMetaObject;
export const applyItemMeta = EGTopServices.applyItemMeta;
export const bootstrapItemMetaStatic = EGTopServices.bootstrapItemMetaStatic;
export const fetchNamesIcons = EGTopServices.fetchNamesIcons;
export const fetchCatalogExtras = EGTopServices.fetchCatalogExtras;
export const tryCatalogQueries = EGTopServices.tryCatalogQueries;
export const saveQualitiesDebounced = EGTopServices.saveQualitiesDebounced;
export const saveNameIconsDebounced = EGTopServices.saveNameIconsDebounced;
export const ping = EGTopServices.ping;
export default EGTopServices;
