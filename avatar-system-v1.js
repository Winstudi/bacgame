(() => {
  "use strict";

  const BASE_AVATARS = Object.freeze([
    "/a1.webp",
    "/a2.webp",
    "/a3.webp",
    "/a4.webp",
    "/a5.webp"
  ]);

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

  const LEGACY_AVATARS = Object.freeze({
    "/avatar-base-01.webp": "/a1.webp",
    "/avatar-base-02.webp": "/a2.webp",
    "/avatar-base-03.webp": "/a3.webp",
    "/avatar-base-04.webp": "/a4.webp",
    "/avatar-base-05.webp": "/a5.webp"
  });

  const DEFAULT_AVATAR = BASE_AVATARS[0];

  const AVATAR_CONTAINERS = [
    ".hm-avatar",
    ".profile-v10-avatar-visual",
    ".profile-avatar-choice",
    ".friends-v2-avatar",
    ".friends-v3-avatar",
    ".chat-list-avatar",
    ".chat-header-avatar",
    ".lobby-v5-avatar",
    ".lobby-v5-host-avatar",
    ".lobby-v5-profile-avatar",
    ".lobby-v5-invite-friend-avatar",
    ".pl-avatar",
    ".wsv1-avatar",
    ".res-avatar",
    ".fin-avatar",
    ".ptb-avatar-photo",
    ".avatar-emoji",
    ".cat-existing-chooser-avatar",
    ".pbw1-chooser-avatar"
  ].join(",");

  const SELF_FRAME_CONTAINERS = [
    ".hm-avatar",
    ".profile-v10-avatar-visual"
  ].join(",");

  function hashSeed(value) {
    const text = String(value || "ptitbac-avatar");
    let hash = 2166136261;

    for (let i = 0; i < text.length; i += 1) {
      hash ^= text.charCodeAt(i);
      hash = Math.imul(hash, 16777619);
    }

    return Math.abs(hash >>> 0);
  }

  function normalize(value, seed = "") {
    const raw = String(value || "").trim();

    if (KNOWN_AVATARS.includes(raw)) return raw;
    if (LEGACY_AVATARS[raw]) return LEGACY_AVATARS[raw];

    const key = seed || raw || "ptitbac-avatar";
    return BASE_AVATARS[hashSeed(key) % BASE_AVATARS.length];
  }

  function isBaseAvatar(value) {
    const raw = String(value || "").trim();
    return KNOWN_AVATARS.includes(raw) ||
      Object.prototype.hasOwnProperty.call(LEGACY_AVATARS, raw);
  }

  function isImageAvatar(value) {
    return isBaseAvatar(value);
  }

  function markup(value, className = "", alt = "", seed = "") {
    const avatar = normalize(value, seed);
    const safeClass = String(className || "").replace(/[^a-zA-Z0-9 _-]/g, "");
    const safeAlt = String(alt || "").replace(/"/g, "&quot;");

    return (
      `<img class="${safeClass}" ` +
      `src="${avatar}" ` +
      `alt="${safeAlt}" ` +
      `draggable="false">`
    );
  }

  function inventoryFrames() {
    try {
      return window.PtitBacInventory?.frames || {};
    } catch {
      return {};
    }
  }

  function frameAsset(frameId) {
    const id = String(frameId || "").trim();
    return inventoryFrames()[id]?.asset || "";
  }

  function normalizeFrame(frameId) {
    const id = String(frameId || "").trim();
    return frameAsset(id) ? id : "";
  }

  function localEquippedFrame() {
    try {
      const state = window.PtitBacInventory?.state?.();
      const current = normalizeFrame(state?.equipped?.frame);
      if (current) return current;
    } catch {}

    try {
      const cached = JSON.parse(
        localStorage.getItem("petitbac_inventory_v1") || "null"
      );
      return normalizeFrame(cached?.equipped?.frame);
    } catch {
      return "";
    }
  }

  function livePlayers() {
    try {
      return Array.isArray(session?.state?.players)
        ? session.state.players
        : [];
    } catch {
      return [];
    }
  }

  function playerById(value) {
    const id = String(value || "");
    if (!id) return null;
    return livePlayers().find(
      player => String(player?.id || "") === id
    ) || null;
  }

  function primaryImage(box) {
    return box?.querySelector?.(
      ":scope > img:not(.ptb-equipped-frame-overlay)"
    ) || null;
  }

  function directAvatarValue(box) {
    const img = primaryImage(box);
    if (img) return img.getAttribute("src") || "";

    const span = box.querySelector(":scope > span");
    if (span) return span.textContent || "";

    if (box.matches(".avatar-emoji")) return box.textContent || "";
    return "";
  }

  function nearbyPlayerSeed(box) {
    const row = box.closest(
      ".wsv1-player," +
      ".res-row," +
      ".fin-row," +
      ".fin-podium-card," +
      ".lobby-v5-player," +
      ".pl-player," +
      ".friends-v4-card," +
      ".friends-v2-card," +
      ".chat-conversation-row," +
      ".chat-new-row"
    );

    const name = row?.querySelector(
      ".wsv1-player > strong," +
      ".res-player > strong," +
      ".fin-player > strong," +
      ".fin-podium-card > strong," +
      ".lobby-v5-player-copy strong," +
      ".pl-player-copy > strong," +
      ".friends-v2-card-main > strong," +
      ".chat-row-copy > strong," +
      "strong"
    )?.textContent || "";

    return String(name).trim();
  }

  function playerByVisibleIdentity(box) {
    const players = livePlayers();
    if (!players.length) return null;

    const rawAvatar = directAvatarValue(box);
    const nearby = box.closest(
      ".wsv1-player," +
      ".res-row," +
      ".res-winner-copy," +
      ".fin-row," +
      ".fin-podium-card," +
      ".lobby-v5-player," +
      ".pl-player," +
      ".lobby-v5-profile-modal," +
      "article"
    );

    const names = Array.from(
      nearby?.querySelectorAll?.("strong,h2") || []
    )
      .map(node => String(node.textContent || "").trim())
      .filter(Boolean);

    let matches = players.filter(player =>
      names.includes(String(player?.name || "").trim())
    );

    if (matches.length > 1 && rawAvatar) {
      const exact = matches.filter(player =>
        normalize(player?.avatar, player?.id || player?.name) ===
        normalize(rawAvatar, player?.id || player?.name)
      );
      if (exact.length) matches = exact;
    }

    return matches[0] || null;
  }

  function playerForAvatarBox(box) {
    const explicitId =
      box.dataset.playerId ||
      box.closest("[data-lobby-player-profile]")?.dataset.lobbyPlayerProfile ||
      box.closest("[data-chooser-id]")?.dataset.chooserId ||
      "";

    if (explicitId) {
      const player = playerById(explicitId);
      if (player) return player;
    }

    if (box.matches(".pbw1-chooser-avatar")) {
      try {
        const chooser = playerById(session?.state?.letterChooserPlayerId);
        if (chooser) return chooser;
      } catch {}
    }

    if (box.matches(".cat-existing-chooser-avatar")) {
      try {
        const chooser = playerById(session?.state?.categoryChooserPlayerId);
        if (chooser) return chooser;
      } catch {}
    }

    if (box.matches(".wsv1-avatar")) {
      const row = box.closest(".wsv1-player");
      const rows = Array.from(
        document.querySelectorAll(".wsv1-player-list .wsv1-player")
      );
      const index = rows.indexOf(row);
      const player = livePlayers()[index];
      if (player) return player;
    }

    if (box.matches(".res-avatar")) {
      const row = box.closest(".res-row");
      if (row) {
        const rows = Array.from(
          document.querySelectorAll(".res-rows .res-row")
        );
        const index = rows.indexOf(row);
        const player = livePlayers()[index];
        if (player) return player;
      }
    }

    return playerByVisibleIdentity(box);
  }

  function frameForAvatarBox(box) {
    if (!(box instanceof Element)) return "";

    // Le sélecteur d'avatars du profil ne doit pas afficher le cadre
    // sur chaque vignette.
    if (box.matches(".profile-avatar-choice")) return "";

    if (box.hasAttribute("data-frame-id")) {
      return normalizeFrame(box.dataset.frameId);
    }

    if (box.matches(SELF_FRAME_CONTAINERS)) {
      return localEquippedFrame();
    }

    const player = playerForAvatarBox(box);
    return normalizeFrame(player?.frameId);
  }

  function removeFrame(box) {
    box
      .querySelectorAll(":scope > .ptb-equipped-frame-overlay")
      .forEach(node => node.remove());

    box.classList.remove("ptb-has-equipped-frame");
    delete box.dataset.ptbRenderedFrame;
  }

  function applyFrame(box) {
    if (!(box instanceof Element)) return;

    const frameId = frameForAvatarBox(box);
    const asset = frameAsset(frameId);

    if (!frameId || !asset) {
      removeFrame(box);
      return;
    }

    const existing = box.querySelector(
      ":scope > .ptb-equipped-frame-overlay"
    );

    if (
      existing &&
      box.dataset.ptbRenderedFrame === frameId &&
      existing.getAttribute("src") === asset
    ) {
      box.classList.add("ptb-has-equipped-frame");
      return;
    }

    existing?.remove();

    const overlay = document.createElement("img");
    overlay.className = "ptb-equipped-frame-overlay";
    overlay.src = asset;
    overlay.alt = "";
    overlay.draggable = false;
    overlay.setAttribute("aria-hidden", "true");

    box.appendChild(overlay);
    box.dataset.ptbRenderedFrame = frameId;
    box.classList.add("ptb-has-equipped-frame");
  }

  function setAvatarImage(box, src) {
    const image = document.createElement("img");
    image.src = src;
    image.alt = "";
    image.draggable = false;

    const oldImg = primaryImage(box);
    const oldSpan = box.querySelector(":scope > span");

    if (oldImg) {
      oldImg.replaceWith(image);
    } else if (oldSpan) {
      oldSpan.replaceWith(image);
    } else if (box.matches(".avatar-emoji")) {
      const frame = box.querySelector(
        ":scope > .ptb-equipped-frame-overlay"
      );
      box.replaceChildren(image);
      if (frame) box.appendChild(frame);
      box.classList.remove("avatar-emoji");
      box.classList.add("ptb-avatar-photo");
    } else {
      box.prepend(image);
    }

    box.classList.add("ptb-base-avatar");
  }

  function upgradeAvatarBox(box) {
    if (!(box instanceof Element)) return;

    const raw = directAvatarValue(box);
    const seed = nearbyPlayerSeed(box) || raw || box.className;
    const src = normalize(raw, seed);
    const existing = primaryImage(box);

    if (existing && existing.getAttribute("src") === src) {
      existing.draggable = false;
      box.classList.add("ptb-base-avatar");
      applyFrame(box);
      return;
    }

    setAvatarImage(box, src);
    applyFrame(box);
  }

  function chooserPlayer() {
    try {
      const state = session?.state;
      if (!state) return null;

      return state.players?.find(
        player =>
          String(player.id) ===
          String(state.letterChooserPlayerId)
      ) || null;
    } catch {
      return null;
    }
  }

  function upgradeWheelChooser() {
    const box = document.querySelector(
      ".pbw1-screen .pbw1-chooser .pbw1-lightning"
    );
    if (!box) return;

    const chooser = chooserPlayer();
    const seed = chooser?.id || chooser?.name || "letter-chooser";
    const src = normalize(chooser?.avatar, seed);
    const current = primaryImage(box);

    box.classList.add("pbw1-chooser-avatar");

    if (!current || current.getAttribute("src") !== src) {
      const frame = box.querySelector(
        ":scope > .ptb-equipped-frame-overlay"
      );
      box.replaceChildren();
      const image = document.createElement("img");
      image.src = src;
      image.alt = "";
      image.draggable = false;
      box.appendChild(image);
      if (frame) box.appendChild(frame);
    }

    if (chooser?.id) {
      box.dataset.playerId = String(chooser.id);
    }

    applyFrame(box);
  }

  function upgradeAll(root = document) {
    if (root instanceof Element && root.matches(AVATAR_CONTAINERS)) {
      upgradeAvatarBox(root);
    }

    root.querySelectorAll?.(AVATAR_CONTAINERS).forEach(upgradeAvatarBox);
    upgradeWheelChooser();
  }

  let avatarUpgradeScheduled = false;

  function scheduleAvatarUpgrade() {
    if (avatarUpgradeScheduled) return;
    avatarUpgradeScheduled = true;

    requestAnimationFrame(() => {
      avatarUpgradeScheduled = false;
      upgradeAll(document);
    });
  }

  function start() {
    upgradeAll(document);

    document.addEventListener(
      "ptitbac:screen-rendered",
      scheduleAvatarUpgrade
    );

    document.addEventListener(
      "ptitbac:dom-updated",
      scheduleAvatarUpgrade
    );

    document.addEventListener(
      "ptitbac:inventory-changed",
      scheduleAvatarUpgrade
    );

    try {
      socket?.on?.("room:state", scheduleAvatarUpgrade);
      socket?.on?.("inventory:update", scheduleAvatarUpgrade);
    } catch {}
  }

  window.PtitBacAvatars = {
    list: BASE_AVATARS,
    knownList: KNOWN_AVATARS,
    defaultAvatar: DEFAULT_AVATAR,
    normalize,
    normalizeAvatar: normalize,
    isBaseAvatar,
    isImageAvatar,
    markup
  };

  window.PtitBacFrames = {
    asset: frameAsset,
    normalize: normalizeFrame,
    local: localEquippedFrame,
    apply: applyFrame,
    upgradeAll
  };

  // Compatibilité Amis / Chat / Lobby.
  window.PtitBacProfilePhoto = {
    ...(window.PtitBacProfilePhoto || {}),
    isImageAvatar
  };

  // Migration locale unique : ancien emoji/photo/ancien nom -> avatar de base.
  try {
    const current = localStorage.getItem("petitbac_profile_icon");
    const name = localStorage.getItem("petitbac_profile_name") || "";
    const migrated = normalize(current, name || current);

    if (current !== migrated) {
      localStorage.setItem("petitbac_profile_icon", migrated);
    }
  } catch {}

  // Les helpers historiques restent utilisables mais passent désormais
  // tous par le même normaliseur.
  try {
    const oldGetProfile =
      typeof getProfile === "function"
        ? getProfile
        : null;

    if (oldGetProfile && !oldGetProfile.__ptbUnifiedAvatar) {
      const unifiedGetProfile = function() {
        const profile = oldGetProfile() || {};
        return {
          ...profile,
          icon: normalize(profile.icon, profile.name || profile.icon)
        };
      };
      unifiedGetProfile.__ptbUnifiedAvatar = true;
      getProfile = unifiedGetProfile;
      window.getProfile = unifiedGetProfile;
    }
  } catch {}

  try {
    const oldSaveProfile =
      typeof saveProfile === "function"
        ? saveProfile
        : null;

    if (oldSaveProfile && !oldSaveProfile.__ptbUnifiedAvatar) {
      const unifiedSaveProfile = function(name, icon) {
        return oldSaveProfile(name, normalize(icon, name || icon));
      };
      unifiedSaveProfile.__ptbUnifiedAvatar = true;
      saveProfile = unifiedSaveProfile;
      window.saveProfile = unifiedSaveProfile;
    }
  } catch {}

  // Alias historique, sans second observer.
  window.PtitBacAvatarPagesFix = {
    normalizeAvatar: normalize,
    upgradeAll,
    upgradeWheelChooser
  };

  // Les écrans historiques de app.js passent aussi par ce moteur.
  try {
    if (typeof avatarMarkup === "function") {
      avatarMarkup = function(player, index = 0, extra = "") {
        const safeExtra = String(extra || "")
          .replace(/[^a-zA-Z0-9 _-]/g, "");
        const seed =
          player?.id ||
          player?.name ||
          player?.avatar ||
          "";
        const avatar = normalize(player?.avatar, seed);
        const frameId = normalizeFrame(player?.frameId);

        return `
          <div
            class="avatar avatar-${index % 6} ptb-avatar-photo ${safeExtra}"
            ${frameId ? `data-frame-id="${frameId}"` : ""}
          >
            <img src="${avatar}" alt="" draggable="false">
          </div>
        `;
      };
      window.avatarMarkup = avatarMarkup;
    }
  } catch {}

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", start, { once: true });
  } else {
    start();
  }
})();
