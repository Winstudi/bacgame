(() => {
  "use strict";

  const BASE = "/";
  const MAP = {
    settings: "settings.png",
    plus: "plus.png",
    shop: "shop.png",
    gift: "rewards.png",
    users: "friends.png"
  };

  const oldUiIcon = typeof uiIcon === "function" ? uiIcon : null;

  window.ptitBacPngIcon = function(name, extraClass = "") {
    const file = MAP[name];
    if (!file) return oldUiIcon ? oldUiIcon(name, extraClass) : "";
    return `<span class="ui-icon pb-global-icon ${extraClass}"><img src="${BASE}${file}" alt="" aria-hidden="true"></span>`;
  };

  if (oldUiIcon) {
    try { uiIcon = window.ptitBacPngIcon; } catch {}
  }

  if (typeof homeCoin === "function") {
    try {
      homeCoin = function(sizeClass = "") {
        return `<span class="home-coin ${sizeClass}" aria-hidden="true"><img class="pb-global-coin" src="${BASE}coin.png" alt=""></span>`;
      };
    } catch {}
  }

  // Une seule image publiée pour les 3 niveaux de difficulté.
  // Les renderers utilisent directement cet asset : aucun patch DOM tardif.
  const DIFFICULTY_ICON = `${BASE}difficulty.png`;

  window.PtitBacDifficultyIcon = DIFFICULTY_ICON;
})();