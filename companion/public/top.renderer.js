// Top Renderer (Phase 3): row building and lightweight helpers
// Exposed as ES module exports and window.EGTopRenderer for legacy scripts.

import {
  nameCache,
  iconCache,
  qualityCache,
  normalizeName,
  isBadName,
  idNum,
} from './top.services.js';
function fmtSold(v) {
  const n = Number(v);
  if (!Number.isFinite(n)) {
    return '0';
  }
  return Math.ceil(n).toLocaleString();
}

export function buildRow(it) {
  const id = idNum(it?.itemId);
  const tr = document.createElement('tr');
  const rawName = (id != null ? nameCache.get(id) : it && it.itemName) || (it && it.itemName) || '';
  const name = normalizeName(rawName);
  const badNameForRender = isBadName(name);
  const dispName = badNameForRender ? '' : String(name).trim();
  if (badNameForRender) {
    try {
      // eslint-disable-next-line no-console
      (console.debug || console.log)('[Top] bad item name encountered; using placeholder', {
        id,
        raw: rawName,
        normalized: name,
      });
    } catch {}
  }
  const icon = iconCache.get(id) || '';
  const ql = qualityCache.has(id) ? Number(qualityCache.get(id)) : null;
  const qcls = ql != null && ql >= 0 && ql <= 5 ? `q${ql}` : '';
  const iconHtml = icon
    ? `<img src="${icon}" alt="${dispName || ''}" title="Quality ${ql != null ? ql : '?'}" width="18" height="18" class="icon ${qcls}" loading="lazy">`
    : '';
  const wh = id != null ? `https://www.wowhead.com/item=${id}` : '#';
  tr.innerHTML = `
    <td>
      ${iconHtml}
      <a href="${wh}" target="_blank" rel="noopener" data-wowhead="item=${id}" title="${dispName || '(unknown)'} (ID ${id})">${dispName || '(unknown)'} </a>
      <span class="quality-pill" title="Quality ${ql != null ? ql : '?'}">ID ${id}</span>
    </td>
    <td class="mono">
      ${fmtSold(it.soldPerDay)}
      <span class="spark" data-id="${id}" title="Hover to load sparkline" aria-hidden="true"></span>
      <span style="float:right; display:flex; gap:6px">
        <button class="tool-btn" data-act="eta" data-id="${id}" title="Show posting ETA" aria-label="Show ETA for item ${id}">ETA</button>
        <button class="tool-btn" data-act="policy" data-id="${id}" title="Open AI assistant" aria-label="Open AI assistant for item ${id}">AI</button>
        <button class="tool-btn" data-act="copy" data-id="${id}" title="Copy item ID" aria-label="Copy item ID ${id}">Copy</button>
      </span>
    </td>`;
  return tr;
}

// Sparkline helpers (module-scoped caches)
const SPARK_HOVER_THROTTLE_MS = 120;
const sparkCache = new Map(); // id -> svg string
const sparkInflight = new Set(); // ids currently being fetched
const sparkHoverTs = new Map(); // id -> last hover timestamp

export function renderSparkline(points) {
  try {
    // points: [[t,v]...], small inline SVG 60x18 with padding
    const w = 60,
      h = 18,
      px = 2,
      py = 2;
    const xs = points.map((p) => p[0]);
    const ys = points.map((p) => p[1]);
    const minX = Math.min(...xs),
      maxX = Math.max(...xs);
    const minY = Math.min(...ys),
      maxY = Math.max(...ys);
    const dx = maxX - minX || 1;
    const dy = maxY - minY || 1;
    const innerW = w - px * 2;
    const innerH = h - py * 2;
    const path = points
      .map((p, i) => {
        const x = px + ((p[0] - minX) / dx) * innerW;
        const y = py + innerH - ((p[1] - minY) / dy) * innerH;
        return (i === 0 ? 'M' : 'L') + x.toFixed(1) + ' ' + y.toFixed(1);
      })
      .join(' ');
    return `<svg width="${w}" height="${h}" viewBox="0 0 ${w} ${h}" xmlns="http://www.w3.org/2000/svg" aria-hidden="true">
      <path d="${path}" fill="none" stroke="#6aa1ff" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round" opacity="0.9"/>
    </svg>`;
  } catch {
    return '';
  }
}

