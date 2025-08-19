(() => {
  const $ = (sel) => document.querySelector(sel);
  const fmtGold = (v) => {
    if (!Number.isFinite(v)) {
      return '0';
    }
    const g = Math.round(v); // assuming values already in gold units
    return g.toLocaleString();
  };

  // Time helpers
  const fmtTime = (tSec) => {
    const ms = Number(tSec || 0) * 1000;
    if (!Number.isFinite(ms) || ms <= 0) {
      return '';
    }
    try {
      const d = new Date(ms);
      return d.toLocaleString();
    } catch {
      return '';
    }
  };
  const fmtAge = (tSec) => {
    const ms = Number(tSec || 0) * 1000;
    if (!Number.isFinite(ms) || ms <= 0) {
      return '';
    }
    const delta = Date.now() - ms;
    const m = Math.max(0, Math.floor(delta / 60000));
    if (m < 60) {
      return `${m}m`;
    }
    const h = Math.floor(m / 60);
    if (h < 48) {
      return `${h}h`;
    }
    const d = Math.floor(h / 24);
    return `${d}d`;
  };

  // Simple monogram avatar renderer (data URL)
  function monogramAvatar(name) {
    const txt = (name || '').trim();
    const initials = txt
      ? txt
          .split(/\s+/)
          .slice(0, 2)
          .map((s) => s[0]?.toUpperCase() || '')
          .join('')
      : 'EG';
    const seed = Array.from(txt).reduce((h, ch) => (h * 31 + ch.charCodeAt(0)) >>> 0, 0xc0ffee);
    const h = seed % 360;
    const c1 = `hsl(${h},70%,32%)`;
    const c2 = `hsl(${(h + 40) % 360},70%,22%)`;
    const size = 120;
    const canvas = document.createElement('canvas');
    canvas.width = size;
    canvas.height = size;
    const ctx = canvas.getContext('2d');
    // bg circle
    const grad = ctx.createLinearGradient(0, 0, size, size);
    grad.addColorStop(0, c1);
    grad.addColorStop(1, c2);
    ctx.fillStyle = grad;
    ctx.beginPath();
    ctx.arc(size / 2, size / 2, size / 2 - 2, 0, Math.PI * 2);
    ctx.fill();
    // initials
    ctx.fillStyle = '#e6ebff';
    ctx.font = 'bold 52px Inter, system-ui, sans-serif';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText(initials, size / 2, size / 2);
    return canvas.toDataURL('image/png');
  }

  function updateHero() {
    const nm = getSelectedChar() || '';
    const rl = getSelectedRealm() || '';
    const avatar = $('#charAvatar');
    const heroName = $('#heroName');
    const heroSub = $('#heroSub');
    if (heroName) {
      heroName.textContent = nm || 'Select a character';
    }
    if (heroSub) {
      heroSub.textContent = rl || (nm ? '' : '—');
    }
    if (avatar) {
      avatar.src = monogramAvatar(nm || rl || 'EG');
    }
  }

  // Profile selection helpers
  function getSelectedRealm() {
    return localStorage.getItem('eg.selRealm') || '';
  }
  function getSelectedChar() {
    return localStorage.getItem('eg.selChar') || '';
  }
  function setSelectedRealm(v) {
    localStorage.setItem('eg.selRealm', v || '');
  }
  function setSelectedChar(v) {
    localStorage.setItem('eg.selChar', v || '');
  }
  // Builders for endpoint-specific query params
  const buildScope = () => ({ realm: getSelectedRealm(), character: getSelectedChar() });
  async function loadProfileOptions() {
    $('#profStatus') && ($('#profStatus').textContent = 'Loading…');
    try {
      const resp = await fetch('/player/characters');
      const data = await resp.json();
      const realms = data?.realms || {};
      const selRealm = $('#selRealm');
      const selChar = $('#selChar');
      if (selRealm && selChar) {
        // populate realms
        const savedR = getSelectedRealm();
        const savedC = getSelectedChar();
        selRealm.innerHTML = '<option value="">All</option>';
        for (const r of Object.keys(realms)) {
          const opt = document.createElement('option');
          opt.value = r;
          opt.textContent = r;
          if (r === savedR) {
            opt.selected = true;
          }
          selRealm.appendChild(opt);
        }
        // populate chars for current realm
        const curR = selRealm.value || savedR || '';
        const chars = curR ? realms[curR] || [] : Array.from(new Set(Object.values(realms).flat()));
        selChar.innerHTML = '<option value="">All</option>';
        for (const ch of chars) {
          const opt = document.createElement('option');
          opt.value = ch;
          opt.textContent = ch;
          if (ch === savedC) {
            opt.selected = true;
          }
          selChar.appendChild(opt);
        }
        // If no saved selection, try auto-select most recent from server
        if (!savedR && !savedC) {
          try {
            const curResp = await fetch('/player/current');
            const cur = await curResp.json();
            const curRlm = cur?.current?.realm || '';
            const curChr = cur?.current?.character || '';
            if (curRlm) {
              setSelectedRealm(curRlm);
              selRealm.value = curRlm;
              // repopulate chars for selected realm
              const chs = realms[curRlm] || [];
              selChar.innerHTML = '<option value="">All</option>';
              for (const ch of chs) {
                const opt = document.createElement('option');
                opt.value = ch;
                opt.textContent = ch;
                if (curChr && ch === curChr) {
                  opt.selected = true;
                }
                selChar.appendChild(opt);
              }
              if (curChr) {
                setSelectedChar(curChr);
              }
              refreshAll();
            }
          } catch (e) {
            /* ignore */
          }
        }
        // Profile change/event bindings moved to controller
      }
      $('#profStatus') && ($('#profStatus').textContent = '');
    } catch (e) {
      console.error(e);
      $('#profStatus') && ($('#profStatus').textContent = 'Failed to load');
    }
  }

  const getParams = () => ({
    realm: getSelectedRealm(),
    char: getSelectedChar(),
    sinceHours: Math.max(1, Math.min(24 * 365, Number($('#sinceHours').value || 168))),
  });

  async function loadTotals() {
    const { realm, char, sinceHours } = getParams();
    const qs = new URLSearchParams();
    if (realm) {
      qs.set('realm', realm);
    }
    if (char) {
      qs.set('char', char);
    }
    qs.set('sinceHours', String(sinceHours));
    $('#status').textContent = 'Loading totals…';
    try {
      const resp = await fetch(`/player/stats?${qs.toString()}`);
      const data = await resp.json();
      $('#salesCount').textContent = String(data?.totals?.salesCount || 0);
      $('#gross').textContent = fmtGold(Number(data?.totals?.gross || 0) / 10000);
      $('#ahCut').textContent = fmtGold(Number(data?.totals?.ahCut || 0) / 10000);
      $('#net').textContent = fmtGold(Number(data?.totals?.net || 0) / 10000);
      $('#status').textContent = `Realm: ${data.realm}, Char: ${data.character}`;
    } catch (e) {
      console.error(e);
      $('#status').textContent = 'Failed to load totals';
    }
  }

  async function loadPending() {
    const realm = getSelectedRealm();
    const char = getSelectedChar();
    const windowMin = Math.max(10, Math.min(1440, Number($('#windowMin').value || 60)));
    const qs = new URLSearchParams();
    if (realm) {
      qs.set('realm', realm);
    }
    if (char) {
      qs.set('char', char);
    }
    qs.set('windowMin', String(windowMin));
    $('#pendingStatus').textContent = 'Loading pending…';
    try {
      const resp = await fetch(`/player/payouts/awaiting?${qs.toString()}`);
      const data = await resp.json();
      const rows = data?.items || [];
      const tbody = $('#pendingRows');
      tbody.innerHTML = '';
      // Resolve item names for better UX
      const ids = Array.from(
        new Set(rows.map((r) => Number(r.itemId || 0)).filter((n) => Number.isFinite(n) && n > 0)),
      );
      let nameMap = {};
      if (ids.length) {
        try {
          const respNames = await fetch(`/blizzard/item-names?ids=${ids.join(',')}`);
          const json = await respNames.json();
          // support both { names: {id:name}, map:{id:name} } formats
          nameMap = json?.names || json?.map || {};
        } catch (e) {
          console.warn('name resolve failed', e);
        }
      }
      for (const r of rows) {
        const tr = document.createElement('tr');
        const itemCell = document.createElement('td');
        const id = Number(r.itemId || 0);
        const nm =
          id && (nameMap[String(id)] || nameMap[id])
            ? `${nameMap[String(id)] || nameMap[id]} (#${id})`
            : id
              ? `#${id}`
              : '';
        itemCell.textContent = nm;
        const qtyCell = document.createElement('td');
        qtyCell.textContent = String(r.qty || 0);
        const unitCell = document.createElement('td');
        unitCell.className = 'mono';
        unitCell.textContent = fmtGold(Number(r.unit || 0) / 10000);
        const grossCell = document.createElement('td');
        grossCell.className = 'mono';
        grossCell.textContent = fmtGold(Number(r.gross || 0) / 10000);
        const etaCell = document.createElement('td');
        etaCell.textContent = `${Math.round(Number(r.etaMinutes || 60))}m`;
        tr.append(itemCell, qtyCell, unitCell, grossCell, etaCell);
        tbody.appendChild(tr);
      }
      $('#pendingStatus').textContent = `${rows.length} pending`;
    } catch (e) {
      console.error(e);
      $('#pendingStatus').textContent = 'Failed to load pending';
    }
  }

  async function loadInsights() {
    const windowDays = Math.max(1, Math.min(90, Number($('#insDays').value || 7)));
    $('#insStatus').textContent = 'Loading…';
    try {
      const { realm, character } = buildScope();
      const qs = new URLSearchParams();
      qs.set('windowDays', String(windowDays));
      if (realm) {
        qs.set('realm', realm);
      }
      if (character) {
        qs.set('character', character);
      }
      const resp = await fetch(`/player/insights?${qs.toString()}`);
      const data = await resp.json();
      const best = (data?.bestHours || []).map((h) => `${h}:00`).join(', ');
      const items = (data?.items || [])
        .slice(0, 10)
        .map((it) => `#${it.itemId} net ${fmtGold((it.net || 0) / 10000)}g`)
        .join('\n');
      $('#insOut').textContent = `Best hours: ${best}\nTop items (net):\n${items}`;
      $('#insStatus').textContent = '';
    } catch (e) {
      console.error(e);
      $('#insStatus').textContent = 'Failed to load insights';
    }
  }

  async function loadAdvisor() {
    const target = Math.max(1, Math.min(8, Number($('#advTarget').value || 2)));
    $('#advStatus').textContent = 'Computing…';
    try {
      const { realm, character } = buildScope();
      const qs = new URLSearchParams();
      qs.set('targetHours', String(target));
      if (realm) {
        qs.set('realm', realm);
      }
      if (character) {
        qs.set('character', character);
      }
      const resp = await fetch(`/player/recommend/window?${qs.toString()}`);
      const data = await resp.json();
      const win = data?.window;
      const ranked = data?.ranked || [];
      const top = ranked
        .slice(0, 3)
        .map((x) => `${x.hour}:00`)
        .join(', ');
      $('#advOut').textContent = win
        ? `Next best window: ${win.start} → ${win.end} | Top hours: ${top}`
        : 'No data yet';
      $('#advStatus').textContent = '';
    } catch (e) {
      console.error(e);
      $('#advStatus').textContent = 'Failed to compute';
    }
  }

  async function loadTopItems() {
    const days = Math.max(1, Math.min(365, Number($('#topDays').value || 7)));
    const limit = Math.max(1, Math.min(200, Number($('#topLimit').value || 25)));
    $('#topStatus').textContent = 'Loading…';
    try {
      const { realm, character } = buildScope();
      const qs = new URLSearchParams();
      qs.set('windowDays', String(days));
      qs.set('limit', String(limit));
      if (realm) {
        qs.set('realm', realm);
      }
      if (character) {
        qs.set('character', character);
      }
      const resp = await fetch(`/player/top-items?${qs.toString()}`);
      const data = await resp.json();
      const items = data?.items || [];
      const ids = Array.from(
        new Set(
          items.map((it) => Number(it.itemId || 0)).filter((n) => Number.isFinite(n) && n > 0),
        ),
      );
      let nameMap = {};
      if (ids.length) {
        try {
          const r = await fetch(`/blizzard/item-names?ids=${ids.join(',')}`);
          const j = await r.json();
          nameMap = j?.names || j?.map || {};
        } catch {}
      }
      const tbody = $('#topRows');
      tbody.innerHTML = '';
      for (const it of items) {
        const tr = document.createElement('tr');
        const nameCell = document.createElement('td');
        const id = Number(it.itemId || 0);
        const nm =
          id && (nameMap[String(id)] || nameMap[id])
            ? `${nameMap[String(id)] || nameMap[id]} (#${id})`
            : id
              ? `#${id}`
              : '';
        nameCell.textContent = nm;
        const salesCell = document.createElement('td');
        salesCell.textContent = String(it.salesCount || 0);
        const qtyCell = document.createElement('td');
        qtyCell.textContent = String(it.qty || 0);
        const netCell = document.createElement('td');
        netCell.className = 'mono';
        netCell.textContent = fmtGold(Number(it.net || 0) / 10000);
        tr.append(nameCell, salesCell, qtyCell, netCell);
        tbody.appendChild(tr);
      }
      $('#topStatus').textContent = `${items.length} items`;
    } catch (e) {
      console.error(e);
      $('#topStatus').textContent = 'Failed to load';
    }
  }

  async function recommend() {
    const itemId = Number($('#recItemId').value || 0);
    const targetHours = Math.max(1, Math.min(72, Number($('#recTarget').value || 12)));
    const maxStack = Math.max(1, Math.min(10000, Number($('#recMaxStack').value || 200)));
    if (!Number.isFinite(itemId) || itemId <= 0) {
      $('#recOut').textContent = 'Enter a valid Item ID';
      return;
    }
    $('#recOut').textContent = 'Loading…';
    try {
      const qs = new URLSearchParams({
        itemId: String(itemId),
        targetHours: String(targetHours),
        maxStack: String(maxStack),
      });
      // Recommendation doesn't require realm/character; omit to avoid confusion
      const resp = await fetch(`/player/recommend/price?${qs.toString()}`);
      const data = await resp.json();
      const r = data?.recommended;
      if (!r) {
        $('#recOut').textContent = 'No recommendation available yet';
        return;
      }
      // Fetch fair value to blend
      let fair = 0;
      try {
        const fvResp = await fetch(`/prices/fair-values?ids=${itemId}`);
        const fv = await fvResp.json();
        // Try common shapes
        if (fv && typeof fv === 'object') {
          if (fv.map && fv.map[String(itemId)] && Number.isFinite(Number(fv.map[String(itemId)]))) {
            fair = Number(fv.map[String(itemId)]);
          } else if (
            fv.items &&
            fv.items[String(itemId)] &&
            Number.isFinite(Number(fv.items[String(itemId)].fair))
          ) {
            fair = Number(fv.items[String(itemId)].fair);
          } else if (fv[String(itemId)] && Number.isFinite(Number(fv[String(itemId)]))) {
            fair = Number(fv[String(itemId)]);
          }
        }
      } catch (e) {
        /* ignore fair value errors */
      }
      // Blend: keep within 60%-105% of fair value if fair is available
      const unitRaw = Number(r.unit || 0);
      const unitBlended =
        fair > 0
          ? Math.max(Math.floor(fair * 0.6), Math.min(Math.floor(fair * 1.05), unitRaw || fair))
          : unitRaw;
      const stack = Number(r.stack || maxStack);
      const gross = unitBlended * stack;
      const ahCut = Math.round(gross * 0.05);
      const net = gross - ahCut;
      const lines = [];
      lines.push(`Unit (raw): ${fmtGold((unitRaw || 0) / 10000)}g`);
      if (fair > 0) {
        lines.push(`Fair: ${fmtGold(fair / 10000)}g`);
      }
      if (fair > 0) {
        lines.push(`Unit (blended): ${fmtGold(unitBlended / 10000)}g`);
      }
      lines.push(`Stack: ${stack}`);
      lines.push(`Net: ${fmtGold(net / 10000)}g (AH Cut ${fmtGold(ahCut / 10000)}g)`);
      lines.push(`ETA: ${r.expectedETA}h`);
      $('#recOut').textContent = lines.join(' | ');
    } catch (e) {
      console.error(e);
      $('#recOut').textContent = 'Failed to load recommendation';
    }
  }

  // Button bindings moved to controller

  async function refreshAll() {
    loadTotals().then(loadPending);
    loadInsights();
    loadAdvisor();
    loadTopItems();
  }

  async function rebuildModels() {
    try {
      await fetch('/player/learn/rebuild', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ sinceDays: 30 }),
      });
    } catch (e) {
      console.warn('learn rebuild failed', e);
    }
  }
  // Initialize is orchestrated by controller
  async function initFromURLAndRefresh() {
    try {
      const url = new URL(window.location.href);
      const ur = url.searchParams.get('realm') || '';
      const uc = url.searchParams.get('character') || '';
      const norm = (s) =>
        (s || '')
          .toLowerCase()
          .replace(/[ '\u00A0]/g, '')
          .replace(/’/g, '')
          .replace(/[^a-z0-9]+/g, '');
      let changed = false;
      const sr = $('#selRealm');
      const sc = $('#selChar');
      if (ur && sr) {
        // Find best matching realm option by normalized comparison
        const target = norm(ur);
        let matchVal = '';
        for (const opt of Array.from(sr.options || [])) {
          if (norm(opt.value) === target || norm(opt.textContent || '') === target) {
            matchVal = opt.value;
            break;
          }
        }
        if (matchVal) {
          setSelectedRealm(matchVal);
          sr.value = matchVal;
          sr.dispatchEvent(new Event('change'));
          changed = true;
        }
      }
      if (uc && sc) {
        // After realm change, repopulated character list; normalize match
        const targetC = norm(uc);
        let matchChar = '';
        for (const opt of Array.from(sc.options || [])) {
          if (norm(opt.value) === targetC || norm(opt.textContent || '') === targetC) {
            matchChar = opt.value;
            break;
          }
        }
        if (matchChar) {
          setSelectedChar(matchChar);
          sc.value = matchChar;
          sc.dispatchEvent(new Event('change'));
          changed = true;
        }
      }
      if (changed) {
        url.searchParams.delete('realm');
        url.searchParams.delete('character');
        history.replaceState({}, '', url.toString());
      }
    } catch (_) {
      /* ignore URL errors */
    }
    // Initial load after possible URL-based selection
    updateHero();
    refreshAll();
  }

  // --- Ledger / Summary / Overdue loaders ---
  let _ledgerOffset = 0;
  function setLedgerOffset(v) {
    _ledgerOffset = Math.max(0, Number(v) || 0);
  }
  function getLedgerOffset() {
    return _ledgerOffset;
  }

  async function loadLedger({ resetOffset } = {}) {
    if (resetOffset) {
      setLedgerOffset(0);
    }
    const realm = getSelectedRealm();
    const char = getSelectedChar();
    const since = Math.max(1, Math.min(24 * 365, Number($('#ledgerSince')?.value || 168)));
    const type = String($('#ledgerType')?.value || 'all').toLowerCase();
    const limit = Math.max(10, Math.min(200, Number($('#ledgerLimit')?.value || 25)));
    const offset = getLedgerOffset();
    const qs = new URLSearchParams();
    if (realm) {
      qs.set('realm', realm);
    }
    if (char) {
      qs.set('char', char);
    }
    qs.set('sinceHours', String(since));
    qs.set('type', type);
    qs.set('limit', String(limit));
    qs.set('offset', String(offset));
    $('#ledgerStatus') && ($('#ledgerStatus').textContent = 'Loading…');
    try {
      const resp = await fetch(`/player/ledger?${qs.toString()}`);
      const data = await resp.json();
      const items = data?.items || [];
      const total = Number(data?.total || items.length || 0);
      const tbody = $('#ledgerRows');
      if (tbody) {
        tbody.innerHTML = '';
      }
      // Resolve names
      const ids = Array.from(
        new Set(items.map((r) => Number(r.itemId || 0)).filter((n) => Number.isFinite(n) && n > 0)),
      );
      let nameMap = {};
      if (ids.length) {
        try {
          const r = await fetch(`/blizzard/item-names?ids=${ids.join(',')}`);
          const j = await r.json();
          nameMap = j?.names || j?.map || {};
        } catch {}
      }
      for (const r of items) {
        const tr = document.createElement('tr');
        const timeCell = document.createElement('td');
        timeCell.className = 'mono';
        timeCell.textContent = fmtTime(r.t);
        const typeCell = document.createElement('td');
        typeCell.textContent = String(r.type || '');
        const itemCell = document.createElement('td');
        const id = Number(r.itemId || 0);
        const nm =
          id && (nameMap[String(id)] || nameMap[id])
            ? `${nameMap[String(id)] || nameMap[id]} (#${id})`
            : r.itemName || (id ? `#${id}` : '');
        itemCell.textContent = nm;
        const qtyCell = document.createElement('td');
        qtyCell.textContent = String(r.qty || 0);
        const unitCell = document.createElement('td');
        unitCell.className = 'mono';
        unitCell.textContent = r.unit != null ? fmtGold(Number(r.unit) / 10000) : '';
        const grossCell = document.createElement('td');
        grossCell.className = 'mono';
        grossCell.textContent = r.gross != null ? fmtGold(Number(r.gross) / 10000) : '';
        const cutCell = document.createElement('td');
        cutCell.className = 'mono';
        cutCell.textContent = r.cut != null ? fmtGold(Number(r.cut) / 10000) : '';
        const netCell = document.createElement('td');
        netCell.className = 'mono';
        netCell.textContent = r.net != null ? fmtGold(Number(r.net) / 10000) : '';
        tr.append(timeCell, typeCell, itemCell, qtyCell, unitCell, grossCell, cutCell, netCell);
        tbody && tbody.appendChild(tr);
      }
      // Status and pager button states
      if ($('#ledgerStatus')) {
        const start = Math.min(total, offset + (items.length ? 1 : 0));
        const end = Math.min(total, offset + items.length);
        $('#ledgerStatus').textContent = total
          ? `Showing ${start}–${end} of ${total}`
          : 'No results';
      }
      const prevBtn = $('#ledgerPrev');
      const nextBtn = $('#ledgerNext');
      if (prevBtn) {
        prevBtn.disabled = offset <= 0;
      }
      if (nextBtn) {
        nextBtn.disabled = offset + items.length >= total;
      }
    } catch (e) {
      console.error(e);
      $('#ledgerStatus') && ($('#ledgerStatus').textContent = 'Failed to load');
    }
  }

  async function loadSummary() {
    const days = Math.max(1, Math.min(90, Number($('#sumDays')?.value || 14)));
    $('#summaryStatus') && ($('#summaryStatus').textContent = 'Loading…');
    try {
      const realm = getSelectedRealm();
      const char = getSelectedChar();
      const qs = new URLSearchParams();
      qs.set('windowDays', String(days));
      if (realm) {
        qs.set('realm', realm);
      }
      if (char) {
        qs.set('char', char);
      }
      const resp = await fetch(`/player/summary?${qs.toString()}`);
      const data = await resp.json();
      const rows = data?.days || [];
      const tbody = $('#sumRows');
      if (tbody) {
        tbody.innerHTML = '';
      }
      for (const d of rows) {
        const tr = document.createElement('tr');
        const dayCell = document.createElement('td');
        dayCell.textContent = d.day || '';
        const salesCell = document.createElement('td');
        salesCell.textContent = String(d.salesCount || 0);
        const grossCell = document.createElement('td');
        grossCell.className = 'mono';
        grossCell.textContent = fmtGold(Number(d.gross || 0) / 10000);
        const cutCell = document.createElement('td');
        cutCell.className = 'mono';
        cutCell.textContent = fmtGold(Number(d.ahCut || 0) / 10000);
        const netSalesCell = document.createElement('td');
        netSalesCell.className = 'mono';
        netSalesCell.textContent = fmtGold(Number(d.netSales || 0) / 10000);
        const netPayoutsCell = document.createElement('td');
        netPayoutsCell.className = 'mono';
        netPayoutsCell.textContent = fmtGold(Number(d.netPayouts || 0) / 10000);
        tr.append(dayCell, salesCell, grossCell, cutCell, netSalesCell, netPayoutsCell);
        tbody && tbody.appendChild(tr);
      }
      $('#summaryStatus') && ($('#summaryStatus').textContent = `${rows.length} days`);
    } catch (e) {
      console.error(e);
      $('#summaryStatus') && ($('#summaryStatus').textContent = 'Failed to load');
    }
  }

  async function loadUnmatched() {
    const older = Math.max(10, Math.min(10080, Number($('#unmOlder')?.value || 120)));
    const grace = Math.max(0, Math.min(720, Number($('#unmGrace')?.value || 10)));
    $('#unmatchedStatus') && ($('#unmatchedStatus').textContent = 'Loading…');
    try {
      const realm = getSelectedRealm();
      const char = getSelectedChar();
      const qs = new URLSearchParams();
      if (realm) {
        qs.set('realm', realm);
      }
      if (char) {
        qs.set('char', char);
      }
      qs.set('olderThanMin', String(older));
      qs.set('graceMin', String(grace));
      const resp = await fetch(`/player/payouts/unmatched?${qs.toString()}`);
      const data = await resp.json();
      const items = data?.items || [];
      const ids = Array.from(
        new Set(items.map((r) => Number(r.itemId || 0)).filter((n) => Number.isFinite(n) && n > 0)),
      );
      let nameMap = {};
      if (ids.length) {
        try {
          const r = await fetch(`/blizzard/item-names?ids=${ids.join(',')}`);
          const j = await r.json();
          nameMap = j?.names || j?.map || {};
        } catch {}
      }
      const tbody = $('#unmRows');
      if (tbody) {
        tbody.innerHTML = '';
      }
      for (const r of items) {
        const tr = document.createElement('tr');
        const itemCell = document.createElement('td');
        const id = Number(r.itemId || 0);
        const nm =
          id && (nameMap[String(id)] || nameMap[id])
            ? `${nameMap[String(id)] || nameMap[id]} (#${id})`
            : id
              ? `#${id}`
              : '';
        itemCell.textContent = nm;
        const qtyCell = document.createElement('td');
        qtyCell.textContent = String(r.qty || 0);
        const unitCell = document.createElement('td');
        unitCell.className = 'mono';
        unitCell.textContent = fmtGold(Number(r.unit || 0) / 10000);
        const grossCell = document.createElement('td');
        grossCell.className = 'mono';
        grossCell.textContent = fmtGold(Number(r.gross || 0) / 10000);
        const ageCell = document.createElement('td');
        ageCell.textContent = fmtAge(r.t);
        tr.append(itemCell, qtyCell, unitCell, grossCell, ageCell);
        tbody && tbody.appendChild(tr);
      }
      $('#unmatchedStatus') && ($('#unmatchedStatus').textContent = `${items.length} overdue`);
    } catch (e) {
      console.error(e);
      $('#unmatchedStatus') && ($('#unmatchedStatus').textContent = 'Failed to load');
    }
  }

  // Expose controller API
  try {
    window.EGPlayer = Object.freeze({
      fmtGold,
      monogramAvatar,
      fmtTime,
      fmtAge,
      updateHero,
      getSelectedRealm,
      getSelectedChar,
      setSelectedRealm,
      setSelectedChar,
      buildScope,
      getParams,
      loadProfileOptions,
      loadTotals,
      loadPending,
      loadInsights,
      loadAdvisor,
      loadTopItems,
      recommend,
      refreshAll,
      rebuildModels,
      initFromURLAndRefresh,
      // new loaders & pager state
      loadLedger,
      loadSummary,
      loadUnmatched,
      setLedgerOffset,
      getLedgerOffset,
    });
  } catch {}
})();
