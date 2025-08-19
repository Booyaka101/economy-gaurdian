import { describe, it, expect, beforeEach, vi } from 'vitest';

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

describe('EGTopController.init hydration', () => {
  beforeEach(() => {
    vi.resetModules();
    document.body.innerHTML = '';
    try { localStorage.clear(); } catch {}
    // Prevent auto bootstrap side effects
    globalThis.__EG_TOP_BOOTSTRAP__ = true;
    // Minimal DOM expected by init()
    const app = el('div', { id: 'app' });
    const table = el('table');
    const tbody = el('tbody', { id: 'rowsTop' });
    // Add one row to avoid triggering initial refresh
    tbody.appendChild(el('tr'));
    table.appendChild(tbody);
    app.appendChild(table);
    app.appendChild(el('div', { id: 'statusTop' }));
    app.appendChild(el('div', { id: 'pageInfo' }));
    app.appendChild(el('div', { id: 'footerInfo' }));
    // Controls
    const source = el('select', { id: 'sourceTop' });
    source.appendChild(el('option', { value: 'region' }, 'Region'));
    source.appendChild(el('option', { value: 'local' }, 'Local'));
    app.appendChild(source);
    app.appendChild(el('div', { id: 'hoursTopWrap' }));
    app.appendChild(el('input', { id: 'hoursTop', value: '48' }));
    app.appendChild(el('input', { id: 'limitTop', value: '400' }));
    app.appendChild(el('input', { id: 'minSoldTop', value: '0' }));
    app.appendChild(el('select', { id: 'qualityTop' }));
    app.appendChild(el('input', { id: 'searchTop', type: 'text', value: '' }));
    document.body.appendChild(app);
    // EventSource stub to avoid ReferenceError in modules that expect it
    globalThis.EventSource = class { addEventListener() {} close() {} };
  });

  it('hydrates query and sort from localStorage into DOM and ControllerState', async () => {
    const { LS, ControllerState } = await import('../top.state.js');
    // Seed LS
    localStorage.setItem(LS.source, 'local');
    localStorage.setItem(LS.hours, '36');
    localStorage.setItem(LS.limit, '500');
    localStorage.setItem(LS.all, '1');
    localStorage.setItem(LS.inc0, '1');
    localStorage.setItem(LS.minSold, '10');
    localStorage.setItem(LS.quality, '3');
    localStorage.setItem(LS.query, ' hammer ');
    localStorage.setItem(LS.sortKey, 'sold');
    localStorage.setItem(LS.sortDir, 'asc');

    const { EGTopController } = await import('../top.controller.js');
    EGTopController.init();

    const searchEl = document.getElementById('searchTop');
    expect(searchEl.value).toBe(' hammer ');

    // Filters synchronized with hydrated DOM
    expect(ControllerState.filters.query).toBe('hammer');
    expect(ControllerState.filters.minSold).toBe(10);
    expect(ControllerState.filters.hours).toBe(36);
    expect(ControllerState.filters.limit).toBe(500);
    expect(ControllerState.filters.useAll).toBe(true);
    expect(ControllerState.filters.includeZero).toBe(true);

    // Sort state hydrated
    expect(ControllerState.sort.key).toBe('sold');
    expect(ControllerState.sort.dir).toBe('asc');
  });
});
