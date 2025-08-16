import { describe, it, expect, beforeEach, vi } from 'vitest';

// Helper to create and attach an element
function el(tag, attrs = {}, html = '') {
  const e = document.createElement(tag);
  Object.entries(attrs).forEach(([k, v]) => {
    if (k === 'dataset' && v && typeof v === 'object') {
      Object.entries(v).forEach(([dk, dv]) => (e.dataset[dk] = dv));
    } else if (k === 'class') {
      e.className = String(v || '');
    } else if (k === 'style' && v && typeof v === 'object') {
      Object.assign(e.style, v);
    } else if (k in e) {
      try { e[k] = v; } catch {}
    } else {
      try { e.setAttribute(k, String(v)); } catch {}
    }
  });
  if (html) {
    e.innerHTML = html;
  }
  return e;
}

async function loadController() {
  // Reset ESM module cache for a clean import each test
  vi.resetModules();
  const mod = await import('../top.controller.js');
  return mod;
}

describe('EGTopController.attachHandlers()', () => {
  beforeEach(() => {
    // Fresh DOM
    document.body.innerHTML = '';
    // Prevent auto bootstrap in module side-effect
    globalThis.__EG_TOP_BOOTSTRAP__ = true;
    // Polyfill rAF/ric for renderer scheduling used during refresh
    if (!globalThis.requestAnimationFrame) {
      globalThis.requestAnimationFrame = (cb) => setTimeout(() => cb(performance.now()), 0);
    }
    if (!globalThis.cancelAnimationFrame) {
      globalThis.cancelAnimationFrame = (id) => clearTimeout(id);
    }
    if (!globalThis.requestIdleCallback) {
      globalThis.requestIdleCallback = (cb) => setTimeout(() => cb({ timeRemaining: () => 16 }), 1);
    }
    // Stub fetch to avoid real network
    globalThis.fetch = vi.fn().mockResolvedValue({ ok: true, json: async () => ({}) });

    // Minimal structure used by init() and handlers
    const app = el('div', { id: 'app' });

    // Rows container with one child to avoid auto-refresh in init()
    const table = el('table');
    const tbody = el('tbody', { id: 'rowsTop' });
    tbody.appendChild(el('tr'));
    table.appendChild(tbody);
    app.appendChild(table);

    // Status/footer (not required but harmless)
    app.appendChild(el('div', { id: 'statusTop' }));
    app.appendChild(el('div', { id: 'pageInfo' }));
    app.appendChild(el('div', { id: 'footerInfo' }));

    // Controls
    const source = el('select', { id: 'sourceTop' });
    source.appendChild(el('option', { value: 'region' }, 'Region'));
    source.appendChild(el('option', { value: 'local' }, 'Local'));
    app.appendChild(source);

    app.appendChild(el('div', { id: 'hoursTopWrap', style: { display: 'none' } }));
    app.appendChild(el('input', { id: 'hoursTop', value: '48' }));
    app.appendChild(el('input', { id: 'limitTop', value: '400' }));
    app.appendChild(el('input', { id: 'minSoldTop', value: '0' }));
    app.appendChild(el('select', { id: 'qualityTop' }));
    app.appendChild(el('input', { id: 'searchTop', type: 'text' }));
    app.appendChild(el('button', { id: 'clearSearchTop' }, 'Clear'));

    // Tab visibility element used by some features (hidden to avoid auto refresh)
    app.appendChild(el('div', { id: 'tab-top', class: 'hidden' }));

    document.body.appendChild(app);

    // Basic stubs
    globalThis.showToast = () => {};
    // Avoid EventSource ReferenceError
    globalThis.EventSource = class { addEventListener() {} close() {} };
  });

  it('toggles hours visibility when source changes', async () => {
    const { EGTopController } = await loadController();
    EGTopController.init();
    EGTopController.attachHandlers();

    const sourceEl = document.getElementById('sourceTop');
    const hoursWrapEl = document.getElementById('hoursTopWrap');

    // Start with region -> expect hidden
    sourceEl.value = 'region';
    sourceEl.dispatchEvent(new Event('change', { bubbles: true }));
    expect(hoursWrapEl.style.display).toBe('none');

    // Switch to local -> expect visible (empty string)
    sourceEl.value = 'local';
    sourceEl.dispatchEvent(new Event('change', { bubbles: true }));
    expect(hoursWrapEl.style.display).toBe('');
  });

  it('focuses search input on "/" shortcut and clears on Escape', async () => {
    const { EGTopController } = await loadController();
    EGTopController.init();
    EGTopController.attachHandlers();

    const searchEl = document.getElementById('searchTop');

    // Press "/" to focus search
    document.dispatchEvent(new KeyboardEvent('keydown', { key: '/', ctrlKey: false, shiftKey: false, bubbles: true }));
    expect(document.activeElement).toBe(searchEl);

    // Type text and press Escape to clear
    searchEl.value = 'hello';
    document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
    expect(searchEl.value).toBe('');
  });

  it('clears search input via clear button', async () => {
    const { EGTopController } = await loadController();
    EGTopController.init();
    EGTopController.attachHandlers();

    const searchEl = document.getElementById('searchTop');
    const clearBtn = document.getElementById('clearSearchTop');

    searchEl.value = 'abc';
    clearBtn.click();
    expect(searchEl.value).toBe('');
  });
});
