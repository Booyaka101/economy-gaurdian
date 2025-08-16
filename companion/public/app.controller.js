// Deals Tab Controller: owns all DOM event bindings and orchestration
(function () {
  const $ = (s) => document.querySelector(s);
  const on = (el, type, fn, opts) => {
    if (el) {
      el.addEventListener(type, fn, opts);
    }
  };
  const debounce = (fn, ms) => {
    let t;
    return (...a) => {
      clearTimeout(t);
      t = setTimeout(() => fn(...a), ms);
    };
  };

  function ready() {
    return typeof window !== 'undefined' && window.EGDeals;
  }

  function bindAll() {
    const deals = window.EGDeals;
    // Buttons
    on($('#refresh'), 'click', deals.refreshDeals);
    on($('#export'), 'click', deals.exportLua);
    on($('#refreshAuctions'), 'click', deals.refreshAuctions);
    // Presets
    on($('#presetCommodities'), 'click', () => {
      deals.applyPresetCommodity();
      deals.refreshDeals();
    });
    on($('#presetItems'), 'click', () => {
      deals.applyPresetItems();
      deals.refreshDeals();
    });
    // Search debounce
    const search = document.getElementById('searchDeals');
    if (search) {
      on(
        search,
        'input',
        debounce(() => deals.renderDeals(), 150),
      );
    }
    // Header sorting
    const thead = document.querySelector('thead');
    on(thead, 'click', (e) => {
      const th = e.target.closest && e.target.closest('th[data-sort]');
      if (!th) {
        return;
      }
      const key = th.getAttribute('data-sort');
      deals.setSort(key);
    });
    // Metrics polling
    try {
      bindAll._metrics = setInterval(deals.refreshMetrics, 5000);
    } catch {}

    // Initial load
    deals.refreshStatus().then(() => {
      deals.applyPresetCommodity();
      deals.refreshDeals();
      deals.refreshMetrics();
    });
  }

  function init() {
    if (ready()) {
      bindAll();
    }
  }

  if (ready()) {
    init();
  } else {
    let tries = 0;
    const t = setInterval(() => {
      if (ready() || tries++ > 40) {
        clearInterval(t);
        init();
      }
    }, 50);
  }
})();
