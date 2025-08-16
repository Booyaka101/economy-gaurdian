// Catalog routes
// Provides: /catalog/status, /catalog/rebuild, /catalog/search, and Blizzard catalog helpers

export default function registerCatalogRoutes(app, deps) {
  const {
    getCatalogStatus,
    catalogRebuildState,
    AUTO_CATALOG_REBUILD,
    CATALOG_MIN_COUNT,
    CATALOG_REFRESH_HOURS,
    maybeRebuildCatalog,
    loadCatalogFromDisk,
    // Blizzard-specific catalog endpoints
    rebuildItemCatalog,
  } = deps;

  // --- CORS and rate-limit helpers (scoped to catalog endpoints) ---
  const CORS_ORIGIN = process.env.CORS_ORIGIN || '*';
  const RL_WINDOW_MS = Number(process.env.RATE_LIMIT_WINDOW_MS || 60_000);
  const RL_MAX = Number(process.env.RATE_LIMIT_MAX || 120);
  const rl = new Map(); // key -> { count, resetAt }
  function setCORS(res) {
    try {
      res.setHeader('Access-Control-Allow-Origin', CORS_ORIGIN);
      res.setHeader('Access-Control-Allow-Methods', 'GET,POST,OPTIONS');
      res.setHeader('Access-Control-Allow-Headers', 'Content-Type, X-API-Key');
      res.setHeader('Access-Control-Max-Age', '600');
    } catch {}
  }
  function clientIp(req) {
    const xf = (req.headers['x-forwarded-for'] || '').toString().split(',')[0].trim();
    return xf || req.ip || req.connection?.remoteAddress || 'unknown';
  }
  function checkRate(req, res) {
    const now = Date.now();
    const key = clientIp(req) + '|' + (req.path || '');
    let st = rl.get(key);
    if (!st || now >= st.resetAt) {
      st = { count: 0, resetAt: now + RL_WINDOW_MS };
      rl.set(key, st);
    }
    st.count += 1;
    if (st.count > RL_MAX) {
      setCORS(res);
      res.setHeader('Retry-After', Math.ceil((st.resetAt - now) / 1000));
      res.status(429).json({ error: 'rate_limited', retryAfterMs: Math.max(0, st.resetAt - now) });
      return false;
    }
    return true;
  }
  // Pre-flight for catalog endpoints
  app.options('/catalog/*', (req, res) => {
    setCORS(res);
    res.sendStatus(204);
  });

  app.get('/catalog/status', (_req, res) => {
    try {
      setCORS(res);
      return res.json({
        status: getCatalogStatus(),
        rebuild: catalogRebuildState,
        config: { AUTO_CATALOG_REBUILD, CATALOG_MIN_COUNT, CATALOG_REFRESH_HOURS },
      });
    } catch (e) {
      setCORS(res);
      return res
        .status(500)
        .json({ error: 'catalog_status_failed', message: e?.message || String(e) });
    }
  });

  app.post('/catalog/rebuild', async (req, res) => {
    try {
      // API key protection for rebuild
      const want = process.env.API_KEY || process.env.EG_API_KEY;
      if (want && (req.get('x-api-key') || req.query.key) !== want) {
        setCORS(res);
        return res.status(401).json({ error: 'unauthorized' });
      }
      setCORS(res);
      if (catalogRebuildState.running) {
        return res.json({ ok: true, running: true });
      }
      const reason = String(req.query.reason || 'manual');
      setTimeout(() => {
        maybeRebuildCatalog(reason);
      }, 0);
      return res.json({ ok: true, scheduled: true });
    } catch (e) {
      setCORS(res);
      return res
        .status(500)
        .json({ error: 'catalog_rebuild_failed', message: e?.message || String(e) });
    }
  });

  // Basic name search within catalog (debug/helper)
  app.get('/catalog/search', (req, res) => {
    try {
      if (!checkRate(req, res)) {
        return;
      }
      setCORS(res);
      const rawQ = String(req.query.q || '').trim();
      if (!rawQ) {
        res.status(400).json({ error: 'missing_query' });
        return;
      }
      let limit = Number(req.query.limit || 50);
      if (!Number.isFinite(limit) || limit <= 0) {
        limit = 50;
      }
      limit = Math.min(Math.max(1, limit), 50);

      const toks = rawQ.toLowerCase().split(/\s+/).filter(Boolean);
      const cat = loadCatalogFromDisk();
      const items = Array.isArray(cat?.items) ? cat.items : [];
      const isNum = /^\d+$/.test(rawQ);
      const qId = isNum ? Number(rawQ) : null;

      // Score results: exact id > startsWith all tokens > contains all tokens
      const results = [];
      for (const it of items) {
        const id = Number(it?.id);
        const name = pickName(it);
        const lo = String(name || '').toLowerCase();
        let score = null;
        if (isNum && id === qId) {
          score = 0;
        } else if (toks.every((t) => lo.startsWith(t))) {
          score = 1;
        } else if (toks.every((t) => lo.includes(t))) {
          score = 2;
        }
        if (score != null) {
          results.push({ id, name, score });
        }
      }
      results.sort((a, b) => a.score - b.score || String(a.name).localeCompare(String(b.name)));
      const out = results.slice(0, limit).map((r) => ({ id: r.id, name: r.name }));
      res.json({ count: out.length, items: out });
      return;
    } catch (e) {
      setCORS(res);
      res.status(500).json({ error: 'catalog_search_failed', message: e?.message || String(e) });
      return;
    }
  });

  // Blizzard catalog status
  app.get('/blizzard/items/catalog/status', (req, res) => {
    try {
      setCORS(res);
      const s = getCatalogStatus();
      return res.json({ source: 'blizzard', ...s });
    } catch (e) {
      setCORS(res);
      return res
        .status(500)
        .json({ error: 'catalog_status_failed', message: e?.message || String(e) });
    }
  });

  // Trigger/resume item catalog rebuild (background)
  app.post('/blizzard/items/catalog/rebuild', async (req, res) => {
    try {
      // API key protection for rebuild
      const want = process.env.API_KEY || process.env.EG_API_KEY;
      if (want && (req.get('x-api-key') || req.query.key) !== want) {
        setCORS(res);
        return res.status(401).json({ error: 'unauthorized' });
      }
      setCORS(res);
      const resume = String(req.query.resume ?? '1') !== '0';
      const pageLimit = Number(req.query.pageLimit || 0);
      setTimeout(async () => {
        try {
          await rebuildItemCatalog({ resume, pageLimit });
        } catch (e) {
          console.warn('[EG] Catalog rebuild failed', e?.message);
        }
      }, 0);
      return res.json({ started: true, resume, pageLimit });
    } catch (e) {
      setCORS(res);
      return res
        .status(500)
        .json({ error: 'catalog_rebuild_failed', message: e?.message || String(e) });
    }
  });

  // Helper: pick a display name from a catalog item
  function pickName(it) {
    if (!it) {
      return '';
    }
    const nm = it?.name;
    if (!nm) {
      return '';
    }
    return (
      nm.en_GB ||
      nm.en_US ||
      nm['en-US'] ||
      nm.en ||
      nm.default ||
      nm.name ||
      nm.label ||
      nm.display ||
      ''
    );
  }

  // Get a single catalog item by ID
  app.get('/catalog/item/:id', (req, res) => {
    try {
      if (!checkRate(req, res)) {
        return;
      }
      setCORS(res);
      const id = Number(req.params.id);
      if (!Number.isFinite(id) || id <= 0) {
        res.status(400).json({ error: 'bad_id' });
        return;
      }
      const cat = loadCatalogFromDisk();
      const items = Array.isArray(cat?.items) ? cat.items : [];
      const it = items.find((x) => Number(x?.id) === id);
      if (!it) {
        res.status(404).json({ error: 'not_found', id });
        return;
      }
      res.json({ id, name: pickName(it), item: it });
      return;
    } catch (e) {
      setCORS(res);
      res.status(500).json({ error: 'catalog_item_failed', message: e?.message || String(e) });
      return;
    }
  });

  // Bulk fetch catalog items by IDs
  app.post('/catalog/bulk', (req, res) => {
    try {
      if (!checkRate(req, res)) {
        return;
      }
      setCORS(res);
      const body = (req && req.body) || {};
      const ids = Array.isArray(body.ids)
        ? body.ids.map((n) => Number(n)).filter((n) => Number.isFinite(n) && n > 0)
        : [];
      if (!ids.length) {
        res.status(400).json({ error: 'missing_ids' });
        return;
      }
      // Limit to avoid large payloads
      const MAX = 1000;
      const want = ids.slice(0, MAX);
      const cat = loadCatalogFromDisk();
      const items = Array.isArray(cat?.items) ? cat.items : [];
      const map = new Map(items.map((x) => [Number(x?.id), x]));
      const out = [];
      for (const id of want) {
        const it = map.get(id);
        if (it) {
          out.push({ id, name: pickName(it), item: it });
        }
      }
      res.json({ count: out.length, items: out, truncated: ids.length > MAX });
      return;
    } catch (e) {
      setCORS(res);
      res.status(500).json({ error: 'catalog_bulk_failed', message: e?.message || String(e) });
      return;
    }
  });

  // Autocomplete endpoint optimized for typeahead
  app.get('/catalog/autocomplete', (req, res) => {
    try {
      if (!checkRate(req, res)) {
        return;
      }
      setCORS(res);
      const rawQ = String(req.query.q || '').trim();
      const q = rawQ.toLowerCase();
      let limit = Number(req.query.limit || 10);
      if (!Number.isFinite(limit) || limit <= 0) {
        limit = 10;
      }
      limit = Math.min(Math.max(1, limit), 50);
      if (!q) {
        res.json({ count: 0, items: [] });
        return;
      }
      const cat = loadCatalogFromDisk();
      const items = Array.isArray(cat?.items) ? cat.items : [];
      const isNum = /^\d+$/.test(rawQ);
      const qId = isNum ? Number(rawQ) : null;

      // Score: startsWith > contains; prefer exact id match
      const results = [];
      for (const it of items) {
        const id = Number(it?.id);
        const name = pickName(it);
        const lo = String(name || '').toLowerCase();
        let score = null;
        if (isNum && id === qId) {
          score = 0;
        } // highest priority
        else if (lo.startsWith(q)) {
          score = 1;
        } else if (lo.includes(q)) {
          score = 2;
        }
        if (score != null) {
          results.push({ id, name, score });
        }
      }
      results.sort((a, b) => a.score - b.score || String(a.name).localeCompare(String(b.name)));
      const out = results.slice(0, limit).map((r) => ({ id: r.id, name: r.name }));
      res.json({ count: out.length, items: out });
      return;
    } catch (e) {
      setCORS(res);
      res
        .status(500)
        .json({ error: 'catalog_autocomplete_failed', message: e?.message || String(e) });
      return;
    }
  });
}
