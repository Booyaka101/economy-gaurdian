// Index Controller: tabs, net status, settings modal
(function () {
  const $ = (id) => document.getElementById(id);
  const on = (el, evt, fn, opts) => {
    if (el) {
      el.addEventListener(evt, fn, opts);
    }
  };

  function initTabs() {
    const linkDeals = $('tabLinkDeals');
    const linkTop = $('tabLinkTop');
    const tabDeals = $('tab-deals');
    const tabTop = $('tab-top');
    function activate(tab) {
      const isDeals = tab === 'deals';
      if (tabDeals) {
        tabDeals.classList.toggle('hidden', !isDeals);
      }
      if (tabTop) {
        tabTop.classList.toggle('hidden', isDeals);
      }
      if (linkDeals) {
        linkDeals.classList.toggle('active', isDeals);
      }
      if (linkTop) {
        linkTop.classList.toggle('active', !isDeals);
      }
      // trigger initial refresh for top tab if visible
      if (!isDeals) {
        const btn = $('refreshTop') || $('refresh');
        try {
          btn && btn.click();
        } catch {}
      }
    }
    on(linkDeals, 'click', () => activate('deals'));
    on(linkTop, 'click', () => activate('top'));
    // default
    activate('top');
  }

  function initNetStatus() {
    const netEl = $('netStatus');
    function updateNet() {
      if (!netEl) {
        return;
      }
      netEl.textContent = navigator.onLine ? 'Online' : 'Offline';
      netEl.style.color = navigator.onLine ? '' : '#ff9494';
    }
    on(window, 'online', updateNet);
    on(window, 'offline', updateNet);
    updateNet();
  }

  function initSettings() {
    const modal = $('settingsModal');
    const openBtn = $('openSettings');
    const closeBtn = $('closeSettings');
    const chk = $('toggleRenderDebug');
    const chkTooltips = $('toggleTooltips');
    const diagBtn = $('btnDiag');
    const clearBtn = $('btnClearCaches');
    const diagOut = $('diagOut');
    const open = () => {
      if (modal) {
        modal.style.display = 'flex';
      }
    };
    const close = () => {
      if (modal) {
        modal.style.display = 'none';
      }
    };
    on(openBtn, 'click', open);
    on(closeBtn, 'click', close);
    on(modal, 'click', (e) => {
      if (e.target === modal) {
        close();
      }
    });
    try {
      if (chk) {
        chk.checked = !!(localStorage.getItem('eg_debug_render') === '1');
      }
    } catch {}
    on(chk, 'change', () => {
      try {
        if (chk && chk.checked) {
          localStorage.setItem('eg_debug_render', '1');
        } else {
          localStorage.removeItem('eg_debug_render');
        }
      } catch {}
    });

    // Initialize tooltips checkbox from localStorage (eg_tooltips !== 'off' => enabled)
    try {
      if (chkTooltips) {
        chkTooltips.checked = (localStorage.getItem('eg_tooltips') || '') !== 'off';
      }
    } catch {}
    on(chkTooltips, 'change', () => {
      const enabled = !!(chkTooltips && chkTooltips.checked);
      try {
        if (enabled) {
          if (window.EGTooltips && typeof window.EGTooltips.enable === 'function') {
            window.EGTooltips.enable();
          } else {
            localStorage.removeItem('eg_tooltips');
            location.reload();
          }
        } else {
          if (window.EGTooltips && typeof window.EGTooltips.disable === 'function') {
            window.EGTooltips.disable();
          } else {
            localStorage.setItem('eg_tooltips', 'off');
            location.reload();
          }
        }
      } catch {}
    });

    // Diagnostics
    on(diagBtn, 'click', async () => {
      try {
        const regs =
          navigator.serviceWorker && navigator.serviceWorker.getRegistrations
            ? await navigator.serviceWorker.getRegistrations()
            : [];
        const active = regs && regs[0] && regs[0].active;
        const swInfo = {
          controller:
            navigator.serviceWorker && navigator.serviceWorker.controller
              ? navigator.serviceWorker.controller.scriptURL
              : null,
          active: active ? active.scriptURL : null,
          state: active ? active.state : null,
        };
        const cacheKeys = (await caches.keys()).sort();
        const tooltips =
          window.EGTooltips && typeof window.EGTooltips.info === 'function'
            ? window.EGTooltips.info()
            : null;
        const url = new URL(location.href);
        const whsrc = url.searchParams.get('whsrc') || null;
        const out = {
          time: new Date().toISOString(),
          location: location.pathname + location.search,
          whsrc,
          tooltips,
          serviceWorker: swInfo,
          caches: cacheKeys,
        };
        if (diagOut) {
          diagOut.textContent = JSON.stringify(out, null, 2);
        }
      } catch (e) {
        if (diagOut) {
          diagOut.textContent = 'Diagnostics error: ' + ((e && e.message) || e);
        }
      }
    });

    // Clear Cache Storage entries and reload
    on(clearBtn, 'click', async () => {
      try {
        const keys = await caches.keys();
        await Promise.all(keys.map((k) => caches.delete(k).catch(() => {})));
        location.reload();
      } catch (e) {
        if (diagOut) {
          diagOut.textContent = 'Clear caches error: ' + ((e && e.message) || e);
        }
      }
    });
  }

  // Defer init to DOMContentLoaded to ensure elements present
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', () => {
      initTabs();
      initNetStatus();
      initSettings();
    });
  } else {
    initTabs();
    initNetStatus();
    initSettings();
  }
})();
