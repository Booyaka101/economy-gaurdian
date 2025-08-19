// Wowhead tooltips controller: centralize config and script loading
(function () {
  try {
    if (window.__egWowheadLoaded) {
      return;
    }
    window.__egWowheadLoaded = true;

    // Config must exist before the external script loads
    window.whTooltips = window.whTooltips || {
      colorLinks: true,
      iconizeLinks: false,
      renameLinks: false,
      maxHeight: 480,
    };

    // Preconnect hint to improve compatibility and performance
    try {
      const link = document.createElement('link');
      link.rel = 'preconnect';
      link.href = 'https://wow.zamimg.com';
      link.crossOrigin = '';
      document.head.appendChild(link);
    } catch {}
    try {
      const link2 = document.createElement('link');
      link2.rel = 'preconnect';
      link2.href = 'https://www.wowhead.com';
      link2.crossOrigin = '';
      document.head.appendChild(link2);
    } catch {}

    // Source selection via global or URL param
    // Prefer location.search (more reliable in jsdom), fallback to href
    let whParam = '';
    try {
      whParam = new URLSearchParams(window.location.search || '').get('whsrc') || '';
    } catch {}
    if (!whParam) {
      try {
        const url = new URL(window.location.href);
        whParam = url.searchParams.get('whsrc') || '';
      } catch {}
    }
    whParam = String(whParam).toLowerCase();
    if (whParam === 'off') {
      try {
        window.EGTooltips = window.EGTooltips || {};
        window.EGTooltips.state = { enabled: false, reason: 'whsrc=off' };
      } catch {}
      try {
        console.info('[EG] Wowhead tooltips disabled via ?whsrc=off');
      } catch {}
      return;
    }

    // Persistent user preference: localStorage key 'eg_tooltips' set to 'off' disables tooltips
    try {
      const pref = (localStorage.getItem('eg_tooltips') || '').toLowerCase();
      if (pref === 'off') {
        try {
          window.EGTooltips = window.EGTooltips || {};
          window.EGTooltips.state = { enabled: false, reason: 'pref-off' };
        } catch {}
        try {
          console.info('[EG] Wowhead tooltips disabled via local preference (eg_tooltips=off)');
        } catch {}
        return;
      }
    } catch {}

    // Expose minimal toggler API (no bindings): window.EGTooltips.enable()/disable()
    try {
      window.EGTooltips = window.EGTooltips || {};
      window.EGTooltips.disable = () => {
        try {
          localStorage.setItem('eg_tooltips', 'off');
        } catch {}
        try {
          location.reload();
        } catch {}
      };
      window.EGTooltips.enable = () => {
        try {
          localStorage.removeItem('eg_tooltips');
        } catch {}
        try {
          location.reload();
        } catch {}
      };
      window.EGTooltips.info = () => {
        try {
          return window.EGTooltips.state || null;
        } catch {
          return null;
        }
      };
    } catch {}
    let chosenSrc = window.EG_WOWHEAD_SRC || '';
    if (!chosenSrc) {
      if (whParam === 'wowhead') {
        chosenSrc = 'https://www.wowhead.com/widgets/power.js';
      } else if (whParam === 'zamimg') {
        chosenSrc = 'https://wow.zamimg.com/widgets/power.js';
      } else {
        chosenSrc = 'https://wow.zamimg.com/widgets/power.js';
      }
    }

    // Inject the external wowhead tooltips script (no crossorigin/referrer attributes)
    const s = document.createElement('script');
    const primarySrc = chosenSrc;
    try {
      window.EGTooltips = window.EGTooltips || {};
      window.EGTooltips.state = { enabled: true, src: primarySrc, loaded: false };
    } catch {}
    s.src = primarySrc;
    s.async = true;
    s.onload = () => {
      try {
        window.EGTooltips = window.EGTooltips || {};
        window.EGTooltips.state = Object.assign({}, window.EGTooltips.state, { loaded: true });
      } catch {}
      try {
        console.info('[EG] Wowhead tooltips loaded:', primarySrc);
      } catch {}
    };

    // One-time retry with protocol-relative URL if the first load errors
    let retried = false;
    s.onerror = () => {
      if (retried) {
        return;
      }
      retried = true;
      const fallback = primarySrc.startsWith('http')
        ? primarySrc.replace(/^https?:/, '')
        : primarySrc;
      const s2 = document.createElement('script');
      s2.src = fallback;
      s2.async = true;
      s2.onload = () => {
        try {
          window.EGTooltips = window.EGTooltips || {};
          window.EGTooltips.state = Object.assign({}, window.EGTooltips.state, {
            loaded: true,
            src: fallback,
          });
        } catch {}
        try {
          console.info('[EG] Wowhead tooltips loaded on retry:', fallback);
        } catch {}
      };
      s2.onerror = () => {
        try {
          window.EGTooltips = window.EGTooltips || {};
          window.EGTooltips.state = Object.assign({}, window.EGTooltips.state, {
            loaded: false,
            error: 'load-failed',
          });
        } catch {}
        try {
          console.warn(
            '[EG] Wowhead tooltips failed to load from both sources:',
            primarySrc,
            'and',
            fallback,
          );
        } catch {}
        return;
      };
      document.head.appendChild(s2);
    };

    document.head.appendChild(s);

    // Safety timeout to log if neither primary nor fallback loaded
    setTimeout(() => {
      const ok = !!(window.$WowheadPower || window.whTooltips?.ready);
      if (!ok) {
        try {
          console.warn(
            '[EG] Wowhead tooltips failed to load. Tooltips will be disabled for this session.',
          );
        } catch {}
      }
    }, 5000);
  } catch {}
})();
