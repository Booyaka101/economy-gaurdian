'use strict';

(function () {
  /* eslint-disable no-console */
  const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

  function fmtGold(v) {
    const n = Number(v || 0);
    if (!Number.isFinite(n)) return '';
    const g = Math.floor(n / 10000);
    const s = Math.floor((n % 10000) / 100);
    const c = n % 100;
    return `${g.toLocaleString()}g ${String(s).padStart(2, '0')}s ${String(c).padStart(2, '0')}c`;
  }

  function rowHTML(x, meta) {
    const m = (meta && meta[x.itemId]) || {};
    const name = m.name || String(x.itemId);
    const icon = m.icon || '';
    const itemUrl = `https://www.wowhead.com/item=${x.itemId}`;
    const auc = String(x.auctionId || '');
    return `
      <tr>
        <td>
          <span class="item">
            ${icon ? `<img class="icon" src="${icon}" alt="">` : ''}
            <a href="${itemUrl}" target="_blank" rel="noreferrer">${name}</a>
          </span>
        </td>
        <td class="r">${fmtGold(x.unitPrice)}</td>
        <td class="r">${fmtGold(x.fair)}</td>
        <td class="r ${x.discountPct >= 50 ? 'danger' : (x.discountPct >= 30 ? 'g' : 'y')}">${x.discountPct.toFixed(2)}</td>
        <td class="r">${Number(x.quantity || 0).toLocaleString()}</td>
        <td class="muted">${auc}</td>
      </tr>
    `;
  }

  function parseRetryAfterSeconds(res) {
    const ra = res.headers && res.headers.get && res.headers.get('Retry-After');
    if (!ra) return null;
    const n = Number(ra);
    if (Number.isFinite(n)) return Math.max(0, Math.floor(n));
    const dt = Date.parse(ra);
    if (Number.isFinite(dt)) {
      const secs = Math.ceil((dt - Date.now()) / 1000);
      return Math.max(0, secs);
    }
    return null;
  }

  async function fetchJSONWithRetry(url, options, onStatus, maxAttempts = 4) {
    let attempt = 0;
    let lastText = '';
    while (attempt < maxAttempts) {
      attempt++;
      const res = await fetch(url, options);
      if (res.ok) {
        return { json: await res.json(), res };
      }
      lastText = await res.text().catch(() => '');
      if (res.status === 429 || res.status === 503) {
        const ra = parseRetryAfterSeconds(res);
        const base = ra != null ? ra * 1000 : Math.min(2000 * 2 ** (attempt - 1), 15000);
        const jitter = Math.floor(Math.random() * 400);
        const delay = base + jitter;
        const left = maxAttempts - attempt;
        if (left <= 0) break;
        if (typeof onStatus === 'function') {
          onStatus(`Rate limited – retrying in ${(delay / 1000).toFixed(1)}s (attempt ${
            attempt + 1
          }/${maxAttempts})`);
        }
        await sleep(delay);
        continue;
      }
      throw new Error(`${res.status} ${res.statusText} - ${lastText}`);
    }
    throw new Error(`429 Too Many Requests - ${lastText || 'Too many requests, please try again later.'}`);
  }

  async function fetchDeals(params, onStatus) {
    const discount = Math.max(0.01, Math.min(0.99, Number(params.discount || 0.3)));
    const limit = Math.max(1, Math.min(2000, Number(params.limit || 200)));
    const slug = String(params.slug || '').trim();
    const qs = new URLSearchParams({ discount: String(discount), limit: String(limit) });
    if (slug) qs.set('slug', slug);
    const { json: data } = await fetchJSONWithRetry(
      `/deals/snipe?${qs.toString()}`,
      { headers: { Accept: 'application/json' } },
      onStatus,
    );
    const items = Array.isArray(data.items) ? data.items : [];
    let meta = {};
    if (items.length) {
      try {
        const ids = [
          ...new Set(items.map((x) => Number(x.itemId)).filter((n) => Number.isFinite(n) && n > 0)),
        ];
        if (ids.length) {
          const resMeta = await fetch(`/blizzard/item-names?ids=${ids.join(',')}`, {
            headers: { Accept: 'application/json' },
          });
          if (resMeta.ok) {
            const j = await resMeta.json();
            meta = j.map || {};
          }
        }
      } catch {}
    }
    return { items, meta, discount };
  }

  async function refreshAuctions(slug) {
    const qs = new URLSearchParams();
    if (slug) qs.set('slug', slug);
    const res = await fetch(`/blizzard/auctions/refresh?${qs.toString()}`, {
      headers: { Accept: 'application/json' },
    });
    if (!res.ok) {
      const t = await res.text();
      throw new Error(`${res.status} ${res.statusText} - ${t}`);
    }
    const data = await res.json();
    return data;
  }

  window.EGDeals = {
    fmtGold,
    rowHTML,
    fetchDeals,
    refreshAuctions,
    fetchJSONWithRetry,
  };
})();
