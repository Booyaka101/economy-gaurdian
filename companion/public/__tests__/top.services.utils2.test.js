import { describe, it, expect, beforeEach, vi } from 'vitest';
import {
  normalizeName,
  isBadName,
  idNum,
  fmtInt,
  copyText,
  showToast,
} from '../top.services.js';

describe('EGTopServices basic utils and UI helpers', () => {
  beforeEach(() => {
    document.body.innerHTML = '';
    try { localStorage.clear(); } catch {}
  });

  it('normalizeName returns a normalized string', () => {
    const s = 'Cafe01'; // "e" + combining acute
    const out = normalizeName(s);
    expect(typeof out).toBe('string');
  });

  it('isBadName detects empty, ? and numeric-only names', () => {
    expect(isBadName('')).toBe(true);
    expect(isBadName('   ')).toBe(true);
    expect(isBadName('?')).toBe(true);
    expect(isBadName('12345')).toBe(true);
    expect(isBadName('Iron Bar')).toBe(false);
  });

  it('idNum parses finite numbers and rejects NaN', () => {
    expect(idNum('123')).toBe(123);
    expect(idNum(456)).toBe(456);
    expect(idNum('abc')).toBeNull();
  });

  it('fmtInt formats integers and clamps invalid to 0', () => {
    const s = fmtInt(1234);
    expect(/^1,?234$/.test(s)).toBe(true);
    expect(fmtInt('99')).toMatch(/^99$/);
    expect(fmtInt('x')).toBe('0');
  });

  it('showToast sets text and toggles class, auto hides', async () => {
    vi.useFakeTimers();
    const toast = document.createElement('div');
    toast.id = 'toast';
    document.body.appendChild(toast);

    showToast('Hello');
    expect(toast.textContent).toBe('Hello');
    expect(toast.classList.contains('show')).toBe(true);

    // Advance timers beyond 1500ms hide delay
    vi.advanceTimersByTime(1600);
    expect(toast.classList.contains('show')).toBe(false);

    vi.useRealTimers();
  });

  it('copyText prefers navigator.clipboard.writeText and falls back to execCommand', async () => {
    // Primary path
    const writeSpy = vi.fn().mockResolvedValue(undefined);
    globalThis.navigator = globalThis.navigator || {};
    globalThis.navigator.clipboard = { writeText: writeSpy };

    const ok1 = await copyText('abc');
    expect(ok1).toBe(true);
    expect(writeSpy).toHaveBeenCalledWith('abc');

    // Fallback path
    globalThis.navigator.clipboard.writeText = vi.fn().mockRejectedValue(new Error('nope'));
    const execSpy = vi.fn().mockReturnValue(true);
    document.execCommand = execSpy;

    const ok2 = await copyText('xyz');
    expect(ok2).toBe(true);
    expect(execSpy).toHaveBeenCalledWith('copy');

    // Failure path
    document.execCommand = vi.fn().mockImplementation(() => { throw new Error('fail'); });
    const ok3 = await copyText('zzz');
    expect(ok3).toBe(false);
  });
});
