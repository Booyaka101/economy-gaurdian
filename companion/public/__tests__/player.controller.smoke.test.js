import { describe, it, expect, beforeEach, vi } from 'vitest';

function el(tag, attrs = {}, html = '') {
  const e = document.createElement(tag);
  Object.entries(attrs).forEach(([k, v]) => {
    if (k === 'class') {e.className = String(v || '');}
    else if (k in e) {
      try {
        e[k] = v;
      } catch {}
    } else {
      try {
        e.setAttribute(k, String(v));
      } catch {}
    }
  });
  if (html) {e.innerHTML = html;}
  return e;
}

describe('player.controller.js smoke', () => {
  const realms = { A: ['Alice', 'Andy'], B: ['Bob'] };

  beforeEach(() => {
    document.body.innerHTML = '';
    vi.restoreAllMocks();

    // Minimal DOM expected by controller
    const controls = el('div');
    const selRealm = el('select', { id: 'selRealm' });
    // Populate realm options so .value assignment sticks
    selRealm.appendChild(el('option', { value: '' }, 'All'));
    selRealm.appendChild(el('option', { value: 'A' }, 'A'));
    selRealm.appendChild(el('option', { value: 'B' }, 'B'));
    const selChar = el('select', { id: 'selChar' });
    const refresh = el('button', { id: 'refresh' });
    const refreshPending = el('button', { id: 'refreshPending' });
    const recBtn = el('button', { id: 'recBtn' });
    const insRefresh = el('button', { id: 'insRefresh' });
    const advRefresh = el('button', { id: 'advRefresh' });
    const topRefresh = el('button', { id: 'topRefresh' });

    controls.appendChild(selRealm);
    controls.appendChild(selChar);
    controls.appendChild(refresh);
    controls.appendChild(refreshPending);
    controls.appendChild(recBtn);
    controls.appendChild(insRefresh);
    controls.appendChild(advRefresh);
    controls.appendChild(topRefresh);
    document.body.appendChild(controls);

    // Stub EGPlayer API used by controller
    globalThis.EGPlayer = {
      // Buttons
      loadTotals: vi.fn(),
      loadPending: vi.fn(),
      recommend: vi.fn(),
      loadInsights: vi.fn(),
      loadAdvisor: vi.fn(),
      loadTopItems: vi.fn(),
      // Init sequence
      rebuildModels: vi.fn().mockResolvedValue(undefined),
      loadProfileOptions: vi.fn().mockResolvedValue(undefined),
      initFromURLAndRefresh: vi.fn().mockResolvedValue(undefined),
      // Profile management
      setSelectedRealm: vi.fn(),
      setSelectedChar: vi.fn(),
      getSelectedRealm: vi.fn().mockReturnValue(''),
      getSelectedChar: vi.fn().mockReturnValue(''),
      updateHero: vi.fn(),
      refreshAll: vi.fn(),
    };

    // Mock fetch for realms and current player
    globalThis.fetch = vi.fn(async (url) => {
      return {
        ok: true,
        async json() {
          if (String(url).includes('/player/characters')) {
            return { realms };
          }
          if (String(url).includes('/player/current')) {
            // Avoid auto-pick changing state during test
            return { current: null };
          }
          return {};
        },
      };
    });
  });

  it('initializes, binds, and reacts to user actions', async () => {

    // Import side-effect module (ensure fresh evaluation per test)
    vi.resetModules();
    await import('../player.controller.js');

    // Allow any awaited calls/microtasks to flush
    await Promise.resolve();

    // Init sequence executed
    expect(globalThis.EGPlayer.rebuildModels).toHaveBeenCalledTimes(1);
    expect(globalThis.EGPlayer.loadProfileOptions).toHaveBeenCalledTimes(1);
    expect(globalThis.EGPlayer.initFromURLAndRefresh).toHaveBeenCalledTimes(1);

    // Button bindings
    document.getElementById('refresh').click();
    document.getElementById('refreshPending').click();
    document.getElementById('recBtn').click();
    document.getElementById('insRefresh').click();
    document.getElementById('advRefresh').click();
    document.getElementById('topRefresh').click();

    expect(globalThis.EGPlayer.loadTotals).toHaveBeenCalledTimes(1);
    expect(globalThis.EGPlayer.loadPending).toHaveBeenCalledTimes(1);
    expect(globalThis.EGPlayer.recommend).toHaveBeenCalledTimes(1);
    expect(globalThis.EGPlayer.loadInsights).toHaveBeenCalledTimes(1);
    expect(globalThis.EGPlayer.loadAdvisor).toHaveBeenCalledTimes(1);
    expect(globalThis.EGPlayer.loadTopItems).toHaveBeenCalledTimes(1);

    // Realm change populates characters and triggers update/refresh
    const selRealm = document.getElementById('selRealm');
    const selChar = document.getElementById('selChar');
    selRealm.value = 'A';
    selRealm.dispatchEvent(new Event('change'));

    await Promise.resolve();

    expect(globalThis.EGPlayer.setSelectedRealm).toHaveBeenLastCalledWith('A');
    // Should include default 'All' + two chars for realm A
    expect(selChar.options.length).toBe(3);

    // Char change
    selChar.value = 'Andy';
    selChar.dispatchEvent(new Event('change'));

    expect(globalThis.EGPlayer.setSelectedChar).toHaveBeenLastCalledWith('Andy');
    expect(globalThis.EGPlayer.updateHero).toHaveBeenCalled();
    expect(globalThis.EGPlayer.refreshAll).toHaveBeenCalled();

    // Clean interval created by controller
    window.dispatchEvent(new Event('beforeunload'));
  });
});
