/* =========================================================
   P'tit Bac — Inventaire serveur V2
   PostgreSQL = source de vérité ; localStorage = cache visuel.
   La page Inventaire est un écran plein écran, pas une modale.
   ========================================================= */
(() => {
  "use strict";

  const STORAGE_KEY = "petitbac_inventory_v1";
  const BASE_AVATARS = ["/a1.webp", "/a2.webp", "/a3.webp", "/a4.webp", "/a5.webp"];
  const KNOWN_AVATARS = Object.freeze([
    ...BASE_AVATARS,
    "/avatar-prestige.png",
    "/avatar-main-quantique.webp",
    "/avatar-chevalier.webp",
    "/avatar-renard.webp",
    "/avatar-spectre.webp",
    "/avatar-minto.webp",
    "/avatar-bot.webp",
    "/avatar-game.webp",
    "/avatar-sanctuaire.webp",
    "/avatar-ramen.webp",
    "/avatar-volcan.webp",
    "/avatar-orage.webp",
    "/avatar-potion.webp",
    "/avatar-arcade.webp",
    "/avatar-tresor.webp",
    "/avatar-portail-cristal.webp"
  ]);

  const FRAMES = Object.freeze({
    frame_nature: {
      id:"frame_nature",
      name:"Nature",
      asset:"/frame-nature.png"
    },
    frame_gaming: {
      id:"frame_gaming",
      name:"Gaming",
      asset:"/frame-gaming.png"
    },
    frame_purple_flame: {
      id:"frame_purple_flame",
      name:"Flamme violette",
      asset:"/frame-purple-flame.png"
    },
    frame_ice: {
      id:"frame_ice",
      name:"Glace",
      asset:"/frame-ice.png"
    },
    frame_gold_stars: {
      id:"frame_gold_stars",
      name:"Étoiles dorées",
      asset:"/frame-gold-stars.png"
    },
    "frame-prestige": {
      id:"frame-prestige",
      name:"Prestige",
      asset:"/frame-prestige.png"
    },
    frame_quantique: {
      id:"frame_quantique",
      name:"Cadre Quantique",
      asset:"/frame-quantique.png"
    },
    frame_ruines: {
      id:"frame_ruines",
      name:"Ruines",
      asset:"/frame-ruines.png"
    },
    frame_lave: {
      id:"frame_lave",
      name:"Lave",
      asset:"/frame-lave.png"
    },
    frame_flamme_cristal: {
      id:"frame_flamme_cristal",
      name:"Flamme Cristal",
      asset:"/frame-flamme-cristal.png"
    }
  });

  const TAGS = Object.freeze({
    tag_debutant: { id:"tag_debutant", name:"Débutant", icon:"🌱", className:"inv-tag-starter" },
    tag_quantique: {
      id:"tag_quantique",
      name:"Tag Quantique",
      asset:"/tag-quantique.png",
      className:"inv-tag-quantique"
    },
    tag_game_over: {
      id:"tag_game_over",
      name:"Game Over",
      asset:"/tag-game-over.png",
      className:"inv-tag-game-over"
    }
  });

  let serverState = null;
  let serverStateWalletToken = "";
  let loadingPromise = null;
  let loadingWalletToken = "";
  let inventoryOpen = false;
  let baselineState = null;
  let draftState = null;
  let saving = false;

  function esc(value = "") {
    return String(value).replace(/[&<>"']/g, char => ({
      "&":"&amp;", "<":"&lt;", ">":"&gt;", '"':"&quot;", "'":"&#039;"
    })[char]);
  }

  function walletToken() {
    return String(localStorage.getItem("petitbac_walletToken") || "").trim();
  }

  function cloneState(value) {
    const state = normalizeState(value);
    return {
      owned: {
        avatars:[...state.owned.avatars],
        frames:[...state.owned.frames],
        tags:[...state.owned.tags]
      },
      equipped:{ ...state.equipped }
    };
  }

  function legacyEquipped() {
    try {
      const raw = JSON.parse(localStorage.getItem(STORAGE_KEY) || "null");
      return {
        avatar: String(raw?.equipped?.avatar || localStorage.getItem("petitbac_profile_icon") || BASE_AVATARS[0]),
        frame: String(raw?.equipped?.frame || ""),
        tag: String(raw?.equipped?.tag || "tag_debutant")
      };
    } catch {
      return {
        avatar: String(localStorage.getItem("petitbac_profile_icon") || BASE_AVATARS[0]),
        frame: "",
        tag: "tag_debutant"
      };
    }
  }

  function purgeDeprecatedLocalCosmetics() {
    try {
      const raw = JSON.parse(localStorage.getItem(STORAGE_KEY) || "null");
      if (!raw || typeof raw !== "object") return;
      raw.owned = raw.owned && typeof raw.owned === "object" ? raw.owned : {};
      raw.equipped = raw.equipped && typeof raw.equipped === "object" ? raw.equipped : {};
      raw.owned.avatars = Array.isArray(raw.owned.avatars)
        ? raw.owned.avatars.filter(id => KNOWN_AVATARS.includes(id))
        : [...BASE_AVATARS];
      raw.owned.frames = Array.isArray(raw.owned.frames)
        ? raw.owned.frames.filter(id => FRAMES[id])
        : [];
      raw.owned.tags = Array.isArray(raw.owned.tags)
        ? raw.owned.tags.filter(id => TAGS[id])
        : ["tag_debutant"];
      raw.equipped.avatar = KNOWN_AVATARS.includes(raw.equipped.avatar)
        ? raw.equipped.avatar
        : BASE_AVATARS[0];
      raw.equipped.frame = FRAMES[raw.equipped.frame]
        ? raw.equipped.frame
        : "";
      raw.equipped.tag = raw.equipped.tag === ""
        ? ""
        : (TAGS[raw.equipped.tag] ? raw.equipped.tag : "tag_debutant");
      localStorage.setItem(STORAGE_KEY, JSON.stringify(raw));
    } catch {}
  }

  purgeDeprecatedLocalCosmetics();

  function normalizeState(value) {
    const owned = value?.owned || {};
    const equipped = value?.equipped || {};
    const avatars = Array.isArray(owned.avatars)
      ? owned.avatars.filter(id => KNOWN_AVATARS.includes(id))
      : [...BASE_AVATARS];
    const frames = Array.isArray(owned.frames)
      ? owned.frames.filter(id => FRAMES[id])
      : [];
    const tags = Array.isArray(owned.tags)
      ? owned.tags.filter(id => TAGS[id])
      : ["tag_debutant"];

    return {
      owned: {
        avatars: [...new Set(avatars)],
        frames: [...new Set(frames)],
        tags: [...new Set(tags)]
      },
      equipped: {
        avatar: avatars.includes(equipped.avatar) ? equipped.avatar : (avatars[0] || BASE_AVATARS[0]),
        frame: frames.includes(equipped.frame) ? equipped.frame : "",
        tag: equipped.tag === "" || tags.includes(equipped.tag)
          ? String(equipped.tag || "")
          : (tags[0] || "")
      }
    };
  }

  function cacheState(value, token = walletToken()) {
    serverState = normalizeState(value);
    serverStateWalletToken = String(token || "").trim();
    localStorage.setItem(STORAGE_KEY, JSON.stringify({
      ...serverState,
      walletToken: serverStateWalletToken
    }));

    if (serverState.equipped.avatar) {
      const name = localStorage.getItem("petitbac_profile_name") || "Joueur";
      try {
        if (typeof saveProfile === "function") saveProfile(name, serverState.equipped.avatar);
        else localStorage.setItem("petitbac_profile_icon", serverState.equipped.avatar);
      } catch {
        localStorage.setItem("petitbac_profile_icon", serverState.equipped.avatar);
      }
    }

    document.dispatchEvent(new CustomEvent("ptitbac:inventory-changed", {
      detail: { source:"server" }
    }));

    return serverState;
  }

  function fallbackState() {
    const token = walletToken();
    if (serverState && serverStateWalletToken === token) return normalizeState(serverState);
    try {
      const cached = JSON.parse(localStorage.getItem(STORAGE_KEY) || "null");
      if (cached?.walletToken && cached.walletToken !== token) return normalizeState(null);
      return normalizeState(cached);
    } catch {
      return normalizeState(null);
    }
  }

  function requestState({ force = false } = {}) {
    const token = walletToken();
    if (!token || typeof socket === "undefined" || !socket?.connected) {
      return Promise.reject(new Error("Connexion inventaire indisponible."));
    }

    if (!force && serverState && serverStateWalletToken === token) {
      return Promise.resolve(normalizeState(serverState));
    }
    if (loadingPromise && loadingWalletToken === token) return loadingPromise;

    const requestToken = token;
    let requestPromise = null;
    requestPromise = new Promise((resolve, reject) => {
      socket.timeout(8000).emit("inventory:get", {
        walletToken: requestToken,
        legacyEquipped: legacyEquipped()
      }, (err, res) => {
        if (loadingPromise === requestPromise) {
          loadingPromise = null;
          loadingWalletToken = "";
        }
        if (walletToken() !== requestToken) {
          reject(new Error("Identité joueur modifiée."));
          return;
        }
        if (err || !res?.ok || !res.state) {
          reject(new Error(res?.error || "Inventaire indisponible."));
          return;
        }
        resolve(cacheState(res.state, requestToken));
      });
    });

    loadingPromise = requestPromise;
    loadingWalletToken = requestToken;
    return requestPromise;
  }

  function profileName() {
    try {
      return String(typeof getProfile === "function" ? getProfile()?.name || "Joueur" : "Joueur");
    } catch {
      return String(localStorage.getItem("petitbac_profile_name") || "Joueur");
    }
  }

  function frameMarkup(frameId, extraClass = "") {
    const frame = FRAMES[frameId];
    if (!frame) return "";
    return `
      <span class="inv-frame ${esc(extraClass)}" aria-hidden="true">
        <img class="inv-frame-asset" src="${esc(frame.asset)}" alt="" draggable="false">
      </span>`;
  }

  function tagMarkup(tagId, extraClass = "") {
    const tag = TAGS[tagId];
    if (!tag) return "";

    if (tag.asset) {
      return `
        <span class="inv-tag ${tag.className} ${esc(extraClass)} inv-tag-image">
          <img src="${esc(tag.asset)}" alt="${esc(tag.name)}" draggable="false" style="display:block; max-width: 100%; height: auto; max-height: 44px; filter: drop-shadow(0 0 10px rgba(0, 220, 255, 0.35));">
        </span>`;
    }

    return `<span class="inv-tag ${tag.className} ${esc(extraClass)}"><span aria-hidden="true">${tag.icon}</span><strong>${esc(tag.name)}</strong></span>`;
  }

  function tagChoiceInner(tag) {
    if (!tag) return "";
    if (tag.asset) {
      return `
        <img src="${esc(tag.asset)}" alt="${esc(tag.name)}" draggable="false" style="display:block; width: 100%; max-width: 220px; height: auto; margin: 0 auto 6px;">
        <strong>${esc(tag.name)}</strong>`;
    }
    return `
      <span aria-hidden="true">${tag.icon}</span>
      <strong>${esc(tag.name)}</strong>`;
  }

  function ownedLabel(count) {
    const value = Math.max(0, Number(count) || 0);
    return `${value} possédé${value > 1 ? "s" : ""}`;
  }

  function saveIcon() {
    return `
      <svg viewBox="0 0 24 24" aria-hidden="true">
        <path d="M5 3h12l3 3v15H4V3h1Z"></path>
        <path d="M8 3v6h8V3M8 21v-7h8v7"></path>
      </svg>`;
  }

  function chevronIcon() {
    return `<span class="inventory-v2-chevron" aria-hidden="true">›</span>`;
  }

  function framePreview(state) {
    if (!state.equipped.frame) return "";

    const frame = FRAMES[state.equipped.frame];
    return `
      <div class="inventory-v2-frame-preview">
        <span>
          <img src="${esc(state.equipped.avatar)}" alt="" draggable="false">
          ${frameMarkup(state.equipped.frame, "inv-frame-preview")}
        </span>
        <small>${esc(frame?.name || "Cadre équipé")}</small>
      </div>`;
  }

  function inventoryHtml(state) {
    const equippedAvatar = state.equipped.avatar || BASE_AVATARS[0];

    return `
      <main class="inventory-v2-page" aria-label="Inventaire">
        <header class="inventory-v2-header">
          <button id="inventoryV2Back" class="inventory-v2-back" type="button" aria-label="Retour à l’accueil">
            <img src="/back-arrow.png" alt="">
          </button>
          <div class="inventory-v2-title">
            <h1>Inventaire</h1>
            <p>Personnalise ton profil</p>
          </div>
          <span class="inventory-v2-header-crown" aria-hidden="true">♔</span>
        </header>

        <div class="inventory-v2-content">
          <section class="inventory-v2-preview ${state.equipped.frame ? "has-frame" : "is-minimal"}" aria-label="Aperçu du joueur">
            <div class="inventory-v2-preview-avatar">
              <img src="${esc(equippedAvatar)}" alt="" draggable="false">
              ${frameMarkup(state.equipped.frame, "inv-frame-preview")}
            </div>

            <div class="inventory-v2-preview-copy">
              <small>APERÇU DU JOUEUR</small>
              <strong>${esc(profileName())}</strong>
              ${state.equipped.tag
                ? tagMarkup(state.equipped.tag, "inv-tag-preview")
                : ""}
            </div>

            ${framePreview(state)}
          </section>

          <section class="inventory-v2-section inventory-v2-avatars">
            <header class="inventory-v2-section-head">
              <div>
                <h2>Avatars</h2>
                <p>Choisis ton avatar</p>
              </div>
              <small>${ownedLabel(state.owned.avatars.length)}</small>
              ${chevronIcon()}
            </header>

            <div class="inventory-v2-avatar-grid">
              ${state.owned.avatars.map((avatar, index) => {
                const selected = avatar === equippedAvatar;
                return `
                  <button
                    class="inventory-v2-avatar-choice ${selected ? "is-selected" : ""}"
                    type="button"
                    data-inventory-type="avatar"
                    data-inventory-id="${esc(avatar)}"
                    aria-label="Sélectionner l’avatar ${index + 1}"
                    aria-pressed="${selected}"
                  >
                    <img src="${esc(avatar)}" alt="" draggable="false">
                    <span class="inventory-v2-check" aria-hidden="true">✓</span>
                  </button>`;
              }).join("")}
            </div>
          </section>

          <section class="inventory-v2-section inventory-v2-frames">
            <header class="inventory-v2-section-head">
              <div>
                <h2>Cadres</h2>
                <p>Habille ton avatar</p>
              </div>
              <small>${ownedLabel(state.owned.frames.length)}</small>
              ${chevronIcon()}
            </header>

            <div class="inventory-v2-frame-grid">
              <button
                class="inventory-v2-frame-choice is-empty ${state.equipped.frame === "" ? "is-selected" : ""}"
                type="button"
                data-inventory-type="frame"
                data-inventory-id=""
                aria-pressed="${state.equipped.frame === ""}"
              >
                <span class="inventory-v2-frame-swatch"><i></i></span>
                <strong>Sans cadre</strong>
                <span class="inventory-v2-check" aria-hidden="true">✓</span>
              </button>

              ${state.owned.frames.map(frameId => {
                const frame = FRAMES[frameId];
                if (!frame) return "";
                const selected = state.equipped.frame === frameId;
                return `
                  <button
                    class="inventory-v2-frame-choice ${selected ? "is-selected" : ""}"
                    type="button"
                    data-inventory-type="frame"
                    data-inventory-id="${esc(frameId)}"
                    aria-pressed="${selected}"
                  >
                    <span class="inventory-v2-frame-swatch">
                      <img src="${esc(equippedAvatar)}" alt="" draggable="false">
                      ${frameMarkup(frameId, "inv-frame-mini")}
                    </span>
                    <strong>${esc(frame.name)}</strong>
                    <span class="inventory-v2-check" aria-hidden="true">✓</span>
                  </button>`;
              }).join("")}
            </div>
          </section>

          <section class="inventory-v2-section inventory-v2-tags">
            <header class="inventory-v2-section-head">
              <div>
                <h2>Titre</h2>
                <p>Affiche un titre sur ton profil</p>
              </div>
              <small>${ownedLabel(state.owned.tags.length)}</small>
              ${chevronIcon()}
            </header>

            <div class="inventory-v2-tag-grid">
              <button
                class="inventory-v2-tag-choice is-none ${state.equipped.tag === "" ? "is-selected" : ""}"
                type="button"
                data-inventory-type="tag"
                data-inventory-id=""
                aria-pressed="${state.equipped.tag === ""}"
              >
                <span>Aucun titre</span>
                <i class="inventory-v2-check" aria-hidden="true">✓</i>
              </button>

              ${state.owned.tags.map(tagId => {
                const tag = TAGS[tagId];
                if (!tag) return "";
                const selected = state.equipped.tag === tagId;
                return `
                  <button
                    class="inventory-v2-tag-choice ${tag.className} ${selected ? "is-selected" : ""}"
                    type="button"
                    data-inventory-type="tag"
                    data-inventory-id="${esc(tagId)}"
                    aria-pressed="${selected}"
                  >
                    ${tagChoiceInner(tag)}
                    <i class="inventory-v2-check" aria-hidden="true">✓</i>
                  </button>`;
              }).join("")}
            </div>
          </section>
        </div>

        <footer class="inventory-v2-footer">
          <button id="inventoryV2Save" class="inventory-v2-save" type="button" ${saving ? "disabled" : ""}>
            ${saveIcon()}
            <span>${saving ? "Enregistrement…" : "Enregistrer"}</span>
          </button>
        </footer>
      </main>`;
  }

  function loadingHtml(message = "Chargement de ton inventaire…") {
    return `
      <main class="inventory-v2-page inventory-v2-loading-page">
        <header class="inventory-v2-header">
          <button id="inventoryV2Back" class="inventory-v2-back" type="button" aria-label="Retour à l’accueil">
            <img src="/back-arrow.png" alt="">
          </button>
          <div class="inventory-v2-title"><h1>Inventaire</h1><p>Personnalise ton profil</p></div>
        </header>
        <div class="inventory-v2-loading" role="status">
          <span class="inventory-v2-spinner" aria-hidden="true"></span>
          <strong>${esc(message)}</strong>
        </div>
      </main>`;
  }

  function showToast(message) {
    try {
      if (typeof toast === "function") return toast(message);
    } catch {}
    const el = document.getElementById("toast");
    if (!el) return;
    el.textContent = message;
    el.classList.add("show");
    clearTimeout(el._inventoryServerTimer);
    el._inventoryServerTimer = setTimeout(() => el.classList.remove("show"), 2200);
  }

  function closeInventory() {
    inventoryOpen = false;
    baselineState = null;
    draftState = null;
    saving = false;
    if (typeof renderHome === "function") renderHome();
  }

  function hasDraftChanges() {
    if (!baselineState || !draftState) return false;
    return ["avatar", "frame", "tag"].some(
      key => String(baselineState.equipped[key] || "") !== String(draftState.equipped[key] || "")
    );
  }

  function renderPage({ preserveScroll = false } = {}) {
    if (!inventoryOpen || !draftState) return;
    const previous = document.querySelector(".inventory-v2-page");
    const scrollTop = preserveScroll ? Number(previous?.scrollTop || 0) : 0;
    setScreen(inventoryHtml(draftState));
    bindInventoryPage();
    const page = document.querySelector(".inventory-v2-page");
    if (page && scrollTop > 0) page.scrollTop = scrollTop;
  }

  function selectDraft(type, id) {
    if (!draftState || saving) return;
    if (type === "avatar" && draftState.owned.avatars.includes(id)) {
      draftState.equipped.avatar = id;
    } else if (type === "frame" && (id === "" || draftState.owned.frames.includes(id))) {
      draftState.equipped.frame = id;
    } else if (type === "tag" && (id === "" || draftState.owned.tags.includes(id))) {
      draftState.equipped.tag = id;
    } else {
      return;
    }
    renderPage({ preserveScroll:true });
  }

  function equipOnServer(type, id, token) {
    return new Promise((resolve, reject) => {
      socket.timeout(8000).emit("inventory:equip", {
        walletToken: token,
        type,
        id
      }, (err, res) => {
        if (err || !res?.ok || !res.state) {
          reject(new Error(res?.error || "Impossible d’équiper cet objet."));
          return;
        }
        resolve(res.state);
      });
    });
  }

  async function saveDraft() {
    if (!baselineState || !draftState || saving) return;
    if (!hasDraftChanges()) {
      showToast("Aucune modification à enregistrer.");
      return;
    }

    const token = walletToken();
    if (!token || typeof socket === "undefined" || !socket?.connected) {
      showToast("Connexion inventaire indisponible.");
      return;
    }

    saving = true;
    renderPage({ preserveScroll:true });

    let latest = cloneState(baselineState);
    try {
      for (const type of ["avatar", "frame", "tag"]) {
        if (String(latest.equipped[type] || "") === String(draftState.equipped[type] || "")) continue;
        latest = normalizeState(await equipOnServer(type, String(draftState.equipped[type] || ""), token));
      }

      if (walletToken() !== token) return;
      const saved = cacheState(latest, token);
      baselineState = cloneState(saved);
      draftState = cloneState(saved);
      saving = false;
      renderPage({ preserveScroll:true });
      showToast("Inventaire enregistré.");
    } catch (error) {
      saving = false;
      try {
        const fresh = await requestState({ force:true });
        baselineState = cloneState(fresh);
        draftState = cloneState(fresh);
      } catch {}
      renderPage({ preserveScroll:true });
      showToast(error?.message || "Impossible d’enregistrer l’inventaire.");
    }
  }

  function bindInventoryPage() {
    document.getElementById("inventoryV2Back")?.addEventListener("click", closeInventory);
    document.getElementById("inventoryV2Save")?.addEventListener("click", saveDraft);

    document.querySelectorAll("[data-inventory-type]").forEach(button => {
      button.addEventListener("click", () => {
        selectDraft(
          String(button.dataset.inventoryType || ""),
          String(button.dataset.inventoryId || "")
        );
      });
    });
  }

  async function openInventory() {
    if (inventoryOpen) return;
    inventoryOpen = true;
    saving = false;
    setScreen(loadingHtml());
    document.getElementById("inventoryV2Back")?.addEventListener("click", closeInventory);

    try {
      const state = await requestState({ force:true });
      if (!inventoryOpen) return;
      baselineState = cloneState(state);
      draftState = cloneState(state);
      renderPage();
    } catch (error) {
      if (!inventoryOpen) return;
      setScreen(loadingHtml(error?.message || "Inventaire indisponible."));
      document.getElementById("inventoryV2Back")?.addEventListener("click", closeInventory);
    }
  }

  function hasItem(type, id) {
    const state = fallbackState();
    const bucket = type === "avatar" ? "avatars" : type === "frame" ? "frames" : type === "tag" ? "tags" : "";
    return !!bucket && state.owned[bucket].includes(id);
  }

  function lockPublicApi() {
    const old = window.PtitBacInventory || {};
    window.PtitBacInventory = {
      ...old,
      open: openInventory,
      close: closeInventory,
      state: fallbackState,
      hasItem,
      grantItem() {
        console.warn("Inventaire V2: grantItem côté client est désactivé.");
        return false;
      },
      equipItem() {
        console.warn("Inventaire V2: utilise l’équipement serveur.");
        return false;
      },
      avatars: KNOWN_AVATARS,
      frames: FRAMES,
      tags: TAGS,
      serverManaged: true,
      refresh: () => requestState({ force:true })
    };
  }

  function warm(attempt = 0) {
    if (walletToken() && typeof socket !== "undefined" && socket?.connected) {
      requestState().catch(() => {});
      return;
    }
    if (attempt < 20) setTimeout(() => warm(attempt + 1), 500);
  }

  try {
    socket?.on?.("connect", () => setTimeout(() => warm(0), 80));
    socket?.on?.("inventory:update", state => {
      if (!state) return;
      const cached = cacheState(state, walletToken());
      if (inventoryOpen && !saving) {
        baselineState = cloneState(cached);
        draftState = cloneState(cached);
        renderPage({ preserveScroll:true });
      }
    });
  } catch {}

  document.addEventListener("ptitbac:identity-changed", () => {
    serverState = null;
    serverStateWalletToken = "";
    loadingPromise = null;
    loadingWalletToken = "";
    inventoryOpen = false;
    baselineState = null;
    draftState = null;
    saving = false;
    try { localStorage.removeItem(STORAGE_KEY); } catch {}
    if (walletToken() && typeof socket !== "undefined" && socket?.connected) {
      requestState({ force:true }).catch(() => {});
    }
  });

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", () => {
      lockPublicApi();
      warm(0);
    }, { once:true });
  } else {
    lockPublicApi();
    warm(0);
  }
})();
