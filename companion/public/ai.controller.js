// AI Dashboard Controller: owns all DOM event bindings for AI tools
(function () {
  const $ = (sel) => document.querySelector(sel);
  function on(el, type, handler, opts) {
    if (el) {
      el.addEventListener(type, handler, opts);
    }
  }

  // Wait for API
  function ready() {
    return typeof window !== 'undefined' && window.EGAI;
  }
  function init() {
    if (!ready()) {
      return;
    }
    const { runSurgeAlerts, runOpportunities, runAdvisor } = window.EGAI;

    const surgeBtn = $('#surgeBtn');
    const oppBtn = $('#oppBtn');
    const advBtn = $('#advBtn');

    on(surgeBtn, 'click', runSurgeAlerts);
    on(oppBtn, 'click', runOpportunities);
    on(advBtn, 'click', runAdvisor);

    // Auto-trigger a default scan to show something
    setTimeout(() => {
      try {
        surgeBtn?.click();
      } catch {}
    }, 200);
  }

  // If EGAI not ready yet (script order), retry shortly
  if (ready()) {
    init();
  } else {
    let tries = 0;
    const t = setInterval(() => {
      if (ready() || tries++ > 20) {
        clearInterval(t);
        init();
      }
    }, 50);
  }
})();
