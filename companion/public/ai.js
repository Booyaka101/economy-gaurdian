/* AI Dashboard client */
(function () {
  const $ = (sel) => document.querySelector(sel);
  const out = (el, data) => {
    el.value = typeof data === 'string' ? data : JSON.stringify(data, null, 2);
  };
  const fmtErr = (e) => ({ error: true, message: e && e.message ? e.message : String(e) });

  // Surge Alerts
  const _surgeBtn = $('#surgeBtn');
  const surgeOut = $('#surgeOut');
  async function runSurgeAlerts() {
    const src = $('#surgeSource')?.value;
    const th = $('#surgeTh')?.value;
    const lim = $('#surgeLim')?.value;
    out(surgeOut, 'Scanning…');
    try {
      const res = await fetch(
        `/ai/surge-alerts?source=${encodeURIComponent(src)}&threshold=${encodeURIComponent(th)}&limit=${encodeURIComponent(lim)}`,
      );
      const j = await res.json();
      out(surgeOut, j);
    } catch (e) {
      out(surgeOut, fmtErr(e));
    }
  }

  // Opportunity Radar
  const _oppBtn = $('#oppBtn');
  const oppOut = $('#oppOut');
  async function runOpportunities() {
    const win = $('#oppWin')?.value;
    const lim = $('#oppLim')?.value;
    out(oppOut, 'Scanning…');
    try {
      const res = await fetch(
        `/ai/opportunities?hoursWindow=${encodeURIComponent(win)}&limit=${encodeURIComponent(lim)}`,
      );
      const j = await res.json();
      out(oppOut, j);
    } catch (e) {
      out(oppOut, fmtErr(e));
    }
  }

  // Smart Price Advisor
  const _advBtn = $('#advBtn');
  const advOut = $('#advOut');
  async function runAdvisor() {
    const item = $('#advItem')?.value;
    const win = $('#advWin')?.value;
    if (!item) {
      out(advOut, { error: true, message: 'Enter an Item ID' });
      return;
    }
    out(advOut, 'Advising…');
    try {
      const res = await fetch(
        `/ai/price-advice?itemId=${encodeURIComponent(item)}&hoursWindow=${encodeURIComponent(win)}`,
      );
      const j = await res.json();
      out(advOut, j);
    } catch (e) {
      out(advOut, fmtErr(e));
    }
  }

  // Expose a minimal API for controllers
  try {
    window.EGAI = Object.freeze({
      runSurgeAlerts,
      runOpportunities,
      runAdvisor,
    });
  } catch {}
})();
