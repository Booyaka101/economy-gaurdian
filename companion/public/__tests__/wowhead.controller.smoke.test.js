import { describe, it, beforeEach, afterEach, expect, vi } from 'vitest';

function setHref(href) {
  // Most reliable in jsdom: mutate history with a string URL
  try {
    window.history.replaceState({}, '', String(href));
    return;
  } catch {}
  try {
    window.history.pushState({}, '', String(href));
    return;
  } catch {}
  try {
    // Last resort for stubborn environments
    const url = new URL(String(href), window.location.href);
    Object.defineProperty(window, 'location', { value: url, configurable: true });
  } catch {}
}

describe('wowhead.controller.js', () => {
  let origAppend;

  beforeEach(() => {
    vi.resetModules();
    document.head.innerHTML = '';
    document.body.innerHTML = '';
    localStorage.clear();
    // Ensure the IIFE doesn't early-return
    delete window.__egWowheadLoaded;
    // Default URL
    setHref('http://localhost/');
    // Default no override
    delete window.EG_WOWHEAD_SRC;

    // Default: when a script is appended, immediately fire onload
    origAppend = document.head.appendChild;
    vi.spyOn(document.head, 'appendChild').mockImplementation((node) => {
      const el = origAppend.call(document.head, node);
      if (node && node.tagName === 'SCRIPT' && typeof node.onload === 'function') {
        // async tick
        setTimeout(() => node.onload(), 0);
      }
      return el;
    });
  });

  afterEach(() => {
    document.head.appendChild.mockRestore?.();
    document.head.innerHTML = '';
    document.body.innerHTML = '';
  });

  it('disables when whsrc=off', async () => {
    setHref('http://localhost/?whsrc=off');
    await import('../wowhead.controller.js');
    expect(window.EGTooltips?.state).toEqual({ enabled: false, reason: 'whsrc=off' });
  });

  it('respects local preference eg_tooltips=off', async () => {
    localStorage.setItem('eg_tooltips', 'off');
    await import('../wowhead.controller.js');
    expect(window.EGTooltips?.state).toEqual({ enabled: false, reason: 'pref-off' });
  });

  it('loads with custom EG_WOWHEAD_SRC and marks loaded on onload', async () => {
    window.EG_WOWHEAD_SRC = 'https://example.com/widgets/x.js';
    await import('../wowhead.controller.js');
    // allow SCRIPT onload to fire (scheduled via setTimeout in our spy)
    await new Promise((r) => setTimeout(r, 1));
    expect(window.EGTooltips?.state?.enabled).toBe(true);
    expect(window.EGTooltips?.state?.loaded).toBe(true);
    expect(window.EGTooltips?.state?.src).toBe('https://example.com/widgets/x.js');
  });

  it('retries on error with protocol-relative fallback and marks loaded', async () => {
    // First script append triggers onerror; second triggers onload
    let first = true;
    document.head.appendChild.mockImplementation((node) => {
      const el = origAppend.call(document.head, node);
      if (node && node.tagName === 'SCRIPT') {
        if (first) {
          first = false;
          typeof node.onerror === 'function' && setTimeout(() => node.onerror(), 0);
        } else {
          typeof node.onload === 'function' && setTimeout(() => node.onload(), 0);
        }
      }
      return el;
    });

    await import('../wowhead.controller.js');
    // allow first onerror then second onload to run
    await new Promise((r) => setTimeout(r, 1));
    await new Promise((r) => setTimeout(r, 1));
    expect(window.EGTooltips?.state?.enabled).toBe(true);
    expect(window.EGTooltips?.state?.loaded).toBe(true);
    // Fallback should drop the protocol
    expect(String(window.EGTooltips?.state?.src || '')).toMatch(/^\/\//);
  });
});
