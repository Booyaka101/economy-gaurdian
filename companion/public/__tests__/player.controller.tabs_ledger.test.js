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
  if (html) { e.innerHTML = html; }
  return e;
}

describe('player.controller.js tabs and ledger controls', () => {
  beforeEach(() => {
    document.body.innerHTML = '';
    vi.restoreAllMocks();

    // Layout containers
    const root = el('div');

    // Profile controls required by controller
    const selRealm = el('select', { id: 'selRealm' });
    selRealm.appendChild(el('option', { value: '' }, 'All'));
    selRealm.appendChild(el('option', { value: 'A' }, 'A'));
    const selChar = el('select', { id: 'selChar' });

    // Buttons expected by controller
    const refresh = el('button', { id: 'refresh' });
    const refreshPending = el('button', { id: 'refreshPending' });
    const recBtn = el('button', { id: 'recBtn' });
    const insRefresh = el('button', { id: 'insRefresh' });
    const advRefresh = el('button', { id: 'advRefresh' });
    const topRefresh = el('button', { id: 'topRefresh' });

    // Tabs and panels
    const tabBtnOverview = el('button', { id: 'tabBtnOverview' });
    const tabBtnLedger = el('button', { id: 'tabBtnLedger' });
    const tabBtnSummary = el('button', { id: 'tabBtnSummary' });

    const pnlOverview = el('div', { id: 'tab-overview', hidden: '' });
    const pnlLedger = el('div', { id: 'tab-ledger', hidden: '' });
    const pnlSummary = el('div', { id: 'tab-summary', hidden: '' });

    // Ledger controls
    const ledgerRefresh = el('button', { id: 'ledgerRefresh' });
    const ledgerPrev = el('button', { id: 'ledgerPrev' });
    const ledgerNext = el('button', { id: 'ledgerNext' });
    const ledgerLimit = el('input', { id: 'ledgerLimit', value: '25', type: 'number' });

    root.append(
      selRealm,
      selChar,
      refresh,
      refreshPending,
      recBtn,
      insRefresh,
      advRefresh,
      topRefresh,
      tabBtnOverview,
      tabBtnLedger,
      tabBtnSummary,
      pnlOverview,
      pnlLedger,
      pnlSummary,
      ledgerRefresh,
      ledgerPrev,
      ledgerNext,
      ledgerLimit,
    );

    document.body.appendChild(root);

    // EGPlayer stub with minimal stateful ledger offset
    let ledgerOffset = 0;
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
      // Tabs/ledger
      setLedgerOffset: vi.fn((v) => {
        ledgerOffset = Number(v) || 0;
      }),
      getLedgerOffset: vi.fn(() => ledgerOffset),
      loadLedger: vi.fn(),
      loadSummary: vi.fn(),
      loadUnmatched: vi.fn(),
      // Profile management
      setSelectedRealm: vi.fn(),
      setSelectedChar: vi.fn(),
      getSelectedRealm: vi.fn(() => ''),
      getSelectedChar: vi.fn(() => ''),
      updateHero: vi.fn(),
      refreshAll: vi.fn(),
    };

    globalThis.fetch = vi.fn(async (url) => {
      return {
        ok: true,
        async json() {
          if (String(url).includes('/player/characters')) { return { realms: {} }; }
          if (String(url).includes('/player/current')) { return { current: null }; }
          return {};
        },
      };
    });
  });

  it('switches tabs and triggers lazy loads correctly', async () => {
    vi.resetModules();
    await import('../player.controller.js');
    await Promise.resolve();

    // Switch to Ledger tab
    document.getElementById('tabBtnLedger').click();

    expect(globalThis.EGPlayer.setLedgerOffset).toHaveBeenLastCalledWith(0);
    expect(globalThis.EGPlayer.loadLedger).toHaveBeenLastCalledWith({ resetOffset: true });

    // Panels visibility/aria
    expect(document.getElementById('tab-ledger').hasAttribute('hidden')).toBe(false);
    expect(document.getElementById('tab-summary').hasAttribute('hidden')).toBe(true);

    // Switch to Summary tab
    document.getElementById('tabBtnSummary').click();
    expect(globalThis.EGPlayer.loadSummary).toHaveBeenCalled();
    expect(globalThis.EGPlayer.loadUnmatched).toHaveBeenCalled();

    expect(document.getElementById('tab-summary').hasAttribute('hidden')).toBe(false);
    expect(document.getElementById('tab-ledger').hasAttribute('hidden')).toBe(true);
  });

  it('ledger controls: refresh, prev, next adjust offset and load', async () => {
    vi.resetModules();
    await import('../player.controller.js');
    await Promise.resolve();

    // Set starting offset then click prev with limit 25 -> 0 (bounded)
    globalThis.EGPlayer.setLedgerOffset(10);
    document.getElementById('ledgerPrev').click();
    expect(globalThis.EGPlayer.getLedgerOffset()).toBe(0);
    expect(globalThis.EGPlayer.loadLedger).toHaveBeenCalled();

    // Next should move +25 -> 25
    document.getElementById('ledgerNext').click();
    expect(globalThis.EGPlayer.getLedgerOffset()).toBe(25);

    // Change limit to 50 and click prev -> back to 0
    const limit = document.getElementById('ledgerLimit');
    limit.value = '50';
    document.getElementById('ledgerPrev').click();
    expect(globalThis.EGPlayer.getLedgerOffset()).toBe(0);

    // ledgerRefresh should request resetOffset true
    document.getElementById('ledgerRefresh').click();
    expect(globalThis.EGPlayer.loadLedger).toHaveBeenLastCalledWith({ resetOffset: true });
  });
});
