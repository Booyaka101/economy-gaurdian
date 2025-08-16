// Player Page Controller: owns all DOM event bindings
(function () {
  const $ = (s) => document.querySelector(s);
  const on = (el, evt, fn, opts) => {
    if (el) {
      el.addEventListener(evt, fn, opts);
    }
  };
  function ready() {
    return typeof window !== 'undefined' && window.EGPlayer;
  }

  async function bindProfileChange(realms) {
    const { setSelectedRealm, setSelectedChar, updateHero, refreshAll } = window.EGPlayer;
    const selRealm = $('#selRealm');
    const selChar = $('#selChar');
    if (!selRealm || !selChar) {
      return;
    }
    let userChangedProfile = false;
    on(selRealm, 'change', () => {
      userChangedProfile = true;
      setSelectedRealm(selRealm.value || '');
      const r = selRealm.value;
      const chs = r ? realms[r] || [] : Array.from(new Set(Object.values(realms).flat()));
      selChar.innerHTML = '<option value="">All</option>';
      for (const ch of chs) {
        const opt = document.createElement('option');
        opt.value = ch;
        opt.textContent = ch;
        selChar.appendChild(opt);
      }
      setSelectedChar('');
      updateHero();
      refreshAll();
    });
    on(selChar, 'change', () => {
      userChangedProfile = true;
      setSelectedChar(selChar.value || '');
      updateHero();
      refreshAll();
    });

    // Background auto-pick if user hasn't interacted
    const timer = setInterval(async () => {
      if (userChangedProfile) {
        return;
      }
      try {
        const resp = await fetch('/player/current');
        const cur = await resp.json();
        const curRlm = cur?.current?.realm || '';
        const curChr = cur?.current?.character || '';
        if (
          curRlm &&
          (curRlm !== window.EGPlayer.getSelectedRealm() ||
            curChr !== window.EGPlayer.getSelectedChar())
        ) {
          setSelectedRealm(curRlm);
          selRealm.value = curRlm;
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
          updateHero();
          refreshAll();
        }
      } catch {}
    }, 15000);
    try {
      window.addEventListener('beforeunload', () => clearInterval(timer));
    } catch {}
  }

  async function bindAll() {
    const P = window.EGPlayer;
    // Buttons
    on($('#refresh'), 'click', () => P.loadTotals());
    on($('#refreshPending'), 'click', () => P.loadPending());
    on($('#recBtn'), 'click', () => P.recommend());
    on($('#insRefresh'), 'click', () => P.loadInsights());
    on($('#advRefresh'), 'click', () => P.loadAdvisor());
    on($('#topRefresh'), 'click', () => P.loadTopItems());

    // Initialize: rebuild models, load profiles, URL params, then refresh
    await P.rebuildModels();
    await P.loadProfileOptions();
    await P.initFromURLAndRefresh();

    // After loadProfileOptions, we need realm map to bind changes.
    // We will fetch realms once to provide to bindProfileChange.
    try {
      const resp = await fetch('/player/characters');
      const data = await resp.json();
      const realms = data?.realms || {};
      bindProfileChange(realms);
    } catch {}
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
