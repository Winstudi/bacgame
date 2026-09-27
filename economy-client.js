(() => {
  "use strict";

  const ecoSocket = socket;
  const eco = {
    coins: Number(localStorage.getItem("petitbac_walletBalance") || 0),
    gems: 0,
    lives: 5,
    maxLives: 5,
    nextLifeAt: null,
    secondsToNext: 0,
    unlimitedLivesUntil: 0,
    rewardedAdCoins: 10,
    shopOffers: {
      coins25: { coins:25, priceEur:0.99 },
      coins100: { coins:100, priceEur:2.99 },
      noAdsLifetime: { bonusCoins:100 }
    }
  };

  let refreshing = false;
  let warmTimer = null;

  function walletToken() {
    return localStorage.getItem("petitbac_walletToken") || "";
  }

  function fmt(sec) {
    sec = Math.max(0, Math.floor(Number(sec) || 0));
    const m = Math.floor(sec / 60);
    const s = sec % 60;
    return `${String(m).padStart(2, "0")}:${String(s).padStart(2, "0")}`;
  }

  function unlimitedSeconds() {
    return Math.max(0, Math.ceil((Number(eco.unlimitedLivesUntil) - Date.now()) / 1000));
  }

  function hasUnlimitedLives() {
    return unlimitedSeconds() > 0;
  }

  function ensureHud() {
    let el = document.getElementById("economyHud");
    if (el) return el;

    el = document.createElement("div");
    el.id = "economyHud";
    el.className = "economy-hud";
    document.body.appendChild(el);
    return el;
  }

  function renderHud() {
    const unlimited = hasUnlimitedLives();
    const waiting = !unlimited && eco.lives < eco.maxLives;

    ensureHud().innerHTML = `
      <div class="economy-pill coins">🪙 <b>${Math.max(0, Number(eco.coins) || 0)}</b></div>
      <div class="economy-pill life ${unlimited ? "is-unlimited" : ""}">
        <span class="economy-heart">♥</span>
        <b>${unlimited ? "∞" : `${Math.max(0, Number(eco.lives) || 0)}/${Math.max(1, Number(eco.maxLives) || 5)}`}</b>
        ${unlimited ? `<small>${fmt(unlimitedSeconds())}</small>` : waiting ? `<small>${fmt(eco.secondsToNext)}</small>` : ""}
      </div>`;
  }

  function renderEconomyUI() {
    renderHud();
    document.dispatchEvent(new CustomEvent("ptitbac:economy-changed", {
      detail: { ...eco }
    }));
  }

  function requestLevelRewardState() {
    const token = walletToken();
    if (!token || !ecoSocket.connected) return;
    ecoSocket.timeout(6000).emit("level-rewards:get", { walletToken:token }, (err, res) => {
      if (err || !res?.ok) return;
      eco.unlimitedLivesUntil = Math.max(0, Number(res.unlimitedLivesUntil) || 0);
      if (hasUnlimitedLives()) eco.lives = Math.max(Number(eco.lives) || 0, Number(eco.maxLives) || 5);
      renderEconomyUI();
    });
  }

  function requestState() {
    const token = walletToken();
    if (!token || !ecoSocket.connected || refreshing) return;

    refreshing = true;
    ecoSocket.timeout(8000).emit("economy:get", { walletToken: token }, (err, res) => {
      refreshing = false;
      if (err || !res?.ok) return;
      Object.assign(eco, res);
      renderEconomyUI();
      requestLevelRewardState();
    });
  }

  function warm(attempt = 0) {
    clearTimeout(warmTimer);

    if (walletToken() && ecoSocket.connected) {
      requestState();
      return;
    }

    if (attempt < 20) {
      warmTimer = setTimeout(() => warm(attempt + 1), 250);
    }
  }

  ecoSocket.on("connect", () => warm(0));

  ecoSocket.on("economy:update", value => {
    if (!value) return;
    Object.assign(eco, value);
    renderEconomyUI();
  });

  ecoSocket.on("level-rewards:update", value => {
    if (!value) return;
    eco.unlimitedLivesUntil = Math.max(0, Number(value.unlimitedLivesUntil) || 0);
    if (hasUnlimitedLives()) eco.lives = Math.max(Number(eco.lives) || 0, Number(eco.maxLives) || 5);
    renderEconomyUI();
  });

  ecoSocket.on("wallet:update", ({ balance } = {}) => {
    if (!Number.isFinite(Number(balance))) return;
    eco.coins = Math.max(0, Math.floor(Number(balance)));
    localStorage.setItem("petitbac_walletBalance", String(eco.coins));
    renderEconomyUI();
  });

  setTimeout(() => {
    const app = document.getElementById("app");
    if (
      app &&
      (!app.children.length || app.querySelector('[role="status"]')) &&
      typeof window.renderHome === "function"
    ) {
      try {
        window.renderHome();
      } catch (err) {
        console.warn("Affichage accueil de secours:", err?.message || err);
      }
    }
  }, 1200);

  setInterval(() => {
    if (hasUnlimitedLives()) {
      renderHud();
      return;
    }

    if (Number(eco.unlimitedLivesUntil) > 0) {
      eco.unlimitedLivesUntil = 0;
      requestState();
      return;
    }

    if (eco.lives >= eco.maxLives || !eco.nextLifeAt) return;

    eco.secondsToNext = Math.max(
      0,
      Math.ceil((Number(eco.nextLifeAt) - Date.now()) / 1000)
    );

    if (eco.secondsToNext <= 0) requestState();
    else renderHud();
  }, 1000);

  setInterval(requestState, 60000);

  window.PtitBacEconomy = {
    refresh: requestState,
    state: () => ({ ...eco }),
    rewardedAdCoins: 10,
    rules: Object.freeze({
      public: { lifeCost: 1, rewards: true, xp: true },
      quick: { lifeCost: 1, rewards: true, xp: true },
      private: { lifeCost: 0, rewards: false, xp: false }
    })
  };

  renderHud();
  warm(0);
})();
