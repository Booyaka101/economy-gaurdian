import { describe, it, expect } from 'vitest';
import { updatePageInfo } from '../top.renderer.js';

describe('EGTopRenderer.updatePageInfo()', () => {
  it('sets HUD text when src starts with local and useAll=true', () => {
    const el = document.createElement('div');
    updatePageInfo(el, { src: 'local-cached', useAll: true, offset: 0, count: 50, total: 123 });
    expect(el.textContent).toBe('Items 1-50 of 123');

    el.textContent = '';
    updatePageInfo(el, { src: 'local', useAll: true, offset: 50, count: 50, total: 120 });
    expect(el.textContent).toBe('Items 51-100 of 120');
  });

  it('clears text for non-local or when useAll is false', () => {
    const el = document.createElement('div');
    updatePageInfo(el, { src: 'region', useAll: true, offset: 0, count: 10, total: 10 });
    expect(el.textContent).toBe('');

    updatePageInfo(el, { src: 'local', useAll: false, offset: 0, count: 10, total: 10 });
    expect(el.textContent).toBe('');
  });
});
