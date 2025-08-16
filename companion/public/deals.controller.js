'use strict';

/* eslint-disable no-console */
(function () {
  function $(s) {
    return document.querySelector(s);
  }
  function on(el, ev, fn) {
    if (el) {
      el.addEventListener(ev, fn);
    }
  }

  const elDiscount = $('#discount');
  const elLimit = $('#limit');
  const elSlug = $('#slug');
  const elRefreshAuctions = $('#refreshAuctions');
  const elRefresh = $('#refresh');
  const elStatus = $('#status');
  const elRows = $('#rows');

  // lock to avoid concurrent requests
  let inFlight = false;

  function setBusy(b) {
    inFlight = !!b;
    if (elRefresh) {
      elRefresh.disabled = b;
    }
    if (elRefreshAuctions) {
      elRefreshAuctions.disabled = b;
    }
  }

  function updateStatus(text) {
    if (elStatus) {
      elStatus.textContent = text;
    }
  }

  function renderRows(items, meta) {
    // Chunked append to keep UI responsive
    let i = 0;
    const chunk = 60;
    function step() {
      const end = Math.min(i + chunk, items.length);
      let html = '';
      for (; i < end; i++) {
        html += window.EGDeals.rowHTML(items[i], meta);
      }
      elRows.insertAdjacentHTML('beforeend', html);
      if (i < items.length) {
        (window.requestIdleCallback || window.requestAnimationFrame)(step);
      }
    }
    step();
  }

  async function refreshDeals() {
    if (inFlight) {
      return;
    }
    setBusy(true);
    try {
      updateStatus('Loading…');
      elRows.innerHTML = '';
      const params = {
        discount: Number(elDiscount?.value || 0.3),
        limit: Number(elLimit?.value || 200),
        slug: String(elSlug?.value || '').trim(),
      };
      const { items, meta } = await window.EGDeals.fetchDeals(params, (t) =>
        updateStatus(t),
      );
      if (items.length === 0) {
        elRows.innerHTML =
          '<tr><td colspan="6" class="muted">No results. If auctions are not loaded yet, use Blizzard → Refresh, then retry.</td></tr>';
      } else {
        renderRows(items, meta);
      }
      updateStatus(`Results: ${items.length} (discount≤${(params.discount * 100).toFixed(0)}%)`);
    } catch (e) {
      console.warn(e);
      updateStatus('Error');
      elRows.innerHTML = `<tr><td colspan="6" class="muted">${(e && e.message) || String(
        e,
      )}</td></tr>`;
    } finally {
      setBusy(false);
    }
  }

  async function refreshAuctionsThenDeals() {
    if (inFlight) {
      return;
    }
    setBusy(true);
    try {
      updateStatus('Refreshing auctions…');
      const slug = String(elSlug?.value || '').trim();
      const data = await window.EGDeals.refreshAuctions(slug);
      updateStatus(
        `Auctions refreshed @ ${new Date((data.refreshedAt || 0) * 1000).toLocaleTimeString()}`,
      );
      // Immediately fetch deals after refresh
      await refreshDeals();
    } catch (e) {
      console.warn(e);
      updateStatus('Refresh auctions failed');
    } finally {
      setBusy(false);
    }
  }

  on(elRefresh, 'click', refreshDeals);
  on(elRefreshAuctions, 'click', refreshAuctionsThenDeals);

  // Auto-run once
  refreshDeals();
})();
