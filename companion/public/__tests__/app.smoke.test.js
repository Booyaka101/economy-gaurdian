import { describe, it, expect, beforeEach } from 'vitest';

function el(tag, attrs = {}, html = '') {
  const e = document.createElement(tag);
  Object.entries(attrs).forEach(([k, v]) => {
    if (k === 'class') {e.className = String(v || '');}
    else if (k in e) {
      try { e[k] = v; } catch {}
    } else {
      try { e.setAttribute(k, String(v)); } catch {}
    }
  });
  if (html) {e.innerHTML = html;}
  return e;
}

describe('app.js smoke', () => {
  beforeEach(() => {
    document.body.innerHTML = '';
    const app = el('div', { id: 'app' });
    app.appendChild(el('div', { id: 'realm' }));
    app.appendChild(el('div', { id: 'lastFetched' }));
    app.appendChild(el('div', { id: 'status' }));
    app.appendChild(el('div', { id: 'metrics' }));

    // Minimal table and rows container
    const table = el('table');
    table.appendChild(el('thead', {}, '<tr><th data-sort="quantity">Qty</th></tr>'));
    const tbody = el('tbody', { id: 'rows' });
    table.appendChild(tbody);
    app.appendChild(table);

    // Search and info
    app.appendChild(el('input', { id: 'searchDeals', value: '' }));
    app.appendChild(el('div', { id: 'dealsInfo' }));

    document.body.appendChild(app);
  });

  it('exposes EGDeals API and setSort toggles correctly', async () => {
    // Fresh import for each test run
    const mod = await import('../app.js');
    expect(mod).toBeTruthy();

    expect(window.EGDeals).toBeTruthy();
    const s1 = window.EGDeals.setSort('quantity');
    expect(s1.key).toBe('quantity');
    expect(s1.dir).toBe('desc');

    const s2 = window.EGDeals.setSort('quantity');
    expect(s2.dir).toBe('asc');

    const s3 = window.EGDeals.getSort();
    expect(s3.key).toBe('quantity');
  });
});
