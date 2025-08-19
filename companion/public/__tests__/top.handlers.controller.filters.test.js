import { describe, it, expect, beforeEach, vi } from 'vitest';
import { attachHandlers } from '../top.handlers.controller.js';

function el(tag, attrs = {}, html = '') {
  const e = document.createElement(tag);
  Object.entries(attrs).forEach(([k, v]) => {
    if (k in e) {
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

describe('top.handlers.controller filters and refresh', () => {
  let deps;
  let ControllerState;
  let setFilters;
  let setSort;
  let refresh;

  beforeEach(() => {
    vi.useFakeTimers();
    document.body.innerHTML = '';
    try {
      localStorage.clear();
    } catch {}

    // Container
    const app = el('div', { id: 'app' });

    // Elements used by filters
    const minSoldEl = el('input', { id: 'minSoldTop', type: 'number', value: '0' });
    const qualityEl = el('select', { id: 'qualityTop' });
    const qOptAny = el('option', { value: '' }, 'Any');
    const qOpt1 = el('option', { value: '1' }, '1');
    qualityEl.appendChild(qOptAny);
    qualityEl.appendChild(qOpt1);
    const searchEl = el('input', { id: 'searchTop', type: 'text' });
    const clearBtn = el('button', { id: 'clearSearchTop' }, 'Clear');
    const limitEl = el('input', { id: 'limitTop', type: 'number', value: '400' });
    const hoursEl = el('input', { id: 'hoursTop', type: 'number', value: '48' });
    const hoursWrapEl = el('div', { id: 'hoursWrapTop' });
    const sourceEl = el('select', { id: 'sourceTop' });
    sourceEl.appendChild(el('option', { value: 'local' }, 'Local'));
    sourceEl.appendChild(el('option', { value: 'region' }, 'Region'));
    const allCatalogEl = el('input', { id: 'allCatalogTop', type: 'checkbox' });
    const includeZeroEl = el('input', { id: 'includeZeroTop', type: 'checkbox' });

    const prevBtn = el('button', { id: 'prevPage' }, 'Prev');
    const nextBtn = el('button', { id: 'nextPage' }, 'Next');
    const refreshBtn = el('button', { id: 'refreshTop' }, 'Refresh');

    // Sort header
    const table = el('table', { id: 'topTable' });
    table.appendChild(document.createElement('thead'));

    app.append(
      minSoldEl,
      qualityEl,
      searchEl,
      clearBtn,
      limitEl,
      hoursEl,
      hoursWrapEl,
      sourceEl,
      allCatalogEl,
      includeZeroEl,
      prevBtn,
      nextBtn,
      refreshBtn,
      table,
    );
    document.body.appendChild(app);

    ControllerState = {
      els: {
        minSoldEl,
        qualityEl,
        searchEl,
        limitEl,
        hoursEl,
        hoursWrapEl,
        sourceEl,
        allCatalogEl,
        includeZeroEl,
      },
      filters: { offset: 0 },
      sort: { key: 'soldPerDay', dir: 'desc' },
    };
    const LS = {
      source: 'eg_source',
      all: 'eg_all',
      inc0: 'eg_inc0',
      hours: 'eg_hours',
      limit: 'eg_limit',
      minSold: 'eg_min',
      quality: 'eg_quality',
    };
    setFilters = vi.fn((o) => Object.assign(ControllerState.filters, o));
    setSort = vi.fn((o) => {
      ControllerState.sort = { ...ControllerState.sort, ...o };
    });
    refresh = vi.fn();

    const EGTopServices = {
      bootstrapItemMetaStatic: vi.fn().mockResolvedValue(false),
    };

    const init = vi.fn();
    deps = { ControllerState, LS, setFilters, setSort, refresh, EGTopServices, init };
  });

  it('clear search resets query and triggers refresh', () => {
    attachHandlers(deps);
    const searchEl = document.getElementById('searchTop');
    const clearBtn = document.getElementById('clearSearchTop');

    searchEl.value = 'hello';
    clearBtn.click();

    expect(setFilters).toHaveBeenCalledWith({ query: '', offset: 0 });
    expect(refresh).toHaveBeenCalled();
  });

  it('search input is debounced and triggers filter+refresh', () => {
    attachHandlers(deps);
    const searchEl = document.getElementById('searchTop');

    searchEl.value = 'foo';
    searchEl.dispatchEvent(new Event('input'));
    vi.advanceTimersByTime(210);

    expect(setFilters).toHaveBeenCalledWith({ query: 'foo', offset: 0 });
    expect(refresh).toHaveBeenCalled();
  });

  it('prev/next adjust offset by limit and refresh', () => {
    attachHandlers(deps);
    ControllerState.filters.offset = 400;
    document.getElementById('nextPage').click();
    expect(setFilters).toHaveBeenCalledWith({ offset: 800 });
    document.getElementById('prevPage').click();
    expect(setFilters).toHaveBeenCalledWith({ offset: 400 });
    expect(refresh).toHaveBeenCalled();
  });

  it('minSold change/input persists to LS and refreshes', () => {
    attachHandlers(deps);
    const minSoldEl = document.getElementById('minSoldTop');
    minSoldEl.value = '12';
    minSoldEl.dispatchEvent(new Event('change'));

    expect(setFilters).toHaveBeenCalledWith({ minSold: 12, offset: 0 });
    expect(localStorage.getItem('eg_min')).toBe('12');
    expect(refresh).toHaveBeenCalled();
  });

  it('quality change persists to LS and refreshes', () => {
    attachHandlers(deps);
    const qualityEl = document.getElementById('qualityTop');
    qualityEl.value = '1';
    qualityEl.dispatchEvent(new Event('change'));
    expect(setFilters).toHaveBeenCalledWith({ quality: 1, offset: 0 });
    expect(localStorage.getItem('eg_quality')).toBe('1');
  });

  it('source change toggles hours visibility, persists and refreshes', () => {
    attachHandlers(deps);
    const sourceEl = document.getElementById('sourceTop');
    const hoursWrapEl = document.getElementById('hoursWrapTop');

    sourceEl.value = 'local';
    sourceEl.dispatchEvent(new Event('change'));
    expect(localStorage.getItem('eg_source')).toBe('local');
    expect(hoursWrapEl.style.display).toBe('');

    sourceEl.value = 'region';
    sourceEl.dispatchEvent(new Event('change'));
    expect(hoursWrapEl.style.display).toBe('none');
  });

  it('allCatalog/includeZero toggles persist and refresh', () => {
    attachHandlers(deps);
    const allCatalogEl = document.getElementById('allCatalogTop');
    const includeZeroEl = document.getElementById('includeZeroTop');

    allCatalogEl.checked = true;
    allCatalogEl.dispatchEvent(new Event('change'));
    expect(setFilters).toHaveBeenCalledWith({ useAll: true, offset: 0 });
    expect(localStorage.getItem('eg_all')).toBe('1');

    includeZeroEl.checked = true;
    includeZeroEl.dispatchEvent(new Event('change'));
    expect(setFilters).toHaveBeenCalledWith({ includeZero: true, offset: 0 });
    expect(localStorage.getItem('eg_inc0')).toBe('1');
  });

  it('limit and hours changes persist to LS and refresh', () => {
    attachHandlers(deps);
    const limitEl = document.getElementById('limitTop');
    const hoursEl = document.getElementById('hoursTop');

    limitEl.value = '500';
    limitEl.dispatchEvent(new Event('change'));
    expect(setFilters).toHaveBeenCalledWith({ limit: 500, offset: 0 });
    expect(localStorage.getItem('eg_limit')).toBe('500');

    hoursEl.value = '72';
    hoursEl.dispatchEvent(new Event('change'));
    expect(setFilters).toHaveBeenCalledWith({ hours: 72, offset: 0 });
    expect(localStorage.getItem('eg_hours')).toBe('72');
  });

  it('refresh button triggers refresh', () => {
    attachHandlers(deps);
    document.getElementById('refreshTop').click();
    expect(refresh).toHaveBeenCalled();
  });
});
