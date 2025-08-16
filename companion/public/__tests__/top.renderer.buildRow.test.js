import { describe, it, expect, beforeEach } from 'vitest';
import { buildRow } from '../top.renderer.js';
import { nameCache, iconCache, qualityCache } from '../top.services.js';

describe('EGTopRenderer.buildRow()', () => {
  beforeEach(() => {
    document.body.innerHTML = '';
    nameCache.clear();
    iconCache.clear();
    qualityCache.clear();
  });

  it('renders row with valid name, icon, and quality; shows ceil(soldPerDay)', () => {
    nameCache.set(42, 'Hammer');
    iconCache.set(42, 'http://example/icon.png');
    qualityCache.set(42, 3);

    const tr = buildRow({ itemId: 42, soldPerDay: 2.2 });
    expect(tr).toBeInstanceOf(HTMLElement);

    // Anchor text and href
    const a = tr.querySelector('a');
    expect(a).toBeTruthy();
    expect(a.textContent).toContain('Hammer');
    expect(a.getAttribute('href')).toContain('https://www.wowhead.com/item=42');

    // Icon with quality class
    const img = tr.querySelector('img.icon.q3');
    expect(img).toBeTruthy();
    expect(img.getAttribute('alt')).toBe('Hammer');
    expect(img.getAttribute('loading')).toBe('lazy');

    // Sold/day is ceiled
    const tds = tr.querySelectorAll('td');
    expect(tds[1].textContent).toMatch(/\b3\b/);

    // Tool buttons exist
    expect(tr.querySelector('[data-act="eta"][data-id="42"]')).toBeTruthy();
    expect(tr.querySelector('[data-act="policy"][data-id="42"]')).toBeTruthy();
    expect(tr.querySelector('[data-act="copy"][data-id="42"]')).toBeTruthy();
  });

  it('handles bad name by using placeholder and keeps ID/quality pill', () => {
    nameCache.set(5, '?'); // bad name
    qualityCache.set(5, 1);

    const tr = buildRow({ itemId: 5, soldPerDay: 1 });
    const a = tr.querySelector('a');
    expect(a.textContent).toContain('(unknown)');
    expect(a.getAttribute('title')).toContain('(unknown)');

    // Quality pill shows the ID
    const pill = tr.querySelector('.quality-pill');
    expect(pill).toBeTruthy();
    expect(pill.textContent).toContain('ID 5');
  });

  it('prints 0 when soldPerDay is not finite', () => {
    nameCache.set(7, 'Test');
    const tr = buildRow({ itemId: 7, soldPerDay: 'NaN' });
    const tds = tr.querySelectorAll('td');
    expect(tds[1].textContent).toMatch(/\b0\b/);
  });
});
