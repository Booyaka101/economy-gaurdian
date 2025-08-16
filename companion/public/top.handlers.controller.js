// Top handlers controller: owns all DOM bindings for the Top tab (guardrail-compliant)
// Exports a dependency-injected attachHandlers; imported directly by top.controller.js

export function attachHandlers(deps = {}) {
  const {
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
  } = deps;

  function bindGlobalShortcuts() {
    try {
      if (!window.__egTopShortcuts__) {
        window.__egTopShortcuts__ = true;
        const isTypingTarget = (el) => {
          const tag = el && el.tagName ? el.tagName.toLowerCase() : '';
          const editable =
            el &&
            (el.isContentEditable ||
              (el.getAttribute && el.getAttribute('contenteditable') === 'true'));
          return editable || tag === 'input' || tag === 'textarea' || tag === 'select';
        };
        document.addEventListener('keydown', (ev) => {
          try {
            const k = ev.key;
            const ctrl = !!(ev.ctrlKey || ev.metaKey);
            const shift = !!ev.shiftKey;
            const target = ev.target;
            const typing = isTypingTarget(target);
            const lastVis = Array.isArray(window.lastVisible) ? window.lastVisible : [];

            if (!ctrl || !shift) {
              if (typing) {
                if (k !== 'Escape') {
                  return;
                }
              }
            }

            if (k === '/' && !ctrl && !shift && !typing) {
              const el = document.getElementById('searchTop') || document.getElementById('search');
              if (el) {
                try {
                  el.focus();
                  el.select && el.select();
                } catch {}
              }
              ev.preventDefault();
              ev.stopPropagation();
              return;
            }
            if (k === '?' && !ctrl && shift) {
              const btn = document.getElementById('helpTop') || document.getElementById('help');
              if (btn) {
                btn.click();
              } else {
                try {
                  if (window.showToast) {
                    window.showToast('Help not available');
                  }
                } catch {}
              }
              ev.preventDefault();
              ev.stopPropagation();
              return;
            }
            if (k === 'Escape' && !ctrl && !shift) {
              try {
                const helpModal = document.getElementById('helpModal');
                if (helpModal && !helpModal.hasAttribute('hidden')) {
                  helpModal.setAttribute('hidden', '');
                }
              } catch {}
              try {
                const searchEl =
                  document.getElementById('searchTop') || document.getElementById('search');
                if (searchEl && searchEl.value) {
                  searchEl.value = '';
                  setFilters({ query: '', offset: 0 });
                  refresh({ userTriggered: true });
                }
              } catch {}
              ev.preventDefault();
              ev.stopPropagation();
              return;
            }
            if (ctrl && shift && (k === 'E' || k === 'e')) {
              try {
                EGTopServices.exportCsv(lastVis);
              } catch {}
              ev.preventDefault();
              ev.stopPropagation();
              return;
            }
            if (ctrl && shift && (k === 'C' || k === 'c')) {
              try {
                EGTopServices.copyIds(lastVis);
              } catch {}
              ev.preventDefault();
              ev.stopPropagation();
              return;
            }
            if (ctrl && shift && (k === 'G' || k === 'g')) {
              try {
                EGTopServices.copyTsmGroup(lastVis);
              } catch {}
              ev.preventDefault();
              ev.stopPropagation();
              return;
            }
            if (ctrl && shift && (k === 'R' || k === 'r')) {
              try {
                if (window.EGTopRenderer && typeof window.EGTopRenderer.toggleDebug === 'function') {
                  window.EGTopRenderer.toggleDebug();
                }
              } catch {}
              ev.preventDefault();
              ev.stopPropagation();
              return;
            }
            if (ctrl && shift && (k === 'D' || k === 'd')) {
              try {
                window.__EG_TOP_DEBUG__ = !window.__EG_TOP_DEBUG__;
                if (window.showToast) {
                  window.showToast(window.__EG_TOP_DEBUG__ ? 'Top debug ON' : 'Top debug OFF');
                }
              } catch {}
              ev.preventDefault();
              ev.stopPropagation();
              return;
            }
          } catch {}
        });
      }
    } catch {}
  }

  function attachHandlersInternal() {
    bindGlobalShortcuts();
    const e = ControllerState.els;
    if (!e || !e.rowsEl) {
      init({});
    }
    // Persist subset of settings to localStorage for UX continuity (mirrors top.js keys)
    const persist = (k, v) => {
      try {
        localStorage.setItem(k, String(v));
      } catch {}
    };
    const debounce = (fn, ms = 200) => {
      let t;
      return (...a) => {
        try {
          clearTimeout(t);
        } catch {}
        t = setTimeout(() => fn(...a), ms);
      };
    };
    // One-time static item-meta bootstrap via services, then refresh if Top tab visible
    try {
      if (!window.__egTopMetaBoot__) {
        window.__egTopMetaBoot__ = true;
        const tabTop = document.getElementById('tab-top');
        (async () => {
          try {
            const ok = await EGTopServices.bootstrapItemMetaStatic();
            if (ok) {
              const visible = tabTop && !tabTop.classList.contains('hidden');
              if (visible) {
                try {
                  await refresh(false);
                } catch {}
              }
            }
          } catch {}
        })();
      }
    } catch {}
    // Filter and pagination controls (centralized)
    try {
      const {
        minSoldEl,
        qualityEl,
        searchEl,
        limitEl,
        hoursEl,
        hoursWrapEl,
        sourceEl,
        allCatalogEl,
        includeZeroEl,
      } = ControllerState.els;
      const prevBtn = document.getElementById('prevPage');
      const nextBtn = document.getElementById('nextPage');
      // Min sold
      if (minSoldEl && !minSoldEl.__egBound) {
        minSoldEl.__egBound = true;
        const onMinSold = () => {
          const v = Math.max(0, Number(minSoldEl.value || 0));
          setFilters({ minSold: v, offset: 0 });
          persist(LS.minSold, v);
          refresh({ userTriggered: true });
        };
        minSoldEl.addEventListener('change', onMinSold);
        minSoldEl.addEventListener('input', debounce(onMinSold, 200));
      }
      // Quality
      if (qualityEl && !qualityEl.__egBound) {
        qualityEl.__egBound = true;
        qualityEl.addEventListener('change', () => {
          const v = qualityEl.value;
          const q = v === '' ? null : Number(v);
          setFilters({ quality: q, offset: 0 });
          if (v === '') {
            persist(LS.quality, '');
          } else {
            persist(LS.quality, Number(q || 0));
          }
          refresh({ userTriggered: true });
        });
      }
      // Clear search button
      const clearBtn = document.getElementById('clearSearchTop');
      if (clearBtn && searchEl && !clearBtn.__egBound) {
        clearBtn.__egBound = true;
        clearBtn.addEventListener('click', () => {
          try {
            searchEl.value = '';
          } catch {}
          setFilters({ query: '', offset: 0 });
          refresh({ userTriggered: true });
        });
      }
      // Pagination: prev/next
      const getLimit = () => {
        try {
          return Math.max(100, Math.min(5000, Number(limitEl?.value || 400)));
        } catch {
          return 400;
        }
      };
      if (prevBtn && !prevBtn.__egBound) {
        prevBtn.__egBound = true;
        prevBtn.addEventListener('click', () => {
          const lim = getLimit();
          const cur = Number(ControllerState.filters.offset || 0);
          const offset = Math.max(0, cur - lim);
          setFilters({ offset });
          refresh({ userTriggered: true });
        });
      }
      if (nextBtn && !nextBtn.__egBound) {
        nextBtn.__egBound = true;
        nextBtn.addEventListener('click', () => {
          const lim = getLimit();
          const cur = Number(ControllerState.filters.offset || 0);
          const offset = cur + lim;
          setFilters({ offset });
          refresh({ userTriggered: true });
        });
      }
      // All catalog toggle
      if (allCatalogEl && !allCatalogEl.__egBound) {
        allCatalogEl.__egBound = true;
        allCatalogEl.addEventListener('change', () => {
          const useAll = !!allCatalogEl.checked;
          setFilters({ useAll, offset: 0 });
          persist(LS.all, useAll ? '1' : '0');
          refresh({ userTriggered: true });
        });
      }
      // Include zero toggle
      if (includeZeroEl && !includeZeroEl.__egBound) {
        includeZeroEl.__egBound = true;
        includeZeroEl.addEventListener('change', () => {
          const includeZero = !!includeZeroEl.checked;
          setFilters({ includeZero, offset: 0 });
          persist(LS.inc0, includeZero ? '1' : '0');
          refresh({ userTriggered: true });
        });
      }
      // Source toggle + hours visibility
      const toggleHours = () => {
        const v = sourceEl ? String(sourceEl.value || 'region') : 'region';
        if (hoursWrapEl) {
          hoursWrapEl.style.display = v === 'local' ? '' : 'none';
        }
      };
      if (sourceEl && !sourceEl.__egBound) {
        sourceEl.__egBound = true;
        sourceEl.addEventListener('change', () => {
          const source = String(sourceEl.value || 'local');
          setFilters({ source, offset: 0 });
          persist(LS.source, source);
          toggleHours();
          refresh({ userTriggered: true });
        });
        toggleHours();
      }
      // Hours
      if (hoursEl && !hoursEl.__egBound) {
        hoursEl.__egBound = true;
        const onHours = () => {
          const hours = Number(hoursEl.value || 48);
          setFilters({ hours, offset: 0 });
          persist(LS.hours, hours);
          refresh({ userTriggered: true });
        };
        hoursEl.addEventListener('change', onHours);
        hoursEl.addEventListener('input', debounce(onHours, 200));
      }
      // Limit
      if (limitEl && !limitEl.__egBound) {
        limitEl.__egBound = true;
        const onLimit = () => {
          const limit = Number(limitEl.value || 400);
          setFilters({ limit, offset: 0 });
          persist(LS.limit, limit);
          refresh({ userTriggered: true });
        };
        limitEl.addEventListener('change', onLimit);
        limitEl.addEventListener('input', debounce(onLimit, 200));
      }
    } catch {}
    // Refresh button
    try {
      const refreshBtn = document.getElementById('refreshTop') || document.getElementById('refresh');
      if (refreshBtn && !refreshBtn.__egBound) {
        refreshBtn.__egBound = true;
        refreshBtn.addEventListener('click', () => {
          try {
            refresh({ userTriggered: true });
          } catch {}
        });
      }
    } catch {}
    // Auto-refresh Top tab periodically when visible (controller-owned)
    try {
      const AUTO_REFRESH_MS = 90000;
      if (!window.__egTopAutoRefresh__) {
        window.__egTopAutoRefresh__ = true;
        const tabTop = document.getElementById('tab-top');
        setInterval(() => {
          try {
            const visible = tabTop && !tabTop.classList.contains('hidden');
            if (visible) {
              refresh(false);
            }
          } catch {}
        }, AUTO_REFRESH_MS);
      }
    } catch {}
    // Server-Sent Events: refresh on new auction snapshots (controller-owned)
    try {
      if (!window.__egTopSSE__) {
        window.__egTopSSE__ = true;
        const tabTop = document.getElementById('tab-top');
        const sseRefresh = debounce(() => {
          try {
            refresh(false);
          } catch {}
        }, 1500);
        const es = new EventSource('/events/auctions');
        es.addEventListener('message', (ev) => {
          try {
            const data = ev && ev.data ? JSON.parse(ev.data) : null;
            if (!data) {
              return;
            }
            if (data.type === 'change') {
              const visible = tabTop && !tabTop.classList.contains('hidden');
              if (visible) {
                sseRefresh();
              }
            }
          } catch {}
        });
        es.addEventListener('error', () => {
          /* allow browser to handle retries */
        });
      }
    } catch {}
    // Export/Copy buttons (CSV/JSON/IDs/TSM)
    try {
      const bindClick = (id, fn) => {
        const el = document.getElementById(id);
        if (el && !el.__egBound) {
          el.__egBound = true;
          el.addEventListener('click', fn);
        }
      };
      bindClick('exportTop', () => {
        try {
          const vis = Array.isArray(window.lastVisible) ? window.lastVisible : [];
          EGTopServices.exportCsv(vis);
        } catch {}
      });
      bindClick('exportJsonTop', () => {
        try {
          const vis = Array.isArray(window.lastVisible) ? window.lastVisible : [];
          EGTopServices.exportJson(vis);
        } catch {}
      });
      bindClick('copyIdsTop', async () => {
        try {
          const vis = Array.isArray(window.lastVisible) ? window.lastVisible : [];
          await EGTopServices.copyIds(vis);
        } catch {}
      });
      bindClick('copyTsmTop', async () => {
        try {
          const vis = Array.isArray(window.lastVisible) ? window.lastVisible : [];
          await EGTopServices.copyTsmGroup(vis);
        } catch {}
      });
    } catch {}
    // Search input (debounced)
    try {
      const searchEl = e.searchEl || document.getElementById('search');
      if (searchEl && !searchEl.__egBound) {
        searchEl.__egBound = true;
        const debounce = (fn, ms = 200) => {
          let t;
          return (...a) => {
            try {
              clearTimeout(t);
            } catch {}
            t = setTimeout(() => fn(...a), ms);
          };
        };
        const doRefresh = debounce(() => {
          try {
            setFilters({ query: String(searchEl.value || '').trim(), offset: 0 });
            refresh({ userTriggered: true });
          } catch {}
        }, 200);
        searchEl.addEventListener('input', () => doRefresh());
        searchEl.addEventListener('keydown', (ev) => {
          if (ev.key === 'Escape') {
            searchEl.value = '';
            doRefresh();
          }
        });
      }
    } catch {}
    // Sort header
    try {
      const rootTable = document.getElementById('topTable') || document.querySelector('table');
      const thead = rootTable ? rootTable.querySelector('thead') : document.querySelector('thead');
      if (thead && !thead.__egBound) {
        thead.__egBound = true;
        thead.addEventListener('click', (e) => {
          const th = e.target.closest && e.target.closest('th[data-sort]');
          if (!th) {
            return;
          }
          const key = th.getAttribute('data-sort');
          if (!key) {
            return;
          }
          const cur = ControllerState.sort;
          const dir = cur.key === key && cur.dir === 'desc' ? 'asc' : 'desc';
          setSort({ key, dir });
          setFilters({ offset: 0 });
          refresh({ userTriggered: true });
        });
      }
    } catch {}
    // Density toggle
    try {
      const densityBtn = document.getElementById('densityToggle');
      if (densityBtn && !densityBtn.__egBound) {
        densityBtn.__egBound = true;
        try {
          densityBtn.setAttribute('title', 'Toggle compact density');
        } catch {}
        densityBtn.addEventListener('click', () => {
          try {
            const root = document.body;
            if (!root) {
              return;
            }
            const cur = root.classList.contains('density-compact');
            const next = !cur;
            if (next) {
              root.classList.add('density-compact');
            } else {
              root.classList.remove('density-compact');
            }
            try {
              const btn = document.getElementById('densityToggle');
              if (btn) {
                btn.textContent = next ? 'Comfortable' : 'Compact';
              }
            } catch {}
            try {
              localStorage.setItem('eg_top_density_compact', next ? '1' : '0');
            } catch {}
          } catch {}
        });
      }
    } catch {}
    // Help modal (open/close + backdrop)
    try {
      const helpBtn = document.getElementById('helpTop') || document.getElementById('help');
      const helpModal = document.getElementById('helpModal');
      const helpModalBody = document.getElementById('helpModalBody');
      const helpModalClose = document.getElementById('helpModalClose');
      const openHelp = () => {
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
      };
      const closeHelp = () => {
        try {
          if (helpModal) {
            helpModal.setAttribute('hidden', '');
          }
        } catch {}
      };
      if (helpBtn && !helpBtn.__egBound) {
        helpBtn.__egBound = true;
        helpBtn.addEventListener('click', () => openHelp());
      }
      if (helpModalClose && !helpModalClose.__egBound) {
        helpModalClose.__egBound = true;
        helpModalClose.addEventListener('click', () => closeHelp());
      }
      if (helpModal && !helpModal.__egBackdrop) {
        helpModal.__egBackdrop = true;
        helpModal.addEventListener('click', (ev) => {
          if (ev.target === helpModal) {
            closeHelp();
          }
        });
      }
    } catch {}
    // Connectivity HUD (online/offline + periodic ping)
    try {
      const dot = document.getElementById('connDot');
      if (dot && !dot.__egConnBound) {
        dot.__egConnBound = true;
        let lastOnline = null;
        let lastPingMs = null;
        let lastPingAt = null;
        const fmtTime = (d) => {
          try {
            return d.toTimeString().slice(0, 8);
          } catch {
            return '';
          }
        };
        const setDot = (online) => {
          try {
            dot.classList.toggle('online', !!online);
            dot.classList.toggle('offline', !online);
            const title = online
              ? `Online${lastPingMs != null ? ` • ${lastPingMs} ms` : ''}${lastPingAt ? ` • ${fmtTime(lastPingAt)}` : ''}`
              : `Offline${lastPingAt ? ` • ${fmtTime(lastPingAt)}` : ''}`;
            try {
              dot.title = title;
            } catch {}
            if (lastOnline !== online) {
              lastOnline = online;
              try {
                if (typeof window.showToast === 'function') {
                  window.showToast(online ? 'Online' : 'Offline');
                }
              } catch {}
            }
          } catch {}
        };
        const pingOnce = async () => {
          try {
            const ctl = new AbortController();
            const t = setTimeout(() => ctl.abort(), 2500);
            try {
              const t0 =
                typeof performance !== 'undefined' && performance.now
                  ? performance.now()
                  : Date.now();
              const r = await fetch('/integrations/status', {
                cache: 'no-store',
                signal: ctl.signal,
              });
              clearTimeout(t);
              lastPingAt = new Date();
              lastPingMs = Math.max(
                0,
                Math.round(
                  (typeof performance !== 'undefined' && performance.now
                    ? performance.now()
                    : Date.now()) - t0,
                ),
              );
              setDot(r && r.ok);
              return;
            } catch {}
            // Fallback ping
            try {
              const t1 =
                typeof performance !== 'undefined' && performance.now
                  ? performance.now()
                  : Date.now();
              const r2 = await fetch('/blizzard/polling/status', { cache: 'no-store' });
              lastPingAt = new Date();
              lastPingMs = Math.max(
                0,
                Math.round(
                  (typeof performance !== 'undefined' && performance.now
                    ? performance.now()
                    : Date.now()) - t1,
                ),
              );
              setDot(r2 && r2.ok);
            } catch {
              setDot(false);
            }
          } catch {
            setDot(false);
          }
        };
        setDot(navigator.onLine);
        window.addEventListener('online', () => setDot(true));
        window.addEventListener('offline', () => setDot(false));
        // Periodic health check
        setInterval(() => {
          pingOnce().catch(() => {});
        }, 20000);
        // Initial ping shortly after load
        setTimeout(() => {
          pingOnce().catch(() => {});
        }, 1000);
      }
    } catch {}
    // Alerts (change-point detection)
    try {
      const alertsStatusEl = document.getElementById('alertsStatus');
      const alertsListEl = document.getElementById('alertsList');
      const refreshAlertsBtn = document.getElementById('refreshAlerts');
      const nameCache = EGTopServices.nameCache;
      const iconCache = EGTopServices.iconCache;
      const qualityCache = EGTopServices.qualityCache;
      const normalizeName = (s) => {
        try {
          return String(s || '').trim();
        } catch {
          return '';
        }
      };
      const refreshAlerts = async () => {
        try {
          if (!alertsStatusEl || !alertsListEl) {
            return;
          }
          alertsStatusEl.textContent = 'Loading surge alerts…';
          alertsListEl.innerHTML = '';
          const data = await svcGetJSON('/ml/detect/change-points?source=commodities&threshold=0.2');
          const events = Array.isArray(data?.events) ? data.events : [];
          if (!events.length) {
            alertsStatusEl.textContent = 'No notable changes right now';
            return;
          }
          alertsStatusEl.textContent = `${events.length} alerts`;
          const rows = events
            .slice(0, 50)
            .map((ev) => {
              const id = Number(ev.itemId);
              const nm = normalizeName(nameCache?.get(id) || id);
              const icon = iconCache?.get(id) || '';
              const ql = qualityCache?.has(id) ? Number(qualityCache.get(id)) : null;
              const iconCls = ql != null ? `icon q${ql}` : 'icon';
              const minPrev = Number(ev.minPricePrev || 0),
                minNow = Number(ev.minPriceNow || 0);
              const qtyPrev = Number(ev.qtyPrev || 0),
                qtyNow = Number(ev.qtyNow || 0);
              const minDelta = (minNow - minPrev) / Math.max(1, minPrev);
              const qtyDelta = (qtyNow - qtyPrev) / Math.max(1, qtyPrev);
              const sign = (v) => (v > 0 ? '+' : '');
              return `
              <div class="mono" style="display:flex; align-items:center; gap:8px; padding:6px 0; border-bottom:1px solid #1f2a44">
                ${icon ? `<img src="${icon}" alt="${nm || ''}" title="Quality ${ql != null ? ql : '?'}" width="18" height="18" class="${iconCls}"/>` : ''}
                <a href="https://www.wowhead.com/item=${id}" data-wowhead="item=${id}" target="_blank" rel="noopener" title="${nm || '(unknown)'} (ID ${id})">${nm || '(unknown)'} </a>
                <span class="quality-pill" title="Quality ${ql != null ? ql : '?'}">ID ${id}</span>
                <span style="flex:1"></span>
                <span title="Min price change">Min ${sign(minDelta)}${(minDelta * 100).toFixed(1)}%</span>
                <span title="Quantity change">Qty ${sign(qtyDelta)}${(qtyDelta * 100).toFixed(1)}%</span>
                <span title="Composite score">Score ${(Number(ev.score) || 0).toFixed(3)}</span>
                <button class="tool-btn" data-act="eta" data-id="${id}" title="Show posting ETA" aria-label="Show ETA for item ${id}">ETA</button>
                <button class="tool-btn" data-act="policy" data-id="${id}" title="Open AI assistant" aria-label="Open AI assistant for item ${id}">AI</button>
                <button class="tool-btn" data-act="copy" data-id="${id}" title="Copy item ID" aria-label="Copy item ID ${id}">Copy</button>
              </div>`;
            })
            .join('');
          alertsListEl.innerHTML = rows;
          try {
            if (window.$WowheadPower && typeof window.$WowheadPower.refreshLinks === 'function') {
              window.$WowheadPower.refreshLinks();
            }
          } catch {}
          try {
            const ids = events
              .slice(0, 100)
              .map((ev) => Number(ev.itemId))
              .filter(Boolean);
            if (ids.length) {
              EGTopServices.fetchNamesIcons(ids).catch(() => {});
            }
          } catch {}
        } catch (e) {
          if (alertsStatusEl) {
            alertsStatusEl.textContent = 'Failed to load alerts';
          }
        }
      };
      if (refreshAlertsBtn && !refreshAlertsBtn.__egBound) {
        refreshAlertsBtn.__egBound = true;
        refreshAlertsBtn?.addEventListener('click', refreshAlerts);
      }
      // Auto-load alerts shortly after page load
      setTimeout(refreshAlerts, 500);
      // Alerts list actions: Copy/ETA/Policy
      alertsListEl?.addEventListener('click', async (e) => {
        const tgt = e.target;
        if (!(tgt instanceof HTMLElement)) {
          return;
        }
        const id = tgt.getAttribute && tgt.getAttribute('data-id');
        // Copy ID
        if (tgt.matches('.tool-btn[data-act="copy"]')) {
          if (!id) {
            return;
          }
          const ok = await svcCopyText(id);
          if (ok && svcShowToast) {
            svcShowToast(`Copied item ID ${id}`);
          }
          return;
        }
        // ETA modal
        if (tgt.matches('.tool-btn[data-act="eta"]')) {
          if (!id) {
            return;
          }
          try {
            const hoursEl = document.getElementById('hoursTop');
            const hours = Number(hoursEl?.value || 48);
            const data = await svcGetJSON(
              `/market/eta?itemId=${encodeURIComponent(id)}&hoursWindow=${encodeURIComponent(hours)}`,
            );
            const ladder = Array.isArray(data?.ladderPreview) ? data.ladderPreview : [];
            const rows = ladder
              .slice(0, 8)
              .map(
                (r) =>
                  `<tr><td class="mono">${(r.price / 10000).toFixed(2)}g</td><td class="mono">${svcFmtInt(r.qty)}</td></tr>`,
              )
              .join('');
            const html = `
              <div style="display:flex; gap:12px; align-items:flex-start">
                <div style="flex:1">
                  <div><strong>Sold/Day:</strong> ${svcFmtInt(data?.soldPerDay)}</div>
                  <div><strong>Queue ahead:</strong> ${svcFmtInt(data?.queue?.aheadQty || 0)} · <strong>same price:</strong> ${svcFmtInt(data?.queue?.samePriceQty || 0)}</div>
                  <div><strong>ETA (P50):</strong> ${data?.etaHours?.p50 != null ? data.etaHours.p50 + 'h' : '—'} · <strong>P90:</strong> ${data?.etaHours?.p90 != null ? data.etaHours.p90 + 'h' : '—'}</div>
                </div>
                <div>
                  <table class="mono" style="font-size:12px"><thead><tr><th>Price</th><th>Qty</th></tr></thead><tbody>${rows}</tbody></table>
                </div>
              </div>`;
            try {
              if (window.openAIModal) {
                window.openAIModal(`ETA — Item ${id}`, html);
              }
            } catch {}
          } catch (err) {
            try {
              if (window.openAIModal) {
                window.openAIModal(
                  'ETA Error',
                  `<pre class="mono" style="white-space:pre-wrap">${String(err)}</pre>`,
                );
              }
            } catch {}
          }
          return;
        }
        // Policy modal
        if (tgt.matches('.tool-btn[data-act="policy"]')) {
          if (!id) {
            return;
          }
          try {
            const hoursEl = document.getElementById('hoursTop');
            const hours = Number(hoursEl?.value || 48);
            const body = { itemId: Number(id), targetHours: 12, maxStack: 200, hoursWindow: hours };
            const data = await svcPostJSON('/ml/policy/recommend', body);
            const rec = data?.recommend;
            const html = rec
              ? `
              <div><strong>Recommended price:</strong> ${(rec.price / 10000).toFixed(2)}g · <strong>Stack:</strong> ${svcFmtInt(rec.stack)}</div>
              <div><strong>ETA (P50):</strong> ${data?.etaHours?.p50 != null ? data.etaHours.p50 + 'h' : '—'} · <strong>P90:</strong> ${data?.etaHours?.p90 != null ? data.etaHours.p90 + 'h' : '—'}</div>
              <div class="status">Rationale: ${data?.rationale || '—'}</div>
            `
              : '<div>No viable policy recommendation at this time.</div>';
            try {
              if (window.openAIModal) {
                window.openAIModal(`Policy — Item ${id}`, html);
              }
            } catch {}
          } catch (err) {
            try {
              if (window.openAIModal) {
                window.openAIModal(
                  'Policy Error',
                  `<pre class="mono" style="white-space:pre-wrap">${String(err)}</pre>`,
                );
              }
            } catch {}
          }
          return;
        }
      });
    } catch {}
    // Row interactions (Copy/ETA/AI) and keyboard copy
    try {
      const rows = document.getElementById('rowsTop') || document.getElementById('rows');
      if (rows && !rows.__egRowBound) {
        rows.__egRowBound = true;
        rows.addEventListener('click', async (e) => {
          const tgt = e.target;
          if (!(tgt instanceof HTMLElement)) {
            return;
          }
          const id = tgt.getAttribute && tgt.getAttribute('data-id');
          // Copy ID
          if (tgt.matches('.tool-btn[data-act="copy"]')) {
            if (!id) {
              return;
            }
            const ok = await svcCopyText(id);
            if (ok) {
              svcShowToast && svcShowToast(`Copied item ID ${id}`);
            }
          }
          // Sell-through ETA
          if (tgt.matches('.tool-btn[data-act="eta"]')) {
            if (!id) {
              return;
            }
            try {
              const hours = Number(ControllerState.els.hoursEl?.value || 48);
              const data = await svcGetJSON(
                `/market/eta?itemId=${encodeURIComponent(id)}&hoursWindow=${encodeURIComponent(hours)}`,
              );
              const ladder = Array.isArray(data?.ladderPreview) ? data.ladderPreview : [];
              const rowsHtml = ladder
                .slice(0, 8)
                .map(
                  (r) =>
                    `<tr><td class="mono">${(r.price / 10000).toFixed(2)}g</td><td class="mono">${svcFmtInt(r.qty)}</td></tr>`,
                )
                .join('');
              const html = `
                <div style="display:flex; gap:12px; align-items:flex-start">
                  <div style="flex:1">
                    <div><strong>Sold/Day:</strong> ${svcFmtInt(data?.soldPerDay)}</div>
                    <div><strong>Queue ahead:</strong> ${svcFmtInt(data?.queue?.aheadQty || 0)} · <strong>same price:</strong> ${svcFmtInt(data?.queue?.samePriceQty || 0)}</div>
                    <div><strong>ETA (P50):</strong> ${data?.etaHours?.p50 != null ? data.etaHours.p50 + 'h' : '—'} · <strong>P90:</strong> ${data?.etaHours?.p90 != null ? data.etaHours.p90 + 'h' : '—'}</div>
                  </div>
                  <div>
                    <table class="mono" style="font-size:12px"><thead><tr><th>Price</th><th>Qty</th></tr></thead><tbody>${rowsHtml}</tbody></table>
                  </div>
                </div>`;
              try {
                window.openAIModal && window.openAIModal(`ETA — Item ${id}`, html);
              } catch {}
            } catch (err) {
              try {
                window.openAIModal &&
                  window.openAIModal(
                    'ETA Error',
                    `<pre class="mono" style="white-space:pre-wrap">${String(err)}</pre>`,
                  );
              } catch {}
            }
          }
          // Pricing policy recommendation
          if (tgt.matches('.tool-btn[data-act="policy"]')) {
            if (!id) {
              return;
            }
            try {
              const hours = Number(ControllerState.els.hoursEl?.value || 48);
              const body = { itemId: Number(id), targetHours: 12, maxStack: 200, hoursWindow: hours };
              const data = await svcPostJSON('/ml/policy/recommend', body);
              const rec = data?.recommend;
              const html = rec
                ? `
                <div><strong>Recommended price:</strong> ${(rec.price / 10000).toFixed(2)}g · <strong>Stack:</strong> ${svcFmtInt(rec.stack)}</div>
                <div><strong>ETA (P50):</strong> ${data?.etaHours?.p50 != null ? data.etaHours.p50 + 'h' : '—'} · <strong>P90:</strong> ${data?.etaHours?.p90 != null ? data.etaHours.p90 + 'h' : '—'}</div>
                <div class="status">Rationale: ${data?.rationale || '—'}</div>
              `
                : '<div>No viable policy recommendation at this time.</div>';
              try {
                window.openAIModal && window.openAIModal(`Policy — Item ${id}`, html);
              } catch {}
            } catch (err) {
              try {
                window.openAIModal &&
                  window.openAIModal(
                    'Policy Error',
                    `<pre class="mono" style="white-space:pre-wrap">${String(err)}</pre>`,
                  );
              } catch {}
            }
          }
        });
        // Keyboard: when a row is focused, press 'c' to copy ID
        rows.addEventListener('keydown', async (e) => {
          const tr =
            document.activeElement && document.activeElement.tagName === 'TR'
              ? document.activeElement
              : null;
          if (!tr) {
            return;
          }
          if (e.key && e.key.toLowerCase() === 'c') {
            const btn = tr.querySelector('.tool-btn[data-act="copy"]');
            const id = btn && btn.getAttribute('data-id');
            if (id) {
              const ok = await svcCopyText(id);
              if (ok) {
                svcShowToast && svcShowToast(`Copied item ID ${id}`);
              }
            }
          }
        });
      }
    } catch {}
    // Global keydown shortcuts
    try {
      if (!window.__egKeydownBound) {
        window.__egKeydownBound = true;
        window.addEventListener('keydown', (e) => {
          try {
            const ae = document.activeElement;
            const typing =
              ae &&
              (ae.tagName === 'INPUT' ||
                ae.tagName === 'TEXTAREA' ||
                (ae.getAttribute && ae.getAttribute('contenteditable') === 'true'));
            // ESC closes help + AI modals
            if (e.key === 'Escape') {
              try {
                const hm = document.getElementById('helpModal');
                if (hm && !hm.hasAttribute('hidden')) {
                  hm.setAttribute('hidden', '');
                }
              } catch {}
              try {
                if (window.closeAIModal) {
                  window.closeAIModal();
                }
              } catch {}
              return;
            }
            // '/' focuses search
            if (!typing && e.key === '/') {
              try {
                if (ControllerState.els.searchEl) {
                  ControllerState.els.searchEl.focus();
                }
              } catch {}
              e.preventDefault();
              return;
            }
            // '?' opens Help
            const isHelp = e.key === '?' || (e.shiftKey && e.key === '/');
            if (isHelp) {
              try {
                const btn = document.getElementById('helpTop');
                if (btn) {
                  btn.click();
                }
              } catch {}
              e.preventDefault();
              return;
            }
            // Ctrl+Shift+D: toggle eg_debug_top
            const isDbg =
              e.key && e.key.toLowerCase() === 'd' && e.ctrlKey === true && e.shiftKey === true;
            if (isDbg) {
              let next = '1';
              try {
                const cur =
                  typeof localStorage !== 'undefined' && localStorage.getItem('eg_debug_top') === '1';
                next = cur ? '0' : '1';
                localStorage.setItem('eg_debug_top', next);
              } catch {}
              try {
                const btn = document.getElementById('toggleDebugTop');
                if (btn) {
                  btn.textContent = next === '1' ? 'Debug ON' : 'Debug OFF';
                }
              } catch {}
              try {
                if (window.showToast) {
                  window.showToast(next === '1' ? 'Top debug ON' : 'Top debug OFF');
                }
              } catch {}
              e.preventDefault();
              return;
            }
            // Ctrl+Shift+J: export JSON via button
            const isExportJson =
              e.key && e.key.toLowerCase() === 'j' && e.ctrlKey === true && e.shiftKey === true;
            if (!typing && isExportJson) {
              try {
                const btn = document.getElementById('exportJsonTop');
                if (btn) {
                  btn.click();
                }
              } catch {}
              e.preventDefault();
              return;
            }
            // Ctrl+Shift+E: export CSV via button
            const isExportCsv =
              e.key && e.key.toLowerCase() === 'e' && e.ctrlKey === true && e.shiftKey === true;
            if (!typing && isExportCsv) {
              try {
                const btn = document.getElementById('exportTop');
                if (btn) {
                  btn.click();
                }
              } catch {}
              e.preventDefault();
              return;
            }
            // Ctrl+Shift+C: copy visible IDs via button
            const isCopyIds =
              e.key && e.key.toLowerCase() === 'c' && e.ctrlKey === true && e.shiftKey === true;
            if (!typing && isCopyIds) {
              try {
                const btn = document.getElementById('copyIdsTop');
                if (btn) {
                  btn.click();
                }
              } catch {}
              e.preventDefault();
              return;
            }
            // Ctrl+Shift+C: copy visible IDs
            if (
              !typing &&
              e.ctrlKey === true &&
              e.shiftKey === true &&
              e.key &&
              e.key.toLowerCase() === 'c'
            ) {
              try {
                const btn = document.getElementById('copyIdsTop');
                if (btn) {
                  btn.click();
                }
              } catch {}
              e.preventDefault();
              return;
            }
            // Ctrl+Shift+E: export visible CSV
            if (
              !typing &&
              e.ctrlKey === true &&
              e.shiftKey === true &&
              e.key &&
              e.key.toLowerCase() === 'e'
            ) {
              try {
                const btn = document.getElementById('exportTop');
                if (btn) {
                  btn.click();
                }
              } catch {}
              e.preventDefault();
              return;
            }
            // Shift+? shortcuts help toast
            if (!typing && e.shiftKey === true && (e.key === '?' || e.key === '/')) {
              try {
                const lines = [
                  'Shortcuts:',
                  ' • / focus search',
                  ' • Ctrl+Shift+D toggle debug',
                  ' • Ctrl+Shift+C copy visible IDs',
                  ' • Ctrl+Shift+E export CSV',
                  ' • Ctrl+Shift+G copy TSM group',
                ];
                if (svcShowToast) {
                  svcShowToast(lines.join('\n'));
                }
              } catch {}
              e.preventDefault();
              return;
            }
          } catch {}
        });
      }
    } catch {}

    // Catalog-wide search handlers (input/keydown + results click)
    try {
      const catalogSearchEl = document.getElementById('catalogSearch');
      const catalogResultsEl = document.getElementById('catalogResults');
      if (catalogSearchEl && !catalogSearchEl.__egBound) {
        catalogSearchEl.__egBound = true;
        const debounce = (fn, ms = 200) => {
          let t;
          return (...a) => {
            try {
              clearTimeout(t);
            } catch {}
            t = setTimeout(() => fn(...a), ms);
          };
        };
        const renderCatalogResults = (items) => {
          try {
            if (!catalogResultsEl) {
              return;
            }
            if (!items || !items.length) {
              catalogResultsEl.innerHTML = '';
              return;
            }
            const rows = items
              .map((it) => {
                const rawId = it.id != null ? it.id : it.itemId != null ? it.itemId : it.item?.id;
                const id = Number(rawId);
                const name = (it.name ?? it.itemName ?? it.item?.name ?? '').toString();
                const icon = (EGTopServices.iconCache?.get && EGTopServices.iconCache.get(id)) || '';
                const ql =
                  EGTopServices.qualityCache?.has && EGTopServices.qualityCache.has(id)
                    ? Number(EGTopServices.qualityCache.get(id))
                    : null;
                const iconCls = ql != null ? `icon q${ql}` : 'icon';
                const wh = `https://www.wowhead.com/item=${id}`;
                return `
                <div class="mono" style="display:flex; align-items:center; gap:8px; padding:6px 0; border-bottom:1px solid #1f2a44">
                  ${icon ? `<img src="${icon}" alt="${name || ''}" title="Quality ${ql != null ? ql : '?'}" width="18" height="18" class="${iconCls}"/>` : ''}
                  <a href="${wh}" data-wowhead="item=${id}" target="_blank" rel="noopener" title="${name || '(unknown)'} (ID ${id})">${name || '(unknown)'} </a>
                  <span class="quality-pill" title="Quality ${ql != null ? ql : '?'}">ID ${id}</span>
                  <span style="flex:1"></span>
                  <button class="tool-btn" data-act="copy-id" data-id="${id}" title="Copy item ID" aria-label="Copy item ID ${id}">Copy</button>
                  <a class="tool-btn" href="${wh}" target="_blank" rel="noopener">Wowhead</a>
                </div>`;
              })
              .join('');
            catalogResultsEl.innerHTML = rows;
            try {
              if (window.$WowheadPower && typeof window.$WowheadPower.refreshLinks === 'function') {
                window.$WowheadPower.refreshLinks();
              }
            } catch {}
          } catch {}
        };
        const runCatalogSearch = async (q) => {
          try {
            if (!q || q.length < 1) {
              if (catalogResultsEl) {
                catalogResultsEl.innerHTML = '';
              }
              return;
            }
            if (catalogResultsEl) {
              catalogResultsEl.textContent = 'Searching…';
            }
            let arr = [];
            try {
              arr = await EGTopServices.tryCatalogQueries(q);
            } catch {}
            // Normalize to {id,name}
            arr = Array.isArray(arr)
              ? arr.map((x) => ({
                  id: x.id ?? x.itemId ?? x.item?.id,
                  name: x.name ?? x.itemName ?? x.item?.name,
                }))
              : [];
            // Warm caches for icons/names if available
            try {
              const ids = arr.map((x) => Number(x.id)).filter(Boolean);
              if (ids.length) {
                EGTopServices.fetchNamesIcons(ids).catch(() => {});
              }
            } catch {}
            renderCatalogResults(arr);
          } catch {
            if (catalogResultsEl) {
              catalogResultsEl.textContent = 'Search failed';
            }
          }
        };
        const doSearch = debounce(
          () => runCatalogSearch(String(catalogSearchEl.value || '').trim()),
          200,
        );
        catalogSearchEl.addEventListener('input', () => doSearch());
        catalogSearchEl.addEventListener('keydown', (e) => {
          if (e.key === 'Escape') {
            catalogSearchEl.value = '';
            renderCatalogResults([]);
          }
        });
        if (catalogResultsEl && !catalogResultsEl.__egBound) {
          catalogResultsEl.__egBound = true;
          catalogResultsEl.addEventListener('click', async (e) => {
            const btn =
              e.target && e.target.closest && e.target.closest('.tool-btn[data-act="copy-id"]');
            if (btn) {
              const id = btn.getAttribute('data-id');
              if (id) {
                const ok = await svcCopyText(id);
                if (ok && svcShowToast) {
                  svcShowToast(`Copied item ID ${id}`);
                }
              }
              e.preventDefault();
              e.stopPropagation();
            }
          });
        }
        // Auto-run if URL provided a query (?q= or #q=)
        try {
          const u = new URL(window.location.href);
          const q1 = u.searchParams.get('q');
          const q2 = (u.hash || '').replace(/^#q=/, '');
          const initialQ = (q1 && q1.trim()) || (q2 && q2.trim()) || '';
          if (initialQ) {
            catalogSearchEl.value = initialQ;
            runCatalogSearch(initialQ);
          }
        } catch {}
      }
    } catch {}
    // Polling status widget (Blizzard items/commodities)
    try {
      const el = document.getElementById('pollingStatus');
      if (el && !el.__egPollingBound) {
        el.__egPollingBound = true;
        const fmtRel = (ts) => {
          try {
            const t = Number(ts);
            if (!Number.isFinite(t)) {
              return '';
            }
            const d = t > 1e12 ? new Date(t) : new Date(t * 1000);
            const diff = Date.now() - d.getTime();
            const abs = Math.abs(diff);
            const min = Math.round(abs / 60000);
            if (min < 1) {
              return diff >= 0 ? 'just now' : 'soon';
            }
            return diff >= 0 ? `${min}m ago` : `in ${min}m`;
          } catch {
            return '';
          }
        };
        const tick = async () => {
          try {
            el.textContent = 'Checking polling…';
            const r = await fetch('/blizzard/polling/status', { cache: 'no-store' });
            if (!r.ok) {
              el.textContent = 'Polling status unavailable';
              return;
            }
            const data = await r.json().catch(() => null);
            if (!data || typeof data !== 'object') {
              el.textContent = 'Polling status unavailable';
              return;
            }
            const parts = [];
            const sec = (k) => data[k] || {};
            const it = sec('items');
            const co = sec('commodities');
            const mk = (label, o) => {
              try {
                if (!o || typeof o !== 'object') {
                  return null;
                }
                const ls = o.lastSuccessAt ?? o.lastOkAt ?? o.lastSuccess ?? o.lastOk ?? o.last;
                const nx = o.nextRunAt ?? o.nextAt ?? o.next ?? o.nextPollAt;
                const st = o.status || o.state;
                const p = [label];
                if (st) {
                  p.push(String(st));
                }
                if (ls != null) {
                  p.push(`ok ${fmtRel(ls)}`);
                }
                if (nx != null) {
                  p.push(`next ${fmtRel(nx)}`);
                }
                return p.join(' • ');
              } catch {
                return null;
              }
            };
            const p1 = mk('Items', it);
            const p2 = mk('Commodities', co);
            if (p1) {
              parts.push(p1);
            }
            if (p2) {
              parts.push(p2);
            }
            el.textContent = parts.length ? parts.join('  |  ') : 'Polling status ready';
          } catch {
            el.textContent = 'Polling status unavailable';
          }
        };
        tick().catch(() => {});
        setInterval(() => {
          tick().catch(() => {});
        }, 15000);
      }
    } catch {}
    try {
      window.__EG_TOP_HANDLERS__ = true;
    } catch {}
  }

  attachHandlersInternal();
}
