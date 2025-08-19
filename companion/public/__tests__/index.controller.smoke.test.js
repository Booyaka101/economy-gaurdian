import { describe, it, expect, beforeEach } from 'vitest';

function el(tag, attrs = {}, html = '') {
  const e = document.createElement(tag);
  Object.entries(attrs).forEach(([k, v]) => {
    if (k === 'class') {
      e.className = String(v || '');
    } else if (k in e) {
      try {
        e[k] = v;
      } catch {}
    } else {
      try {
        e.setAttribute(k, String(v));
      } catch {}
    }
  });
  if (html) {
    e.innerHTML = html;
  }
  return e;
}

describe('index.controller.js smoke', () => {
  let refreshCount;

  beforeEach(() => {
    document.body.innerHTML = '';
    refreshCount = 0;

    // Tabs and content areas
    const nav = el('div');
    const linkDeals = el('a', { id: 'tabLinkDeals' });
    const linkTop = el('a', { id: 'tabLinkTop' });
    nav.appendChild(linkDeals);
    nav.appendChild(linkTop);

    const tabDeals = el('div', { id: 'tab-deals' });
    const tabTop = el('div', { id: 'tab-top' });

    // Refresh button used when activating top tab
    const refreshTop = el('button', { id: 'refreshTop' });
    refreshTop.addEventListener('click', () => {
      refreshCount += 1;
    });

    // Net status element
    const net = el('div', { id: 'netStatus' });

    // Settings minimal elements
    const modal = el('div', { id: 'settingsModal' });
    const openBtn = el('button', { id: 'openSettings' });
    const closeBtn = el('button', { id: 'closeSettings' });
    const chk = el('input', { id: 'toggleRenderDebug', type: 'checkbox' });
    const chkTooltips = el('input', { id: 'toggleTooltips', type: 'checkbox' });
    const diagBtn = el('button', { id: 'btnDiag' });
    const clearBtn = el('button', { id: 'btnClearCaches' });
    const diagOut = el('pre', { id: 'diagOut' });

    document.body.appendChild(nav);
    document.body.appendChild(tabDeals);
    document.body.appendChild(tabTop);
    document.body.appendChild(refreshTop);
    document.body.appendChild(net);
    document.body.appendChild(modal);
    document.body.appendChild(openBtn);
    document.body.appendChild(closeBtn);
    document.body.appendChild(chk);
    document.body.appendChild(chkTooltips);
    document.body.appendChild(diagBtn);
    document.body.appendChild(clearBtn);
    document.body.appendChild(diagOut);

    // Stubs for caches and service worker used in diagnostics
    // eslint-disable-next-line no-undef
    globalThis.caches = {
      keys: async () => [],
      delete: async () => true,
    };
    Object.defineProperty(window.navigator, 'serviceWorker', {
      value: {
        getRegistrations: async () => [],
        controller: null,
      },
      configurable: true,
    });
  });

  it('initializes tabs to top, updates net status, and triggers top refresh', async () => {
    // Import side-effect module
    const mod = await import('../index.controller.js');
    expect(mod).toBeTruthy();

    const linkDeals = document.getElementById('tabLinkDeals');
    const linkTop = document.getElementById('tabLinkTop');
    const tabDeals = document.getElementById('tab-deals');
    const tabTop = document.getElementById('tab-top');

    // Default activation is top
    expect(linkTop.classList.contains('active')).toBe(true);
    expect(linkDeals.classList.contains('active')).toBe(false);
    expect(tabTop.classList.contains('hidden')).toBe(false);
    expect(tabDeals.classList.contains('hidden')).toBe(true);

    // Net status shows Online by default
    const net = document.getElementById('netStatus');
    expect(net.textContent).toBe('Online');

    // Default activation of top should have clicked refreshTop once
    expect(refreshCount).toBe(1);

    // Switch to deals then back to top; ensure refreshTop clicked again
    linkDeals.click();
    linkTop.click();
    expect(refreshCount).toBe(2);
  });
});
