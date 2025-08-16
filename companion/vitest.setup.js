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
