import { describe, it, expect, beforeEach, vi } from 'vitest';
import { attachHandlers } from '../top.handlers.controller.js';

class EventSourceMock {
  static instances = [];
  constructor(url) {
    this.url = url;
    this._listeners = {};
    EventSourceMock.instances.push(this);
  }
  addEventListener(type, cb) {
    (this._listeners[type] ||= []).push(cb);
  }
  emit(type, payload) {
    const cbs = this._listeners[type] || [];
    for (const cb of cbs) {
      cb(payload);
    }
  }
  close() {}
}

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

describe('top.handlers.controller SSE', () => {
  let deps;
  let ControllerState;
  let refresh;

  beforeEach(() => {
    vi.useFakeTimers();
    document.body.innerHTML = '';
    try {
      localStorage.clear();
    } catch {}
    // Override global EventSource with controllable mock
    globalThis.EventSource = EventSourceMock;

    const tabTop = el('div', { id: 'tab-top' });
    document.body.appendChild(tabTop);

    ControllerState = { els: {} };
    const LS = {};
    const setFilters = vi.fn();
    const setSort = vi.fn();
    refresh = vi.fn();

    const EGTopServices = {
      bootstrapItemMetaStatic: vi.fn().mockResolvedValue(false),
    };

    const init = vi.fn();
    deps = { ControllerState, LS, setFilters, setSort, refresh, EGTopServices, init };
  });

  it('emits change message triggers debounced refresh when tab visible', () => {
    attachHandlers(deps);
    const es = EventSourceMock.instances[0];
    expect(es?.url).toBe('/events/auctions');

    refresh.mockClear();
    es.emit('message', { data: JSON.stringify({ type: 'change' }) });

    // before debounce
    expect(refresh).not.toHaveBeenCalled();
    vi.advanceTimersByTime(1600);

    expect(refresh).toHaveBeenCalled();
    // Expect refresh(false) call shape (first arg false or undefined)
    const [arg] = refresh.mock.calls.at(-1) || [];
    expect(arg === false || arg?.userTriggered === undefined).toBe(true);
  });

  it('does not refresh when tab is hidden', () => {
    const tabTop = document.getElementById('tab-top');
    tabTop.classList.add('hidden');

    attachHandlers(deps);
    const es = EventSourceMock.instances.at(-1);
    refresh.mockClear();

    es.emit('message', { data: JSON.stringify({ type: 'change' }) });
    vi.advanceTimersByTime(2000);

    expect(refresh).not.toHaveBeenCalled();
  });

  it('ignores non-change messages', () => {
    attachHandlers(deps);
    const es = EventSourceMock.instances.at(-1);
    refresh.mockClear();

    es.emit('message', { data: JSON.stringify({ type: 'noop' }) });
    vi.advanceTimersByTime(2000);

    expect(refresh).not.toHaveBeenCalled();
  });
});
