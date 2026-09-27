/* =========================================================
   P'tit Bac — Progression XP / niveaux V2
   Accueil : niveau + barre.
   Fin de partie : refonte classement + récompenses premium.
   ========================================================= */
(() => {
  "use strict";

  const CACHE_KEY = "petitbac_progression_v1";
  const shownLevelUps = new Set();
  let state = null;
  let lastAward = null;
  let requestPromise = null;
  let scheduled = false;
  let levelsOverlay = null;
  let lastFocusedTrigger = null;
  let levelRewardClaims = new Set();
  let levelRewardStatusPromise = null;
  let levelRewardStatusLoaded = false;
  let levelRewardClaiming = 0;
  let unlimitedLivesUntil = 0;
  const LEVEL_REWARD_COINS = 50;

  const LEVEL_REWARDS = Object.freeze({
    1: Object.freeze({ type:"tag", label:"Tag débutant", short:"Tag débutant" }),
    2: Object.freeze({ type:"coins", amount:200, label:"200 pièces", asset:"/coin.png" }),
    3: Object.freeze({ type:"gems", amount:5, label:"5 gemmes", asset:"/gem.png" }),
    4: Object.freeze({ type:"bag", label:"Sac (coffre)", short:"Sac", asset:"/reward-bag.png" }),
    5: Object.freeze({ type:"lives", minutes:30, label:"Vie illimitée 30 min", short:"Vie ∞ 30 min", asset:"/heart.png" }),
    6: Object.freeze({ type:"coins", amount:200, label:"200 pièces", asset:"/coin.png" }),
    7: Object.freeze({ type:"gems", amount:5, label:"5 gemmes", asset:"/gem.png" }),
    8: Object.freeze({ type:"bag", label:"Sac (coffre)", short:"Sac", asset:"/reward-bag.png" }),
    9: Object.freeze({ type:"coins", amount:200, label:"200 pièces", asset:"/coin.png" }),
    10: Object.freeze({ type:"chest", label:"Coffre", asset:"/reward-star-simple-closed.png" }),
    11: Object.freeze({ type:"gems", amount:5, label:"5 gemmes", asset:"/gem.png" }),
    12: Object.freeze({ type:"coins", amount:200, label:"200 pièces", asset:"/coin.png" }),
    13: Object.freeze({ type:"bag", label:"Sac (coffre)", short:"Sac", asset:"/reward-bag.png" }),
    14: Object.freeze({ type:"coins", amount:200, label:"200 pièces", asset:"/coin.png" }),
    15: Object.freeze({ type:"lives", minutes:30, label:"Vie illimitée 30 min", short:"Vie ∞ 30 min", asset:"/heart.png" }),
    16: Object.freeze({ type:"coins", amount:200, label:"200 pièces", asset:"/coin.png" }),
    17: Object.freeze({ type:"bag", label:"Sac (coffre)", short:"Sac", asset:"/reward-bag.png" }),
    18: Object.freeze({ type:"gems", amount:5, label:"5 gemmes", asset:"/gem.png" }),
    19: Object.freeze({ type:"coins", amount:200, label:"200 pièces", asset:"/coin.png" }),
    20: Object.freeze({ type:"legendary", label:"Coffre légendaire", short:"Légendaire", asset:"/reward-legendary-simple-closed.png" }),
    21: Object.freeze({ type:"coins", amount:200, label:"200 pièces", asset:"/coin.png" }),
    22: Object.freeze({ type:"gems", amount:5, label:"5 gemmes", asset:"/gem.png" }),
    23: Object.freeze({ type:"coins", amount:200, label:"200 pièces", asset:"/coin.png" }),
    24: Object.freeze({ type:"bag", label:"Sac (coffre)", short:"Sac", asset:"/reward-bag.png" }),
    25: Object.freeze({ type:"frame", key:"frame_gold_stars", label:"Cadre étoile dorée", short:"Cadre doré", asset:"/frame-gold-stars.png" }),
    26: Object.freeze({ type:"coins", amount:200, label:"200 pièces", asset:"/coin.png" }),
    27: Object.freeze({ type:"gems", amount:5, label:"5 gemmes", asset:"/gem.png" }),
    28: Object.freeze({ type:"bag", label:"Sac (coffre)", short:"Sac", asset:"/reward-bag.png" }),
    29: Object.freeze({ type:"coins", amount:200, label:"200 pièces", asset:"/coin.png" }),
    30: Object.freeze({ type:"chest", label:"Coffre", asset:"/reward-star-simple-closed.png" }),
    31: Object.freeze({ type:"gems", amount:10, label:"10 gemmes", asset:"/gem.png" }),
    32: Object.freeze({ type:"coins", amount:200, label:"200 pièces", asset:"/coin.png" }),
    33: Object.freeze({ type:"bag", label:"Sac (coffre)", short:"Sac", asset:"/reward-bag.png" }),
    34: Object.freeze({ type:"coins", amount:200, label:"200 pièces", asset:"/coin.png" }),
    35: Object.freeze({ type:"lives", minutes:30, label:"Vie illimitée 30 min", short:"Vie ∞ 30 min", asset:"/heart.png" }),
    36: Object.freeze({ type:"coins", amount:200, label:"200 pièces", asset:"/coin.png" }),
    37: Object.freeze({ type:"bag", label:"Sac (coffre)", short:"Sac", asset:"/reward-bag.png" }),
    38: Object.freeze({ type:"gems", amount:10, label:"10 gemmes", asset:"/gem.png" }),
    39: Object.freeze({ type:"coins", amount:200, label:"200 pièces", asset:"/coin.png" }),
    40: Object.freeze({ type:"legendary", label:"Coffre légendaire", short:"Légendaire", asset:"/reward-legendary-simple-closed.png" }),
    41: Object.freeze({ type:"gems", amount:15, label:"15 gemmes", asset:"/gem.png" }),
    42: Object.freeze({ type:"coins", amount:500, label:"500 pièces", asset:"/coin.png" }),
    43: Object.freeze({ type:"bag", label:"Sac (coffre)", short:"Sac", asset:"/reward-bag.png" }),
    44: Object.freeze({ type:"gems", amount:20, label:"20 gemmes", asset:"/gem.png" }),
    45: Object.freeze({ type:"avatar", key:"/avatar-prestige.png", label:"Icon prestige", short:"Icon prestige", asset:"/avatar-prestige.png" }),
    46: Object.freeze({ type:"coins", amount:500, label:"500 pièces", asset:"/coin.png" }),
    47: Object.freeze({ type:"gems", amount:50, label:"50 gemmes", asset:"/gem.png" }),
    48: Object.freeze({ type:"chest", label:"Coffre", asset:"/reward-star-simple-closed.png" }),
    49: Object.freeze({ type:"legendary", label:"Coffre légendaire", short:"Légendaire", asset:"/reward-legendary-simple-closed.png" }),
    50: Object.freeze({ type:"frame", key:"frame-prestige", label:"Cadre prestige", asset:"/frame-prestige.png" })
  });

  function walletToken() {
    return String(localStorage.getItem("petitbac_walletToken") || "").trim();
  }

  function clampPercent(value) {
    return Math.max(0, Math.min(100, Number(value) || 0));
  }

  function escapeHtml(value) {
    return String(value ?? "").replace(
      /[&<>"']/g,
      char => ({
        "&":"&amp;",
        "<":"&lt;",
        ">":"&gt;",
        '"':"&quot;",
        "'":"&#39;"
      })[char]
    );
  }

  function winnerHeadingMarkup(value) {
    const text = String(value || "").trim();
    const winner = text.match(/^(.+?)\s+remporte la partie\s*!$/i);
    if (winner) {
      return `<span>${escapeHtml(winner[1])}</span> remporte la partie !`;
    }

    const shared = text.match(/^Victoire partagée\s*:\s*(.+)$/i);
    if (shared) {
      return `Victoire partagée : <span>${escapeHtml(shared[1])}</span>`;
    }

    return escapeHtml(text || "Partie terminée !");
  }

  function normalizeState(value) {
    if (!value || typeof value !== "object") return null;
    const level = Math.max(1, Math.min(50, Math.floor(Number(value.level) || 1)));
    return {
      level,
      totalXp: Math.max(0, Math.floor(Number(value.totalXp) || 0)),
      xpIntoLevel: Math.max(0, Math.floor(Number(value.xpIntoLevel) || 0)),
      xpForNext: Math.max(0, Math.floor(Number(value.xpForNext) || 0)),
      progress: Math.max(0, Math.min(1, Number(value.progress) || 0)),
      progressPercent: clampPercent(value.progressPercent),
      maxLevel: value.maxLevel === true || level >= 50,
      trophies: Math.max(0, Math.floor(Number(value.trophies) || 0)),
      completedGames: Math.max(0, Math.floor(Number(value.completedGames) || 0)),
      wins: Math.max(0, Math.floor(Number(value.wins) || 0))
    };
  }

  function readCache() {
    if (state) return state;
    try {
      state = normalizeState(JSON.parse(localStorage.getItem(CACHE_KEY) || "null"));
    } catch {
      state = null;
    }
    return state;
  }

  function cacheState(value) {
    const clean = normalizeState(value);
    if (!clean) return null;
    state = clean;
    try {
      localStorage.setItem(CACHE_KEY, JSON.stringify(clean));
    } catch {}
    schedulePatch();
    return clean;
  }

  function requestState({ force = false } = {}) {
    if (!force && readCache()) return Promise.resolve(state);
    if (requestPromise) return requestPromise;

    const token = walletToken();
    if (!token || typeof socket === "undefined" || !socket?.connected) {
      return Promise.reject(new Error("Progression indisponible."));
    }

    requestPromise = new Promise((resolve, reject) => {
      socket.timeout(8000).emit("progression:get", { walletToken: token }, (err, res) => {
        requestPromise = null;
        if (err || !res?.ok || !res.state) {
          reject(new Error(res?.error || "Progression indisponible."));
          return;
        }
        resolve(cacheState(res.state));
      });
    });

    return requestPromise;
  }

  function styleOnce() {
    if (document.getElementById("ptbProgressionStyle")) return;

    const style = document.createElement("style");
    style.id = "ptbProgressionStyle";
    style.textContent = `
      .hm-profile-copy .ptb-home-xp-bar{
        width:82px;height:5px;margin-top:4px;overflow:hidden;
        border:1px solid rgba(149,101,255,.42);border-radius:999px;
        background:rgba(7,13,48,.78);box-shadow:inset 0 1px 4px rgba(0,0,0,.3)
      }
      .hm-profile-copy .ptb-home-xp-fill{
        display:block;width:0;height:100%;border-radius:inherit;
        background:linear-gradient(90deg,#7139ee,#c257ff);
        box-shadow:0 0 8px rgba(171,72,255,.55);
        transition:width .45s ease
      }
      .ptb-level-up-burst{
        position:fixed;z-index:99999;left:50%;top:44%;transform:translate(-50%,-50%) scale(.72);
        min-width:220px;padding:18px 24px;text-align:center;pointer-events:none;
        border:1px solid rgba(220,154,255,.9);border-radius:20px;
        background:radial-gradient(circle at 50% 0%,rgba(172,74,255,.35),transparent 58%),linear-gradient(180deg,#211866,#111744);
        box-shadow:0 0 28px rgba(179,76,255,.56),0 20px 55px rgba(0,0,0,.45);
        opacity:0;animation:ptbLevelBurst 1.7s ease forwards
      }
      .ptb-level-up-burst small{display:block;color:#d8b8ff;font-size:.68rem;font-weight:900;letter-spacing:.12em}
      .ptb-level-up-burst strong{display:block;margin-top:4px;color:#fff;font-size:1.55rem;font-weight:1000;text-shadow:0 0 14px rgba(218,127,255,.72)}
      .ptb-level-up-burst::before,.ptb-level-up-burst::after{
        content:"✦";position:absolute;color:#e5b5ff;font-size:1.4rem;animation:ptbStarSpin 1.5s ease both
      }
      .ptb-level-up-burst::before{left:16px;top:13px}.ptb-level-up-burst::after{right:16px;bottom:12px}
      @keyframes ptbLevelBurst{0%{opacity:0;transform:translate(-50%,-50%) scale(.72)}18%{opacity:1;transform:translate(-50%,-50%) scale(1.08)}32%,72%{opacity:1;transform:translate(-50%,-50%) scale(1)}100%{opacity:0;transform:translate(-50%,-58%) scale(.94)}}
      @keyframes ptbStarSpin{0%{opacity:0;transform:scale(.4) rotate(0)}30%,75%{opacity:1}100%{opacity:0;transform:scale(1.4) rotate(180deg)}}

      .ptb-level-entry-trigger{cursor:pointer;pointer-events:auto!important;touch-action:manipulation}

      .ptb-levels-overlay{
        position:fixed;inset:0;z-index:100030;display:flex;align-items:stretch;justify-content:center;
        background:#03092d;opacity:0;pointer-events:none;transition:opacity .2s ease;
      }
      .ptb-levels-overlay.is-open{opacity:1;pointer-events:auto}
      .ptb-levels-panel{
        width:min(100vw,430px);height:100%;overflow:hidden;position:relative;color:#fff;
        font-family:"DM Sans",system-ui,sans-serif;
        background:
          radial-gradient(circle at -6% 104%,rgba(52,92,255,.70) 0 11%,transparent 25%),
          radial-gradient(circle at 108% 103%,rgba(76,74,255,.48) 0 9%,transparent 23%),
          radial-gradient(circle at 82% 2%,rgba(123,48,255,.22),transparent 18%),
          linear-gradient(180deg,#06134c 0%,#061343 55%,#07123d 100%);
      }
      .ptb-levels-panel::before{
        content:"";position:absolute;inset:0;pointer-events:none;opacity:.78;
        background:
          radial-gradient(circle at 16% 9%,rgba(255,255,255,.22) 0 1px,transparent 1.5px),
          radial-gradient(circle at 71% 8%,rgba(255,255,255,.16) 0 1px,transparent 1.4px),
          radial-gradient(circle at 93% 23%,rgba(158,116,255,.27) 0 1.4px,transparent 2px),
          radial-gradient(circle at 31% 49%,rgba(255,255,255,.12) 0 .9px,transparent 1.4px),
          radial-gradient(circle at 79% 62%,rgba(255,255,255,.10) 0 .9px,transparent 1.3px);
      }
      .ptb-levels-scroll{
        position:relative;height:100%;overflow:auto;padding:14px 13px 22px;scroll-behavior:smooth;
        scrollbar-width:none;
      }
      .ptb-levels-scroll::-webkit-scrollbar{display:none}
      .ptb-levels-header{display:flex;align-items:center;justify-content:center;position:relative;height:56px;margin-bottom:8px}
      .ptb-levels-header::after{
        content:"";position:absolute;right:3px;top:2px;width:42px;height:42px;opacity:.22;pointer-events:none;
        background:#8249ff;clip-path:polygon(50% 0,61% 34%,98% 35%,68% 57%,79% 94%,50% 72%,21% 94%,32% 57%,2% 35%,39% 34%);
        filter:blur(.2px) drop-shadow(0 0 10px rgba(133,74,255,.58));transform:rotate(14deg)
      }
      .ptb-levels-back{
        position:absolute;left:1px;top:5px;width:40px;height:40px;padding:0;border:0;border-radius:0;
        background:transparent;display:grid;place-items:center;cursor:pointer;box-shadow:none
      }
      .ptb-levels-back img{width:24px;height:24px;object-fit:contain;display:block;filter:none}
      .ptb-levels-title{
        margin:0;font-size:2.05rem;line-height:1;font-weight:1000;letter-spacing:-.035em;color:#fff;
        text-shadow:0 0 10px rgba(90,221,255,.30),0 0 14px rgba(196,87,255,.42),0 4px 8px rgba(0,0,0,.26)
      }

      .ptb-levels-hero{
        position:relative;z-index:2;border:2px solid transparent;border-radius:26px;padding:13px 14px 12px;
        background:
          linear-gradient(180deg,rgba(8,31,112,.98),rgba(5,18,71,.99)) padding-box,
          linear-gradient(100deg,#40e8ff 0%,#328dff 38%,#7f69ff 67%,#f45bff 100%) border-box;
        box-shadow:0 0 16px rgba(43,182,255,.27),0 0 20px rgba(215,69,255,.15),inset 0 0 28px rgba(31,83,206,.10)
      }
      .ptb-levels-hero-top{display:grid;grid-template-columns:92px minmax(0,1fr);gap:12px;align-items:center}
      .ptb-levels-hero-badge{position:relative;width:92px;height:92px;display:grid;place-items:center}
      .ptb-levels-hero-badge img{width:92px;height:92px;display:block;object-fit:contain;filter:drop-shadow(0 7px 10px rgba(0,0,0,.24))}
      .ptb-levels-hero-badge b{position:absolute;left:50%;top:50%;width:100%;transform:translate(-50%,-53%);display:grid;place-items:center;font-size:2.7rem;line-height:1;font-weight:1000;letter-spacing:-.05em;text-align:center;text-shadow:0 3px 7px rgba(5,9,45,.98)}
      .ptb-levels-hero-copy{min-width:0;align-self:center}
      .ptb-levels-hero-copy h2{margin:0 0 7px;font-size:.92rem;line-height:1;font-weight:900;color:#e6c8ff}
      .ptb-levels-hero-track{
        width:100%;height:62px;padding:0 12%;box-sizing:border-box;display:flex;align-items:center;
        background:url('/level-bar-shell-v1.png') center/100% 100% no-repeat;
        filter:drop-shadow(0 6px 12px rgba(0,0,0,.18))
      }
      .ptb-levels-hero-fill{
        position:relative;display:block;height:13px;width:0;border-radius:999px;overflow:hidden;min-width:0;
        background:linear-gradient(90deg,#5fe6ff 0%,#3ed3ff 24%,#4d8fff 49%,#8c5bff 74%,#ef57ff 100%);
        box-shadow:inset 0 1px 1px rgba(255,255,255,.78),0 0 5px rgba(54,218,255,.88),0 0 8px rgba(107,92,255,.52);
        transition:width .45s cubic-bezier(.22,.8,.28,1)
      }
      .ptb-levels-hero-fill::after{
        content:"";position:absolute;left:6px;right:6px;top:2px;height:2px;border-radius:999px;
        background:linear-gradient(90deg,transparent,rgba(255,255,255,.76),transparent)
      }
      .ptb-levels-hero-meta{margin-top:4px;color:#f4f6ff;font-weight:1000;line-height:1}
      .ptb-levels-hero-meta strong{font-size:1rem;letter-spacing:-.02em}
      .ptb-levels-hero-reward{
        margin-top:10px;min-height:42px;border-radius:0;padding:4px 8px;display:flex;align-items:center;justify-content:center;gap:10px;
        background:transparent;border:0;box-shadow:none
      }
      .ptb-level-reward-icon{
        width:28px;height:28px;flex:0 0 28px;border-radius:9px;display:grid;place-items:center;font-style:normal;overflow:hidden;
        color:#fff;font-size:.72rem;font-weight:1000;background:linear-gradient(145deg,#263eaa,#4e2aa1);
        border:1px solid rgba(126,159,255,.75);box-shadow:0 0 10px rgba(78,130,255,.3)
      }
      .ptb-level-reward-icon.is-hero{width:30px;height:30px;flex-basis:30px}
      .ptb-level-reward-icon img{width:100%;height:100%;object-fit:contain;display:block}
      .ptb-level-reward-icon.is-coins,.ptb-level-reward-icon.is-gems{background:transparent;border:0;box-shadow:none}
      .ptb-level-reward-icon.is-frame img{object-fit:contain}
      .ptb-level-reward-icon.is-avatar img{object-fit:cover;border-radius:7px}
      .ptb-levels-hero-reward span{font-size:.7rem;line-height:1.1;font-weight:800;color:#eef0ff;text-align:center}
      .ptb-levels-hero-reward b{color:#ffdd64;font-size:.82rem}

      .ptb-levels-list{position:relative;z-index:1;margin-top:12px;padding-left:31px}
      .ptb-levels-line{
        position:absolute;left:11px;top:-18px;bottom:45px;width:2px;border-radius:999px;
        background:linear-gradient(180deg,#4be7ff 0%,#62d9ff 28%,#8a98ff 65%,#adb8ff 100%);
        box-shadow:0 0 7px rgba(88,213,255,.38)
      }
      .ptb-level-row{position:relative;margin:0 0 7px}
      .ptb-level-dot{
        position:absolute;left:-25.5px;top:50%;transform:translateY(-50%);width:13px;height:13px;border-radius:50%;box-sizing:border-box;
        border:2px solid rgba(155,177,246,.82);background:#07184f;box-shadow:0 0 0 2px rgba(91,112,208,.18)
      }
      .ptb-level-row.is-completed .ptb-level-dot{
        left:-31.5px;width:25px;height:25px;border:2px solid #4ce9ff;background:#0f83ca;color:#fff;
        box-shadow:0 0 11px rgba(77,222,255,.52)
      }
      .ptb-level-row.is-completed .ptb-level-dot::after{
        content:"✓";position:absolute;inset:0;display:grid;place-items:center;font-style:normal;font-size:.76rem;font-weight:1000;color:#dfffff
      }
      .ptb-level-row.is-current .ptb-level-dot{
        left:-33px;width:28px;height:28px;border:4px solid #d278ff;background:#fff;
        box-shadow:0 0 0 2px rgba(121,97,255,.30),0 0 14px rgba(220,103,255,.46)
      }
      .ptb-level-card{
        position:relative;min-height:58px;border:1px solid rgba(73,111,229,.34);border-radius:17px;padding:6px 8px;display:grid;align-items:center;
        grid-template-columns:52px minmax(0,1fr) 126px;gap:7px;
        background:linear-gradient(180deg,rgba(8,29,102,.98),rgba(5,21,78,.98));
        box-shadow:inset 0 1px 0 rgba(255,255,255,.035),0 8px 16px rgba(0,0,0,.12)
      }
      .ptb-level-row.is-current .ptb-level-card{
        min-height:68px;border:2px solid transparent;border-radius:18px;padding:5px 7px;
        background:
          linear-gradient(90deg,rgba(10,52,158,.99),rgba(27,53,171,.99) 55%,rgba(102,34,157,.99)) padding-box,
          linear-gradient(100deg,#52e7ff 0%,#557cff 55%,#f05cff 100%) border-box;
        box-shadow:0 0 13px rgba(64,201,255,.28),0 0 15px rgba(219,74,255,.22),inset 0 1px 0 rgba(255,255,255,.08)
      }
      .ptb-level-row.is-locked .ptb-level-card{opacity:.87}
      .ptb-level-mini-badge{position:relative;width:50px;height:50px;display:grid;place-items:center;justify-self:start}
      .ptb-level-mini-badge img{width:50px;height:50px;display:block;object-fit:contain;filter:drop-shadow(0 5px 7px rgba(0,0,0,.20))}
      .ptb-level-mini-badge b{position:absolute;left:50%;top:50%;width:100%;transform:translate(-50%,-53%);display:grid;place-items:center;font-size:1.35rem;line-height:1;font-weight:1000;letter-spacing:-.04em;text-align:center;text-shadow:0 2px 5px rgba(5,8,38,.96)}
      .ptb-level-row.is-completed .ptb-level-mini-badge img{width:46px;height:46px}
      .ptb-level-row.is-completed .ptb-level-mini-badge b{font-size:1.18rem}
      .ptb-level-row.is-current .ptb-level-mini-badge{width:60px;height:60px;margin-left:-4px}
      .ptb-level-row.is-current .ptb-level-mini-badge img{width:60px;height:60px}
      .ptb-level-row.is-current .ptb-level-mini-badge b{font-size:1.65rem}
      .ptb-level-row.is-locked .ptb-level-mini-badge img{filter:saturate(.58) brightness(.76) contrast(.94) drop-shadow(0 5px 7px rgba(0,0,0,.18))}
      .ptb-level-copy{min-width:0;display:flex;flex-direction:column;align-items:flex-start;gap:2px}
      .ptb-level-copy strong{display:block;font-size:.73rem;line-height:1;font-weight:900;color:#fff;white-space:nowrap}
      .ptb-level-copy small{display:block;font-size:.63rem;line-height:1;font-weight:700;color:#9faeea;white-space:nowrap}
      .ptb-level-row.is-completed .ptb-level-copy small{color:#4ff2ff;font-weight:800}
      .ptb-level-row.is-current .ptb-level-copy small{
        margin-top:1px;padding:4px 11px;border-radius:999px;font-size:.62rem;font-weight:900;color:#fff;
        background:linear-gradient(90deg,#39d9ff,#718cff 56%,#e458ff);box-shadow:inset 0 1px 0 rgba(255,255,255,.22)
      }
      .ptb-level-reward{
        grid-column:3;justify-self:end;width:126px;min-height:36px;border-radius:12px;padding:5px 8px;box-sizing:border-box;
        display:flex;align-items:center;justify-content:flex-start;gap:6px;
        background:rgba(4,15,59,.94);border:1px solid rgba(61,80,177,.42);box-shadow:inset 0 1px 0 rgba(255,255,255,.03)
      }
      .ptb-level-reward .ptb-level-reward-icon{width:24px;height:24px;flex-basis:24px;border-radius:7px;font-size:.6rem}
      .ptb-level-reward span{font-size:.58rem;line-height:1.05;font-weight:900;color:#ffe16b;white-space:normal;text-align:left}
      .ptb-level-status{position:absolute;right:8px;top:50%;transform:translateY(-50%);width:32px;height:32px;display:grid;place-items:center}
      .ptb-level-row.is-current .ptb-level-status,
      .ptb-level-row.is-locked .ptb-level-status{display:none}
      .ptb-level-row.is-completed .ptb-level-reward{margin-right:38px}
      .ptb-level-status .ptb-check{
        width:30px;height:30px;border-radius:50%;display:grid;place-items:center;font-style:normal;
        border:3px solid #4ce9ff;background:rgba(6,26,92,.88);color:#6ff3ff;font-size:.92rem;font-weight:1000;
        box-shadow:0 0 10px rgba(76,233,255,.30)
      }
      .ptb-level-status .ptb-empty{display:block;width:30px;height:30px}
      .ptb-level-reward{font-family:inherit;color:inherit;appearance:none;-webkit-appearance:none}
      .ptb-level-reward:disabled{cursor:default}
      .ptb-level-reward.is-claimable{
        cursor:pointer;border-color:rgba(83,229,255,.92);
        box-shadow:0 0 0 1px rgba(102,106,255,.18),0 0 12px rgba(63,216,255,.34),inset 0 1px 0 rgba(255,255,255,.07);
        animation:ptbLevelClaimPulse 1.7s ease-in-out infinite
      }
      .ptb-level-reward.is-claimable span{color:#fff4a4}
      .ptb-level-reward.is-claimed{opacity:.62;filter:saturate(.72)}
      .ptb-level-row.reward-claimable .ptb-level-copy small{color:#65f2ff!important;font-weight:900}
      .ptb-level-row.reward-claimed .ptb-level-copy small{color:#77f4c6!important;font-weight:850}
      .ptb-level-row.reward-claimable .ptb-level-dot{
        border-color:#69ecff;box-shadow:0 0 0 2px rgba(83,119,255,.2),0 0 9px rgba(67,221,255,.5)
      }
      .ptb-level-status .ptb-claim-mark{
        width:28px;height:28px;border-radius:50%;display:grid;place-items:center;font-style:normal;
        border:2px solid #59e8ff;background:rgba(7,27,91,.9);color:#fff49a;font-size:.88rem;font-weight:1000;
        box-shadow:0 0 10px rgba(77,226,255,.34)
      }
      @keyframes ptbLevelClaimPulse{0%,100%{transform:scale(1)}50%{transform:scale(1.025)}}

      .ptb-levels-footer{padding:5px 0 0;text-align:center}
      .ptb-levels-footer-dots{display:flex;flex-direction:column;align-items:center;justify-content:center;gap:4px;margin-bottom:7px}
      .ptb-levels-footer-dots i{width:4px;height:4px;border-radius:50%;background:#9eaaff;box-shadow:0 0 6px rgba(155,174,255,.34)}
      .ptb-levels-footer p{margin:0;color:#aaaee8;font-size:.7rem;font-weight:600}

      @media(max-width:370px){
        .ptb-levels-scroll{padding-inline:10px}
        .ptb-levels-title{font-size:1.9rem}
        .ptb-levels-header{height:52px}
        .ptb-levels-back{width:36px;height:36px;top:5px}
        .ptb-levels-hero{padding:11px 11px 10px}
        .ptb-levels-hero-top{grid-template-columns:82px minmax(0,1fr);gap:9px}
        .ptb-levels-hero-badge,.ptb-levels-hero-badge img{width:82px;height:82px}
        .ptb-levels-hero-badge b{font-size:2.4rem}
        .ptb-levels-hero-copy h2{font-size:.82rem}
        .ptb-levels-hero-track{height:58px}
        .ptb-levels-hero-meta strong{font-size:.9rem}
        .ptb-levels-hero-reward{padding-inline:8px;gap:6px}
        .ptb-levels-hero-reward span{font-size:.64rem}
        .ptb-levels-hero-reward b{font-size:.73rem}
        .ptb-level-card{grid-template-columns:46px minmax(0,1fr) 108px;gap:5px;padding:5px 6px}
        .ptb-level-row.is-current .ptb-level-card{padding:4px 5px}
        .ptb-level-mini-badge,.ptb-level-mini-badge img{width:45px;height:45px}
        .ptb-level-row.is-current .ptb-level-mini-badge{width:54px;height:54px}
        .ptb-level-row.is-current .ptb-level-mini-badge img{width:54px;height:54px}
        .ptb-level-copy strong{font-size:.67rem}
        .ptb-level-copy small{font-size:.57rem}
        .ptb-level-reward{width:108px;min-height:32px;padding:4px 6px;gap:5px}
        .ptb-level-reward .ptb-level-reward-icon{width:20px;height:20px;flex-basis:20px}
        .ptb-level-reward span{font-size:.51rem}
        .ptb-level-status,.ptb-level-status .ptb-empty{width:28px;height:28px}
        .ptb-level-status{right:6px}
        .ptb-level-row.is-completed .ptb-level-reward{margin-right:32px}
        .ptb-level-status .ptb-check{width:27px;height:27px;font-size:.8rem}
      }

      /* =====================================================
         Niveaux V3 — constellation centrale corrigée
         ===================================================== */
      .ptb-levels-panel{
        background:
          radial-gradient(circle at 50% 18%,rgba(51,95,255,.20),transparent 24%),
          radial-gradient(circle at 12% 52%,rgba(108,67,255,.16),transparent 18%),
          radial-gradient(circle at 90% 76%,rgba(48,176,255,.13),transparent 22%),
          linear-gradient(180deg,#05103f 0%,#07154c 46%,#071441 100%)
      }
      .ptb-levels-panel::before{
        opacity:.92;
        background:
          radial-gradient(circle at 8% 8%,rgba(255,255,255,.88) 0 1px,transparent 1.7px),
          radial-gradient(circle at 21% 18%,rgba(107,222,255,.92) 0 1.2px,transparent 2px),
          radial-gradient(circle at 38% 6%,rgba(255,255,255,.72) 0 1px,transparent 1.6px),
          radial-gradient(circle at 61% 13%,rgba(184,125,255,.86) 0 1.2px,transparent 2px),
          radial-gradient(circle at 84% 10%,rgba(255,255,255,.86) 0 1px,transparent 1.7px),
          radial-gradient(circle at 93% 31%,rgba(85,224,255,.8) 0 1px,transparent 1.8px),
          radial-gradient(circle at 16% 37%,rgba(206,156,255,.78) 0 1px,transparent 1.8px),
          radial-gradient(circle at 73% 43%,rgba(255,255,255,.74) 0 1px,transparent 1.6px),
          radial-gradient(circle at 31% 61%,rgba(72,207,255,.78) 0 1px,transparent 1.8px),
          radial-gradient(circle at 88% 67%,rgba(255,255,255,.82) 0 1px,transparent 1.6px),
          radial-gradient(circle at 12% 82%,rgba(144,98,255,.76) 0 1.2px,transparent 1.9px),
          radial-gradient(circle at 58% 89%,rgba(80,213,255,.82) 0 1px,transparent 1.8px)
      }
      .ptb-levels-panel::after{
        content:"";position:absolute;inset:120px 0 0;pointer-events:none;z-index:0;opacity:.22;
        background:
          linear-gradient(25deg,transparent 0 47%,rgba(104,176,255,.5) 48% 48.6%,transparent 49.5%) 14% 24%/90px 60px no-repeat,
          linear-gradient(-28deg,transparent 0 47%,rgba(145,113,255,.45) 48% 48.6%,transparent 49.5%) 80% 38%/100px 74px no-repeat,
          linear-gradient(32deg,transparent 0 47%,rgba(74,216,255,.42) 48% 48.6%,transparent 49.5%) 20% 65%/92px 66px no-repeat,
          linear-gradient(-35deg,transparent 0 47%,rgba(159,118,255,.42) 48% 48.6%,transparent 49.5%) 78% 78%/105px 72px no-repeat
      }
      .ptb-levels-scroll{z-index:1;padding-inline:12px;padding-bottom:36px}
      .ptb-levels-hero{margin-bottom:16px}

      .ptb-levels-list{
        position:relative;z-index:1;margin-top:0;padding:8px 0 12px;
      }
      .ptb-levels-list::before{
        content:"✦";position:absolute;left:50%;top:10px;transform:translateX(-50%);z-index:0;
        color:#71e9ff;font-size:.7rem;text-shadow:0 0 10px #5bdcff,0 0 18px #7c65ff
      }
      .ptb-levels-line{
        --ptb-level-line-progress:0px;
        left:50%;top:-22px;bottom:40px;width:3px;transform:translateX(-50%);z-index:0;
        background:rgba(85,99,154,.30);
        box-shadow:none
      }
      .ptb-levels-line::before{
        content:"";position:absolute;left:0;top:0;width:100%;height:var(--ptb-level-line-progress);
        border-radius:999px;
        background:linear-gradient(180deg,#53e8ff 0%,#65dfff 28%,#6caeff 58%,#7489ff 82%,#62dcff 100%);
        box-shadow:0 0 7px rgba(74,220,255,.72),0 0 15px rgba(84,137,255,.38);
        transition:height .45s cubic-bezier(.22,.8,.28,1)
      }
      .ptb-levels-line::after{
        content:"";position:absolute;inset:0 -8px;
        background:radial-gradient(circle,rgba(180,193,235,.68) 0 1.7px,rgba(104,119,176,.28) 2.2px 3.5px,transparent 4px) center top/17px 64px repeat-y;
        opacity:.34
      }
      [data-level-rows]{position:relative;z-index:1}
      .ptb-level-row{
        position:relative;display:grid;grid-template-columns:minmax(0,1fr) 72px minmax(0,1fr);
        align-items:center;min-height:96px;margin:0;padding:6px 0;
      }
      .ptb-level-row::before{
        content:"";position:absolute;left:50%;top:50%;width:48%;height:1px;z-index:0;
        background:linear-gradient(90deg,rgba(93,221,255,.36),transparent 78%);
        transform-origin:left center;opacity:.42
      }
      .ptb-level-row.side-left::before{transform:translateY(-50%) rotate(180deg)}
      .ptb-level-row.side-right::before{transform:translateY(-50%)}
      .ptb-level-dot{display:none!important}
      .ptb-level-card{
        display:contents!important;min-height:0!important;padding:0!important;border:0!important;background:none!important;box-shadow:none!important
      }

      .ptb-level-node{
        grid-column:2;grid-row:1;justify-self:center;align-self:center;position:relative;z-index:4;
        display:grid;place-items:center;width:72px;height:80px
      }
      .ptb-level-mini-badge{
        position:relative;width:62px;height:62px;margin:0!important;display:grid;place-items:center;justify-self:center;
        filter:drop-shadow(0 7px 10px rgba(0,0,0,.22));transition:transform .2s ease,filter .2s ease
      }
      .ptb-level-mini-badge::after{
        content:"✦";position:absolute;right:-3px;top:1px;color:#dffcff;font-size:.62rem;opacity:.78;
        text-shadow:0 0 8px #72e6ff,0 0 14px #9f72ff
      }
      .ptb-level-mini-badge img,
      .ptb-level-row.is-completed .ptb-level-mini-badge img,
      .ptb-level-row.is-current .ptb-level-mini-badge img{
        width:62px;height:62px;display:block;object-fit:contain
      }
      .ptb-level-mini-badge b,
      .ptb-level-row.is-completed .ptb-level-mini-badge b,
      .ptb-level-row.is-current .ptb-level-mini-badge b{
        position:absolute;left:50%;top:50%;width:100%;transform:translate(-50%,-54%);display:grid;place-items:center;
        font-size:1.45rem;line-height:1;font-weight:1000;letter-spacing:-.04em;text-align:center;color:#fff;
        text-shadow:0 2px 5px rgba(4,8,39,.96)
      }
      .ptb-level-row.is-current .ptb-level-mini-badge{
        width:70px;height:70px;filter:drop-shadow(0 0 12px rgba(78,227,255,.6)) drop-shadow(0 0 16px rgba(203,78,255,.34))
      }
      .ptb-level-row.is-current .ptb-level-mini-badge img{width:70px;height:70px}
      .ptb-level-row.is-current .ptb-level-mini-badge b{font-size:1.7rem}
      .ptb-level-row.is-locked .ptb-level-mini-badge img{filter:saturate(.48) brightness(.72) contrast(.98)}
      .ptb-level-row.reward-claimed .ptb-level-mini-badge{filter:drop-shadow(0 0 8px rgba(90,239,255,.38))}
      .ptb-level-node-status{
        position:absolute;left:50%;bottom:-2px;transform:translateX(-50%);max-width:72px;padding:3px 8px;border-radius:999px;
        font-size:.5rem;line-height:1;font-weight:900;white-space:nowrap;color:#b9c6ff;background:rgba(8,20,74,.92);
        border:1px solid rgba(89,113,211,.42)
      }
      .ptb-level-row.is-current .ptb-level-node-status{color:#fff;background:linear-gradient(90deg,#38d9ff,#7d80ff 56%,#df58ff);border:0}
      .ptb-level-row.reward-claimable .ptb-level-node-status{color:#dfffff;border-color:#4fe6ff;box-shadow:0 0 8px rgba(71,224,255,.28)}
      .ptb-level-row.reward-claimed .ptb-level-node-status{color:#8ff9cc;border-color:rgba(81,238,183,.46)}

      .ptb-level-reward-card{
        position:relative;z-index:3;width:100%;max-width:154px;min-height:150px;box-sizing:border-box;padding:0 2px;
        border-radius:0;display:flex;flex-direction:column;align-items:center;justify-content:center;gap:7px;
        background:transparent;border:0;box-shadow:none;text-align:center
      }
      .ptb-level-row.side-left .ptb-level-reward-card{grid-column:1;justify-self:end;margin-right:6px}
      .ptb-level-row.side-right .ptb-level-reward-card{grid-column:3;justify-self:start;margin-left:6px}
      .ptb-level-row.side-left .ptb-level-reward-copy,
      .ptb-level-row.side-right .ptb-level-reward-copy{align-items:center;text-align:center}
      .ptb-level-node-status:empty{display:none}
      .ptb-level-row.side-left .ptb-level-reward-card::after,
      .ptb-level-row.side-right .ptb-level-reward-card::after{display:none}
      .ptb-level-row.reward-claimable .ptb-level-reward-card{box-shadow:none}
      .ptb-level-row.reward-claimed .ptb-level-reward-card{opacity:.72}
      .ptb-level-row.is-locked .ptb-level-reward-card{opacity:.76}

      .ptb-level-reward-copy{min-width:0;max-width:142px;display:flex;flex-direction:column;align-items:center;gap:3px}
      .ptb-level-reward-copy strong{
        color:#fff;font-size:1.38rem;line-height:1.06;font-weight:1000;overflow-wrap:anywhere;text-align:center
      }
      .ptb-level-reward-copy small{color:#9dace9;font-size:.53rem;line-height:1.05;font-weight:750;text-align:center}
      .ptb-level-row.is-locked .ptb-level-reward-copy small{display:none}
      .ptb-level-row.reward-claimable .ptb-level-reward-copy small{color:#68efff;font-weight:900}
      .ptb-level-row.reward-claimed .ptb-level-reward-copy small{color:#80efc0;font-weight:900}

      .ptb-level-claim-icon{
        position:relative;flex:0 0 132px;width:132px;height:132px;padding:0;border:0;border-radius:0;
        display:grid;place-items:center;background:transparent;box-shadow:none;cursor:default
      }
      .ptb-level-claim-icon .ptb-level-reward-icon{width:110px;height:110px;flex-basis:110px;border-radius:0;border:0;box-shadow:none;background:transparent}
      .ptb-level-claim-icon .ptb-level-reward-icon.is-coins,
      .ptb-level-claim-icon .ptb-level-reward-icon.is-gems{width:120px;height:120px;flex-basis:120px;background:transparent}
      .ptb-level-claim-icon .ptb-level-reward-icon.is-frame,
      .ptb-level-claim-icon .ptb-level-reward-icon.is-avatar{width:116px;height:116px;flex-basis:116px}
      .ptb-level-claim-icon .ptb-level-reward-icon.is-tag{
        width:138px;height:58px;flex-basis:58px;overflow:visible;background:transparent;border:0;box-shadow:none
      }
      .ptb-level-claim-icon:has(.ptb-level-reward-icon.is-tag){height:78px;flex-basis:78px}
      .ptb-level-tag-preview{
        min-width:118px;min-height:42px;padding:8px 14px;box-sizing:border-box;display:inline-flex;align-items:center;justify-content:center;gap:8px;
        border:2px solid #70839b;border-radius:13px;background:linear-gradient(180deg,#27314d,#1a2340);
        color:#fff;font-size:.78rem;font-style:normal;font-weight:900;box-shadow:0 7px 18px rgba(0,0,0,.22),inset 0 0 12px rgba(120,72,230,.08)
      }
      .ptb-level-tag-preview em{font-style:normal;font-size:1rem;line-height:1}
      .ptb-level-tag-preview b{font:inherit;white-space:nowrap}
      .ptb-level-claim-icon.is-claimable{
        cursor:pointer;box-shadow:none;animation:ptbConstellationClaim 1.65s ease-in-out infinite
      }
      .ptb-level-claim-icon.is-claimable::before{display:none}
      .ptb-level-claim-icon.is-claimed{opacity:1;filter:none}
      .ptb-level-claim-icon.is-claimed .ptb-level-reward-icon{opacity:.62;filter:saturate(.68)}
      .ptb-level-claim-icon.is-claimed::after{
        content:"✓";position:absolute;left:50%;top:50%;right:auto;bottom:auto;transform:translate(-50%,-50%);
        z-index:6;width:36px;height:36px;border-radius:50%;display:grid;place-items:center;
        background:#25cda0;border:3px solid #effff9;color:#fff;font-size:1.05rem;font-weight:1000;
        box-shadow:0 0 0 3px rgba(10,38,72,.28),0 0 15px rgba(50,230,181,.72)
      }
      .ptb-level-claim-icon:disabled{cursor:default}
      @keyframes ptbConstellationClaim{
        0%,100%{transform:scale(1);filter:brightness(1)}
        50%{transform:scale(1.055);filter:brightness(1.12)}
      }

      .ptb-level-copy,.ptb-level-reward,.ptb-level-status{display:none!important}
      .ptb-levels-footer{padding-top:14px}
      .ptb-levels-footer::before{
        content:"✦  ✧  ✦";display:block;margin-bottom:7px;color:#8bddff;font-size:.64rem;letter-spacing:.6em;
        text-shadow:0 0 8px rgba(90,219,255,.66)
      }


      /* V8 — fond spatial FIXE de la page Niveaux */
      .ptb-levels-panel{
        background-color:#050d35!important;
        background-image:url('/level-background-v1.png')!important;
        background-position:center top!important;
        background-size:100% auto!important;
        background-repeat:no-repeat!important;
      }
      .ptb-levels-panel::before,
      .ptb-levels-panel::after{
        display:none!important;
      }
      .ptb-levels-scroll{
        background:transparent!important;
      }

      /* V5 — récompenses constellation : grande icône, texte dessous */
      .ptb-levels-list .ptb-level-claim-icon{width:132px;height:132px;flex-basis:132px}
      .ptb-levels-list .ptb-level-claim-icon .ptb-level-reward-icon{width:110px;height:110px;flex-basis:110px}
      .ptb-levels-list .ptb-level-claim-icon .ptb-level-reward-icon.is-coins,
      .ptb-levels-list .ptb-level-claim-icon .ptb-level-reward-icon.is-gems{width:120px;height:120px;flex-basis:120px}
      .ptb-levels-hero-reward [data-level-claim]{margin:0}
      .ptb-levels-hero-reward .ptb-level-claim-icon{width:41px;height:41px;flex-basis:41px}
      .ptb-levels-hero-reward .ptb-level-claim-icon .ptb-level-reward-icon{width:34px;height:34px;flex-basis:34px}
      .ptb-levels-hero-reward .ptb-level-claim-icon .ptb-level-reward-icon.is-coins,
      .ptb-levels-hero-reward .ptb-level-claim-icon .ptb-level-reward-icon.is-gems{width:37px;height:37px;flex-basis:37px}

      @media(max-width:370px){
        .ptb-level-row{grid-template-columns:minmax(0,1fr) 64px minmax(0,1fr);min-height:150px}
        .ptb-level-node{width:64px;height:74px}
        .ptb-level-mini-badge,
        .ptb-level-mini-badge img,
        .ptb-level-row.is-completed .ptb-level-mini-badge img{width:56px;height:56px}
        .ptb-level-row.is-current .ptb-level-mini-badge{width:64px;height:64px}
        .ptb-level-row.is-current .ptb-level-mini-badge img{width:64px;height:64px}
        .ptb-level-mini-badge b,
        .ptb-level-row.is-completed .ptb-level-mini-badge b{font-size:1.28rem}
        .ptb-level-row.is-current .ptb-level-mini-badge b{font-size:1.52rem}
        .ptb-level-reward-card{max-width:132px;min-height:138px;padding:0;gap:5px}
        .ptb-level-row.side-left .ptb-level-reward-card{margin-right:5px}
        .ptb-level-row.side-right .ptb-level-reward-card{margin-left:5px}
        .ptb-levels-list .ptb-level-claim-icon{width:116px;height:116px;flex-basis:116px}
        .ptb-levels-list .ptb-level-claim-icon .ptb-level-reward-icon{width:98px;height:98px;flex-basis:98px}
        .ptb-levels-list .ptb-level-claim-icon .ptb-level-reward-icon.is-coins,
        .ptb-levels-list .ptb-level-claim-icon .ptb-level-reward-icon.is-gems{width:106px;height:106px;flex-basis:106px}
        .ptb-levels-list .ptb-level-claim-icon .ptb-level-reward-icon.is-tag{width:126px;height:54px;flex-basis:54px}
        .ptb-levels-list .ptb-level-claim-icon:has(.ptb-level-reward-icon.is-tag){height:72px;flex-basis:72px}
        .ptb-level-tag-preview{min-width:108px;min-height:40px;padding:7px 11px;font-size:.72rem}
        .ptb-level-reward-copy strong{font-size:1.16rem}
        .ptb-level-reward-copy small{font-size:.49rem}
        .ptb-level-node-status{font-size:.46rem;padding:3px 6px}
      }
    `;
    document.head.appendChild(style);
  }

  function rewardForLevel(level) {
    const safeLevel = Math.max(1, Math.min(50, Math.floor(Number(level) || 1)));
    return LEVEL_REWARDS[safeLevel] || LEVEL_REWARDS[1];
  }

  function rewardLabel(reward, { short = false } = {}) {
    if (!reward) return "Récompense";
    return String((short && reward.short) || reward.label || "Récompense");
  }

  function rewardIconMarkup(reward, extraClass = "") {
    const type = String(reward?.type || "reward").replace(/[^a-z0-9_-]/gi, "").toLowerCase();
    const className = `ptb-level-reward-icon is-${type} ${extraClass}`.trim();
    const asset = String(reward?.asset || "").trim();
    if (asset) {
      return `<i class="${className}" aria-hidden="true"><img src="${escapeHtml(asset)}" alt=""></i>`;
    }
    if (reward?.type === "tag") {
      return `<i class="${className}" aria-hidden="true"><span class="ptb-level-tag-preview"><em>🌱</em><b>Débutant</b></span></i>`;
    }
    return `<i class="${className}" aria-hidden="true">★</i>`;
  }

  function rewardClaimIconButtonMarkup(level, reward, claimState, { hero = false, claiming = false } = {}) {
    const safeLevel = Math.max(1, Math.min(50, Math.floor(Number(level) || 1)));
    const disabled = claimState !== "claimable" || claiming;
    const label = claiming
      ? `Récupération de ${rewardLabel(reward)}`
      : claimState === "claimable"
        ? `Récupérer ${rewardLabel(reward)}`
        : claimState === "claimed"
          ? `${rewardLabel(reward)} récupéré`
          : `${rewardLabel(reward)}`;

    return `<button class="ptb-level-claim-icon is-${escapeHtml(claimState)}${hero ? " is-hero-claim" : ""}"
                    type="button"
                    data-level-claim="${safeLevel}"
                    aria-label="${escapeHtml(label)}"
                    title="${escapeHtml(label)}"
                    ${disabled ? "disabled" : ""}>
              ${rewardIconMarkup(reward, hero ? "is-hero" : "")}
            </button>`;
  }

  function levelStatus(level, currentLevel) {
    if (level < currentLevel) return "completed";
    if (level === currentLevel) return "current";
    return "locked";
  }

  function rewardClaimState(level, currentLevel) {
    if (levelRewardClaims.has(level)) return "claimed";
    if (level <= currentLevel && !levelRewardStatusLoaded) return "loading";
    if (level <= currentLevel) return "claimable";
    return "locked";
  }

  function levelSubtitle(level, currentLevel) {
    const rewardState = rewardClaimState(level, currentLevel);
    if (rewardState === "claimed") return level === currentLevel ? "Actuel · Récupéré" : "Récupéré";
    if (rewardState === "claimable") return "À récupérer";
    if (rewardState === "loading") return "Chargement...";
    return "";
  }

  function applyLevelRewardStatus(value) {
    const levels = Array.isArray(value?.claimedLevels) ? value.claimedLevels : [];
    levelRewardClaims = new Set(
      levels.map(Number).filter(level => Number.isInteger(level) && level >= 1 && level <= 50)
    );
    unlimitedLivesUntil = Math.max(0, Number(value?.unlimitedLivesUntil) || 0);
    levelRewardStatusLoaded = true;
    if (levelsOverlay?.classList.contains("is-open")) renderLevelsOverlay();
  }

  function requestLevelRewardStatus({ force = false } = {}) {
    if (!force && levelRewardStatusLoaded) {
      return Promise.resolve({ claimedLevels:[...levelRewardClaims], unlimitedLivesUntil });
    }
    if (levelRewardStatusPromise) return levelRewardStatusPromise;

    const token = walletToken();
    if (!token || typeof socket === "undefined" || !socket?.connected) {
      return Promise.reject(new Error("Récompenses de niveaux indisponibles."));
    }

    levelRewardStatusPromise = new Promise((resolve, reject) => {
      socket.timeout(8000).emit("level-rewards:get", { walletToken:token }, (err, res) => {
        levelRewardStatusPromise = null;
        if (err || !res?.ok) {
          reject(new Error(res?.error || "Récompenses de niveaux indisponibles."));
          return;
        }
        applyLevelRewardStatus(res);
        resolve(res);
      });
    });

    return levelRewardStatusPromise;
  }

  function rewardSuccessMessage(level, result = {}) {
    if (result.kind === "coins") return `+${Math.max(0, Number(result.amount) || 0)} pièces`;
    if (result.kind === "gems") return `+${Math.max(0, Number(result.amount) || 0)} gemmes`;
    if (result.kind === "lives") return `Vies illimitées +${Math.max(0, Number(result.minutes) || 0)} min`;
    if (result.kind === "item") return String(result.item?.label || rewardLabel(rewardForLevel(level)));
    return rewardLabel(rewardForLevel(level));
  }

  function claimLevelReward(level) {
    const currentLevel = readCache()?.level || 1;
    const safeLevel = Math.max(1, Math.min(50, Math.floor(Number(level) || 0)));
    if (!safeLevel || safeLevel > currentLevel || !levelRewardStatusLoaded || levelRewardClaims.has(safeLevel) || levelRewardClaiming) return;

    const token = walletToken();
    if (!token || typeof socket === "undefined" || !socket?.connected) {
      try { toast("Connexion requise pour récupérer la récompense."); } catch {}
      return;
    }

    levelRewardClaiming = safeLevel;
    renderLevelsOverlay();

    socket.timeout(12000).emit("level-rewards:claim", { walletToken:token, level:safeLevel }, (err, res) => {
      levelRewardClaiming = 0;
      if (err || !res?.ok) {
        try { toast(res?.error || "Impossible de récupérer la récompense."); } catch {}
        renderLevelsOverlay();
        return;
      }

      applyLevelRewardStatus(res.status || {
        claimedLevels:[...levelRewardClaims, safeLevel],
        unlimitedLivesUntil:res.unlimitedLivesUntil || 0
      });

      try { window.PtitBacEconomy?.refresh?.(); } catch {}
      try { window.PtitBacInventory?.refresh?.(); } catch {}

      const result = res.result || {};
      if (result.kind === "chest" && result.chestType && result.reward) {
        try {
          window.PtitBacRewards?.receiveGranted?.({
            chestType:result.chestType,
            reward:result.reward
          });
        } catch {}
      } else {
        try { toast(`Niveau ${safeLevel} · ${rewardSuccessMessage(safeLevel, result)}`); } catch {}
      }

      renderLevelsOverlay();
    });
  }

  function lockIconMarkup() {
    return "";
  }

  function visibleLevelWindow() {
    return { start: 1, end: 50 };
  }

  function ensureLevelsOverlay() {
    if (levelsOverlay?.isConnected) return levelsOverlay;

    levelsOverlay = document.createElement("section");
    levelsOverlay.className = "ptb-levels-overlay";
    levelsOverlay.setAttribute("aria-hidden", "true");
    levelsOverlay.innerHTML = `
      <div class="ptb-levels-panel" role="dialog" aria-modal="true" aria-label="Page des niveaux">
        <div class="ptb-levels-scroll">
          <header class="ptb-levels-header">
            <button type="button" class="ptb-levels-back" aria-label="Retour">
              <img src="/back-arrow.png" alt="">
            </button>
            <h1 class="ptb-levels-title">Niveaux</h1>
          </header>

          <section class="ptb-levels-hero">
            <div class="ptb-levels-hero-top">
              <div class="ptb-levels-hero-badge">
                <img src="/level-badge-v1.png" alt="">
                <b data-level-current>1</b>
              </div>

              <div class="ptb-levels-hero-copy">
                <h2>Niveau actuel</h2>
                <div class="ptb-levels-hero-track" role="progressbar" aria-label="Progression du niveau actuel" aria-valuemin="0" aria-valuemax="100" aria-valuenow="0">
                  <i class="ptb-levels-hero-fill"></i>
                </div>
                <div class="ptb-levels-hero-meta">
                  <strong data-level-xp>0 / 100 XP</strong>
                </div>
              </div>
            </div>
          </section>

          <section class="ptb-levels-list" aria-label="Progression des niveaux">
            <span class="ptb-levels-line" aria-hidden="true"></span>
            <div data-level-rows></div>
            <footer class="ptb-levels-footer" aria-hidden="true">
              <div class="ptb-levels-footer-dots"><i></i><i></i><i></i></div>
            </footer>
          </section>
        </div>
      </div>`;

    levelsOverlay.addEventListener("click", event => {
      const rewardButton = event.target.closest?.("[data-level-claim]");
      if (rewardButton && levelsOverlay.contains(rewardButton)) {
        event.preventDefault();
        event.stopPropagation();
        claimLevelReward(rewardButton.dataset.levelClaim);
        return;
      }
      if (event.target === levelsOverlay) closeLevelsOverlay();
    });
    levelsOverlay.querySelector(".ptb-levels-back")?.addEventListener("click", closeLevelsOverlay);
    levelsOverlay.addEventListener("keydown", event => {
      if (event.key === "Escape") {
        event.preventDefault();
        closeLevelsOverlay();
      }
    });

    document.body.appendChild(levelsOverlay);
    return levelsOverlay;
  }

  function renderLevelsOverlay() {
    const overlay = ensureLevelsOverlay();
    const current = readCache() || normalizeState({ level:1, totalXp:0, xpIntoLevel:0, xpForNext:100, progress:0, progressPercent:0, maxLevel:false, trophies:0, completedGames:0, wins:0 });

    const levelNode = overlay.querySelector("[data-level-current]");
    const xpNode = overlay.querySelector("[data-level-xp]");
    const track = overlay.querySelector(".ptb-levels-hero-track");
    const fill = overlay.querySelector(".ptb-levels-hero-fill");
    const rowsHost = overlay.querySelector("[data-level-rows]");

    if (levelNode) levelNode.textContent = String(current.level);
    if (xpNode) {
      xpNode.textContent = current.maxLevel
        ? "Niveau maximum"
        : `${current.xpIntoLevel} / ${current.xpForNext} XP`;
    }
    if (track) track.setAttribute("aria-valuenow", String(Math.round(current.progressPercent)));
    if (fill) fill.style.width = `${current.progressPercent}%`;

    const { start, end } = visibleLevelWindow(current.level);
    const parts = [];
    for (let level = start; level <= end; level += 1) {
      const status = levelStatus(level, current.level);
      const claimState = rewardClaimState(level, current.level);
      const claiming = levelRewardClaiming === level;
      const reward = rewardForLevel(level);
      const side = level % 2 === 1 ? "left" : "right";
      const statusText = claiming ? "Récupération..." : levelSubtitle(level, current.level);

      parts.push(`
        <article class="ptb-level-row side-${side} is-${status} reward-${claimState}" data-level-row="${level}">
          <div class="ptb-level-card">
            <div class="ptb-level-reward-card">
              ${rewardClaimIconButtonMarkup(level, reward, claimState, { claiming })}
              <div class="ptb-level-reward-copy">
                <strong>${escapeHtml(rewardLabel(reward, { short:true }))}</strong>
                <small>${escapeHtml(statusText)}</small>
              </div>
            </div>

            <div class="ptb-level-node" aria-label="Niveau ${level}">
              <div class="ptb-level-mini-badge">
                <img src="/level-badge-v1.png" alt="">
                <b>${level}</b>
              </div>
              <small class="ptb-level-node-status">${escapeHtml(status === "current" ? "Actuel" : claimState === "claimed" ? "Récupéré" : claimState === "claimable" ? "À récupérer" : "")}</small>
            </div>
          </div>
        </article>`);
    }
    if (rowsHost) rowsHost.innerHTML = parts.join("");

    const levelLine = overlay.querySelector(".ptb-levels-line");
    const currentRow = overlay.querySelector(`[data-level-row="${current.level}"]`);
    if (levelLine && currentRow) {
      requestAnimationFrame(() => {
        const lineRect = levelLine.getBoundingClientRect();
        const rowRect = currentRow.getBoundingClientRect();
        const target = Math.max(0, Math.min(
          lineRect.height,
          rowRect.top + (rowRect.height / 2) - lineRect.top
        ));
        levelLine.style.setProperty("--ptb-level-line-progress", `${target}px`);
      });
    }
  }

  function openLevelsOverlay(trigger) {
    if (trigger?.focus) lastFocusedTrigger = trigger;
    renderLevelsOverlay();
    requestLevelRewardStatus({ force:true }).catch(() => {});

    const overlay = ensureLevelsOverlay();
    overlay.classList.add("is-open");
    overlay.setAttribute("aria-hidden", "false");
    document.body.style.overflow = "hidden";

    requestAnimationFrame(() => {
      overlay.querySelector(".ptb-levels-back")?.focus();
      const currentLevel = readCache()?.level || 1;
      const row = overlay.querySelector(`[data-level-row="${currentLevel}"]`);
      row?.scrollIntoView({ block:"center", behavior:"smooth" });
    });
  }

  function closeLevelsOverlay() {
    if (!levelsOverlay) return;
    levelsOverlay.classList.remove("is-open");
    levelsOverlay.setAttribute("aria-hidden", "true");
    document.body.style.overflow = "";
    if (lastFocusedTrigger?.focus) {
      const target = lastFocusedTrigger;
      lastFocusedTrigger = null;
      setTimeout(() => target.focus(), 20);
    }
  }

  function bindLevelRewardUpdates(attempt = 0) {
    try {
      if (typeof socket === "undefined" || !socket?.on) {
        if (attempt < 20) setTimeout(() => bindLevelRewardUpdates(attempt + 1), 300);
        return;
      }
      socket.off?.("level-rewards:update", applyLevelRewardStatus);
      socket.on("level-rewards:update", applyLevelRewardStatus);
    } catch {}
  }

  bindLevelRewardUpdates();

  function bindLevelEntry(copy, target) {
    const profileButton = copy?.closest?.(".hm-profile");
    if (!copy || !profileButton || profileButton.dataset.ptbLevelTriggerBound === "1") return;

    profileButton.dataset.ptbLevelTriggerBound = "1";

    const isInside = (event, node) => {
      if (!node || !Number.isFinite(event.clientX) || !Number.isFinite(event.clientY)) return false;
      const rect = node.getBoundingClientRect();
      return event.clientX >= rect.left && event.clientX <= rect.right &&
        event.clientY >= rect.top && event.clientY <= rect.bottom;
    };

    profileButton.addEventListener("click", event => {
      const levelNode = copy.querySelector("small");
      const barNode = copy.querySelector(".ptb-home-xp-bar");
      if (!isInside(event, levelNode) && !isInside(event, barNode)) return;

      // Le badge et la barre sont des éléments décoratifs en pointer-events:none :
      // le tap arrive donc sur le bouton Profil. On l'intercepte seulement dans
      // leur zone pour ouvrir Niveaux, sans casser le clic avatar/pseudo.
      event.preventDefault();
      event.stopImmediatePropagation();

      requestState({ force:false })
        .catch(() => readCache())
        .finally(() => openLevelsOverlay(profileButton));
    }, true);
  }

  function patchHome() {
    const current = readCache();
    const copy = document.querySelector(".home-mobile .hm-profile-copy");
    if (!copy || !current) return;

    const level = copy.querySelector("small");
    if (level) {
      const nextLabel = String(current.level);
      if (level.textContent !== nextLabel) level.textContent = nextLabel;
      level.removeAttribute("title");
      level.setAttribute("aria-label", `Niveau ${current.level}`);
    }

    let bar = copy.querySelector(".ptb-home-xp-bar");
    if (!bar) {
      bar = document.createElement("span");
      bar.className = "ptb-home-xp-bar";
      bar.setAttribute("role", "progressbar");
      bar.innerHTML = '<i class="ptb-home-xp-fill"></i>';
      copy.appendChild(bar);
    }

    bar.setAttribute("aria-label", `Progression du niveau ${current.level}`);
    bar.setAttribute("aria-valuemin", "0");
    bar.setAttribute("aria-valuemax", "100");
    bar.setAttribute("aria-valuenow", String(Math.round(current.progressPercent)));

    const fill = bar.querySelector(".ptb-home-xp-fill");
    if (fill) fill.style.width = `${current.progressPercent}%`;

    bindLevelEntry(copy, bar);
  }

  function liveRoomState() {
    try {
      return typeof session !== "undefined" ? session?.state || null : null;
    } catch {
      return null;
    }
  }

  function livePlayers() {
    const room = liveRoomState();
    return Array.isArray(room?.players) ? room.players : [];
  }

  function localPlayerId() {
    try {
      return String(session?.playerId || "");
    } catch {
      return "";
    }
  }

  function tagLabel(player) {
    let id = String(player?.tagId || "").trim();

    if (!id && String(player?.id || "") === localPlayerId()) {
      try {
        id = String(window.PtitBacInventory?.state?.()?.equipped?.tag || "").trim();
      } catch {}
    }

    if (!id || id === "tag_debutant") return "Débutant";

    return id
      .replace(/^tag[_-]?/i, "")
      .replace(/[_-]+/g, " ")
      .replace(/\b\w/g, char => char.toUpperCase())
      .trim() || "Débutant";
  }

  function playerForResultNode(node) {
    const players = livePlayers();
    if (!players.length || !node) return null;

    const nameNode = node.matches(".fin-row")
      ? node.querySelector(".fin-player > strong")
      : node.querySelector(":scope > strong");

    const name = String(nameNode?.textContent || "").trim();
    if (!name) return null;

    const sameName = players.filter(player => String(player?.name || "").trim() === name);
    if (sameName.length === 1) return sameName[0];

    if (node.querySelector(".fin-you")) {
      const self = sameName.find(player => String(player?.id || "") === localPlayerId());
      if (self) return self;
    }

    return sameName[0] || null;
  }

  function decorateResultPlayers(root) {
    root.querySelectorAll(".fin-podium-card").forEach(card => {
      const player = playerForResultNode(card);
      if (player) {
        card.dataset.playerId = String(player.id || "");
        const avatar = card.querySelector(".fin-avatar");
        if (avatar) avatar.dataset.playerId = String(player.id || "");
      }

      if (!card.querySelector(".fin-title-tag")) {
        const name = card.querySelector(":scope > strong");
        if (name) {
          const tag = document.createElement("span");
          tag.className = "fin-title-tag";
          tag.textContent = tagLabel(player);
          name.insertAdjacentElement("afterend", tag);
        }
      }

      const medal = card.querySelector(".fin-medal");
      const isWinner = card.classList.contains("place-1");

      if (!isWinner) {
        card.querySelectorAll(".fin-rank-crown").forEach(crown => crown.remove());
      } else if (medal && !card.querySelector(".fin-rank-crown")) {
        const crown = document.createElement("img");
        crown.className = "fin-rank-crown";
        crown.src = "/admin-crown.png";
        crown.alt = "";
        crown.setAttribute("aria-hidden", "true");
        medal.insertAdjacentElement("beforebegin", crown);
      }
    });

    root.querySelectorAll(".fin-row").forEach(row => {
      const player = playerForResultNode(row);
      if (player) {
        row.dataset.playerId = String(player.id || "");
        const avatar = row.querySelector(".fin-avatar");
        if (avatar) avatar.dataset.playerId = String(player.id || "");
      }

      const playerBox = row.querySelector(".fin-player");
      if (playerBox && !playerBox.querySelector(".fin-title-tag")) {
        const name = playerBox.querySelector("strong");
        if (name) {
          const tag = document.createElement("span");
          tag.className = "fin-title-tag";
          tag.textContent = tagLabel(player);
          name.insertAdjacentElement("afterend", tag);
        }
      }
    });
  }

  function patchFinalVisual(root) {
    if (!root) return;

    root.querySelector(".fin-top")?.remove();

    const heading = root.querySelector(".fin-heading");
    if (heading && heading.dataset.redesigned !== "1") {
      const winnerText = String(heading.querySelector("p")?.textContent || "").trim();
      heading.dataset.redesigned = "1";
      heading.innerHTML = `
        <button class="fin-back" id="finBack" type="button" aria-label="Retour à l’accueil">
          <img src="/back-arrow.png" alt="">
        </button>
        <div class="fin-heading-copy">
          <small>PARTIE TERMINÉE</small>
          <h1>${winnerHeadingMarkup(winnerText)}</h1>
        </div>`;
    }

    const back = root.querySelector("#finBack");
    if (back && back.dataset.bound !== "1") {
      back.dataset.bound = "1";
      back.addEventListener("click", () => {
        root.querySelector("#finHome")?.click();
      });
    }

    decorateResultPlayers(root);

    const actions = root.querySelector(".fin-actions");
    const home = root.querySelector("#finHome");
    const replay = root.querySelector("#finReplay, #finQuick");

    if (replay) {
      replay.textContent = "Retour au salon";
      replay.classList.remove("fin-replay-secondary");
      replay.classList.add("fin-return-lobby");

      if (actions && actions.firstElementChild !== replay) {
        actions.insertBefore(replay, actions.firstElementChild);
      }
    }

    if (home) {
      home.textContent = "Retour à l’accueil";
      home.classList.remove("fin-continue");
      home.classList.add("fin-home-secondary");

      if (actions) {
        if (replay && replay.nextElementSibling !== home) {
          replay.insertAdjacentElement("afterend", home);
        } else if (!replay && actions.lastElementChild !== home) {
          actions.appendChild(home);
        }
      }
    }
  }

  function burstLevelUp(level, eventKey) {
    if (!eventKey || shownLevelUps.has(eventKey)) return;
    shownLevelUps.add(eventKey);

    document.querySelector(".ptb-level-up-burst")?.remove();

    const burst = document.createElement("div");
    burst.className = "ptb-level-up-burst";
    burst.innerHTML = `<small>NIVEAU SUPÉRIEUR</small><strong>NIVEAU ${level} !</strong>`;
    document.body.appendChild(burst);
    setTimeout(() => burst.remove(), 1900);
  }

  function animateFinalBar(card, current, award) {
    const fill = card.querySelector(".ptb-final-xp-fill");
    if (!fill || card.dataset.animated === "1") return;
    card.dataset.animated = "1";

    const afterPercent = clampPercent(current.progressPercent);
    const beforePercent = clampPercent(award?.before?.progressPercent ?? afterPercent);
    fill.style.transition = "none";
    fill.style.width = `${beforePercent}%`;

    requestAnimationFrame(() => {
      requestAnimationFrame(() => {
        fill.style.transition = "width .8s cubic-bezier(.22,.8,.25,1)";

        if (award?.levelUp) {
          card.classList.add("is-level-up");
          fill.style.width = "100%";
          setTimeout(() => {
            fill.style.transition = "none";
            fill.style.width = "0%";
            requestAnimationFrame(() => {
              fill.style.transition = "width .72s cubic-bezier(.22,.8,.25,1)";
              fill.style.width = `${afterPercent}%`;
            });
          }, 760);
          setTimeout(() => burstLevelUp(current.level, award.eventKey), 420);
        } else {
          fill.style.width = `${afterPercent}%`;
        }
      });
    });
  }

  function rewardSubtitle(roomState, progressionEnabled) {
    if (roomState?.mode === "private" || !progressionEnabled) {
      return "Salon privé : aucun gain de progression pour cette partie.";
    }
    return "Voici les gains ajoutés à ta progression.";
  }

  function patchFinal() {
    const root = document.querySelector(".final-mobile");
    if (!root) return;

    patchFinalVisual(root);

    const roomState = liveRoomState();
    const progressionEnabled = roomState?.progressionEnabled === true;

    let card = root.querySelector(".ptb-final-xp-card");

    // Aucun bloc de gains si la progression est désactivée (ex. salon privé).
    if (!progressionEnabled) {
      card?.remove();
      return;
    }

    const current = readCache();

    if (!card) {
      card = document.createElement("section");
      card.className = "ptb-final-xp-card";
      const actions = root.querySelector(".fin-actions");
      if (actions) actions.before(card);
      else root.appendChild(card);
    }

    if (!current) {
      if (card.dataset.progressionSignature !== "loading") {
        card.dataset.progressionSignature = "loading";
        card.innerHTML = `
          <div class="ptb-final-reward-heading">
            <small>TES GAINS</small>
            <p>Chargement de ta progression…</p>
          </div>`;
      }
      return;
    }

    const roomAward = roomState?.myProgression || null;
    const award = progressionEnabled ? (roomAward || lastAward) : null;

    const gainedXp = progressionEnabled
      ? Math.max(0, Number(award?.gainedXp) || 0)
      : 0;

    const gainedTrophies = progressionEnabled
      ? Math.max(0, Number(award?.gainedTrophies) || 0)
      : 0;

    const before = normalizeState(award?.before) || current;
    const fromLevel = Math.max(1, Number(before.level) || current.level);
    const toLevel = current.level;
    const levelLabel = toLevel > fromLevel
      ? `Niveau ${fromLevel} → ${toLevel}`
      : `Niveau ${toLevel}`;

    const xpText = current.maxLevel
      ? "Niveau maximum"
      : `${current.xpIntoLevel} / ${current.xpForNext} XP`;

    const remaining = current.maxLevel
      ? 0
      : Math.max(0, current.xpForNext - current.xpIntoLevel);

    const remainingText = current.maxLevel
      ? "Niveau maximum atteint."
      : remaining === 0
        ? "Prochain niveau atteint !"
        : `Encore ${remaining} XP pour atteindre le niveau ${Math.min(50, current.level + 1)}.`;

    const signature = [
      current.level,
      Math.round(current.progressPercent * 100) / 100,
      current.xpIntoLevel,
      current.xpForNext,
      current.trophies,
      gainedXp,
      gainedTrophies,
      award?.eventKey || "private"
    ].join(":");

    if (card.dataset.progressionSignature !== signature) {
      card.dataset.progressionSignature = signature;
      card.dataset.animated = "0";
      card.classList.remove("is-level-up");
      card.innerHTML = `
        <div class="ptb-final-reward-heading">
          <small>TES GAINS</small>
          <p>${rewardSubtitle(roomState, progressionEnabled)}</p>
        </div>

        <div class="ptb-final-reward-grid">
          <article class="ptb-final-reward-card is-xp">
            <div class="ptb-final-reward-icon"><b>XP</b></div>
            <div>
              <strong>+${gainedXp} XP</strong>
              <small>Expérience gagnée</small>
            </div>
          </article>

          <article class="ptb-final-reward-card is-trophy">
            <div class="ptb-final-reward-icon">
              <img src="/scoreboard-trophy.png" alt="">
            </div>
            <div>
              <strong>+${gainedTrophies} trophées</strong>
              <small>Trophées gagnés</small>
            </div>
          </article>
        </div>

        <div class="ptb-final-level-box">
          <div class="ptb-final-level-head">
            <strong>${levelLabel}</strong>
            <span>Progression <b>+${gainedXp} XP</b></span>
          </div>

          <div class="ptb-final-xp-track" role="progressbar"
               aria-label="Progression du niveau ${current.level}"
               aria-valuemin="0" aria-valuemax="100"
               aria-valuenow="${Math.round(current.progressPercent)}">
            <i class="ptb-final-xp-fill"></i>
          </div>

          <div class="ptb-final-level-foot">
            <small>${remainingText}</small>
            <strong>${xpText}</strong>
          </div>
        </div>`;
    }

    animateFinalBar(card, current, award);
  }

  function patch() {
    scheduled = false;
    styleOnce();
    patchHome();
    patchFinal();
  }

  function schedulePatch() {
    if (scheduled) return;
    scheduled = true;
    requestAnimationFrame(patch);
  }

  function handleProgressionUpdate(payload) {
    if (!payload?.state) return;
    lastAward = payload.result && typeof payload.result === "object"
      ? payload.result
      : null;
    cacheState(payload.state);
  }

  function warm(attempt = 0) {
    if (walletToken() && typeof socket !== "undefined" && socket?.connected) {
      requestState({ force:true }).catch(() => {});
      return;
    }
    if (attempt < 20) setTimeout(() => warm(attempt + 1), 500);
  }

  function start() {
    styleOnce();
    readCache();

    document.addEventListener("ptitbac:screen-rendered", schedulePatch);
    document.addEventListener("ptitbac:dom-updated", schedulePatch);

    try {
      socket?.on?.("connect", () => setTimeout(() => warm(0), 100));
      socket?.on?.("progression:update", handleProgressionUpdate);
      socket?.on?.("room:state", room => {
        if (room?.myProgression?.after) {
          lastAward = room.myProgression;
          cacheState(room.myProgression.after);
        }
        schedulePatch();
      });
    } catch {}

    warm(0);
    schedulePatch();
  }

  window.PtitBacProgression = {
    state: () => normalizeState(readCache()),
    refresh: () => requestState({ force:true }),
    openLevels: trigger => openLevelsOverlay(trigger || document.activeElement || null)
  };

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", start, { once:true });
  } else {
    start();
  }
})();
