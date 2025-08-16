// Lightweight performance tracer for EG Top view
// Exposed as ES module exports and window.EGTopPerf for legacy access.

function now() {
  try {
    if (typeof performance !== 'undefined' && performance.now) {
      return performance.now();
    }
  } catch {}
  return Date.now();
}

const marks = new Map(); // name -> stack of start times
const measures = []; // { name, duration, start, end, count, meta }

function pushStart(name) {
  const t = now();
  const stack = marks.get(name) || [];
  stack.push(t);
  marks.set(name, stack);
  return t;
}
function popStart(name) {
  const stack = marks.get(name) || [];
  const t = stack.pop();
  if (stack.length) {
    marks.set(name, stack);
  } else {
    marks.delete(name);
  }
  return t;
}

const Perf = {
  options: {
    logThresholdMs: 32,
    autoLog: true,
  },
  now,
  mark(name) {
    // alias of start for our usage
    return pushStart(String(name || 'mark'));
  },
  start(name) {
    return pushStart(String(name || 'task'));
  },
  end(name, meta) {
    const nm = String(name || 'task');
    const st = popStart(nm);
    if (st == null) {
      return 0;
    }
    const en = now();
    const dur = en - st;
    measures.push({ name: nm, duration: dur, start: st, end: en, count: 1, meta });
    try {
      if (
        Perf.options.autoLog &&
        (dur >= Perf.options.logThresholdMs || (typeof window !== 'undefined' && window.__EG_TOP_DEBUG__))
      ) {
        // eslint-disable-next-line no-console
        const log = (console.debug || console.log).bind(console);
        // eslint-disable-next-line no-console
        log(`[Perf] ${nm}: ${dur.toFixed(1)}ms`, meta || '');
      }
    } catch {}
    return dur;
  },
  measure(name, startTs, endTs, meta) {
    const nm = String(name || 'measure');
    const st = Number.isFinite(startTs) ? startTs : now();
    const en = Number.isFinite(endTs) ? endTs : now();
    const dur = en - st;
    measures.push({ name: nm, duration: dur, start: st, end: en, count: 1, meta });
    return dur;
  },
  report({ reset = false, group = 'EG Top Perf' } = {}) {
    const out = measures.slice();
    try {
      const tbl = out.map((m) => ({ name: m.name, ms: Number(m.duration.toFixed(2)), start: m.start, end: m.end }));
      // eslint-disable-next-line no-console
      if (typeof console !== 'undefined' && console.table) {
        // eslint-disable-next-line no-console
        console.groupCollapsed(`[Perf] ${group}`);
        // eslint-disable-next-line no-console
        console.table(tbl);
        // eslint-disable-next-line no-console
        console.groupEnd();
      // eslint-disable-next-line no-console
      } else if (console && console.log) {
        // eslint-disable-next-line no-console
        console.log(`[Perf] ${group}:`, tbl);
      }
    } catch {}
    if (reset) {
      measures.length = 0;
    }
    return out;
  },
  clear() {
    measures.length = 0;
    marks.clear();
  },
  setThreshold(ms) {
    Perf.options.logThresholdMs = Math.max(0, Number(ms || 0));
  },
};

export default Perf;
export const startPerf = (...a) => Perf.start(...a);
export const endPerf = (...a) => Perf.end(...a);
export const markPerf = (...a) => Perf.mark(...a);
export const measurePerf = (...a) => Perf.measure(...a);
export const reportPerf = (...a) => Perf.report(...a);

try {
  // Attach for easy runtime inspection
  window.EGTopPerf = Perf;
} catch {}
