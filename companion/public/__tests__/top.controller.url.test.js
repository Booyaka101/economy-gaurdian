import { describe, it, expect, beforeEach, vi } from 'vitest';

// Mock the state module used by top.controller.js so we can drive readControls
let currentControls = {
  src: 'region',
  useAll: false,
  includeZero: true,
  minSold: 0,
  quality: null,
  query: '',
  limit: 400,
};

vi.mock('../top.state.js', async () => {
  const api = {
    ControllerState: {
      inited: false,
      els: {},
      sort: { key: 'soldPerDay', dir: 'desc' },
      filters: {},
    },
    LS: {},
    readControls: vi.fn(() => currentControls),
    setFilters: vi.fn(),
    setSort: vi.fn((p = {}) => {
      api.ControllerState.sort = { ...api.ControllerState.sort, ...p };
    }),
  };
  return api;
});

describe('EGTopController.buildUrlWithHours()', () => {
  beforeEach(() => {
    vi.resetModules();
    currentControls = {
      src: 'region',
      useAll: false,
      includeZero: true,
      minSold: 0,
      quality: null,
      query: '',
      limit: 400,
    };
  });

  it('builds region URL without filters and preserves limit', async () => {
    const { EGTopController } = await import('../top.controller.js');
    const url = EGTopController.buildUrlWithHours(48, 400);
    expect(url.startsWith('/stats/top-sold-region?')).toBe(true);
    expect(url).toContain('limit=400');
    expect(url).toContain('sort=soldPerDay');
    expect(url).toContain('dir=desc');
    expect(url).not.toContain('hours=');
  });

  it('escalates region limit to >=5000 when text filters active', async () => {
    currentControls = { ...currentControls, src: 'region', query: 'abc' };
    const { EGTopController } = await import('../top.controller.js');
    const url = EGTopController.buildUrlWithHours(48, 100);
    expect(url).toContain('limit=5000');
  });

  it('builds local URL without filters and no all-catalog; includes hours and includeZero', async () => {
    currentControls = { ...currentControls, src: 'local', useAll: false };
    const { EGTopController } = await import('../top.controller.js');
    const url = EGTopController.buildUrlWithHours(24, 300);
    expect(url.startsWith('/stats/top-sold-local?')).toBe(true);
    expect(url).toContain('hours=24');
    expect(url).toContain('limit=300');
    expect(url).toContain('includeZero=1');
    expect(url).toContain('sort=soldPerDay');
    expect(url).toContain('dir=desc');
  });

  it('uses all-catalog base and escalates local limit to >=10000 when filters active', async () => {
    currentControls = { ...currentControls, src: 'local', useAll: true, query: 'hammer' };
    const { EGTopController } = await import('../top.controller.js');
    const url = EGTopController.buildUrlWithHours(12, 200);
    expect(url.startsWith('/stats/top-sold-local/all?')).toBe(true);
    expect(url).toContain('hours=12');
    expect(url).toContain('limit=10000');
  });
});
