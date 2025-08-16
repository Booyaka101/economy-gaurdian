import { describe, it, expect, beforeEach, vi } from 'vitest';
import { loadSparkIfNeeded } from '../top.renderer.js';

function makeSpark(id) {
  const el = document.createElement('span');
  el.className = 'spark';
  if (id != null) {
    el.setAttribute('data-id', String(id));
  }
  return el;
}

describe('EGTopRenderer.loadSparkIfNeeded()', () => {
  beforeEach(() => {
    document.body.innerHTML = '';
  });

  it('ignores missing element or missing data-id', async () => {
    await loadSparkIfNeeded(null, 24, () => []);
    const el = makeSpark(null);
    await loadSparkIfNeeded(el, 24, () => []);
    expect(el.innerHTML).toBe('');
  });

  it('fetches once, renders SVG, and caches subsequent calls', async () => {
    const el = makeSpark(123);
    document.body.appendChild(el);
    const fetcher = vi.fn(async () => [
      [0, 1],
      [1, 2],
    ]);

    await loadSparkIfNeeded(el, 24, fetcher);
    expect(fetcher).toHaveBeenCalledTimes(1);
    expect(el.innerHTML).toContain('<svg');

    // Call again immediately: should hit cache and not call fetcher
    await loadSparkIfNeeded(el, 24, fetcher);
    expect(fetcher).toHaveBeenCalledTimes(1);
    expect(el.innerHTML).toContain('<svg');
  });

  it('clears placeholder when series is too short', async () => {
    const el = makeSpark(55);
    document.body.appendChild(el);
    const fetcher = vi.fn(async () => [[0, 1]]); // too short

    await loadSparkIfNeeded(el, 24, fetcher);
    expect(el.textContent).toBe('');
  });
});
