// Centralized Service Worker registration for Economy Guardian
/* eslint-disable no-inner-declarations */
(() => {
  try {
    if (window.__EG_SW_INIT__) {return;}
    window.__EG_SW_INIT__ = true;

    // Ensure Night Owl + Command Palette are available regardless of SW support
    (function initCommon() {
      try {
        // Night Owl minimal utilities (global)
        if (!window.EGTheme) {window.EGTheme = {};}
        if (!window.EGTheme.applyNightOwl)
          {window.EGTheme.applyNightOwl = function (enabled) {
            try {
              const b = document.body;
              if (!b) {return;}
              b.classList.toggle('night-owl', !!enabled);
              let badge = document.getElementById('eg-owl-badge');
              if (enabled) {
                if (!badge) {
                  badge = document.createElement('div');
                  badge.id = 'eg-owl-badge';
                  badge.className = 'eg-owl-badge';
                  badge.textContent = 'Night Owl ✨';
                  document.body.appendChild(badge);
                }
              } else {
                try {
                  badge && badge.remove();
                } catch {}
              }
            } catch {}
          };}
        if (!window.EGTheme.getNightOwl)
          {window.EGTheme.getNightOwl = function () {
            try {
              return localStorage.getItem('eg_night_owl') === '1';
            } catch {
              return false;
            }
          };}
        if (!window.EGTheme.setNightOwl)
          {window.EGTheme.setNightOwl = function (v) {
            try {
              localStorage.setItem('eg_night_owl', v ? '1' : '0');
            } catch {}
          };}
        // High Contrast utilities (global)
        if (!window.EGTheme.applyHighContrast)
          {window.EGTheme.applyHighContrast = function (enabled) {
            try {
              const b = document.body;
              if (!b) {return;}
              b.classList.toggle('high-contrast', !!enabled);
            } catch {}
          };}
        if (!window.EGTheme.getHighContrast)
          {window.EGTheme.getHighContrast = function () {
            try {
              return localStorage.getItem('eg_high_contrast') === '1';
            } catch {
              return false;
            }
          };}
        if (!window.EGTheme.setHighContrast)
          {window.EGTheme.setHighContrast = function (v) {
            try {
              localStorage.setItem('eg_high_contrast', v ? '1' : '0');
            } catch {}
          };}
        // Expose convenience APIs
        try {
          window.EG = window.EG || {};
          if (!window.EG.toggleHighContrast)
            {window.EG.toggleHighContrast = () => {
              try {
                const next = !window.EGTheme.getHighContrast();
                window.EGTheme.setHighContrast(next);
                window.EGTheme.applyHighContrast(next);
              } catch {}
            };}
          if (!window.EG.isHighContrast)
            {window.EG.isHighContrast = () => {
              try {
                return !!window.EGTheme.getHighContrast();
              } catch {
                return false;
              }
            };}
          if (!window.EG.setHighContrast)
            {window.EG.setHighContrast = (v) => {
              try {
                window.EGTheme.setHighContrast(!!v);
                window.EGTheme.applyHighContrast(!!v);
              } catch {}
            };}
          // Night Owl convenience APIs for parity
          if (!window.EG.toggleNightOwl)
            {window.EG.toggleNightOwl = () => {
              try {
                const next = !window.EGTheme.getNightOwl();
                window.EGTheme.setNightOwl(next);
                window.EGTheme.applyNightOwl(next);
              } catch {}
            };}
          if (!window.EG.isNightOwl)
            {window.EG.isNightOwl = () => {
              try {
                return !!window.EGTheme.getNightOwl();
              } catch {
                return false;
              }
            };}
          if (!window.EG.setNightOwl)
            {window.EG.setNightOwl = (v) => {
              try {
                window.EGTheme.setNightOwl(!!v);
                window.EGTheme.applyNightOwl(!!v);
              } catch {}
            };}
        } catch {}

        // Apply themes on ready
        try {
          if (document.readyState === 'complete' || document.readyState === 'interactive') {
            window.EGTheme.applyNightOwl(window.EGTheme.getNightOwl());
            window.EGTheme.applyHighContrast(window.EGTheme.getHighContrast());
          } else {
            document.addEventListener(
              'DOMContentLoaded',
              () => {
                try {
                  window.EGTheme.applyNightOwl(window.EGTheme.getNightOwl());
                  window.EGTheme.applyHighContrast(window.EGTheme.getHighContrast());
                } catch {}
              },
              { once: true },
            );
          }
        } catch {}

        // Alt+N toggle (Night Owl)
        if (!window.__EG_OWL_KEYS__) {
          window.__EG_OWL_KEYS__ = true;
          document.addEventListener('keydown', (ev) => {
            try {
              if (
                (ev.key === 'n' || ev.key === 'N') &&
                ev.altKey &&
                !ev.ctrlKey &&
                !ev.metaKey &&
                !ev.shiftKey
              ) {
                const next = !window.EGTheme.getNightOwl();
                window.EGTheme.setNightOwl(next);
                window.EGTheme.applyNightOwl(next);
                ev.preventDefault();
                ev.stopPropagation();
              }
            } catch {}
          });
        }
        // Alt+H toggle (High Contrast)
        if (!window.__EG_HC_KEYS__) {
          window.__EG_HC_KEYS__ = true;
          document.addEventListener('keydown', (ev) => {
            try {
              if (
                (ev.key === 'h' || ev.key === 'H') &&
                ev.altKey &&
                !ev.ctrlKey &&
                !ev.metaKey &&
                !ev.shiftKey
              ) {
                const next = !window.EGTheme.getHighContrast();
                window.EGTheme.setHighContrast(next);
                window.EGTheme.applyHighContrast(next);
                ev.preventDefault();
                ev.stopPropagation();
              }
            } catch {}
          });
        }

        // Command Palette (Alt+K, ?, double Shift)
        if (!window.__EG_CMDK__) {
          window.__EG_CMDK__ = true;
          function h(tag, props = {}, children = []) {
            const el = document.createElement(tag);
            for (const k in props) {
              if (k === 'class') {el.className = props[k];}
              else if (k === 'text') {el.textContent = props[k];}
              else {el.setAttribute(k, props[k]);}
            }
            children.forEach((c) => el.appendChild(c));
            return el;
          }
          const overlay = h('div', { id: 'eg-cmdk-overlay', class: 'eg-cmdk-overlay', hidden: '' });
          const panel = h('div', {
            class: 'eg-cmdk',
            role: 'dialog',
            'aria-modal': 'true',
            'aria-label': 'Command Palette',
          });
          const header = h('header');
          const input = h('input', {
            id: 'eg-cmdk-input',
            type: 'text',
            placeholder: 'Type a command… (e.g. "settings", "night owl", "top")',
            'aria-label': 'Search commands',
          });
          const hint = h('div', {
            class: 'hint',
            text: 'Enter to run • Esc to close • ↑/↓ to navigate • Alt+K or double Shift to open',
          });
          header.appendChild(input);
          header.appendChild(hint);
          const list = h('div', { id: 'eg-cmdk-list', class: 'list', role: 'listbox' });
          panel.appendChild(header);
          panel.appendChild(list);
          overlay.appendChild(panel);
          if (document.body) {document.body.appendChild(overlay);}
          else
            {document.addEventListener(
              'DOMContentLoaded',
              () => {
                try {
                  document.body.appendChild(overlay);
                } catch {}
              },
              { once: true },
            );}

          function isTextFieldActive() {
            const a = document.activeElement;
            if (!a) {return false;}
            const t = (a.tagName || '').toLowerCase();
            return t === 'input' || t === 'textarea' || a.isContentEditable;
          }
          function open() {
            try {
              overlay.removeAttribute('hidden');
              input.value = '';
              filter('');
              input.focus();
              selected = 0;
              render();
            } catch {}
          }
          function close() {
            try {
              overlay.setAttribute('hidden', '');
            } catch {}
          }
          overlay.addEventListener('click', (e) => {
            if (e.target === overlay) {close();}
          });
          try {
            window.EG = window.EG || {};
            window.EG.openPalette = open;
            window.EG.closePalette = close;
          } catch {}

          function nav(url) {
            return () => {
              try {
                location.href = url;
              } catch {}
            };
          }
          function settings() {
            return () => {
              try {
                document.getElementById('settingsBtn')?.click();
              } catch {}
            };
          }
          function toggleTooltips() {
            return () => {
              try {
                const on = !window.EGTooltips?.state?.enabled;
                window.EGTooltips?.[on ? 'enable' : 'disable']?.('command-palette');
                localStorage.setItem('eg_tooltips', on ? '1' : '0');
              } catch {}
            };
          }
          function diagnostics() {
            return () => {
              try {
                document.getElementById('diagBtn')?.click();
              } catch {}
            };
          }
          function clearCaches() {
            return async () => {
              try {
                const ks = await caches.keys();
                await Promise.all(ks.map((k) => caches.delete(k)));
                location.reload();
              } catch {}
            };
          }
          function swUpdate() {
            return async () => {
              try {
                const reg = await navigator.serviceWorker.getRegistration();
                await reg?.update();
              } catch {}
            };
          }
          function nightOwl() {
            return () => {
              try {
                const next = !window.EGTheme.getNightOwl();
                window.EGTheme.setNightOwl(next);
                window.EGTheme.applyNightOwl(next);
              } catch {}
            };
          }
          function highContrast() {
            return () => {
              try {
                const next = !window.EGTheme.getHighContrast();
                window.EGTheme.setHighContrast(next);
                window.EGTheme.applyHighContrast(next);
              } catch {}
            };
          }
          function setWhsrc(v) {
            return () => {
              try {
                const u = new URL(location.href);
                if (v) {u.searchParams.set('whsrc', v);}
                else {u.searchParams.delete('whsrc');}
                location.href = u.toString();
              } catch {}
            };
          }
          function reload() {
            return () => {
              try {
                location.reload();
              } catch {}
            };
          }

          const commands = [
            { id: 'nav-top', label: 'Go to Top Sold', k: 'G T', run: nav('/top.html') },
            { id: 'nav-player', label: 'Go to Player', k: 'G P', run: nav('/player.html') },
            { id: 'nav-ai', label: 'Go to AI', k: 'G A', run: nav('/ai.html') },
            { id: 'open-settings', label: 'Open Settings', k: 'S', run: settings() },
            {
              id: 'toggle-tooltips',
              label: 'Toggle Wowhead Tooltips',
              k: 'T',
              run: toggleTooltips(),
            },
            {
              id: 'show-diagnostics',
              label: 'Show Diagnostics (in Settings)',
              k: 'D',
              run: diagnostics(),
            },
            { id: 'clear-caches', label: 'Clear Caches and Reload', k: '⌫', run: clearCaches() },
            {
              id: 'sw-update',
              label: 'Check for Updates (Service Worker)',
              k: 'U',
              run: swUpdate(),
            },
            { id: 'night-owl', label: 'Toggle Night Owl Mode', k: 'N', run: nightOwl() },
            {
              id: 'high-contrast',
              label: 'Toggle High Contrast Mode',
              k: 'H',
              run: highContrast(),
            },
            {
              id: 'whsrc-wowhead',
              label: 'Set Tooltip Source: wowhead',
              k: 'W',
              run: setWhsrc('wowhead'),
            },
            {
              id: 'whsrc-zamimg',
              label: 'Set Tooltip Source: zamimg',
              k: 'Z',
              run: setWhsrc('zamimg'),
            },
            { id: 'whsrc-off', label: 'Set Tooltip Source: off', k: 'O', run: setWhsrc('off') },
            {
              id: 'whsrc-clear',
              label: 'Clear Tooltip Source (?whsrc)',
              k: 'C',
              run: setWhsrc(null),
            },
            { id: 'reload', label: 'Reload Page', k: 'R', run: reload() },
          ];

          let results = commands.slice();
          let selected = 0;
          function filter(q) {
            const s = (q || '').toLowerCase().trim();
            results = !s
              ? commands.slice()
              : commands.filter((c) => c.label.toLowerCase().includes(s));
            selected = 0;
            render();
          }
          function render() {
            try {
              list.innerHTML = '';
              results.forEach((c, i) => {
                const item = h('div', {
                  class: 'item',
                  role: 'option',
                  'aria-selected': i === selected ? 'true' : 'false',
                });
                item.appendChild(h('div', { text: c.label }));
                item.appendChild(h('div', { class: 'k', text: c.k }));
                item.addEventListener('click', () => {
                  try {
                    c.run();
                  } catch {}
                  close();
                });
                list.appendChild(item);
              });
            } catch {}
          }
          input.addEventListener('input', () => filter(input.value));
          let lastShiftAt = 0;
          document.addEventListener('keydown', (ev) => {
            try {
              const k = ev.key;
              const now = Date.now();
              const isCmd =
                (ev.altKey && !ev.ctrlKey && !ev.metaKey && (k === 'k' || k === 'K')) ||
                (k === '?' && !ev.ctrlKey && !ev.metaKey && !ev.altKey);
              const isDoubleShift =
                k === 'Shift' &&
                !ev.ctrlKey &&
                !ev.metaKey &&
                !ev.altKey &&
                !isTextFieldActive() &&
                now - lastShiftAt < 350;
              if (!overlay || isTextFieldActive()) {
                if (k === 'Shift') {lastShiftAt = now;}
              }
              if ((isCmd || isDoubleShift) && !isTextFieldActive()) {
                ev.preventDefault();
                open();
                return;
              }
              if (k === 'Shift') {
                lastShiftAt = now;
              }
              if (overlay.hasAttribute('hidden')) {return;}
              if (k === 'Escape') {
                ev.preventDefault();
                close();
                return;
              }
              if (k === 'ArrowDown') {
                ev.preventDefault();
                selected = Math.min(selected + 1, Math.max(0, results.length - 1));
                render();
                return;
              }
              if (k === 'ArrowUp') {
                ev.preventDefault();
                selected = Math.max(0, selected - 1);
                render();
                return;
              }
              if (k === 'Enter') {
                ev.preventDefault();
                const c = results[selected];
                if (c) {
                  try {
                    c.run();
                  } catch {}
                  close();
                }
              }
            } catch {}
          });
        }
      } catch {}
    })();

    if ('serviceWorker' in navigator) {
      // Command Palette is consolidated in initCommon above.

      // Night Owl theme is initialized in initCommon and uses window.EGTheme utilities.

      function createUpdateBanner(onUpdate) {
        try {
          const bar = document.createElement('div');
          bar.id = 'eg-sw-update';
          bar.className = 'eg-sw-update';
          bar.setAttribute('role', 'status');
          bar.setAttribute('aria-live', 'polite');
          const msg = document.createElement('div');
          msg.textContent = 'An update is available.';
          const actions = document.createElement('div');
          actions.style.display = 'flex';
          actions.style.gap = '8px';
          const btn = document.createElement('button');
          btn.textContent = 'Update now';
          btn.className = 'eg-btn eg-btn--primary';
          const dismiss = document.createElement('button');
          dismiss.textContent = 'Dismiss';
          dismiss.className = 'eg-btn eg-btn--ghost';
          actions.appendChild(btn);
          actions.appendChild(dismiss);
          bar.appendChild(msg);
          bar.appendChild(actions);
          dismiss.addEventListener('click', () => {
            try {
              bar.remove();
            } catch {}
          });
          btn.addEventListener('click', () => {
            try {
              onUpdate && onUpdate();
              bar.remove();
            } catch {}
          });
          document.body.appendChild(bar);
          return bar;
        } catch {}
        return null;
      }

      function promptUpdate(reg) {
        const apply = () => {
          try {
            const waiting = reg.waiting;
            if (waiting) {waiting.postMessage('SKIP_WAITING');}
          } catch {}
        };
        createUpdateBanner(apply);
      }

      function watchForUpdates(reg) {
        if (!reg) {return;}
        // If a waiting worker already exists, prompt immediately
        try {
          if (reg.waiting) {promptUpdate(reg);}
        } catch {}
        // Update found listener
        try {
          reg.addEventListener('updatefound', () => {
            const installing = reg.installing;
            if (!installing) {return;}
            installing.addEventListener('statechange', () => {
              if (installing.state === 'installed' && navigator.serviceWorker.controller) {
                promptUpdate(reg);
              }
            });
          });
        } catch {}
      }

      // Reload once when controller changes to the new active SW
      let reloaded = false;
      try {
        navigator.serviceWorker.addEventListener('controllerchange', () => {
          if (reloaded) {return;}
          reloaded = true;
          try {
            location.reload();
          } catch {}
        });
      } catch {}

      window.addEventListener(
        'load',
        () => {
          try {
            const buildId =
              typeof window.EG_BUILD_ID !== 'undefined' && window.EG_BUILD_ID
                ? String(window.EG_BUILD_ID)
                : null;
            const url = buildId ? `/sw.js?v=${encodeURIComponent(buildId)}` : '/sw.js';
            navigator.serviceWorker
              .register(url)
              .then((reg) => {
                try {
                  watchForUpdates(reg);
                } catch {}
              })
              .catch(() => {});
          } catch {}
        },
        { once: true },
      );
    }
  } catch {}
})();
