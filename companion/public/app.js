(() => {
  const $ = (s) => document.querySelector(s);
  // Lightweight toast
  function _showToast(msg) {
    try {
      let el = document.getElementById('toast');
      if (!el) {
        el = document.createElement('div');
        el.id = 'toast';
        document.body.appendChild(el);
      }
      el.textContent = String(msg || '');
      el.classList.add('show');
      clearTimeout(_showToast._t);
      _showToast._t = setTimeout(() => el.classList.remove('show'), 2000);
    } catch {}
  }
  const fmtGold = (c) => {
    if (c == null) {
      return '-';
    }
    const g = Math.floor(c / 10000);
    const s = Math.floor((c % 10000) / 100);
    const ccp = Math.floor(c % 100);
    return `${g.toLocaleString()}g ${s}s ${ccp}c`;
  };
  const fmtPct = (x) => `${(x * 100).toFixed(1)}%`;

  const realmEl = $('#realm');
  const lastFetchedEl = $('#lastFetched');
  const rowsEl = $('#rows');
  const statusEl = $('#status');
  const _thead = document.querySelector('thead');
  const metricsEl = document.querySelector('#metrics');
  const searchDealsEl = document.getElementById('searchDeals');
  const dealsInfoEl = document.getElementById('dealsInfo');

  let lastDeals = [];
  let sortKey = 'pct';
  let sortDir = 'asc'; // 'asc' or 'desc'
  const nameCache = new Map(); // id -> name
  const iconCache = new Map(); // id -> icon url
  const DISPLAY_LIMIT = 400;

  function groupByItem(deals) {
    const map = new Map();
    for (const d of deals) {
      if (!d.itemId) {
        continue;
      }
      let g = map.get(d.itemId);
      if (!g) {
        g = { itemId: d.itemId, listings: 0, quantity: 0, best: null };
        map.set(d.itemId, g);
      }
      g.listings += 1;
      g.quantity += d.quantity || 0;
      if (!g.best || d.unitPrice < g.best.unitPrice) {
        g.best = d;
      }
    }
    const arr = [];
    for (const g of map.values()) {
      const unitPrice = g.best?.unitPrice || 0;
      const fair = g.best?.fair || 0;
      const pct = fair > 0 ? unitPrice / fair : 0;
      arr.push({
        itemId: g.itemId,
        listings: g.listings,
        quantity: g.quantity,
        unitPrice,
        fair,
        pct,
      });
    }
    return arr;
  }

  async function getJSON(url) {
    const res = await fetch(url);
    if (!res.ok) {
      throw new Error(`HTTP ${res.status}`);
    }
    return res.json();
  }

  function qsVal(id) {
    return encodeURIComponent($('#' + id).value.trim());
  }
  function qsNum(id) {
    return Number($('#' + id).value.trim());
  }

  async function refreshAuctions() {
    statusEl.textContent = 'Refreshing auctions...';
    try {
      const data = await getJSON('/blizzard/auctions?ttl=0');
      lastFetchedEl.textContent = `Auctions: ${new Date(data.lastFetched * 1000).toLocaleString()}`;
      statusEl.textContent = 'Auctions refreshed';
    } catch (e) {
      statusEl.textContent = `Failed to refresh auctions: ${e.message}`;
    }
  }

  async function refreshStatus() {
    try {
      const st = await getJSON('/integrations/status');
      const parts = [];
      if (st && st.blizzard) {
        parts.push(`Blizzard: ${st.blizzard.ok ? 'OK' : 'Err'}`);
      }
      if (st && st.tsm) {
        parts.push(`TSM: ${st.tsm.configured ? 'Configured' : 'Off'}`);
      }
      if (st && st.tuj) {
        parts.push(`TUJ: ${st.tuj.configured ? 'Configured' : 'Off'}`);
      }
      if (st && st.nexus) {
        parts.push(`NexusHub: ${st.nexus.configured ? 'Configured' : 'Off'}`);
      }
      statusEl.textContent = parts.join(' · ');
    } catch {
      statusEl.textContent = 'Status unavailable';
    }
  }

  function renderDeals() {
    rowsEl.innerHTML = '';
    const grouped = groupByItem(lastDeals);
    // Sort by current column
    grouped.sort((a, b) => {
      const k = sortKey;
      let va = a[k],
        vb = b[k];
      if (typeof va === 'string') {
        va = va.toLowerCase();
      }
      if (typeof vb === 'string') {
        vb = vb.toLowerCase();
      }
      if (va < vb) {
        return sortDir === 'asc' ? -1 : 1;
      }
      if (va > vb) {
        return sortDir === 'asc' ? 1 : -1;
      }
      return 0;
    });
    const total = grouped.length;
    // Apply search across ALL grouped items (by id or cached name)
    const q = ((searchDealsEl && searchDealsEl.value) || '').trim().toLowerCase();
    const filtered = q
      ? grouped.filter((g) => {
          const idMatch = String(g.itemId).includes(q);
          const nm = (nameCache.get(g.itemId) || '').toLowerCase();
          const nameMatch = nm.includes(q);
          return idMatch || nameMatch;
        })
      : grouped;

    // Enforce default display cap unless searching
    const toShow = q ? filtered : filtered.slice(0, DISPLAY_LIMIT);

    // Info text
    const showing = toShow.length;
    const processing = total > DISPLAY_LIMIT && !q;
    dealsInfoEl.textContent = `Showing ${showing} of ${total} items${processing ? ' · still processing… use search to find specific items' : ''}`;

    const missing = [];
    for (const d of toShow) {
      const tr = document.createElement('tr');
      const name = nameCache.get(d.itemId) || '';
      const icon = iconCache.get(d.itemId) || '';
      const title = name ? `${name} (${d.itemId})` : `${d.itemId}`;
      const img = icon
        ? `<img src="${icon}" alt="" width="18" height="18" style="vertical-align:-4px;margin-right:6px;border-radius:3px"/>`
        : '';
      const itemLink = `${img}<a class="mono" target="_blank" rel="noopener" href="https://www.wowhead.com/item=${d.itemId}">${title}</a>`;
      tr.innerHTML = `
        <td>${itemLink}</td>
        <td class="mono">${fmtGold(d.unitPrice)}</td>
        <td class="mono">${fmtGold(d.fair)}</td>
        <td class="mono">${fmtPct(d.pct)}</td>
        <td>${d.listings}</td>
        <td>${d.quantity}</td>
      `;
      rowsEl.appendChild(tr);
      if (!nameCache.has(d.itemId) || !iconCache.has(d.itemId)) {
        missing.push(d.itemId);
      }
    }

    // Lazy fetch names/icons only for the rows we actually showed (or filtered)
    (async () => {
      try {
        if (!missing.length) {
          return;
        }
        const resp = await getJSON(`/blizzard/item-names?ids=${missing.join(',')}`);
        if (resp && resp.names) {
          for (const [k, v] of Object.entries(resp.names)) {
            const id = Number(k);
            if (!Number.isNaN(id) && v) {
              nameCache.set(id, String(v));
            }
          }
        }
        if (resp && resp.icons) {
          for (const [k, v] of Object.entries(resp.icons)) {
            const id = Number(k);
            if (!Number.isNaN(id) && v) {
              iconCache.set(id, String(v));
            }
          }
        }
        // Re-render the currently visible set to show names/icons
        renderDeals();
      } catch {}
    })();
  }

  async function refreshDeals() {
    const params = new URLSearchParams();
    params.set('percent', qsNum('percent'));
    params.set('maxBuyout', Math.floor(qsNum('maxBuyout') * 10000));
    params.set('includeCommodities', qsVal('includeCommodities'));
    params.set('limit', qsNum('limit'));
    params.set('minListings', qsNum('minListings'));
    params.set('minQuantity', qsNum('minQuantity'));
    params.set('metric', qsVal('metric'));
    params.set('p', qsNum('p'));
    if ($('#includeItemIds').value.trim()) {
      params.set('includeItemIds', qsVal('includeItemIds'));
    }
    if ($('#excludeItemIds').value.trim()) {
      params.set('excludeItemIds', qsVal('excludeItemIds'));
    }
    if ($('#minTimeLeft').value) {
      params.set('minTimeLeft', qsVal('minTimeLeft'));
    }

    const url = `/deals/snipe?${params.toString()}`;
    statusEl.textContent = 'Loading deals...';
    try {
      const data = await getJSON(url);
      lastFetchedEl.textContent = `Auctions: ${new Date(data.lastFetched * 1000).toLocaleString()}`;
      realmEl.textContent = `Realm ${data.connectedRealmId ?? ''}`;
      statusEl.textContent = `Showing ${data.count} deals`;
      lastDeals = Array.isArray(data.deals) ? data.deals : [];
      // Do not fetch all names at once; render first 400, then lazy load names/icons for shown rows.
      renderDeals();
    } catch (e) {
      statusEl.textContent = `Failed to load deals: ${e.message}`;
    }
  }

  async function exportLua() {
    const params = new URLSearchParams();
    params.set('format', 'lua');
    params.set('metric', qsVal('metric'));
    params.set('p', qsNum('p'));
    const url = `/prices/export?${params.toString()}`;
    try {
      const res = await fetch(url);
      const text = await res.text();
      const blob = new Blob([text], { type: 'text/plain' });
      const a = document.createElement('a');
      a.href = URL.createObjectURL(blob);
      // Build descriptive filename: EG_Prices-[realm]-YYYYMMDD-HHMM.lua
      const realmTxt =
        (realmEl?.textContent || '').replace(/[^A-Za-z0-9_-]+/g, '').replace(/^Realm\s*/, '') ||
        'realm';
      const d = new Date();
      const pad = (n) => String(n).padStart(2, '0');
      const fname = `EG_Prices-${realmTxt}-${d.getFullYear()}${pad(d.getMonth() + 1)}${pad(d.getDate())}-${pad(d.getHours())}${pad(d.getMinutes())}.lua`;
      a.download = fname;
      a.click();
      URL.revokeObjectURL(a.href);
    } catch (e) {
      // eslint-disable-next-line no-alert
      alert('Export failed: ' + e.message);
    }
  }

  // Button bindings moved to controller

  // Sorting is controlled by controller via setSort/getSort
  // Simple debounce helper for search input
  function _debounce(fn, ms) {
    let t;
    return (...args) => {
      clearTimeout(t);
      t = setTimeout(() => fn(...args), ms);
    };
  }

  function applyPresetCommodity() {
    $('#percent').value = '0.40';
    $('#includeCommodities').value = '1';
    $('#minListings').value = '3';
    $('#minQuantity').value = '20';
    $('#metric').value = 'percentile';
    $('#p').value = '0.30';
  }
  function applyPresetItems() {
    $('#percent').value = '0.45';
    $('#includeCommodities').value = '0';
    $('#minListings').value = '2';
    $('#minQuantity').value = '1';
    $('#metric').value = 'percentile';
    $('#p').value = '0.35';
  }
  // Preset buttons bindings moved to controller

  // Metrics polling
  async function refreshMetrics() {
    try {
      const m = await getJSON('/metrics');
      const parts = [];
      if (m.auctions) {
        parts.push(
          `Auctions: refreshes ${m.auctions.refreshCount}, last ${m.auctions.lastDurationMs}ms${m.auctions.lastError ? ', err: ' + m.auctions.lastError : ''}`,
        );
      }
      if (m.prices) {
        parts.push(`Prices: builds ${m.prices.buildCount}, last ${m.prices.lastDurationMs}ms`);
      }
      if (m.requests) {
        parts.push(`Requests: snipe ${m.requests.snipeCount}, fair ${m.requests.fairValuesCount}`);
      }
      if (m.items) {
        parts.push(
          `Items: cache ${m.items.cacheSize || 0}, hits ${m.items.cacheHits || 0}, fetched ${m.items.fetchedCount || 0}`,
        );
      }
      metricsEl.textContent = parts.join(' · ');
    } catch {
      metricsEl.textContent = '';
    }
  }
  // Metrics polling moved to controller

  // Initial load is orchestrated by controller

  // Sorting API for controller
  function getSort() {
    return { key: sortKey, dir: sortDir };
  }
  function setSort(key) {
    if (!key) {
      return getSort();
    }
    if (sortKey === key) {
      sortDir = sortDir === 'asc' ? 'desc' : 'asc';
    } else {
      sortKey = key;
      sortDir = key === 'quantity' ? 'desc' : 'asc';
    }
    // Update header classes
    try {
      document
        .querySelectorAll('th[data-sort]')
        .forEach((el) => el.classList.remove('sort-asc', 'sort-desc'));
      const th = document.querySelector(`th[data-sort="${key}"]`);
      if (th) {
        th.classList.add(sortDir === 'asc' ? 'sort-asc' : 'sort-desc');
      }
    } catch {}
    renderDeals();
    return getSort();
  }

  // Service Worker registration moved to controller

  // Expose API for controller
  try {
    window.EGDeals = Object.freeze({
      refreshDeals,
      exportLua,
      refreshAuctions,
      renderDeals,
      applyPresetCommodity,
      applyPresetItems,
      refreshStatus,
      refreshMetrics,
      getSort,
      setSort,
    });
  } catch {}
})();
