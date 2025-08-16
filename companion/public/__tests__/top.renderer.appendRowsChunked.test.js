/** @vitest-environment jsdom */
import { describe, it, expect } from 'vitest';
import { appendRowsChunked } from '../top.renderer.js';

function waitFor(cond, { timeout = 500, interval = 5 } = {}) {
  return new Promise((resolve, reject) => {
    const start = Date.now();
    const tick = () => {
      try {
        if (cond()) return resolve();
        if (Date.now() - start >= timeout) return reject(new Error('timeout'));
        setTimeout(tick, interval);
      } catch (e) {
        reject(e);
      }
    };
    tick();
  });
}

describe('EGTopRenderer.appendRowsChunked()', () => {
  it('renders all items asynchronously and warms first sparks', async () => {
    const rowsEl = document.createElement('tbody');
    const items = Array.from({ length: 10 }, (_, i) => ({ itemId: i + 1, soldPerDay: i + 0.2 }));

    const warmed = { count: 0 };
    const builder = (it) => {
      const tr = document.createElement('tr');
      tr.innerHTML = `<td>${it.itemId}<span class="spark" data-id="${it.itemId}"></span></td>`;
      return tr;
    };
    const loadSpark = () => {
      warmed.count += 1;
    };

    appendRowsChunked(rowsEl, items, { buildRow: builder, loadSpark });

    await waitFor(() => rowsEl.children.length === items.length, { timeout: 1500, interval: 10 });

    expect(rowsEl.querySelectorAll('tr').length).toBe(10);
    // At least one spark should be warmed (renderer warms up to 8)
    await waitFor(() => warmed.count > 0, { timeout: 1500, interval: 10 });
    expect(warmed.count).toBeGreaterThan(0);
  });
});
