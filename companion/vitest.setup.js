/* Global Vitest setup: polyfills and safe stubs for browser APIs used in tests */
import { vi } from 'vitest';

// Scheduling polyfills used by renderer chunking
if (!globalThis.requestAnimationFrame) {
  globalThis.requestAnimationFrame = (cb) => setTimeout(() => cb(performance.now?.() ?? Date.now()), 0);
}
if (!globalThis.cancelAnimationFrame) {
  globalThis.cancelAnimationFrame = (id) => clearTimeout(id);
}
if (!globalThis.requestIdleCallback) {
  globalThis.requestIdleCallback = (cb) => setTimeout(() => cb({ timeRemaining: () => 16 }), 1);
}

// Optional: navigator.scheduling.isInputPending()
if (!globalThis.navigator) {
  globalThis.navigator = {};
}
if (!globalThis.navigator.scheduling) {
  globalThis.navigator.scheduling = { isInputPending: () => false };
} else if (typeof globalThis.navigator.scheduling.isInputPending !== 'function') {
  globalThis.navigator.scheduling.isInputPending = () => false;
}

// Wowhead power refresher used after rendering
if (!globalThis.window) {
  globalThis.window = globalThis;
}
if (!globalThis.window.$WowheadPower) {
  globalThis.window.$WowheadPower = { refreshLinks: () => {} };
}

// Default fetch stub (tests may override)
if (!globalThis.fetch) {
  globalThis.fetch = vi.fn().mockResolvedValue({ ok: true, json: async () => ({}) });
}

// EventSource stub for SSE usage in handlers
if (!globalThis.EventSource) {
  globalThis.EventSource = class {
    addEventListener() {}
    close() {}
  };
}

// URL.createObjectURL/revokeObjectURL polyfills for blob downloads in tests
if (!globalThis.URL) {
  globalThis.URL = {};
}
if (typeof globalThis.URL.createObjectURL !== 'function') {
  globalThis.URL.createObjectURL = vi.fn(() => 'blob:mock');
}
if (typeof globalThis.URL.revokeObjectURL !== 'function') {
  globalThis.URL.revokeObjectURL = vi.fn();
}

// Silence jsdom navigation warnings (e.g., "Not implemented: navigation (except hash changes)")
// and provide stable no-op navigation methods used by some UI flows.
try {
  if (globalThis.window && globalThis.window.location) {
    const noop = vi.fn ? vi.fn() : () => {};
    try { globalThis.window.location.assign = noop } catch {}
    try { globalThis.window.location.replace = noop } catch {}
  }
} catch {}

// Filter out jsdom navigation noise from console.error without hiding real failures
try {
  const origError = console.error ? console.error.bind(console) : null;
  if (origError) {
    console.error = (...args) => {
      let ignore = false;
      try {
        const msg = (args && args[0] && args[0].toString) ? args[0].toString() : '';
        if (typeof msg === 'string' && msg.includes('Not implemented: navigation')) {
          ignore = true; // ignore noisy jsdom navigation warnings
        }
      } catch {}
      if (!ignore) {
        origError(...args);
      }
    };
  }
} catch {}