// Delegation-friendly loader: caller provides hours and fetcher
export async function loadSparkIfNeeded(sparkEl, hours, fetchSalesSeries) {
  try {
    if (!sparkEl) {
      return;
    }
    const id = sparkEl.getAttribute('data-id');
    if (!id) {
      return;
    }
    if (sparkCache.has(id)) {
      sparkEl.innerHTML = sparkCache.get(id);
      return;
    }
    const now = Date.now();
    const last = sparkHoverTs.get(id) || 0;
    if (now - last < SPARK_HOVER_THROTTLE_MS) {
      return;
    }
    sparkHoverTs.set(id, now);
    if (sparkInflight.has(id)) {
      return;
    }
    sparkInflight.add(id);
    sparkEl.textContent = '…';
    try {
      const series = await (typeof fetchSalesSeries === 'function'
        ? fetchSalesSeries(id, hours)
        : Promise.resolve(null));
      if (!series || series.length < 2) {
        sparkEl.textContent = '';
        return;
      }
      const svg = renderSparkline(series);
      sparkEl.innerHTML = svg;
      sparkCache.set(id, svg);
    } finally {
      sparkInflight.delete(id);
    }
  } catch {}
}

// Append rows in chunks with adaptive sizing and warm a few sparklines
export function appendRowsChunked(rowsEl, items, { buildRow: makeRow, loadSpark } = {}) {
  try {
    if (!rowsEl || !Array.isArray(items)) {
      return;
    }
    const builder = typeof makeRow === 'function' ? makeRow : (it) => buildRow(it);
    const warm = typeof loadSpark === 'function' ? loadSpark : () => {};
    rowsEl.innerHTML = '';
    let i = 0;
    let curChunk = 80;
    const processChunk = (deadline) => {
      const start =
        typeof performance !== 'undefined' && performance.now ? performance.now() : Date.now();
      const frag = document.createDocumentFragment();
      let n = 0;
      while (i < items.length && n < curChunk) {
        frag.appendChild(builder(items[i++]));
        n++;
        if (
          deadline &&
          typeof deadline.timeRemaining === 'function' &&
          deadline.timeRemaining() <= 1
        ) {
          break;
        }
      }
      if (frag.childNodes.length) {
        rowsEl.appendChild(frag);
      }
      try {
        const took =
          (typeof performance !== 'undefined' && performance.now ? performance.now() : Date.now()) -
          start;
        if (took > 20) {
          curChunk = Math.max(20, Math.floor(curChunk * 0.8));
        } else if (took < 8) {
          curChunk = Math.min(250, Math.ceil(curChunk * 1.2));
        }
      } catch {}
      if (i < items.length) {
        if ('requestIdleCallback' in window) {
          // @ts-ignore
          window.requestIdleCallback(processChunk, { timeout: 100 });
        } else {
          window.requestAnimationFrame(processChunk);
        }
      } else {
        try {
          if (window.$WowheadPower && typeof window.$WowheadPower.refreshLinks === 'function') {
            window.$WowheadPower.refreshLinks();
          }
        } catch {}
        try {
          const sparks = Array.from(rowsEl.querySelectorAll('.spark')).slice(0, 8);
          let j = 0;
          const step = () => {
            if (j >= sparks.length) {
              return;
            }
            const el = sparks[j++];
            if (el) {
              warm(el);
            }
            if (j < sparks.length) {
              window.requestAnimationFrame(step);
            }
          };
          window.requestAnimationFrame(step);
        } catch {}
      }
    };
    if ('requestIdleCallback' in window) {
      // @ts-ignore
      window.requestIdleCallback(processChunk, { timeout: 100 });
    } else {
      window.requestAnimationFrame(processChunk);
    }
  } catch {}
}

// Update page info HUD text (keeps legacy wording)
export function updatePageInfo(el, { src, useAll, offset, count, total }) {
  try {
    if (!el) {
      return;
    }
    if (src && String(src).startsWith('local') && !!useAll) {
      const start = total ? Math.min(total, offset + 1) : offset + 1;
      const end = total ? Math.min(total, offset + count) : offset + count;
      el.textContent = `Items ${start}-${end}${total ? ` of ${total}` : ''}`;
    } else {
      el.textContent = '';
    }
  } catch {}
}

const EGTopRenderer = {
  buildRow,
  renderSparkline,
  loadSparkIfNeeded,
  appendRowsChunked,
  updatePageInfo,
};
try {
  window.EGTopRenderer = EGTopRenderer;
} catch {}
export default EGTopRenderer;
