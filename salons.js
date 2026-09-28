/* ==== lobby-screen-v4.js ==== */
(() => {
  "use strict";

  const LOBBY_MAX_PLAYERS = 6;
  const BOMB_LOBBY_MAX_PLAYERS = 8;
  const lobbyMaxPlayers = state => state?.gameType === "bombe" ? BOMB_LOBBY_MAX_PLAYERS : LOBBY_MAX_PLAYERS;
  const DIFFICULTY_ICON_URLS = {
    beginner: "/difficulty.png",
    medium: "/difficulty.png",
    hard: "/difficulty.png"
  };

  let lobbyOpenedPlayerId = "";
  let lobbyDifficultyLockUntil = 0;
  let lobbySettingsOpen = false;
  let lobbyInviteOpen = false;
  let lobbyInviteFriends = [];
  let lobbyInviteLoading = false;
  let lobbyCountdownTimer = null;
  let lobbyCountdownActive = false;
  let lobbyCountdownAudio = null;
  let lobbyCountdownLastValue = "";
  let lobbyModeSwitching = false;
  let lobbyInventoryReturnToLobby = false;
  const lobbyInviteSocket = socket;

  Object.values(DIFFICULTY_ICON_URLS).forEach(src => {
    const img = new Image();
    img.decoding = "async";
    img.src = src;
  });

  function lobbyNow() {
    try {
      return typeof serverNowMs === "function" ? serverNowMs() : Date.now();
    } catch {
      return Date.now();
    }
  }

  function clearLobbyCountdown() {
    clearInterval(lobbyCountdownTimer);
    lobbyCountdownTimer = null;
    lobbyCountdownActive = false;
    lobbyCountdownLastValue = "";

    if (lobbyCountdownAudio) {
      try {
        lobbyCountdownAudio.pause();
        lobbyCountdownAudio.currentTime = 0;
      } catch {}
      lobbyCountdownAudio = null;
    }

    document.getElementById("lobbyStartCountdown")?.remove();
  }

  function ensureLobbyCountdownOverlay() {
    let overlay = document.getElementById("lobbyStartCountdown");
    if (overlay) return overlay;

    overlay = document.createElement("div");
    overlay.id = "lobbyStartCountdown";
    overlay.className = "lobby-start-countdown";
    overlay.setAttribute("role", "status");
    overlay.setAttribute("aria-live", "assertive");
    overlay.innerHTML = `
      <div class="lobby-start-countdown-card">
        <div class="lobby-countdown-rocket" aria-hidden="true">🚀</div>
        <h2>La partie commence dans</h2>

        <div class="lobby-countdown-ring" aria-hidden="true">
          <div class="lobby-countdown-ring-track"></div>
          <div class="lobby-countdown-ring-glow"></div>
          <strong id="lobbyCountdownNumber">3</strong>
          <i class="spark s1"></i>
          <i class="spark s2"></i>
          <i class="spark s3"></i>
          <i class="spark s4"></i>
        </div>

        <p>Préparez-vous !</p>
      </div>
    `;

    document.body.appendChild(overlay);
    return overlay;
  }

  function startLobbyCountdown(payload = {}) {
    const activeCode = String(session?.state?.code || session?.code || "");
    if (!payload.code || String(payload.code) !== activeCode) return;

    clearLobbyCountdown();
    lobbyCountdownActive = true;

    const overlay = ensureLobbyCountdownOverlay();
    const number = overlay.querySelector("#lobbyCountdownNumber");
    const card = overlay.querySelector(".lobby-start-countdown-card");
    const ring = overlay.querySelector(".lobby-countdown-ring");

    try {
      lobbyCountdownAudio = new Audio("/ptitbac-countdown-neon.wav");
      lobbyCountdownAudio.preload = "auto";
      lobbyCountdownAudio.volume = 0.78;
      lobbyCountdownAudio.currentTime = 0;
      const playPromise = lobbyCountdownAudio.play();
      if (playPromise?.catch) playPromise.catch(() => {});
    } catch {}

    const startedAt = Number(payload.startedAt || lobbyNow());
    const durationMs = Math.max(3000, Number(payload.durationMs || 3200));
    const deadline = startedAt + durationMs;

    const update = () => {
      const remaining = deadline - lobbyNow();
      let nextValue = "3";

      if (remaining > 2200) nextValue = "3";
      else if (remaining > 1200) nextValue = "2";
      else if (remaining > 250) nextValue = "1";
      else nextValue = "!";

      if (number && nextValue !== lobbyCountdownLastValue) {
        number.textContent = nextValue;
        lobbyCountdownLastValue = nextValue;
        ring?.classList.remove("pulse");
        void ring?.offsetWidth;
        ring?.classList.add("pulse");
      }

      if (nextValue === "!") card?.classList.add("is-go");
    };

    update();
    lobbyCountdownTimer = setInterval(update, 70);

    setTimeout(() => {
      if (document.querySelector(".lobby-v5")) clearLobbyCountdown();
    }, durationMs + 1800);
  }

  function roomModeToggleMarkup(state, user) {
    if (state.gameType === "bombe") return `<div class="pl-title-mode"><h1>Bombe - Salon Privé</h1></div>`;
    const publicMode = state.mode === "public";
    const host = user?.isHost === true;
    const label = publicMode ? "Public" : "Privé";
    const nextLabel = publicMode ? "privé" : "public";

    return `
      <div class="pl-title-mode">
        <h1>Baccalauréat - Salon ${publicMode ? "Public" : "Privé"}</h1>
        <button
          id="plModeToggle"
          class="pl-mode-toggle ${publicMode ? "is-public" : ""}"
          type="button"
          aria-pressed="${publicMode ? "true" : "false"}"
          aria-label="${host ? `Passer le salon en mode ${nextLabel}` : `Salon ${label.toLowerCase()}`}"
          title="${publicMode ? "Public : 1 vie, XP et trophées activés, visible en recherche rapide" : "Privé : gratuit, sans XP ni trophées, accès par code ou invitation"}"
          ${host && !lobbyModeSwitching ? "" : "disabled"}
        >
          <span class="pl-mode-toggle-dot" aria-hidden="true"></span>
          <strong>${label}</strong>
        </button>
      </div>
    `;
  }

  function changeRoomMode(state, user) {
    if (!user?.isHost || lobbyModeSwitching || state.mode === "quick" || state.gameType === "bombe") return;

    const nextMode = state.mode === "public" ? "private" : "public";
    lobbyModeSwitching = true;
    renderLobbyV5();

    socket.timeout(8000).emit(
      "room:setMode",
      {
        code: state.code,
        playerId: session.playerId,
        mode: nextMode
      },
      (err, res) => {
        lobbyModeSwitching = false;

        if (err || !res?.ok) {
          renderLobbyV5();
          return toast(res?.error || "Impossible de modifier le type du salon.");
        }

        if (res.state) session.state = res.state;
        renderLobbyV5();
      }
    );
  }

  function isImageAvatar(value) {
    return (
      window.PtitBacProfilePhoto?.isImageAvatar?.(value) ||
      /^data:image\//i.test(String(value || ""))
    );
  }

  function difficultyInfo(value) {
    if (value === "hard") return { label: "Difficile", icon: DIFFICULTY_ICON_URLS.hard };
    if (value === "medium") return { label: "Moyen", icon: DIFFICULTY_ICON_URLS.medium };
    return { label: "Facile", icon: DIFFICULTY_ICON_URLS.beginner };
  }

  function avatarMarkup(player) {
    const raw = String(player?.avatar || "");
    if (isImageAvatar(raw)) {
      return `<img src="${raw}" alt="" draggable="false">`;
    }
    return `<span>${escapeHtml(raw || String(player?.name || "?").charAt(0).toUpperCase())}</span>`;
  }

  function friendCodeFor(player) {
    if (!player) return "";
    if (String(player.id) === String(session.playerId)) {
      const local = String(localStorage.getItem("petitbac_friendCode") || "").trim();
      if (/^\d{5}$/.test(local)) return local;
    }
    const remote = String(player.friendCode || "").trim();
    return /^\d{5}$/.test(remote) ? remote : "";
  }

  function playerProfileModal(state) {
    if (!lobbyOpenedPlayerId) return "";

    const player = state.players.find(p => String(p.id) === String(lobbyOpenedPlayerId));
    if (!player) {
      lobbyOpenedPlayerId = "";
      return "";
    }

    const self = String(player.id) === String(session.playerId);
    const quickMode = state.mode === "quick";
    const code = friendCodeFor(player);
    const canSocial = !self && !player.isBot && !!code;
    return `
      <div class="lobby-v5-profile-backdrop pl-profile-v2-backdrop" id="lobbyPlayerProfileBackdrop">
        <section class="lobby-v5-profile-modal pl-profile-v2-modal" role="dialog" aria-modal="true" aria-label="Profil de ${escapeHtml(player.name || "Joueur")}">
          <button id="lobbyPlayerProfileClose" class="lobby-v5-profile-close pl-profile-v2-close" type="button" aria-label="Fermer">×</button>

          <div class="pl-profile-v2-card ${!quickMode && player.isHost ? "is-host" : ""} ${self ? "is-self" : ""}">
            <div class="pl-profile-v2-avatar-shell">
              <div class="lobby-v5-profile-avatar pl-profile-v2-avatar">${avatarMarkup(player)}</div>
            </div>

            <div class="pl-profile-v2-copy">
              <div class="pl-profile-v2-name-row">
                <strong>${escapeHtml(player.name || "Joueur")}</strong>
                ${!player.isBot && code
                  ? `<span class="pl-profile-v2-player-code">#${escapeHtml(code)}</span>`
                  : ""}
              </div>
              <div class="pl-profile-v2-title-row">
                ${privateLobbyTagMarkup(player)}
                ${!quickMode && player.isHost
                  ? `<img class="pl-host-crown-inline" src="/admin-crown.png" alt="Hôte">`
                  : ""}
              </div>
            </div>
          </div>

          ${self
            ? `<button id="lobbyPlayerInventory" class="pl-profile-v2-inventory" type="button">
                <img src="/inventaire.png" alt="">
                <span>Inventaire</span>
                <small>Modifier mon apparence</small>
              </button>`
            : player.isBot
              ? `<div class="pl-profile-v2-note">Les joueurs test n’ont pas de profil personnalisable.</div>`
              : `<div class="lobby-v5-profile-actions pl-profile-v2-actions">
                  <button id="lobbyPlayerAddFriend" type="button" ${canSocial ? "" : "disabled"}>Ajouter en ami</button>
                  <button id="lobbyPlayerReport" class="danger" type="button" ${code ? "" : "disabled"}>Signaler</button>
                </div>`}
        </section>
      </div>`;
  }

  function settingCard({ key, label, value, icon, difficulty = false }) {
    return `
      <article class="lobby-v5-setting-card ${difficulty ? "is-difficulty" : ""}">
        <img class="lobby-v5-setting-icon" src="${icon}" alt="">
        <small>${label}</small>
        <div class="lobby-v5-setting-value">
          <strong>${value}</strong>
        </div>
      </article>`;
  }

  function playerRow(player, index, user) {
    const online = player.connected || player.isBot;

    return `
      <article class="lobby-v5-player quick-player-card"
        data-lobby-player-profile="${player.id}" tabindex="0" role="button"
        aria-label="Profil de ${escapeHtml(player.name || "Joueur")}">
        <div class="lobby-v5-avatar">${avatarMarkup(player)}</div>

        <div class="lobby-v5-player-copy">
          <div class="lobby-v5-player-name-row">
            <strong>${escapeHtml(player.name || "Joueur")}</strong>
            ${online
              ? `<span class="ready-badge">Pas prêt</span>`
              : `<span class="offline-badge">Hors ligne</span>`}
          </div>

          <div class="quick-player-title-row">
            ${privateLobbyTagMarkup(player)}
          </div>
        </div>
      </article>`;
  }

  function emptyPlayerRow(host, slot) {
    if (host) {
      return `
        <button class="lobby-v5-empty-player" data-add-bot="${slot}" type="button">
          <span class="lobby-v5-empty-plus">＋</span>
          <span>En attente d’un joueur…</span>
        </button>`;
    }
    return `
      <div class="lobby-v5-empty-player readonly">
        <span class="lobby-v5-empty-plus">＋</span>
        <span>En attente d’un joueur…</span>
      </div>`;
  }

  function lobbySettingsOverlay(state, user) {
    if (!lobbySettingsOpen || !user?.isHost || state.mode === "quick") return "";

    const difficulty = difficultyInfo(state.categoryDifficulty);
    const categoryCount = Number(state.categoryCount || state.categories?.length || 6);
    const bomb = state.gameType === "bombe";
    const speedLabel = { fast: "Rapide", medium: "Moyen", slow: "Lent" }[state.bombSpeed] || "Moyen";

    const card = ({ key, label, value, icon, difficultyClass = "" }) => `
      <article class="lobby-v5-edit-card ${difficultyClass}">
        <img src="${icon}" alt="">
        <small>${label}</small>
        <div class="lobby-v5-edit-stepper">
          <button type="button" data-lobby-inline-step="${key}" data-dir="-1" aria-label="Diminuer">
            <img src="/lobby-minus.png" alt="">
          </button>
          <strong>${value}</strong>
          <button type="button" data-lobby-inline-step="${key}" data-dir="1" aria-label="Augmenter">
            <img src="/lobby-plus.png" alt="">
          </button>
        </div>
      </article>
    `;

    return `
      <div class="lobby-v5-settings-overlay" id="lobbySettingsOverlay">
        <section class="lobby-v5-settings-sheet" role="dialog" aria-modal="true" aria-label="Modifier les paramètres">
          <header class="lobby-v5-settings-sheet-header">
            <div>
              <small>PARAMÈTRES DU SALON</small>
              <h2>Modifier la partie</h2>
            </div>
            <button id="lobbySettingsClose" type="button" aria-label="Fermer">×</button>
          </header>

          <div class="lobby-v5-edit-grid">
            ${card({
              key: "rounds",
              label: "Manches",
              value: state.rounds,
              icon: "/lightning.png"
            })}
            ${bomb ? card({ key: "bombLives", label: "Vies", value: state.bombLives || 3, icon: "/lobby-categories.png" }) : card({
              key: "categoryCount",
              label: "Catégories",
              value: categoryCount,
              icon: "/lobby-categories.png"
            })}
            ${bomb ? card({ key: "bombSpeed", label: "Bombe", value: speedLabel, icon: "/lobby-clock.png" }) : card({
              key: "duration",
              label: "Temps",
              value: `${Number(state.duration || 60)}s`,
              icon: "/lobby-clock.png"
            })}
            ${card({
              key: "categoryDifficulty",
              label: "Difficulté",
              value: difficulty.label,
              icon: difficulty.icon,
              difficultyClass: "difficulty"
            })}
          </div>

          <button id="lobbySettingsApply" class="lobby-v5-settings-apply" type="button">
            Terminé
          </button>
        </section>
      </div>
    `;
  }

  function lobbyInviteIdentity(extra = {}) {
    return {
      walletToken: localStorage.getItem("petitbac_walletToken") || "",
      username: localStorage.getItem("petitbac_profile_name") || "Joueur",
      avatar: localStorage.getItem("petitbac_profile_icon") || "🐼",
      ...extra
    };
  }

  function lobbyInviteAvatar(user) {
    const raw = String(user?.avatar || "");
    if (isImageAvatar(raw)) {
      return `<img src="${raw}" alt="" draggable="false">`;
    }
    return `<span>${escapeHtml(raw || String(user?.username || "?").charAt(0).toUpperCase())}</span>`;
  }

  function lobbyInviteOverlay(state) {
    if (!lobbyInviteOpen) return "";

    const rows = lobbyInviteLoading
      ? `<div class="lobby-v5-invite-loading">
          <span class="spinner small-spinner"></span>
          Chargement des amis…
        </div>`
      : lobbyInviteFriends.length
        ? lobbyInviteFriends.map(friend => `
            <article class="lobby-v5-invite-friend">
              <div class="lobby-v5-invite-friend-avatar">
                ${lobbyInviteAvatar(friend)}
              </div>

              <div class="lobby-v5-invite-friend-copy">
                <strong>${escapeHtml(friend.username || "Joueur")}</strong>
                <small class="${friend.online ? "online" : ""}">
                  ${friend.online ? "En ligne" : "Hors ligne"}
                </small>
              </div>

              <button
                type="button"
                class="lobby-v5-invite-friend-btn"
                data-lobby-invite-friend="${escapeHtml(friend.id)}"
              >
                <img src="/friends.png" alt="">
                <span>Inviter</span>
              </button>
            </article>
          `).join("")
        : `<div class="lobby-v5-invite-empty">
            <img src="/friends.png" alt="">
            <strong>Aucun ami disponible</strong>
            <small>Ajoute des amis depuis ton profil pour les inviter ici.</small>
          </div>`;

    return `
      <div class="lobby-v5-invite-overlay" id="lobbyInviteOverlay">
        <section class="lobby-v5-invite-sheet" role="dialog" aria-modal="true" aria-label="Inviter des amis">
          <header class="lobby-v5-invite-sheet-header">
            <div>
              <small>SALON ${escapeHtml(state.code)}</small>
              <h2>Inviter des amis</h2>
            </div>

            <button id="lobbyInviteClose" type="button" aria-label="Fermer">×</button>
          </header>

          <div class="lobby-v5-invite-list">
            ${rows}
          </div>
        </section>
      </div>
    `;
  }

  function loadLobbyInviteFriends() {
    lobbyInviteLoading = true;
    renderLobbyV5();

    lobbyInviteSocket.emit("friends:list", lobbyInviteIdentity(), res => {
      lobbyInviteLoading = false;

      if (!res?.ok) {
        lobbyInviteFriends = [];
        toast(res?.error || "Impossible de charger tes amis.");
        return renderLobbyV5();
      }

      lobbyInviteFriends = Array.isArray(res.friends) ? res.friends : [];
      renderLobbyV5();
    });
  }


  function privateLobbyTagInfo(player) {
    let id = String(player?.tagId || "").trim();

    if (!id && String(player?.id || "") === String(session?.playerId || "")) {
      try {
        id = String(window.PtitBacInventory?.state?.()?.equipped?.tag || "").trim();
      } catch {}
    }

    if (!id) return null;

    const known = {
      tag_debutant: { label:"Débutant", icon:"★" }
    };

    if (known[id]) return known[id];

    const label = id
      .replace(/^tag[_-]?/i, "")
      .replace(/[_-]+/g, " ")
      .replace(/\b\w/g, char => char.toUpperCase())
      .trim();

    return label ? { label, icon:"★" } : null;
  }

  function privateLobbyTagMarkup(player) {
    const tag = privateLobbyTagInfo(player);
    if (!tag) return "";

    return `
      <span class="pl-player-title" title="Titre équipé">
        <strong>${escapeHtml(tag.label)}</strong>
      </span>`;
  }

  function privateLobbyShareIcon() {
    return `
      <svg class="pl-share-icon" viewBox="0 0 24 24" aria-hidden="true">
        <circle cx="18" cy="5" r="2.5"></circle>
        <circle cx="6" cy="12" r="2.5"></circle>
        <circle cx="18" cy="19" r="2.5"></circle>
        <path d="m8.2 10.8 7.5-4.4M8.2 13.2l7.5 4.4"></path>
      </svg>`;
  }

  function ensurePrivateLobbyV2Styles() {
    if (document.getElementById("ptbPrivateLobbyV2Styles")) return;

    const style = document.createElement("style");
    style.id = "ptbPrivateLobbyV2Styles";
    style.textContent = `
      /* =====================================================
         Salon privé/public V2 — identité joueur mise en avant — avatar x1,6
         Styles volontairement scopés à .pl-private.
         ===================================================== */
      html body .pl-private {
        --pl-v2-line:#526ea4;
        --pl-v2-violet:#b04cff;
        --pl-v2-violet-soft:#7f56ff;
        --pl-v2-panel:#0d2147;
        --pl-v2-panel-2:#131f4b;
      }

      html body .pl-private .pl-settings {
        padding:8px 9px 9px !important;
        border-color:#38548a !important;
        background:linear-gradient(145deg,rgba(18,34,78,.94),rgba(9,23,61,.96));
        box-shadow:inset 0 0 18px rgba(94,69,216,.05);
      }

      html body .pl-private .pl-settings h2 {
        min-height:30px;
        margin-bottom:6px !important;
        font-size:14px !important;
      }

      html body .pl-private .pl-settings h2 > img {
        width:24px !important;
        height:24px !important;
        filter:drop-shadow(0 0 5px rgba(192,75,255,.42));
      }

      html body .pl-private .pl-settings h2 .pl-settings-edit {
        width:auto !important;
        min-width:0 !important;
        height:28px !important;
        margin-left:auto !important;
        padding:2px 3px 2px 8px !important;
        display:inline-flex !important;
        align-items:center !important;
        gap:4px !important;
        border:0 !important;
        background:transparent !important;
        color:#b5c4ef !important;
        font-size:11px !important;
        font-weight:700 !important;
      }

      html body .pl-private .pl-settings h2 .pl-settings-edit b {
        font-size:22px;
        line-height:1;
        font-weight:400;
      }

      html body .pl-private .pl-setting-grid {
        gap:7px !important;
      }

      html body .pl-private .pl-setting-grid .lobby-v5-setting-card {
        height:72px !important;
        border-color:#3e5f98 !important;
        background:linear-gradient(180deg,#0b254f,#0b1e43) !important;
        box-shadow:inset 0 0 12px rgba(70,146,255,.035) !important;
      }

      html body .pl-private .pl-setting-grid .lobby-v5-setting-icon {
        width:29px !important;
        height:29px !important;
        filter:drop-shadow(0 0 5px rgba(187,64,255,.34));
      }

      html body .pl-private .pl-players h2 {
        margin-bottom:7px !important;
        font-size:21px !important;
        line-height:25px !important;
      }

      html body .pl-private .pl-players h2 span {
        color:#b8c5ef !important;
        font-size:16px !important;
        font-weight:800;
      }

      html body .pl-private .pl-grid {
        grid-template-columns:repeat(2,minmax(0,1fr)) !important;
        grid-template-rows:repeat(3,minmax(132px,1fr)) !important;
        gap:8px !important;
        overflow:visible !important;
      }

      html body .pl-private .pl-player,
      html body .pl-private .pl-empty {
        min-width:0;
        min-height:132px !important;
        height:100%;
        border-radius:15px !important;
      }

      html body .pl-private .pl-player {
        position:relative;
        padding:8px 9px !important;
        display:grid !important;
        grid-template-columns:clamp(106px,28vw,124px) minmax(0,1fr) !important;
        align-items:center !important;
        gap:10px !important;
        overflow:visible;
        border:1px solid #405b91 !important;
        background:
          radial-gradient(circle at 18% 38%,rgba(121,55,255,.10),transparent 42%),
          linear-gradient(145deg,#11264d,#0c1d42 78%) !important;
        box-shadow:inset 0 0 14px rgba(99,74,229,.035);
        transition:border-color .18s ease,box-shadow .18s ease,transform .18s ease;
      }

      html body .pl-private .pl-player.is-host,
      html body .pl-private .pl-player.is-self {
        border-color:rgba(177,76,255,.50) !important;
        box-shadow:
          inset 0 0 20px rgba(138,62,255,.08),
          0 0 11px rgba(166,54,255,.16);
      }

      html body .pl-private .pl-player.is-host::after {
        content:"";
        position:absolute;
        right:9px;
        bottom:7px;
        width:40px;
        height:30px;
        opacity:.06;
        pointer-events:none;
        border:4px solid #c06cff;
        border-top:0;
        border-radius:0 0 12px 12px;
        transform:rotate(-9deg);
      }

      html body .pl-private .pl-avatar-shell {
        position:relative;
        width:clamp(106px,28vw,124px);
        height:clamp(106px,28vw,124px);
        display:grid;
        place-items:center;
        overflow:visible;
        align-self:center;
      }

      html body .pl-private .pl-avatar {
        position:relative !important;
        width:100% !important;
        height:100% !important;
        min-width:0 !important;
        min-height:0 !important;
        margin:0 !important;
        flex:none !important;
        border:1.5px solid #a657ff !important;
        border-radius:13px !important;
        background:#181953 !important;
        box-shadow:0 0 9px rgba(163,66,255,.28) !important;
        overflow:hidden !important;
      }

      html body .pl-private .pl-avatar > img:not(.ptb-equipped-frame-overlay) {
        width:100% !important;
        height:100% !important;
        max-width:none !important;
        max-height:none !important;
        object-fit:cover !important;
      }

      html body .pl-private .pl-avatar.ptb-has-equipped-frame {
        overflow:visible !important;
        border:0 !important;
        border-radius:0 !important;
        background:transparent !important;
        box-shadow:none !important;
      }

      html body .pl-private .pl-avatar.ptb-has-equipped-frame > img:not(.ptb-equipped-frame-overlay) {
        width:85% !important;
        height:85% !important;
        max-width:85% !important;
        max-height:85% !important;
        object-fit:cover !important;
        object-position:center center !important;
        border-radius:0 !important;
      }

      html body .pl-private .pl-avatar.ptb-has-equipped-frame > .ptb-equipped-frame-overlay {
        left:50% !important;
        top:50% !important;
        right:auto !important;
        bottom:auto !important;
        width:118% !important;
        height:118% !important;
        max-width:none !important;
        max-height:none !important;
        margin:0 !important;
        padding:0 !important;
        object-fit:contain !important;
        object-position:center center !important;
        transform:translate3d(-50%,-50%,0) !important;
        transform-origin:center center !important;
      }

      html body .pl-private .pl-player-copy {
        position:relative;
        z-index:2;
        min-width:0;
        display:grid;
        align-content:center;
        justify-items:start;
        gap:3px;
      }

      html body .pl-private .pl-player-head {
        width:100%;
        display:flex;
        align-items:center;
        justify-content:space-between;
        gap:8px;
      }

      html body .pl-private .pl-player-copy > strong,
      html body .pl-private .pl-player-head > strong {
        display:block;
        min-width:0;
        flex:1 1 auto;
        overflow:hidden;
        text-overflow:ellipsis;
        white-space:nowrap;
        color:#fff;
        font-size:clamp(14px,3.7vw,17px) !important;
        line-height:1.05 !important;
        font-weight:900;
      }

      html body .pl-private .pl-tags {
        width:100%;
        margin:0 !important;
        display:flex !important;
        flex-wrap:nowrap !important;
        gap:3px !important;
        overflow:hidden;
      }

      html body .pl-private .pl-tags span {
        min-width:0;
        padding:2px 5px !important;
        border:1px solid #7356ce !important;
        border-radius:999px !important;
        background:rgba(48,35,105,.72);
        color:#ded7ff !important;
        font-size:8.5px !important;
        line-height:1.15;
        font-weight:800;
        white-space:nowrap;
      }

      html body .pl-private .pl-tags .is-host {
        border-color:#c24eff !important;
        color:#f0c9ff !important;
      }

      html body .pl-private .pl-player-title {
        max-width:100%;
        min-height:20px;
        padding:2px 7px;
        display:inline-flex;
        align-items:center;
        gap:4px;
        border:1px solid #8e61ff;
        border-radius:999px;
        background:linear-gradient(90deg,rgba(105,42,202,.76),rgba(37,54,151,.74));
        color:#fff;
        box-shadow:0 0 8px rgba(172,65,255,.22);
        font-size:9px;
        line-height:1;
        overflow:hidden;
      }

      html body .pl-private .pl-player-title > span {
        flex:none;
        color:#fff;
        font-size:11px;
        text-shadow:0 0 6px rgba(214,142,255,.55);
      }

      html body .pl-private .pl-player-title strong {
        overflow:hidden;
        text-overflow:ellipsis;
        white-space:nowrap;
        font-size:9px;
        font-weight:900;
      }

      html body .pl-private .pl-player-title-row {
        max-width:100%;
        display:inline-flex;
        align-items:center;
        gap:5px;
      }

      html body .pl-private .pl-host-crown-inline {
        width:18px !important;
        height:18px !important;
        flex:none;
        display:block;
        object-fit:contain;
        filter:drop-shadow(0 0 5px rgba(255,196,64,.30));
      }

      html body .pl-private .pl-status {
        margin-top:0;
        display:inline-flex;
        align-items:center;
        justify-content:flex-end;
        gap:4px;
        color:#aab7d9 !important;
        font-size:9px !important;
        line-height:1.1;
        white-space:nowrap;
        flex:none;
      }

      html body .pl-private .pl-card-status {
        position:absolute;
        z-index:5;
        right:8px;
        bottom:7px;
        padding:3px 5px;
        border-radius:999px;
        background:rgba(7,18,50,.55);
        backdrop-filter:blur(4px);
      }

      html body .pl-private .pl-status i {
        width:6px;
        height:6px;
        flex:none;
        border-radius:50%;
        background:#8c83ae;
        box-shadow:0 0 5px rgba(145,130,188,.35);
      }

      html body .pl-private .pl-status.is-ready {
        color:#67e3ba !important;
      }

      html body .pl-private .pl-status.is-ready i {
        background:#55e7b6;
        box-shadow:0 0 7px rgba(85,231,182,.55);
      }

      html body .pl-private .pl-status.is-offline i {
        background:#69738f;
        box-shadow:none;
      }

      html body .pl-private .pl-kick {
        z-index:12;
        right:1px !important;
        top:0 !important;
        width:22px;
        height:22px;
        padding:0 !important;
        display:grid;
        place-items:center;
        border:0 !important;
        border-radius:50%;
        background:rgba(9,17,53,.65) !important;
        color:#aeb7d5 !important;
        font-size:15px !important;
        line-height:1;
      }

      html body .pl-private .pl-empty {
        padding:7px !important;
        display:flex !important;
        flex-direction:column !important;
        align-items:center !important;
        justify-content:center !important;
        gap:6px !important;
        border:1px dashed #5a78b0 !important;
        background:linear-gradient(145deg,rgba(10,27,66,.54),rgba(10,20,55,.42));
        color:#a7b8e4 !important;
      }

      html body .pl-private .pl-empty b {
        width:36px !important;
        height:36px !important;
        display:grid !important;
        place-items:center !important;
        border:1px solid #6988c7 !important;
        border-radius:50% !important;
        background:rgba(19,39,84,.55);
        color:#adc1f5;
        font-size:25px !important;
        line-height:1 !important;
        font-weight:300 !important;
      }

      html body .pl-private .pl-empty span {
        font-size:10.5px !important;
        font-weight:600;
      }

      /* ---------- Profil joueur V2 ---------- */
      html body .pl-private .pl-profile-v2-backdrop {
        position:fixed !important;
        inset:0 !important;
        z-index:100020 !important;
        padding:18px !important;
        display:grid !important;
        place-items:center !important;
        background:rgba(3,8,31,.76) !important;
        backdrop-filter:blur(10px);
      }

      html body .pl-private .pl-profile-v2-modal {
        position:relative;
        width:min(100%,360px) !important;
        max-width:360px !important;
        padding:18px !important;
        display:grid !important;
        gap:14px !important;
        border:1px solid rgba(165,83,255,.72) !important;
        border-radius:22px !important;
        background:
          radial-gradient(circle at 18% 6%,rgba(140,58,255,.22),transparent 38%),
          linear-gradient(155deg,#111b50,#09153c 75%) !important;
        box-shadow:0 22px 65px rgba(0,0,0,.48),0 0 28px rgba(142,56,255,.18) !important;
        color:#fff !important;
        overflow:visible !important;
      }

      html body .pl-private .pl-profile-v2-close {
        position:absolute !important;
        z-index:20;
        right:10px !important;
        top:9px !important;
        width:32px !important;
        height:32px !important;
        padding:0 !important;
        display:grid !important;
        place-items:center !important;
        border:1px solid rgba(130,104,212,.46) !important;
        border-radius:50% !important;
        background:rgba(12,23,65,.84) !important;
        color:#d8d3ee !important;
        font-size:23px !important;
        line-height:1 !important;
      }

      html body .pl-private .pl-profile-v2-card {
        position:relative;
        min-height:142px;
        padding:12px 12px 12px 10px;
        display:grid;
        grid-template-columns:126px minmax(0,1fr);
        align-items:center;
        gap:12px;
        border:1px solid rgba(83,111,166,.66);
        border-radius:18px;
        background:
          radial-gradient(circle at 19% 44%,rgba(131,58,255,.13),transparent 42%),
          linear-gradient(145deg,#11264d,#0b1c42 78%);
        box-shadow:inset 0 0 16px rgba(110,83,245,.055);
        overflow:visible;
      }

      html body .pl-private .pl-profile-v2-card.is-host,
      html body .pl-private .pl-profile-v2-card.is-self {
        border-color:rgba(177,76,255,.50);
        box-shadow:inset 0 0 22px rgba(138,62,255,.08),0 0 13px rgba(166,54,255,.16);
      }

      html body .pl-private .pl-profile-v2-avatar-shell {
        position:relative;
        width:126px;
        height:126px;
        display:grid;
        place-items:center;
        overflow:visible;
      }

      html body .pl-private .pl-profile-v2-avatar {
        position:relative !important;
        width:100% !important;
        height:100% !important;
        display:grid !important;
        place-items:center !important;
        overflow:hidden !important;
        border:1.5px solid #a657ff !important;
        border-radius:15px !important;
        background:#181953 !important;
        box-shadow:0 0 10px rgba(163,66,255,.27) !important;
      }

      html body .pl-private .pl-profile-v2-avatar > img:not(.ptb-equipped-frame-overlay) {
        width:100% !important;
        height:100% !important;
        max-width:none !important;
        max-height:none !important;
        object-fit:cover !important;
      }

      html body .pl-private .pl-profile-v2-avatar.ptb-has-equipped-frame {
        overflow:visible !important;
        border:0 !important;
        border-radius:0 !important;
        background:transparent !important;
        box-shadow:none !important;
      }

      html body .pl-private .pl-profile-v2-avatar.ptb-has-equipped-frame > img:not(.ptb-equipped-frame-overlay) {
        width:85% !important;
        height:85% !important;
        max-width:85% !important;
        max-height:85% !important;
        border-radius:0 !important;
      }

      html body .pl-private .pl-profile-v2-avatar.ptb-has-equipped-frame > .ptb-equipped-frame-overlay {
        left:50% !important;
        top:50% !important;
        width:118% !important;
        height:118% !important;
        max-width:none !important;
        max-height:none !important;
        transform:translate3d(-50%,-50%,0) !important;
      }

      html body .pl-private .pl-profile-v2-copy {
        min-width:0;
        min-height:104px;
        display:flex;
        flex-direction:column;
        align-items:center;
        justify-content:center;
        gap:8px;
        text-align:center;
      }

      html body .pl-private .pl-profile-v2-name-row {
        width:100%;
        min-width:0;
        display:flex;
        align-items:baseline;
        justify-content:center;
        gap:6px;
      }

      html body .pl-private .pl-profile-v2-name-row > strong {
        min-width:0;
        overflow:hidden;
        text-overflow:ellipsis;
        white-space:nowrap;
        font-size:22px !important;
        line-height:1.05;
        font-weight:900;
      }

      html body .pl-private .pl-profile-v2-player-code {
        flex:none;
        color:#b25cff;
        font-size:11px;
        line-height:1;
        font-weight:900;
        white-space:nowrap;
        text-shadow:0 0 7px rgba(178,92,255,.26);
      }

      html body .pl-private .pl-profile-v2-title-row {
        max-width:100%;
        display:inline-flex;
        align-items:center;
        justify-content:center;
        gap:6px;
      }

      html body .pl-private .pl-profile-v2-copy .pl-player-title {
        min-height:25px;
        padding:4px 10px;
        font-size:11px;
      }

      html body .pl-private .pl-profile-v2-copy .pl-player-title strong {
        font-size:11px;
      }

      html body .pl-private .pl-profile-v2-title-row .pl-host-crown-inline {
        width:20px !important;
        height:20px !important;
      }

      html body .pl-private .pl-profile-v2-status {
        display:inline-flex;
        align-items:center;
        gap:5px;
        color:#aab7d9;
        font-size:11px;
        font-weight:700;
        white-space:nowrap;
      }

      html body .pl-private .pl-profile-v2-status i {
        width:7px;
        height:7px;
        border-radius:50%;
        background:#8c83ae;
        box-shadow:0 0 5px rgba(145,130,188,.35);
      }

      html body .pl-private .pl-profile-v2-status.is-ready {
        color:#67e3ba;
      }

      html body .pl-private .pl-profile-v2-status.is-ready i {
        background:#55e7b6;
        box-shadow:0 0 7px rgba(85,231,182,.55);
      }

      html body .pl-private .pl-profile-v2-status.is-offline i {
        background:#69738f;
        box-shadow:none;
      }

      html body .pl-private .pl-profile-v2-inventory {
        width:100%;
        min-height:58px;
        padding:8px 12px;
        display:grid;
        grid-template-columns:38px minmax(0,1fr);
        grid-template-rows:auto auto;
        align-items:center;
        column-gap:10px;
        border:1px solid #8e61ff;
        border-radius:14px;
        background:linear-gradient(135deg,rgba(91,48,171,.90),rgba(48,35,122,.94));
        box-shadow:inset 0 0 13px rgba(189,127,255,.10),0 0 11px rgba(137,64,246,.15);
        text-align:left;
      }

      html body .pl-private .pl-profile-v2-inventory img {
        grid-row:1 / 3;
        width:36px !important;
        height:36px !important;
      }

      html body .pl-private .pl-profile-v2-inventory span {
        align-self:end;
        font-size:14px;
        font-weight:900;
      }

      html body .pl-private .pl-profile-v2-inventory small {
        align-self:start;
        color:#c3b6ed;
        font-size:9px;
        font-weight:700;
      }

      html body .pl-private .pl-profile-v2-actions {
        display:grid !important;
        grid-template-columns:1fr 1fr;
        gap:8px !important;
      }

      html body .pl-private .pl-profile-v2-actions button {
        min-height:46px !important;
        border-radius:13px !important;
      }

      html body .pl-private .pl-profile-v2-note {
        padding:10px 12px;
        border:1px solid rgba(63,83,137,.55);
        border-radius:12px;
        background:rgba(10,27,66,.58);
        color:#a9b4d3;
        text-align:center;
        font-size:10px;
        line-height:1.35;
      }

      html body .pl-private .pl-actions {
        gap:7px !important;
      }

      html body .pl-private .pl-social {
        gap:7px !important;
      }

      html body .pl-private .pl-invite,
      html body .pl-private .pl-share {
        min-height:43px !important;
        border-radius:13px !important;
      }

      html body .pl-private .pl-invite {
        border-color:#859bff !important;
        background:linear-gradient(145deg,#152853,#102044) !important;
        font-size:13px !important;
        font-weight:900 !important;
      }

      html body .pl-private .pl-invite img {
        width:26px !important;
        height:26px !important;
      }

      html body .pl-private .pl-share {
        min-width:94px;
        padding:6px 10px !important;
        display:inline-flex;
        align-items:center;
        justify-content:center;
        gap:6px;
        border-color:#8255cf !important;
        background:linear-gradient(145deg,#241552,#171a49) !important;
        color:#f1ecff;
        font-size:11px !important;
      }

      html body .pl-private .pl-share-icon {
        width:18px;
        height:18px;
        flex:none;
        fill:none;
        stroke:currentColor;
        stroke-width:1.8;
        stroke-linecap:round;
        stroke-linejoin:round;
      }

      html body .pl-private .pl-launch {
        gap:8px !important;
      }

      html body .pl-private .pl-launch button {
        min-height:45px !important;
        border-radius:13px !important;
      }

      html body .pl-private .pl-launch #plReady {
        border-color:#b36cff !important;
        background:linear-gradient(145deg,#5c388f,#432b79) !important;
        font-size:15px !important;
      }

      html body .pl-private .pl-launch #plReady.selected {
        border-color:#59ddb4 !important;
        background:linear-gradient(145deg,#15594c,#18493f) !important;
      }

      html body .pl-private .pl-launch #startBtn {
        background:linear-gradient(135deg,#783ee7,#5226bc) !important;
        box-shadow:inset 0 0 13px rgba(211,159,255,.10);
      }

      html body .pl-private .pl-launch #startBtn:disabled {
        filter:saturate(.45);
        opacity:.42;
      }

      html body .pl-private .pl-test {
        margin-top:-1px;
        font-size:9px !important;
      }

      @media (max-width:370px) {
        html body .pl-private .pl-grid {
          gap:6px !important;
        }

        html body .pl-private .pl-player {
          grid-template-columns:92px minmax(0,1fr) !important;
          padding:6px !important;
          gap:6px !important;
        }

        html body .pl-private .pl-avatar-shell {
          width:92px;
          height:92px;
        }

        html body .pl-private .pl-player-copy > strong {
          font-size:13px !important;
        }

        html body .pl-private .pl-player-title,
        html body .pl-private .pl-player-title strong {
          font-size:8px !important;
        }

        html body .pl-private .pl-tags span {
          padding-inline:4px !important;
          font-size:7.7px !important;
        }
      }

      @media (max-height:690px) {
        html body .pl-private .pl-setting-grid .lobby-v5-setting-card {
          height:60px !important;
        }

        html body .pl-private .pl-setting-grid .lobby-v5-setting-icon {
          width:22px !important;
          height:22px !important;
        }

        html body .pl-private .pl-grid {
          grid-template-rows:repeat(3,minmax(102px,1fr)) !important;
          gap:6px !important;
          overflow-y:auto !important;
          overscroll-behavior:contain;
        }

        html body .pl-private .pl-player,
        html body .pl-private .pl-empty {
          min-height:102px !important;
        }

        html body .pl-private .pl-player {
          grid-template-columns:86px minmax(0,1fr) !important;
          padding:5px 6px !important;
          gap:6px !important;
        }

        html body .pl-private .pl-avatar-shell {
          width:86px;
          height:86px;
        }

        html body .pl-private .pl-player-copy {
          gap:2px;
        }

        html body .pl-private .pl-player-copy > strong {
          font-size:12px !important;
        }

        html body .pl-private .pl-player-title {
          min-height:16px;
          padding:1px 5px;
        }

        html body .pl-private .pl-player-title strong,
        html body .pl-private .pl-status {
          font-size:7.5px !important;
        }

        html body .pl-private .pl-empty b {
          width:30px !important;
          height:30px !important;
          font-size:21px !important;
        }

        html body .pl-private .pl-invite,
        html body .pl-private .pl-share,
        html body .pl-private .pl-launch button {
          min-height:39px !important;
        }
      }
    `;

    document.head.appendChild(style);
  }

  function privateMarkup(state, user) {
    const maxPlayers = lobbyMaxPlayers(state);
    ensurePrivateLobbyV2Styles();

    const quickMode = state.mode === "quick";
    const publicMode = state.mode === "public";
    const difficulty = difficultyInfo(state.categoryDifficulty);

    const allReady =
      !quickMode &&
      state.players.length >= 2 &&
      state.players.every(
        player => player.isBot || (player.connected && player.lobbyReady)
      );

    const cards = state.players.map(player => {
      const self = String(player.id) === String(session.playerId);
      const hostVisual = !quickMode && player.isHost;
      const ready =
        !quickMode &&
        (player.isBot || (player.connected && player.lobbyReady));
      const offline = !player.isBot && !player.connected;
      const canKick =
        !quickMode &&
        user?.isHost &&
        !player.isHost;

      return `
        <article
          class="pl-player pl-player-v2 ${hostVisual ? "is-host" : ""} ${self ? "is-self" : ""} ${ready ? "is-ready" : ""}"
          data-lobby-player-profile="${escapeHtml(player.id)}"
          role="button"
          tabindex="0"
          aria-label="Profil de ${escapeHtml(player.name || "Joueur")}"
        >
          <div class="pl-avatar-shell">
            <div class="pl-avatar">${avatarMarkup(player)}</div>
          </div>

          <div class="pl-player-copy">
            <div class="pl-player-head">
              <strong>${escapeHtml(player.name || "Joueur")}</strong>
            </div>

            <div class="pl-player-title-row">
              ${privateLobbyTagMarkup(player)}
              ${hostVisual
                ? `<img class="pl-host-crown-inline" src="/admin-crown.png" alt="Hôte">`
                : ""}
            </div>

            ${player.isBot
              ? `<div class="pl-tags"><span>Bot</span></div>`
              : ""}
          </div>

          <small class="pl-status pl-card-status ${ready ? "is-ready" : ""} ${offline ? "is-offline" : ""}">
            <i aria-hidden="true"></i>
            ${ready ? "Prêt" : offline ? "Hors ligne" : "Pas prêt"}
          </small>

          ${canKick
            ? `<button class="pl-kick" data-kick-id="${escapeHtml(player.id)}" type="button" aria-label="Retirer ce joueur">×</button>`
            : ""}
        </article>`;
    }).join("");

    const emptySlots = Array.from(
      { length:Math.max(0, maxPlayers - state.players.length) },
      () => `
        <div class="pl-empty" aria-label="Place libre">
          <b aria-hidden="true">＋</b>
          <span>Place libre</span>
        </div>`
    ).join("");

    const rootClasses = [
      "screen",
      "lobby-v5",
      "pl-private",
      publicMode ? "pl-public-mode" : "",
      quickMode ? "pl-private-v3" : "",
      quickMode ? "pl-quick-v3" : ""
    ].filter(Boolean).join(" ");

    // Le mode Quick garde sa logique serveur via state.mode === "quick"
    // et sa classe .pl-quick-v3, mais utilise exactement la même peau
    // DOM que le salon Privé. Cela évite de maintenir un second jeu de
    // styles et garde inactifs les anciens scripts [data-mode="quick"].
    const domMode = quickMode
      ? "private"
      : publicMode
        ? "public"
        : "private";

    return `
      <main
        class="${rootClasses}"
        data-mode="${domMode}"
        data-lobby-kind="${quickMode ? "quick" : publicMode ? "public" : "private"}"
        data-game-type="${state.gameType === "bombe" ? "bombe" : "baccalaureat"}"
        ${quickMode ? `data-quick-v3-upgraded="1"` : ""}
      >
        <header class="pl-header">
          <button id="lobbyV5Leave" type="button" aria-label="Quitter le salon">
            <img src="/back-arrow.png" alt="">
          </button>

          ${quickMode
            ? `<div class="pl-title-mode">
                <h1>Baccalauréat - Partie Rapide</h1>
              </div>`
            : roomModeToggleMarkup(state, user)}

          <button id="copyCode" class="pl-header-code" type="button" aria-label="Copier le code du salon">
            <small>Code salon</small>
            <strong>${escapeHtml(state.code)}</strong>
            <img src="/lobby-copy.png" alt="">
          </button>
        </header>

        <section class="pl-settings">
          <h2>
            <img src="/settings.png" alt="">
            <span>Paramètres de la partie</span>
            ${!quickMode && user?.isHost
              ? `<button id="lobbySettingsShortcut" class="pl-settings-edit" type="button" aria-label="Modifier les paramètres"><span>Modifier</span><b aria-hidden="true">›</b></button>`
              : ""}
          </h2>

          <div class="pl-setting-grid">
            ${settingCard({label:"Manches",value:state.rounds,icon:"/lightning.png"})}
            ${state.gameType === "bombe"
              ? `${settingCard({label:"Vies",value:state.bombLives || 3,icon:"/lobby-categories.png"})}${settingCard({label:"Bombe",value:({fast:"Rapide",medium:"Moyen",slow:"Lent"})[state.bombSpeed] || "Moyen",icon:"/lobby-clock.png"})}`
              : `${settingCard({label:"Catégories",value:state.categoryCount || 6,icon:"/lobby-categories.png"})}${settingCard({label:"Temps",value:state.duration+"s",icon:"/lobby-clock.png"})}`}
            ${settingCard({label:"Difficulté",value:difficulty.label,icon:difficulty.icon,difficulty:true})}
          </div>
        </section>

        <section class="pl-players">
          <h2>Joueurs <span>${state.players.length}/${maxPlayers}</span></h2>
          <div class="pl-grid">${cards}${emptySlots}</div>
        </section>

        <div class="pl-actions">
          <div class="pl-social">
            <button id="inviteFriendsBtn" class="pl-invite" type="button">
              <img src="/friends.png" alt="">
              <span>Inviter des amis</span>
            </button>

            <button id="plShare" class="pl-share" type="button" aria-label="Partager le code du salon">
              ${privateLobbyShareIcon()}
              <span>Partager</span>
            </button>
          </div>

          <div class="pl-launch">
            <button
              id="plReady"
              class="${!quickMode && user?.lobbyReady ? "selected" : ""}"
              type="button"
              aria-pressed="${!quickMode && !!user?.lobbyReady}"
            >${!quickMode && user?.lobbyReady ? "Annuler" : "✓ Prêt"}</button>

            ${quickMode
              ? ""
              : user?.isHost
                ? `<button id="startBtn" type="button" ${allReady ? "" : "disabled"}>▶ Lancer la partie</button>`
                : `<span class="pl-wait">L’hôte lancera la partie.</span>`}

          </div>

          ${!quickMode && user?.isHost && state.mode === "private"
            ? `<button class="pl-test" data-add-bot="0" type="button" ${state.players.length >= maxPlayers ? "disabled" : ""}>Ajouter un joueur test</button>`
            : ""}
        </div>

        ${playerProfileModal(state)}
        ${lobbySettingsOverlay(state,user)}
        ${lobbyInviteOverlay(state)}
      </main>`;
  }

  function renderLobbyV5() {
    clearInterval(session.timerHandle);
    session.localAnswers = {};

    const state = session.state;
    const user = me();
    if (!state || state.phase !== "lobby") return render();

    const categoryCount = Number(
      state.categoryCount || state.categories?.length || 6
    );

    setScreen(privateMarkup(state, user));

    document.getElementById("plShare")?.addEventListener("click", async () => {
      try {
        if (navigator.share) await navigator.share({title:"P’tit Bac", text:"Rejoins mon salon P’tit Bac avec le code "+state.code});
        else document.getElementById("copyCode")?.click();
      } catch (err) { if (err.name !== "AbortError") toast("Partage indisponible. Copie le code du salon."); }
    });
    if (state.mode !== "quick") {
      document.getElementById("plReady")?.addEventListener("click", event => {
        const button = event.currentTarget;
        button.disabled = true;
        socket.timeout(8000).emit("lobby:setReady", {code:state.code,playerId:session.playerId,ready:!user?.lobbyReady}, (err,res) => {
          button.disabled = false;
          if (err || !res?.ok) toast(res?.error || "Connexion interrompue. Réessaie.");
        });
      });
    }
    document.getElementById("plModeToggle")?.addEventListener("click", () => {
      changeRoomMode(state, user);
    });
    const leave = () => {
      lobbySettingsOpen = false;
      lobbyInviteOpen = false;

      const button = document.getElementById("lobbyV5Leave");
      if (button) button.disabled = true;

      socket.timeout(8000).emit(
        "room:leave",
        { code:state.code, playerId:session.playerId },
        (err, res) => {
          if (err || !res?.ok) {
            if (button) button.disabled = false;
            return toast(
              res?.error ||
              "Impossible de quitter le salon pour le moment."
            );
          }

          clearSession();
          if (typeof initWallet === "function") {
            initWallet(() => renderHome());
          } else {
            renderHome();
          }
        }
      );
    };

    document.getElementById("lobbyV5Leave")?.addEventListener("click", leave);

    document.getElementById("copyCode")?.addEventListener("click", async () => {
      try {
        await navigator.clipboard.writeText(state.code);
        toast("Code copié !");
      } catch {
        toast(`Code : ${state.code}`);
      }
    });

    document.getElementById("lobbySettingsShortcut")?.addEventListener("click", () => {
      if (state.mode === "quick") return;
      if (!user?.isHost) {
        return toast("Seul l’hôte peut modifier les paramètres.");
      }
      lobbySettingsOpen = true;
      renderLobbyV5();
    });

    const closeInlineSettings = () => {
      lobbySettingsOpen = false;
      renderLobbyV5();
    };

    document.getElementById("lobbySettingsClose")?.addEventListener("click", closeInlineSettings);
    document.getElementById("lobbySettingsApply")?.addEventListener("click", closeInlineSettings);

    document.getElementById("lobbySettingsOverlay")?.addEventListener("click", event => {
      if (event.target.id === "lobbySettingsOverlay") closeInlineSettings();
    });

    const updateInlineSetting = (setting, dir) => {
      if (state.mode === "quick" || !user?.isHost) return;

      if (setting === "categoryDifficulty") {
        const now = Date.now();
        if (now < lobbyDifficultyLockUntil) return;
        lobbyDifficultyLockUntil = now + 260;
      }

      const rounds = [1, 3, 5];
      const durations = [30, 60, 90, 120];
      const difficulties = ["beginner", "medium", "hard"];
      const bomb = state.gameType === "bombe";
      let nextBombLives = Number(state.bombLives || 3);
      let nextBombSpeed = state.bombSpeed || "medium";

      let nextRounds = Number(state.rounds || 1);
      let nextDuration = Number(state.duration || 60);
      let nextDifficulty = state.categoryDifficulty || "beginner";
      let nextCategoryCount = categoryCount;
      const categoryCounts = [6, 8, 10];

      const cycle = (arr, current, direction) => {
        let i = arr.indexOf(current);
        if (i < 0) i = 0;
        return arr[(i + direction + arr.length) % arr.length];
      };

      if (setting === "rounds") nextRounds = cycle(rounds, nextRounds, dir);
      if (bomb && setting === "bombLives") nextBombLives = cycle([1, 2, 3], nextBombLives, dir);
      if (bomb && setting === "bombSpeed") nextBombSpeed = cycle(["fast", "medium", "slow"], nextBombSpeed, dir);
      if (setting === "duration") nextDuration = cycle(durations, nextDuration, dir);
      if (setting === "categoryDifficulty") nextDifficulty = cycle(difficulties, nextDifficulty, dir);
      if (setting === "categoryCount") {
        const normalizedCount = categoryCounts.includes(nextCategoryCount) ? nextCategoryCount : 6;
        nextCategoryCount = cycle(categoryCounts, normalizedCount, dir);
      }

      document.querySelectorAll("[data-lobby-inline-step]").forEach(button => {
        button.disabled = true;
      });

      socket.emit("room:updateSettings", {
        code: state.code,
        playerId: session.playerId,
        rounds: nextRounds,
        duration: nextDuration,
        categoryCount: nextCategoryCount,
        categoryDifficulty: nextDifficulty,
        bombLives: nextBombLives,
        bombSpeed: nextBombSpeed
      }, res => {
        if (!res?.ok) {
          lobbyDifficultyLockUntil = 0;
          document.querySelectorAll("[data-lobby-inline-step]").forEach(button => {
            button.disabled = false;
          });
          return toast(res?.error || "Impossible de modifier ce paramètre.");
        }

        if (res.state) session.state = res.state;
        // La room:state va rerendre le salon ; garder l'overlay ouvert.
      });
    };

    document.querySelectorAll("[data-lobby-inline-step]").forEach(button => {
      button.addEventListener("click", event => {
        event.preventDefault();
        event.stopPropagation();
        updateInlineSetting(
          button.dataset.lobbyInlineStep,
          Number(button.dataset.dir) || 1
        );
      });
    });

    document.getElementById("inviteFriendsBtn")?.addEventListener("click", () => {
      lobbyInviteOpen = true;
      lobbyInviteFriends = [];
      renderLobbyV5();
      loadLobbyInviteFriends();
    });

    const closeLobbyInvite = () => {
      lobbyInviteOpen = false;
      lobbyInviteLoading = false;
      renderLobbyV5();
    };

    document.getElementById("lobbyInviteClose")?.addEventListener("click", closeLobbyInvite);

    document.getElementById("lobbyInviteOverlay")?.addEventListener("click", event => {
      if (event.target.id === "lobbyInviteOverlay") closeLobbyInvite();
    });

    document.querySelectorAll("[data-lobby-invite-friend]").forEach(button => {
      button.addEventListener("click", () => {
        const friendId = button.dataset.lobbyInviteFriend || "";
        if (!friendId) return;

        button.disabled = true;

        lobbyInviteSocket.emit(
          "friends:invite",
          lobbyInviteIdentity({
            friendId,
            roomCode: state.code
          }),
          res => {
            button.disabled = false;

            if (!res?.ok) {
              return toast(res?.error || "Invitation impossible.");
            }

            button.classList.add("sent");
            button.innerHTML = `<span>${res.delivered ? "Envoyé ✓" : "Hors ligne"}</span>`;
            toast(res.delivered ? "Invitation envoyée !" : "Ami hors ligne pour le moment.");
          }
        );
      });
    });

    document.querySelectorAll("[data-add-bot]").forEach(btn => {
      btn.addEventListener("click", () => {
        if (!user?.isHost) return;
        if (state.players.length >= lobbyMaxPlayers(state)) return toast("Salon complet.");
        socket.emit("room:addBot", { code: state.code, playerId: session.playerId });
      });
    });

    const openProfile = playerId => {
      lobbyOpenedPlayerId = String(playerId || "");
      renderLobbyV5();
    };

    document.querySelectorAll("[data-lobby-player-profile]").forEach(card => {
      card.addEventListener("click", event => {
        if (event.target.closest("[data-kick-id]")) return;
        openProfile(card.dataset.lobbyPlayerProfile);
      });
      card.addEventListener("keydown", event => {
        if (!["Enter", " "].includes(event.key)) return;
        event.preventDefault();
        openProfile(card.dataset.lobbyPlayerProfile);
      });
    });

    const closeProfile = () => {
      lobbyOpenedPlayerId = "";
      renderLobbyV5();
    };

    document.getElementById("lobbyPlayerProfileClose")?.addEventListener("click", closeProfile);
    document.getElementById("lobbyPlayerProfileBackdrop")?.addEventListener("click", event => {
      if (event.target.id === "lobbyPlayerProfileBackdrop") closeProfile();
    });

    document.getElementById("lobbyPlayerInventory")?.addEventListener("click", event => {
      event.preventDefault();
      event.stopPropagation();

      if (!window.PtitBacInventory?.open) {
        return toast("Inventaire indisponible pour le moment.");
      }

      lobbyInventoryReturnToLobby = true;
      lobbyOpenedPlayerId = "";
      window.PtitBacInventory.open();
    });

    document.getElementById("lobbyPlayerAddFriend")?.addEventListener("click", () => {
      const target = state.players.find(p => String(p.id) === String(lobbyOpenedPlayerId));
      const code = friendCodeFor(target);
      if (!code) return toast("Code ami indisponible.");
      if (!window.PtitBacFriends?.sendRequestByCode) return toast("Le système d’amis n’est pas encore prêt.");

      window.PtitBacFriends.sendRequestByCode(code, res => {
        if (!res?.ok) return toast(res?.error || "Demande impossible.");
        toast(`Demande envoyée à ${target?.name || "ce joueur"} !`);
      });
    });

    document.getElementById("lobbyPlayerReport")?.addEventListener("click", () => {
      const target = state.players.find(p => String(p.id) === String(lobbyOpenedPlayerId));
      const code = friendCodeFor(target);
      if (!target || !code) return toast("Ce joueur ne peut pas être signalé.");

      socket.emit("players:report", {
        walletToken: session.walletToken || localStorage.getItem("petitbac_walletToken") || "",
        roomCode: state.code,
        targetPlayerId: target.id,
        targetFriendCode: code,
        targetName: target.name || ""
      }, res => {
        if (!res?.ok) return toast(res?.error || "Signalement impossible.");
        toast("Signalement envoyé.");
        closeProfile();
      });
    });

    if (user?.isHost && state.mode !== "quick") {
      document.querySelectorAll("[data-kick-id]").forEach(btn => {
        btn.addEventListener("click", event => {
          event.stopPropagation();
          socket.emit("room:kick", {
            code: state.code,
            playerId: session.playerId,
            targetPlayerId: btn.dataset.kickId
          });
        });
      });

      document.getElementById("startBtn")?.addEventListener("click", event => {
        const button = event.currentTarget;
        if (button.disabled || lobbyCountdownActive) return;

        button.disabled = true;
        button.classList.add("is-counting-down");

        socket.emit("lobby:startCountdown", {
          code: state.code,
          playerId: session.playerId
        }, res => {
          if (res?.ok) return;

          lobbyCountdownActive = false;
          button.disabled = false;
          button.classList.remove("is-counting-down");
          toast(res?.error || "Impossible de lancer le compte à rebours.");
        });
      });
    }
  }

  document.addEventListener("click", event => {
    if (!lobbyInventoryReturnToLobby) return;
    if (!event.target.closest?.("#inventoryV2Back")) return;

    event.preventDefault();
    event.stopPropagation();
    lobbyInventoryReturnToLobby = false;

    try {
      window.PtitBacInventory?.close?.();
    } catch {}

    if (session?.state?.phase === "lobby") {
      renderLobbyV5();
    }
  }, true);

  socket.on("lobby:countdown", startLobbyCountdown);

  socket.on("room:state", state => {
    if (state?.phase !== "lobby") clearLobbyCountdown();
  });

  window.renderLobby = renderLobbyV5;
  try { renderLobby = renderLobbyV5; } catch {}
})();

/* ==== quick-lobby-v1.js ==== */
(() => {
  "use strict";

  /*
   * CLEAN-01A — Partie Rapide
   *
   * Le rendu du salon Quick n'appartient plus à ce fichier.
   * Il est désormais pris en charge par le lobby V3 commun
   * (lobby-screen-v4.js + ui-runtime-v1.js + private-lobby.css).
   *
   * Ce fichier ne conserve que les fonctions encore spécifiques
   * au déroulement Quick après le lobby :
   * - relance de la lettre ;
   * - relance des catégories ;
   * - confirmation des catégories.
   */

  const QUICK_REROLL_FALLBACK_COST = 20;
  const QUICK_DIFFICULTY_ICON = "/difficulty.png";
  let scheduled = false;

  function liveSession() {
    try {
      if (typeof session !== "undefined" && session) return session;
    } catch {}
    return null;
  }

  function stateNow() {
    return liveSession()?.state || null;
  }

  function playerIdNow() {
    return String(liveSession()?.playerId || "");
  }

  function coinBalance() {
    try {
      return typeof getCoins === "function"
        ? Number(getCoins())
        : Infinity;
    } catch {
      return Infinity;
    }
  }

  function showToast(message) {
    try {
      if (typeof toast === "function") return toast(message);
    } catch {}
  }

  function costFromState(kind) {
    const state = stateNow();
    const value =
      kind === "letter"
        ? Number(state?.letterRerollCost)
        : Number(state?.categoryRerollCost);

    return Number.isFinite(value) && value > 0
      ? value
      : QUICK_REROLL_FALLBACK_COST;
  }

  function setCoinCostMarkup(button, cost) {
    if (!button) return;

    const coin = button.querySelector("b");

    if (coin) {
      coin.innerHTML = `<img src="/coin.png" alt="">${cost}`;
      return;
    }

    button.insertAdjacentHTML(
      "beforeend",
      `<b><img src="/coin.png" alt="">${cost}</b>`
    );
  }

  function bindQuickLetterReroll(button) {
    if (
      !button ||
      button.dataset.ptbQuickRerollBound === "1"
    ) {
      return;
    }

    button.dataset.ptbQuickRerollBound = "1";

    button.addEventListener("click", event => {
      event.preventDefault();
      event.stopPropagation();

      const state = stateNow();
      const playerId = playerIdNow();
      const cost = costFromState("letter");

      if (
        !state ||
        state.mode !== "quick" ||
        String(state.letterChooserPlayerId || "") !== playerId ||
        !state.pendingLetter
      ) {
        return;
      }

      if (coinBalance() < cost) {
        return showToast(
          `Il te faut ${cost} pièces pour relancer.`
        );
      }

      if (!socket?.connected) {
        return showToast(
          "Connexion interrompue. Attends la reconnexion."
        );
      }

      const requestedVersion =
        Number(state.letterSpinVersion || 0);

      const requestedLetter =
        String(state.pendingLetter || "").slice(0, 1);

      button.disabled = true;

      const confirm =
        document.getElementById("pbw1Confirm");

      if (confirm) confirm.disabled = true;

      socket.emit(
        "game:rerollLetter",
        {
          code: state.code,
          playerId
        }
      );

      setTimeout(() => {
        const current = stateNow();

        const stillSameLetter =
          current?.phase === "letter_selection" &&
          current?.mode === "quick" &&
          String(current?.letterChooserPlayerId || "") ===
            playerId &&
          Number(current?.letterSpinVersion || 0) ===
            requestedVersion &&
          String(current?.pendingLetter || "").slice(0, 1) ===
            requestedLetter;

        if (
          socket?.connected &&
          button.isConnected &&
          stillSameLetter
        ) {
          button.disabled = coinBalance() < cost;

          if (confirm?.isConnected) {
            confirm.disabled = false;
          }

          showToast(
            "La relance de la lettre n’a pas été confirmée. Réessaie."
          );
        }
      }, 8000);
    });
  }

  function ensureQuickLetterReroll() {
    const state = stateNow();
    const playerId = playerIdNow();

    if (
      !state ||
      state.mode !== "quick" ||
      String(state.letterChooserPlayerId || "") !== playerId ||
      !state.pendingLetter ||
      !document.querySelector(".pbw1-screen")
    ) {
      return;
    }

    const actions =
      document.querySelector(".pbw1-screen .pbw1-actions");

    if (!actions) return;

    const cost = costFromState("letter");
    let button =
      document.getElementById("pbw1Reroll");

    if (!button) {
      button = document.createElement("button");
      button.className =
        "pbw1-reroll ptb-quick-reroll-restored";
      button.id = "pbw1Reroll";
      button.type = "button";
      button.innerHTML = `
        <span>↻ Relancer</span>
        <b><img src="/coin.png" alt="">${cost}</b>
      `;

      const confirm =
        document.getElementById("pbw1Confirm");

      actions.insertBefore(
        button,
        confirm || actions.firstChild
      );
    }

    setCoinCostMarkup(button, cost);
    button.disabled = coinBalance() < cost;
    bindQuickLetterReroll(button);
  }

  function bindQuickCategoryControls(
    reroll,
    confirm
  ) {
    if (
      reroll &&
      reroll.dataset.ptbQuickCreated === "1" &&
      reroll.dataset.ptbQuickRerollBound !== "1"
    ) {
      reroll.dataset.ptbQuickRerollBound = "1";

      reroll.addEventListener("click", event => {
        event.preventDefault();
        event.stopPropagation();

        const current = stateNow();
        const cost = costFromState("category");

        if (
          !current ||
          current.mode !== "quick" ||
          String(current.categoryChooserPlayerId || "") !==
            playerIdNow()
        ) {
          return;
        }

        if (coinBalance() < cost) {
          return showToast(
            `Il te faut ${cost} pièces pour relancer le tirage.`
          );
        }

        if (!socket?.connected) {
          return showToast(
            "Connexion interrompue. Attends la reconnexion."
          );
        }

        const originalCategories =
          JSON.stringify(
            Array.isArray(current.categories)
              ? current.categories
              : []
          );

        reroll.disabled = true;
        reroll.classList.add("is-loading");

        if (confirm) confirm.disabled = true;

        socket.emit(
          "game:rerollCategories",
          {
            code: current.code,
            playerId: playerIdNow()
          }
        );

        setTimeout(() => {
          const latest = stateNow();

          const stillSameDraw =
            latest?.phase === "category_selection" &&
            latest?.mode === "quick" &&
            String(latest?.categoryChooserPlayerId || "") ===
              playerIdNow() &&
            JSON.stringify(
              Array.isArray(latest?.categories)
                ? latest.categories
                : []
            ) === originalCategories;

          if (
            socket?.connected &&
            reroll.isConnected &&
            stillSameDraw
          ) {
            reroll.disabled = coinBalance() < cost;
            reroll.classList.remove("is-loading");

            if (confirm?.isConnected) {
              confirm.disabled = false;
            }

            showToast(
              "La relance des catégories n’a pas été confirmée. Réessaie."
            );
          }
        }, 8000);
      });
    }

    if (
      confirm &&
      confirm.dataset.ptbQuickConfirmBound !== "1"
    ) {
      confirm.dataset.ptbQuickConfirmBound = "1";

      confirm.addEventListener(
        "click",
        event => {
          if (
            confirm.dataset.ptbQuickCreated !== "1"
          ) {
            return;
          }

          event.preventDefault();
          event.stopPropagation();

          const current = stateNow();

          if (
            !current ||
            current.mode !== "quick" ||
            String(
              current.categoryChooserPlayerId || ""
            ) !== playerIdNow()
          ) {
            return;
          }

          if (!socket?.connected) {
            return showToast(
              "Connexion interrompue. Attends la reconnexion."
            );
          }

          confirm.disabled = true;

          if (reroll) reroll.disabled = true;

          socket.emit(
            "game:confirmCategories",
            {
              code: current.code,
              playerId: playerIdNow()
            }
          );

          setTimeout(() => {
            const latest = stateNow();

            const stillChoosing =
              latest?.phase === "category_selection" &&
              latest?.mode === "quick" &&
              String(
                latest?.categoryChooserPlayerId || ""
              ) === playerIdNow();

            if (
              socket?.connected &&
              confirm.isConnected &&
              stillChoosing
            ) {
              confirm.disabled = false;

              if (reroll?.isConnected) {
                reroll.disabled =
                  coinBalance() <
                  costFromState("category");

                reroll.classList.remove("is-loading");
              }

              showToast(
                "Le passage à la lettre n’a pas été confirmé. Réessaie."
              );
            }
          }, 8000);
        },
        true
      );
    }
  }

  function ensureQuickCategoryReroll() {
    const state = stateNow();
    const playerId = playerIdNow();
    const root = document.querySelector(".cat-v2");

    if (
      !root ||
      !state ||
      state.mode !== "quick" ||
      String(state.categoryChooserPlayerId || "") !==
        playerId
    ) {
      return;
    }

    const cost = costFromState("category");

    let actions =
      root.querySelector(".cat-v2-actions");

    let reroll =
      document.getElementById("rerollCategoriesBtn");

    let confirm =
      document.getElementById("confirmCategoriesBtn");

    if (!actions) {
      const wait =
        root.querySelector(".cat-v2-wait");

      actions = document.createElement("section");
      actions.className =
        "category-pick-actions cat-v2-actions ptb-quick-actions-restored";

      actions.innerHTML = `
        <button
          class="category-reroll-btn cat-v2-reroll"
          id="rerollCategoriesBtn"
          type="button"
          data-ptb-quick-created="1"
        >
          <span class="cat-v2-reroll-title">
            <b class="cat-v2-reroll-icon">↻</b>
            Relancer le tirage
          </span>
          <span class="cat-v2-coin-pill cat-v2-cost">
            <img src="/coin.png" alt="">
            <strong>${cost}</strong>
          </span>
          <small>
            Obtenez de nouvelles catégories aléatoires.
          </small>
        </button>

        <button
          class="btn btn-primary category-confirm-btn cat-v2-confirm"
          id="confirmCategoriesBtn"
          type="button"
          data-ptb-quick-created="1"
        >
          Continuer vers la lettre <span>→</span>
        </button>
      `;

      if (wait) {
        wait.replaceWith(actions);
      } else {
        root.appendChild(actions);
      }

      reroll =
        document.getElementById(
          "rerollCategoriesBtn"
        );

      confirm =
        document.getElementById(
          "confirmCategoriesBtn"
        );

      if (confirm) {
        confirm.dataset.ptbQuickCreated = "1";
      }
    }

    if (reroll) {
      const costStrong =
        reroll.querySelector(
          ".cat-v2-cost strong"
        );

      if (costStrong) {
        costStrong.textContent = String(cost);
      }

      reroll.disabled = coinBalance() < cost;
    }

    bindQuickCategoryControls(
      reroll,
      confirm
    );
  }

  function syncQuickModeClass() {
    let quick = false;

    try {
      quick = stateNow()?.mode === "quick";
    } catch {}

    document.documentElement.classList.toggle("ptb-quick-game", quick);
  }

  function enhance() {
    scheduled = false;
    syncQuickModeClass();
    ensureQuickLetterReroll();
    ensureQuickCategoryReroll();
  }

  /*
   * Nom conservé volontairement pendant Clean-01A :
   * les tests d'architecture existants vérifient encore ce point
   * d'entrée. Il ne redessine plus le lobby ; il programme uniquement
   * les fonctions Quick encore nécessaires après le salon.
   */
  function scheduleEnhance() {
    if (scheduled) return;

    scheduled = true;
    requestAnimationFrame(enhance);
  }

  let quickCountdownTimer = null;
  let quickCountdownAudio = null;
  let quickCountdownDeadline = 0;
  let quickCountdownLastValue = "";

  function quickCountdownNow() {
    try {
      return typeof serverNowMs === "function"
        ? serverNowMs()
        : Date.now();
    } catch {
      return Date.now();
    }
  }

  function clearQuickLobbyCountdown() {
    clearInterval(quickCountdownTimer);
    quickCountdownTimer = null;
    quickCountdownDeadline = 0;
    quickCountdownLastValue = "";

    if (quickCountdownAudio) {
      try {
        quickCountdownAudio.pause();
        quickCountdownAudio.currentTime = 0;
      } catch {}
      quickCountdownAudio = null;
    }

    document.getElementById("lobbyStartCountdown")?.remove();
  }

  function ensureQuickLobbyCountdownOverlay() {
    let overlay =
      document.getElementById("lobbyStartCountdown");

    if (overlay) return overlay;

    overlay = document.createElement("div");
    overlay.id = "lobbyStartCountdown";
    overlay.className = "lobby-start-countdown";
    overlay.setAttribute("role", "status");
    overlay.setAttribute("aria-live", "assertive");

    /* Markup strictement identique au compte à rebours du salon privé. */
    overlay.innerHTML = `
      <div class="lobby-start-countdown-card">
        <div class="lobby-countdown-rocket" aria-hidden="true">🚀</div>
        <h2>La partie commence dans</h2>

        <div class="lobby-countdown-ring" aria-hidden="true">
          <div class="lobby-countdown-ring-track"></div>
          <div class="lobby-countdown-ring-glow"></div>
          <strong id="lobbyCountdownNumber">3</strong>
          <i class="spark s1"></i>
          <i class="spark s2"></i>
          <i class="spark s3"></i>
          <i class="spark s4"></i>
        </div>

        <p>Préparez-vous !</p>
      </div>
    `;

    document.body.appendChild(overlay);
    return overlay;
  }

  function startQuickLobbyCountdown(deadline) {
    const safeDeadline = Number(deadline || 0);
    if (!safeDeadline) return;

    if (
      quickCountdownDeadline === safeDeadline &&
      document.getElementById("lobbyStartCountdown")
    ) {
      return;
    }

    clearQuickLobbyCountdown();
    quickCountdownDeadline = safeDeadline;

    const overlay = ensureQuickLobbyCountdownOverlay();
    const number =
      overlay.querySelector("#lobbyCountdownNumber");
    const card =
      overlay.querySelector(".lobby-start-countdown-card");
    const ring =
      overlay.querySelector(".lobby-countdown-ring");

    /* Même son que dans le salon privé. */
    try {
      quickCountdownAudio =
        new Audio("/ptitbac-countdown-neon.wav");
      quickCountdownAudio.preload = "auto";
      quickCountdownAudio.volume = 0.78;
      quickCountdownAudio.currentTime = 0;

      const playPromise = quickCountdownAudio.play();
      if (playPromise?.catch) {
        playPromise.catch(() => {});
      }
    } catch {}

    const update = () => {
      const remaining =
        quickCountdownDeadline - quickCountdownNow();

      let nextValue = "3";

      if (remaining > 2200) nextValue = "3";
      else if (remaining > 1200) nextValue = "2";
      else if (remaining > 250) nextValue = "1";
      else nextValue = "!";

      if (
        number &&
        nextValue !== quickCountdownLastValue
      ) {
        number.textContent = nextValue;
        quickCountdownLastValue = nextValue;

        ring?.classList.remove("pulse");
        void ring?.offsetWidth;
        ring?.classList.add("pulse");
      }

      if (nextValue === "!") {
        card?.classList.add("is-go");
      }

      if (remaining < -350) {
        clearQuickLobbyCountdown();
      }
    };

    update();
    quickCountdownTimer = setInterval(update, 70);
  }

  function handleQuickReadyCountdown(payload = {}) {
    let state = null;

    try {
      state = session?.state || null;
    } catch {}

    if (
      !state ||
      state.mode !== "quick" ||
      state.phase !== "lobby"
    ) {
      clearQuickLobbyCountdown();
      return;
    }

    if (
      payload.starting === true &&
      Number(payload.deadline || 0) > 0
    ) {
      startQuickLobbyCountdown(payload.deadline);
      return;
    }

    /* Un joueur annule "Prêt", quitte, ou le lancement est annulé. */
    clearQuickLobbyCountdown();
  }

  function startQuickCountdownRuntime() {
    try {
      socket?.on?.(
        "quick:ready-state",
        handleQuickReadyCountdown
      );

      socket?.on?.("quick:error", () => {
        clearQuickLobbyCountdown();
      });

      socket?.on?.("room:state", state => {
        if (
          state?.mode !== "quick" ||
          state?.phase !== "lobby"
        ) {
          clearQuickLobbyCountdown();
        }
      });
    } catch {}
  }

  function start() {
    startQuickCountdownRuntime();
    document.addEventListener(
      "ptitbac:screen-rendered",
      scheduleEnhance
    );

    document.addEventListener(
      "ptitbac:dom-updated",
      scheduleEnhance
    );

    try {
      socket?.on?.("room:state", scheduleEnhance);

      socket?.on?.(
        "wallet:update",
        scheduleEnhance
      );
    } catch {}

    scheduleEnhance();
  }

  if (document.readyState === "loading") {
    document.addEventListener(
      "DOMContentLoaded",
      start,
      { once:true }
    );
  } else {
    start();
  }
})();

/* ==== ui-runtime-v1.js ==== */
(() => {
  "use strict";

  const adminState = {
    admin: false,
    infiniteCoins: false,
    infiniteLives: false
  };

  function walletToken() {
    return String(
      window.session?.walletToken ||
      localStorage.getItem("petitbac_walletToken") ||
      ""
    ).trim();
  }

  function applyAdminClasses() {
    const root = document.documentElement;

    root.classList.toggle(
      "ptb-admin-infinite-coins",
      !!adminState.admin && !!adminState.infiniteCoins
    );

    root.classList.toggle(
      "ptb-admin-infinite-lives",
      !!adminState.admin && !!adminState.infiniteLives
    );
  }

  function refreshAdminState() {
    if (
      document.hidden ||
      typeof socket === "undefined" ||
      !socket?.connected
    ) {
      return;
    }

    const token = walletToken();

    if (!token) {
      adminState.admin = false;
      adminState.infiniteCoins = false;
      adminState.infiniteLives = false;
      window.PtitBacAdminDisplayState = { ...adminState };
      applyAdminClasses();
      return;
    }

    socket.emit("admin:status", { walletToken: token }, res => {
      if (!res?.ok || !res.admin) {
        adminState.admin = false;
        adminState.infiniteCoins = false;
        adminState.infiniteLives = false;
      } else {
        adminState.admin = true;
        adminState.infiniteCoins = !!res.infiniteCoins;
        adminState.infiniteLives = !!res.infiniteLives;
      }

      window.PtitBacAdminDisplayState = { ...adminState };
      applyAdminClasses();
    });
  }

  /* =========================================================
     Salon privé V3 — transformation du lobby actuel.
     Aucun nouveau fichier de jeu : tout reste dans le runtime existant.
     ========================================================= */

  const privateLobbyV3State = {
    busy: false,
    decorating: false
  };

  const quickLobbyV3State = {
    ready:false,
    starting:false,
    deadline:0,
    players:new Map()
  };


  const roomChatState = {
    open: false,
    roomCode: "",
    messages: [],
    unread: 0,
    loading: false,
    sending: false,
    pendingNew: 0,
    nearBottom: true
  };


  const roomVoiceState = {
    joined: false,
    joining: false,
    roomCode: "",
    micEnabled: false,
    deafened: false,
    stream: null,
    peers: new Map(),
    audios: new Map(),
    meters: new Map(),
    audioContext: null,
    meterTimer: null
  };


  const micSvg = `
    <svg class="pl-v3-comms-svg" viewBox="0 0 24 24" aria-hidden="true">
      <rect x="9" y="3" width="6" height="11" rx="3"></rect>
      <path d="M6.5 11.5a5.5 5.5 0 0 0 11 0M12 17v4M9 21h6"></path>
    </svg>
  `;

  const headphonesSvg = `
    <svg viewBox="0 0 24 24" aria-hidden="true">
      <path d="M4 13v-2a8 8 0 0 1 16 0v2"></path>
      <path d="M4 13h3v7H5a1 1 0 0 1-1-1v-6ZM20 13h-3v7h2a1 1 0 0 0 1-1v-6Z"></path>
    </svg>
  `;

  const settingsSvg = `
    <svg viewBox="0 0 24 24" aria-hidden="true">
      <circle cx="12" cy="12" r="3"></circle>
      <path d="M19 12a7.7 7.7 0 0 0-.1-1l2-1.5-2-3.4-2.4 1a8 8 0 0 0-1.8-1L14.4 3h-4.8l-.4 3.1a8 8 0 0 0-1.8 1l-2.4-1-2 3.4L5 11a7.7 7.7 0 0 0 0 2l-2 1.5 2 3.4 2.4-1a8 8 0 0 0 1.8 1l.4 3.1h4.8l.4-3.1a8 8 0 0 0 1.8-1l2.4 1 2-3.4-2-1.5a7.7 7.7 0 0 0 .1-1Z"></path>
    </svg>
  `;

  const chatSvg = `
    <svg viewBox="0 0 24 24" aria-hidden="true">
      <path d="M5 5.5h14a2 2 0 0 1 2 2v7a2 2 0 0 1-2 2h-8l-4.5 3v-3H5a2 2 0 0 1-2-2v-7a2 2 0 0 1 2-2Z"></path>
      <circle cx="8" cy="11" r=".8"></circle>
      <circle cx="12" cy="11" r=".8"></circle>
      <circle cx="16" cy="11" r=".8"></circle>
    </svg>
  `;

  function currentLobbyState() {
    try {
      return typeof session !== "undefined" ? session?.state : null;
    } catch {
      return null;
    }
  }

  /* =========================================================
     RECOVERY — ne pas restaurer un ancien lobby au démarrage
     ========================================================= */

  const ptbBootStoredRoom = {
    code: String(localStorage.getItem("petitbac_code") || "").trim(),
    playerId: String(localStorage.getItem("petitbac_playerId") || "").trim()
  };

  let ptbBootLobbyRecoveryDone = false;

  function ptbRecoverFromStoredLobby() {
    if (
      ptbBootLobbyRecoveryDone ||
      !ptbBootStoredRoom.code ||
      !ptbBootStoredRoom.playerId
    ) {
      return;
    }

    let state = null;
    let activeCode = "";
    let activePlayerId = "";

    try {
      state = typeof session !== "undefined" ? session?.state : null;
      activeCode = String(session?.code || "").trim();
      activePlayerId = String(session?.playerId || "").trim();
    } catch {}

    if (
      !state ||
      String(state.code || "").trim() !== ptbBootStoredRoom.code ||
      state.phase !== "lobby"
    ) {
      return;
    }

    ptbBootLobbyRecoveryDone = true;

    const code = activeCode || ptbBootStoredRoom.code;
    const playerId = activePlayerId || ptbBootStoredRoom.playerId;

    /* On efface d'abord la session locale pour empêcher tout nouveau rendu
       automatique de ce lobby. */
    try {
      if (typeof clearSession === "function") {
        clearSession();
      } else {
        localStorage.removeItem("petitbac_code");
        localStorage.removeItem("petitbac_playerId");
        if (typeof session !== "undefined") {
          session.code = "";
          session.playerId = "";
          session.state = null;
        }
      }
    } catch {}

    try {
      if (typeof renderHome === "function") renderHome();
    } catch {}

    /* Le serveur est prévenu en arrière-plan. Une coupure réseau ne doit
       jamais empêcher le retour à l'accueil. */
    try {
      if (
        typeof socket !== "undefined" &&
        socket?.connected &&
        code &&
        playerId
      ) {
        socket.timeout(2500).emit(
          "room:leave",
          { code, playerId },
          () => {}
        );
      }
    } catch {}
  }

  /* app.js reçoit room:state avant ce runtime. On repasse juste après lui
     pour nettoyer uniquement le lobby restauré au chargement. */
  try {
    if (typeof socket !== "undefined") {
      socket.on("room:state", () => {
        queueMicrotask(ptbRecoverFromStoredLobby);
      });
    }
  } catch {}

  queueMicrotask(ptbRecoverFromStoredLobby);
  setTimeout(ptbRecoverFromStoredLobby, 250);
  setTimeout(ptbRecoverFromStoredLobby, 900);

  function currentLobbyUser() {
    try {
      return typeof me === "function" ? me() : null;
    } catch {
      return null;
    }
  }

  function privateLobbyToast(message) {
    try {
      if (typeof toast === "function") {
        toast(message);
        return;
      }
    } catch {}
    console.info("[Salon privé]", message);
  }


  let privateLobbyLeaving = false;

  function finishPrivateLobbyLeave() {
    try {
      if (typeof clearSession === "function") {
        clearSession();
      } else {
        localStorage.removeItem("petitbac_code");
        localStorage.removeItem("petitbac_playerId");
        if (typeof session !== "undefined") {
          session.code = "";
          session.playerId = "";
          session.state = null;
        }
      }
    } catch {}

    try {
      if (typeof renderHome === "function") {
        renderHome();
      } else {
        window.location.assign("/");
      }
    } catch {
      window.location.assign("/");
    }

    try {
      if (typeof initWallet === "function") {
        initWallet(() => {});
      }
    } catch {}
  }

  function leavePrivateLobbyFromHeader(button) {
    if (privateLobbyLeaving) return;
    privateLobbyLeaving = true;

    button.disabled = true;

    const state = currentLobbyState();
    const code = String(state?.code || session?.code || "").trim();
    const playerId = String(session?.playerId || "").trim();

    /* Retour accueil immédiat. Le réseau ne contrôle plus l'interface. */
    finishPrivateLobbyLeave();
    privateLobbyLeaving = false;

    try {
      if (
        typeof socket === "undefined" ||
        !socket?.connected ||
        !code ||
        !playerId
      ) {
        return;
      }

      socket.timeout(2500).emit(
        "room:leave",
        { code, playerId },
        () => {}
      );
    } catch {}
  }

  document.addEventListener("click", event => {
    const button = event.target.closest?.(
      'main.pl-private-v3:is([data-mode="private"],[data-mode="public"],.pl-quick-v3) #lobbyV5Leave'
    );

    if (!button) return;

    event.preventDefault();
    event.stopPropagation();
    event.stopImmediatePropagation();

    leavePrivateLobbyFromHeader(button);
  }, true);

  function settingMeta(state) {
    const difficulty =
      state?.categoryDifficulty === "hard" ? "Difficile" :
      state?.categoryDifficulty === "medium" ? "Moyen" :
      "Facile";

    if (state?.gameType === "bombe") return [
      { key: "rounds", label: "Manches", value: String(state.rounds || 1), icon: "/lightning.png" },
      { key: "bombLives", label: "Vies", value: String(state.bombLives || 3), icon: "/lobby-categories.png" },
      { key: "bombSpeed", label: "Bombe", value: ({ fast: "Rapide", medium: "Moyen", slow: "Lent" })[state.bombSpeed] || "Moyen", icon: "/lobby-clock.png" },
      { key: "categoryDifficulty", label: "Difficulté", value: difficulty, icon: "/difficulty.png", difficulty: true }
    ];

    return [
      {
        key: "rounds",
        label: "Manches",
        value: String(Number(state?.rounds || 1)),
        icon: "/lightning.png"
      },
      {
        key: "categoryCount",
        label: "Catégories",
        value: String(Number(state?.categoryCount || state?.categories?.length || 6)),
        icon: "/lobby-categories.png"
      },
      {
        key: "duration",
        label: "Temps",
        value: `${Number(state?.duration || 60)}s`,
        icon: "/lobby-clock.png"
      },
      {
        key: "categoryDifficulty",
        label: "Difficulté",
        value: difficulty,
        icon: "/difficulty.png",
        difficulty: true
      }
    ];
  }

  function buildSettingRow(item, hostCanEdit, staticArrows = false) {
    const card = document.createElement("article");
    card.className =
      "pl-v3-setting-card" + (item.difficulty ? " is-difficulty" : "");

    const icon = document.createElement("img");
    icon.src = item.icon;
    icon.alt = "";

    const label = document.createElement("span");
    label.className = "pl-v3-setting-label";
    label.textContent = item.label;

    const showArrows = hostCanEdit || staticArrows;
    const stepper = document.createElement("div");
    stepper.className =
      "pl-v3-stepper" + (showArrows ? "" : " is-readonly");

    if (showArrows) {
      const previous = document.createElement("button");
      previous.type = "button";
      previous.innerHTML = '<span aria-hidden="true">‹</span>';

      if (hostCanEdit) {
        previous.dataset.v3SettingStep = item.key;
        previous.dataset.dir = "-1";
        previous.setAttribute(
          "aria-label",
          `Diminuer ${item.label}`
        );
      } else {
        previous.className = "is-static";
        previous.tabIndex = -1;
        previous.setAttribute("aria-hidden", "true");
      }

      stepper.appendChild(previous);
    }

    const value = document.createElement("strong");
    value.textContent = item.value;
    stepper.appendChild(value);

    if (showArrows) {
      const next = document.createElement("button");
      next.type = "button";
      next.innerHTML = '<span aria-hidden="true">›</span>';

      if (hostCanEdit) {
        next.dataset.v3SettingStep = item.key;
        next.dataset.dir = "1";
        next.setAttribute(
          "aria-label",
          `Augmenter ${item.label}`
        );
      } else {
        next.className = "is-static";
        next.tabIndex = -1;
        next.setAttribute("aria-hidden", "true");
      }

      stepper.appendChild(next);
    }

    card.append(icon, label, stepper);
    return card;
  }

  function buildCommsPanel() {
    const panel = document.createElement("aside");
    panel.className = "pl-v3-comms";
    panel.setAttribute("aria-label", "Communication du salon");

    panel.innerHTML = `
      <section class="pl-v3-voice">
        <div class="pl-v3-comms-head">
          ${micSvg}
          <div>
            <strong>Vocal</strong>
            <small class="pl-voice-status"><i aria-hidden="true"></i><span>Appuie pour rejoindre</span></small>
          </div>
          <span class="pl-v3-wave" aria-hidden="true">
            <i></i><i></i><i></i><i></i><i></i>
          </span>
        </div>

        <div class="pl-v3-voice-actions">
          <button id="plVoiceMic" type="button" aria-label="Micro">
            ${micSvg}
          </button>
          <button id="plVoiceHeadphones" type="button" aria-label="Casque">
            ${headphonesSvg}
          </button>
          <button id="plVoiceSettings" type="button" aria-label="Réglages vocaux">
            ${settingsSvg}
          </button>
        </div>
      </section>

      <button id="plRoomChatOpen" class="pl-v3-textchat" type="button">
        <span class="pl-v3-textchat-title">
          ${chatSvg}
          <strong>Chat</strong>
          <em class="pl-room-chat-badge" hidden>0</em>
          <b class="pl-v3-textchat-chevron" aria-hidden="true">›</b>
        </span>
      </button>
    `;

    return panel;
  }



  const ROOM_VOICE_RTC_CONFIG = {
    iceServers: [
      { urls: "stun:stun.l.google.com:19302" },
      { urls: "stun:stun1.l.google.com:19302" }
    ]
  };

  function roomVoicePayload(extra = {}) {
    const state = currentLobbyState();
    const user = currentLobbyUser();

    return {
      code: String(state?.code || session?.code || "").trim(),
      playerId: String(session?.playerId || "").trim(),
      name: String(user?.name || "Joueur").trim(),
      ...extra
    };
  }

  function roomVoicePlayerCard(playerId) {
    const root = document.querySelector(
      'main.pl-private-v3:is([data-mode="private"],[data-mode="public"],.pl-quick-v3)'
    );
    if (!root) return null;

    return [...root.querySelectorAll(".pl-player")].find(
      card => String(card.dataset.voicePlayerId || "") === String(playerId || "")
    ) || null;
  }

  function roomVoiceSetSpeaking(playerId, speaking) {
    const card = roomVoicePlayerCard(playerId);
    card?.classList.toggle("is-voice-speaking", !!speaking);

    if (
      String(playerId || "") === String(session?.playerId || "")
    ) {
      document.querySelector(".pl-v3-voice")
        ?.classList.toggle("is-speaking", !!speaking);
    }
  }

  function roomVoiceStopMeter(playerId) {
    const meter = roomVoiceState.meters.get(String(playerId || ""));
    if (!meter) return;

    try { meter.source?.disconnect?.(); } catch {}
    try { meter.analyser?.disconnect?.(); } catch {}

    roomVoiceState.meters.delete(String(playerId || ""));
    roomVoiceSetSpeaking(playerId, false);
  }

  async function roomVoiceAudioContext() {
    if (roomVoiceState.audioContext?.state !== "closed") {
      try {
        await roomVoiceState.audioContext?.resume?.();
      } catch {}
      return roomVoiceState.audioContext;
    }

    const AudioCtx = window.AudioContext || window.webkitAudioContext;
    if (!AudioCtx) return null;

    roomVoiceState.audioContext = new AudioCtx();
    try { await roomVoiceState.audioContext.resume(); } catch {}
    return roomVoiceState.audioContext;
  }

  async function roomVoiceStartMeter(playerId, stream) {
    roomVoiceStopMeter(playerId);

    if (!stream?.getAudioTracks?.().length) return;

    const context = await roomVoiceAudioContext();
    if (!context) return;

    try {
      const source = context.createMediaStreamSource(stream);
      const analyser = context.createAnalyser();
      analyser.fftSize = 256;
      analyser.smoothingTimeConstant = 0.65;
      source.connect(analyser);

      roomVoiceState.meters.set(String(playerId), {
        source,
        analyser,
        data: new Uint8Array(analyser.fftSize)
      });

      if (!roomVoiceState.meterTimer) {
        roomVoiceState.meterTimer = setInterval(() => {
          for (const [id, meter] of roomVoiceState.meters.entries()) {
            meter.analyser.getByteTimeDomainData(meter.data);

            let total = 0;
            for (let i = 0; i < meter.data.length; i++) {
              const value = (meter.data[i] - 128) / 128;
              total += value * value;
            }

            const rms = Math.sqrt(total / meter.data.length);
            const isSelf =
              String(id) === String(session?.playerId || "");
            const speaking =
              rms > 0.045 &&
              (!isSelf || roomVoiceState.micEnabled);

            roomVoiceSetSpeaking(id, speaking);
          }
        }, 120);
      }
    } catch {}
  }

  function updateRoomVoiceUi() {
    const voice = document.querySelector(".pl-v3-voice");
    const status = voice?.querySelector(".pl-voice-status span");
    const mic = document.getElementById("plVoiceMic");
    const headphones = document.getElementById("plVoiceHeadphones");

    voice?.classList.toggle("is-connected", roomVoiceState.joined);
    voice?.classList.toggle("is-joining", roomVoiceState.joining);
    voice?.classList.toggle("is-deafened", roomVoiceState.deafened);

    if (status) {
      if (roomVoiceState.joining) {
        status.textContent = "Connexion…";
      } else if (!roomVoiceState.joined) {
        status.textContent = "Appuie pour rejoindre";
      } else {
        const count = roomVoiceState.peers.size + 1;
        status.textContent = `${count} connecté${count > 1 ? "s" : ""}`;
      }
    }

    mic?.classList.toggle(
      "is-active",
      roomVoiceState.joined && roomVoiceState.micEnabled
    );
    mic?.classList.toggle(
      "is-muted",
      roomVoiceState.joined && !roomVoiceState.micEnabled
    );

    headphones?.classList.toggle(
      "is-active",
      roomVoiceState.joined && !roomVoiceState.deafened
    );
    headphones?.classList.toggle(
      "is-muted",
      roomVoiceState.joined && roomVoiceState.deafened
    );

    updateRoomVoiceSettingsUi();
  }

  function roomVoiceAudioElement(playerId) {
    const id = String(playerId || "");
    let audio = roomVoiceState.audios.get(id);

    if (!audio) {
      audio = document.createElement("audio");
      audio.autoplay = true;
      audio.playsInline = true;
      audio.dataset.voicePlayerId = id;
      audio.className = "pl-room-voice-audio";
      audio.style.display = "none";
      document.body.appendChild(audio);
      roomVoiceState.audios.set(id, audio);
    }

    audio.muted = roomVoiceState.deafened;
    return audio;
  }

  function roomVoiceRemovePeer(playerId) {
    const id = String(playerId || "");
    const peer = roomVoiceState.peers.get(id);

    if (peer) {
      try { peer.close(); } catch {}
      roomVoiceState.peers.delete(id);
    }

    roomVoiceStopMeter(id);

    const audio = roomVoiceState.audios.get(id);
    if (audio) {
      try { audio.pause(); } catch {}
      audio.srcObject = null;
      audio.remove();
      roomVoiceState.audios.delete(id);
    }

    updateRoomVoiceUi();
  }

  function roomVoiceSendSignal(targetPlayerId, signal) {
    if (!roomVoiceState.joined) return;

    socket.emit(
      "room:voice:signal",
      roomVoicePayload({
        targetPlayerId: String(targetPlayerId || ""),
        signal
      }),
      () => {}
    );
  }

  async function roomVoicePeer(playerId, createOffer = false) {
    const id = String(playerId || "");
    if (!id || id === String(session?.playerId || "")) return null;

    let peer = roomVoiceState.peers.get(id);
    if (peer) return peer;

    peer = new RTCPeerConnection(ROOM_VOICE_RTC_CONFIG);
    roomVoiceState.peers.set(id, peer);

    for (const track of roomVoiceState.stream?.getAudioTracks?.() || []) {
      peer.addTrack(track, roomVoiceState.stream);
    }

    peer.onicecandidate = event => {
      if (!event.candidate) return;
      roomVoiceSendSignal(id, {
        candidate: event.candidate.toJSON
          ? event.candidate.toJSON()
          : event.candidate
      });
    };

    peer.ontrack = async event => {
      const stream =
        event.streams?.[0] ||
        new MediaStream([event.track]);

      const audio = roomVoiceAudioElement(id);
      audio.srcObject = stream;
      audio.muted = roomVoiceState.deafened;

      try { await audio.play(); } catch {}

      roomVoiceStartMeter(id, stream);
    };

    peer.onconnectionstatechange = () => {
      if (["failed", "closed"].includes(peer.connectionState)) {
        roomVoiceRemovePeer(id);
      }
    };

    if (createOffer) {
      const offer = await peer.createOffer({
        offerToReceiveAudio: true
      });
      await peer.setLocalDescription(offer);
      roomVoiceSendSignal(id, {
        description: {
          type: peer.localDescription.type,
          sdp: peer.localDescription.sdp
        }
      });
    }

    updateRoomVoiceUi();
    return peer;
  }

  async function receiveRoomVoiceSignal(payload = {}) {
    if (!roomVoiceState.joined) return;

    const fromPlayerId = String(payload.fromPlayerId || "");
    const signal = payload.signal || {};
    if (!fromPlayerId) return;

    try {
      const peer = await roomVoicePeer(fromPlayerId, false);
      if (!peer) return;

      if (signal.description) {
        await peer.setRemoteDescription(
          new RTCSessionDescription(signal.description)
        );

        if (signal.description.type === "offer") {
          const answer = await peer.createAnswer();
          await peer.setLocalDescription(answer);
          roomVoiceSendSignal(fromPlayerId, {
            description: {
              type: peer.localDescription.type,
              sdp: peer.localDescription.sdp
            }
          });
        }
      } else if (signal.candidate) {
        await peer.addIceCandidate(
          new RTCIceCandidate(signal.candidate)
        );
      }
    } catch (error) {
      console.warn("[Vocal] signal:", error);
    }
  }

  async function joinRoomVoice() {
    if (roomVoiceState.joined || roomVoiceState.joining) return;

    const state = currentLobbyState();
    if (!state || !["private", "public", "quick"].includes(state.mode)) {
      return privateLobbyToast(
        "Le vocal est disponible dans les salons privé, public et Partie Rapide."
      );
    }

    if (
      !navigator.mediaDevices?.getUserMedia ||
      typeof RTCPeerConnection === "undefined"
    ) {
      return privateLobbyToast(
        "Le chat vocal n’est pas pris en charge sur cet appareil."
      );
    }

    roomVoiceState.joining = true;
    roomVoiceState.roomCode = String(state.code || "");
    updateRoomVoiceUi();

    try {
      const stream = await navigator.mediaDevices.getUserMedia({
        audio: {
          echoCancellation: true,
          noiseSuppression: true,
          autoGainControl: true
        },
        video: false
      });

      roomVoiceState.stream = stream;
      roomVoiceState.micEnabled = true;
      stream.getAudioTracks().forEach(track => {
        track.enabled = true;
      });

      await roomVoiceStartMeter(
        String(session?.playerId || ""),
        stream
      );
      await roomVoiceAudioContext();

      socket.emit("room:voice:join", roomVoicePayload(), async res => {
        roomVoiceState.joining = false;

        if (!res?.ok) {
          stream.getTracks().forEach(track => track.stop());
          roomVoiceState.stream = null;
          roomVoiceState.micEnabled = false;
          updateRoomVoiceUi();
          return privateLobbyToast(
            res?.error || "Impossible de rejoindre le vocal."
          );
        }

        roomVoiceState.joined = true;
        roomVoiceState.roomCode = String(res.roomCode || state.code || "");

        for (const remote of res.peers || []) {
          await roomVoicePeer(remote.playerId, true);
        }

        updateRoomVoiceUi();
      });
    } catch (error) {
      roomVoiceState.joining = false;
      roomVoiceState.stream = null;
      roomVoiceState.micEnabled = false;
      updateRoomVoiceUi();

      if (
        error?.name === "NotAllowedError" ||
        error?.name === "PermissionDeniedError"
      ) {
        return privateLobbyToast(
          "Autorise le micro pour utiliser le chat vocal."
        );
      }

      privateLobbyToast("Impossible d’activer le micro.");
    }
  }

  function toggleRoomVoiceMic() {
    if (!roomVoiceState.joined) {
      return joinRoomVoice();
    }

    roomVoiceState.micEnabled = !roomVoiceState.micEnabled;

    roomVoiceState.stream?.getAudioTracks?.().forEach(track => {
      track.enabled = roomVoiceState.micEnabled;
    });

    if (!roomVoiceState.micEnabled) {
      roomVoiceSetSpeaking(
        String(session?.playerId || ""),
        false
      );
    }

    updateRoomVoiceUi();
  }

  function toggleRoomVoiceHeadphones() {
    if (!roomVoiceState.joined) {
      return privateLobbyToast(
        "Rejoins d’abord le vocal avec le bouton micro."
      );
    }

    roomVoiceState.deafened = !roomVoiceState.deafened;

    for (const audio of roomVoiceState.audios.values()) {
      audio.muted = roomVoiceState.deafened;
    }

    updateRoomVoiceUi();
  }

  function leaveRoomVoice({ silent = false } = {}) {
    if (!roomVoiceState.joined && !roomVoiceState.joining) return;

    try {
      socket.emit("room:voice:leave", roomVoicePayload(), () => {});
    } catch {}

    for (const playerId of [...roomVoiceState.peers.keys()]) {
      roomVoiceRemovePeer(playerId);
    }

    roomVoiceState.stream?.getTracks?.().forEach(track => {
      try { track.stop(); } catch {}
    });

    roomVoiceStopMeter(String(session?.playerId || ""));

    if (roomVoiceState.meterTimer) {
      clearInterval(roomVoiceState.meterTimer);
      roomVoiceState.meterTimer = null;
    }

    try {
      roomVoiceState.audioContext?.close?.();
    } catch {}

    roomVoiceState.audioContext = null;
    roomVoiceState.stream = null;
    roomVoiceState.joined = false;
    roomVoiceState.joining = false;
    roomVoiceState.roomCode = "";
    roomVoiceState.micEnabled = false;
    roomVoiceState.deafened = false;

    document.querySelectorAll(".pl-player.is-voice-speaking")
      .forEach(card => card.classList.remove("is-voice-speaking"));

    closeRoomVoiceSettings();
    updateRoomVoiceUi();

    if (!silent) {
      privateLobbyToast("Tu as quitté le vocal.");
    }
  }

  function syncRoomVoiceContext() {
    const state = currentLobbyState();
    const voiceLobby =
      ["private", "public", "quick"].includes(state?.mode) &&
      state?.phase === "lobby" &&
      String(state?.code || "");

    if (
      roomVoiceState.joined &&
      (
        !voiceLobby ||
        String(state.code) !== String(roomVoiceState.roomCode)
      )
    ) {
      leaveRoomVoice({ silent: true });
      return;
    }

    updateRoomVoiceUi();
  }

  function ensureRoomVoiceSettings() {
    let overlay = document.getElementById("plRoomVoiceSettingsOverlay");
    if (overlay) return overlay;

    overlay = document.createElement("div");
    overlay.id = "plRoomVoiceSettingsOverlay";
    overlay.className = "pl-room-voice-settings-overlay";
    overlay.hidden = true;

    overlay.innerHTML = `
      <section class="pl-room-voice-settings" role="dialog" aria-modal="true" aria-label="Réglages vocaux">
        <header>
          <strong>Réglages vocaux</strong>
          <button id="plRoomVoiceSettingsClose" type="button" aria-label="Fermer">×</button>
        </header>
        <button id="plRoomVoiceSettingsMic" type="button">
          <span>Micro</span><b>—</b>
        </button>
        <button id="plRoomVoiceSettingsSound" type="button">
          <span>Son reçu</span><b>—</b>
        </button>
        <button id="plRoomVoiceSettingsLeave" class="danger" type="button">
          Quitter le vocal
        </button>
      </section>
    `;

    document.body.appendChild(overlay);

    overlay.addEventListener("click", event => {
      if (event.target === overlay) closeRoomVoiceSettings();
    });

    overlay.querySelector("#plRoomVoiceSettingsClose")
      ?.addEventListener("click", closeRoomVoiceSettings);

    overlay.querySelector("#plRoomVoiceSettingsMic")
      ?.addEventListener("click", toggleRoomVoiceMic);

    overlay.querySelector("#plRoomVoiceSettingsSound")
      ?.addEventListener("click", toggleRoomVoiceHeadphones);

    overlay.querySelector("#plRoomVoiceSettingsLeave")
      ?.addEventListener("click", () => leaveRoomVoice());

    return overlay;
  }

  function updateRoomVoiceSettingsUi() {
    const overlay = document.getElementById("plRoomVoiceSettingsOverlay");
    if (!overlay) return;

    const mic = overlay.querySelector("#plRoomVoiceSettingsMic b");
    const sound = overlay.querySelector("#plRoomVoiceSettingsSound b");
    const leave = overlay.querySelector("#plRoomVoiceSettingsLeave");

    if (mic) {
      mic.textContent = roomVoiceState.joined
        ? (roomVoiceState.micEnabled ? "Activé" : "Coupé")
        : "Hors ligne";
    }

    if (sound) {
      sound.textContent = roomVoiceState.joined
        ? (roomVoiceState.deafened ? "Coupé" : "Activé")
        : "Hors ligne";
    }

    if (leave) leave.disabled = !roomVoiceState.joined;
  }

  function openRoomVoiceSettings() {
    const overlay = ensureRoomVoiceSettings();
    overlay.hidden = false;
    document.getElementById("plVoiceSettings")
      ?.classList.add("is-active");
    updateRoomVoiceSettingsUi();
  }

  function closeRoomVoiceSettings() {
    const overlay = document.getElementById("plRoomVoiceSettingsOverlay");
    if (overlay) overlay.hidden = true;
    document.getElementById("plVoiceSettings")
      ?.classList.remove("is-active");
  }

  function receiveRoomVoicePeerJoined(payload = {}) {
    if (!roomVoiceState.joined) return;
    // Le nouveau joueur crée l'offre vers les participants déjà présents.
    updateRoomVoiceUi();
  }

  function receiveRoomVoicePeerLeft(payload = {}) {
    roomVoiceRemovePeer(payload.playerId);
  }

  function roomChatPayload(extra = {}) {
    const state = currentLobbyState();
    const user = currentLobbyUser();

    return {
      code: String(state?.code || session?.code || "").trim(),
      playerId: String(session?.playerId || "").trim(),
      name: String(user?.name || "Joueur").trim(),
      avatar: String(user?.avatar || "").trim(),
      ...extra
    };
  }

  function roomChatTime(value) {
    const date = new Date(value || Date.now());
    if (Number.isNaN(date.getTime())) return "";
    return date.toLocaleTimeString("fr-FR", {
      hour: "2-digit",
      minute: "2-digit"
    });
  }

  function roomChatIdentity(message) {
    const state = currentLobbyState();
    const player = state?.players?.find(
      item => String(item?.id || "") === String(message?.playerId || "")
    );

    return {
      name: String(player?.name || message?.name || "Joueur").slice(0, 24),
      avatar: String(player?.avatar || message?.avatar || "").trim()
    };
  }

  function roomChatAvatarElement(message) {
    const identity = roomChatIdentity(message);
    const avatar = identity.avatar;

    if (avatar.startsWith("/") && !avatar.startsWith("//")) {
      const image = document.createElement("img");
      image.src = avatar;
      image.alt = "";
      image.loading = "lazy";
      return image;
    }

    const span = document.createElement("span");
    span.textContent =
      avatar && avatar.length <= 6
        ? avatar
        : (identity.name.charAt(0).toUpperCase() || "?");
    return span;
  }

  function updateRoomChatBadge() {
    const badge = document.querySelector(
      "#plRoomChatOpen .pl-room-chat-badge"
    );
    if (!badge) return;

    const count = Math.max(0, Number(roomChatState.unread) || 0);
    badge.hidden = count <= 0;
    badge.textContent = count > 99 ? "99+" : String(count);
  }

  function roomChatNearBottom(list, threshold = 64) {
    if (!list) return true;
    return (
      list.scrollHeight -
      list.scrollTop -
      list.clientHeight
    ) <= threshold;
  }

  function resizeRoomChatInput(input) {
    if (!input) return;

    const minHeight = 38;
    const maxHeight = 74;

    input.style.height = "0px";
    const target = Math.max(
      minHeight,
      Math.min(maxHeight, input.scrollHeight)
    );
    input.style.height = `${target}px`;
    input.style.overflowY =
      input.scrollHeight > maxHeight ? "auto" : "hidden";
  }

  function syncRoomChatViewport() {
    const overlay = document.getElementById("plRoomChatOverlay");
    if (!overlay) return;

    const viewport = window.visualViewport;
    const height = Math.round(
      viewport?.height || window.innerHeight || 0
    );
    const top = Math.round(viewport?.offsetTop || 0);

    if (height > 0) {
      overlay.style.setProperty(
        "--pl-room-chat-viewport-height",
        `${height}px`
      );
    }
    overlay.style.setProperty(
      "--pl-room-chat-viewport-top",
      `${top}px`
    );
  }

  function updateRoomChatNewMessagesButton() {
    const button = document.getElementById(
      "plRoomChatNewMessages"
    );
    if (!button) return;

    const count = Math.max(
      0,
      Number(roomChatState.pendingNew) || 0
    );

    button.hidden = count <= 0;
    button.textContent =
      count <= 1
        ? "Nouveau message ↓"
        : `${count} nouveaux messages ↓`;
  }

  function scrollRoomChatToBottom(behavior = "auto") {
    const list = document.getElementById(
      "plRoomChatMessages"
    );
    if (!list) return;

    list.scrollTo({
      top: list.scrollHeight,
      behavior
    });

    roomChatState.nearBottom = true;
    roomChatState.pendingNew = 0;
    updateRoomChatNewMessagesButton();
  }

  function ensureRoomChatOverlay() {
    let overlay = document.getElementById("plRoomChatOverlay");
    if (overlay) return overlay;

    overlay = document.createElement("div");
    overlay.id = "plRoomChatOverlay";
    overlay.className = "pl-room-chat-overlay";
    overlay.hidden = true;
    overlay.setAttribute("aria-hidden", "true");

    overlay.innerHTML = `
      <section class="pl-room-chat-sheet" role="dialog" aria-modal="true" aria-label="Chat du salon">
        <header class="pl-room-chat-header">
          <div>
            <strong>Chat du salon</strong>
            <small id="plRoomChatSubtitle">Baccalauréat - Salon Privé</small>
          </div>
          <button id="plRoomChatClose" type="button" aria-label="Fermer">×</button>
        </header>

        <div id="plRoomChatMessages" class="pl-room-chat-messages" aria-live="polite"></div>

        <button id="plRoomChatNewMessages" class="pl-room-chat-new" type="button" hidden>
          Nouveaux messages
        </button>

        <form id="plRoomChatForm" class="pl-room-chat-form">
          <div class="pl-room-chat-input-wrap">
            <textarea
              id="plRoomChatInput"
              maxlength="200"
              rows="1"
              placeholder="Écrire un message…"
              autocomplete="off"
              enterkeyhint="send"
              aria-label="Écrire un message"
            ></textarea>
            <small id="plRoomChatCount">0/200</small>
          </div>
          <button id="plRoomChatSend" type="submit" aria-label="Envoyer">
            <span aria-hidden="true">➤</span>
          </button>
        </form>
      </section>
    `;

    document.body.appendChild(overlay);

    overlay.addEventListener("click", event => {
      if (event.target === overlay) closeRoomChat();
    });

    overlay.querySelector("#plRoomChatClose")?.addEventListener(
      "click",
      closeRoomChat
    );

    const input = overlay.querySelector("#plRoomChatInput");
    const counter = overlay.querySelector("#plRoomChatCount");
    const list = overlay.querySelector("#plRoomChatMessages");
    const newMessagesButton = overlay.querySelector(
      "#plRoomChatNewMessages"
    );

    input?.addEventListener("input", () => {
      if (counter) {
        counter.textContent = `${input.value.length}/200`;
      }
      resizeRoomChatInput(input);
    });

    input?.addEventListener("focus", () => {
      syncRoomChatViewport();
      setTimeout(() => {
        if (roomChatState.nearBottom) {
          scrollRoomChatToBottom("auto");
        }
      }, 80);
    });

    input?.addEventListener("keydown", event => {
      if (
        event.key === "Enter" &&
        !event.shiftKey &&
        !event.isComposing
      ) {
        event.preventDefault();
        overlay.querySelector("#plRoomChatForm")
          ?.requestSubmit?.();
      }
    });

    list?.addEventListener("scroll", () => {
      const nearBottom = roomChatNearBottom(list);
      roomChatState.nearBottom = nearBottom;

      if (nearBottom && roomChatState.pendingNew) {
        roomChatState.pendingNew = 0;
        updateRoomChatNewMessagesButton();
      }
    }, { passive: true });

    newMessagesButton?.addEventListener("click", () => {
      scrollRoomChatToBottom("smooth");
    });

    overlay.querySelector("#plRoomChatForm")?.addEventListener(
      "submit",
      event => {
        event.preventDefault();
        sendRoomChatMessage();
      }
    );

    if (!overlay.dataset.viewportBound) {
      overlay.dataset.viewportBound = "1";
      window.visualViewport?.addEventListener(
        "resize",
        syncRoomChatViewport
      );
      window.visualViewport?.addEventListener(
        "scroll",
        syncRoomChatViewport
      );
      window.addEventListener(
        "resize",
        syncRoomChatViewport
      );
    }

    resizeRoomChatInput(input);
    syncRoomChatViewport();

    return overlay;
  }

  function renderRoomChatMessages({
    forceBottom = false,
    preserveScroll = false
  } = {}) {
    const overlay = ensureRoomChatOverlay();
    const list = overlay.querySelector("#plRoomChatMessages");
    if (!list) return;

    const previousScrollTop = list.scrollTop;
    const wasNearBottom =
      forceBottom ||
      roomChatState.nearBottom ||
      roomChatNearBottom(list);

    list.replaceChildren();
    list.classList.remove("is-short");

    if (roomChatState.loading) {
      const loading = document.createElement("div");
      loading.className = "pl-room-chat-empty";
      loading.textContent = "Chargement…";
      list.appendChild(loading);
      return;
    }

    if (!roomChatState.messages.length) {
      const empty = document.createElement("div");
      empty.className = "pl-room-chat-empty";
      const strong = document.createElement("strong");
      strong.textContent = "Aucun message";
      const span = document.createElement("span");
      span.textContent =
        "Écris le premier message du salon.";
      empty.append(strong, span);
      list.appendChild(empty);
      return;
    }

    const fragment = document.createDocumentFragment();

    roomChatState.messages.forEach((message, index) => {
      const mine =
        String(message?.playerId || "") ===
        String(session?.playerId || "");
      const identity = roomChatIdentity(message);
      const previous = roomChatState.messages[index - 1];

      const samePreviousPlayer =
        !!previous &&
        String(previous?.playerId || "") ===
          String(message?.playerId || "");

      const previousTime = new Date(
        previous?.createdAt || 0
      ).getTime();
      const currentTime = new Date(
        message?.createdAt || 0
      ).getTime();

      const grouped =
        samePreviousPlayer &&
        Number.isFinite(previousTime) &&
        Number.isFinite(currentTime) &&
        currentTime - previousTime <= 2 * 60 * 1000;

      const row = document.createElement("article");
      row.className =
        "pl-room-chat-message " +
        (mine ? "is-mine" : "is-other") +
        (grouped ? " is-continuation" : "");

      const avatar = document.createElement("div");
      avatar.className = "pl-room-chat-avatar";
      avatar.appendChild(roomChatAvatarElement(message));

      const body = document.createElement("div");
      body.className = "pl-room-chat-message-body";

      if (!grouped) {
        const meta = document.createElement("div");
        meta.className = "pl-room-chat-meta";

        const author = document.createElement("strong");
        author.textContent = mine ? "Moi" : identity.name;

        const time = document.createElement("time");
        time.textContent = roomChatTime(
          message?.createdAt
        );

        meta.append(author, time);
        body.appendChild(meta);
      }

      const bubble = document.createElement("p");
      bubble.textContent = String(
        message?.content || ""
      );
      body.appendChild(bubble);

      if (mine) row.append(body, avatar);
      else row.append(avatar, body);

      fragment.appendChild(row);
    });

    list.appendChild(fragment);

    requestAnimationFrame(() => {
      list.classList.toggle(
        "is-short",
        list.scrollHeight <= list.clientHeight + 6
      );

      if (wasNearBottom) {
        list.scrollTop = list.scrollHeight;
        roomChatState.nearBottom = true;
        roomChatState.pendingNew = 0;
        updateRoomChatNewMessagesButton();
      } else if (preserveScroll) {
        list.scrollTop = previousScrollTop;
        roomChatState.nearBottom =
          roomChatNearBottom(list);
      }
    });
  }

  function syncRoomChatContext() {
    const state = currentLobbyState();
    const code = String(state?.code || "").trim();

    if (
      !state ||
      !["private", "public", "quick"].includes(state.mode) ||
      !code
    ) {
      if (roomChatState.open) closeRoomChat();
      roomChatState.roomCode = "";
      roomChatState.messages = [];
      roomChatState.unread = 0;
      updateRoomChatBadge();
      return;
    }

    if (roomChatState.roomCode !== code) {
      roomChatState.roomCode = code;
      roomChatState.messages = [];
      roomChatState.unread = 0;
      roomChatState.loading = false;
      roomChatState.sending = false;
      roomChatState.pendingNew = 0;
      roomChatState.nearBottom = true;
    }

    updateRoomChatBadge();
  }

  function openRoomChat() {
    const state = currentLobbyState();
    if (!state || !["private", "public", "quick"].includes(state.mode)) {
      return privateLobbyToast(
        "Le chat est disponible dans les salons privé, public et Partie Rapide."
      );
    }

    syncRoomChatContext();

    const overlay = ensureRoomChatOverlay();
    const subtitle = overlay.querySelector("#plRoomChatSubtitle");
    if (subtitle) {
      subtitle.textContent =
        state.gameType === "bombe"
          ? "Bombe - Salon Privé"
          : state.mode === "quick"
          ? "Baccalauréat - Partie Rapide"
          : state.mode === "public"
            ? "Baccalauréat - Salon Public"
            : "Baccalauréat - Salon Privé";
    }

    roomChatState.open = true;
    roomChatState.unread = 0;
    roomChatState.loading = true;
    updateRoomChatBadge();

    overlay.hidden = false;
    overlay.setAttribute("aria-hidden", "false");
    document.documentElement.classList.add("pl-room-chat-open");
    roomChatState.pendingNew = 0;
    roomChatState.nearBottom = true;
    updateRoomChatNewMessagesButton();
    syncRoomChatViewport();
    renderRoomChatMessages({ forceBottom: true });

    socket.emit("room:chat:history", roomChatPayload(), res => {
      roomChatState.loading = false;

      if (!res?.ok) {
        renderRoomChatMessages();
        return privateLobbyToast(res?.error || "Impossible de charger le chat.");
      }

      roomChatState.messages = Array.isArray(res.messages)
        ? res.messages.slice(-50)
        : [];
      renderRoomChatMessages({ forceBottom: true });

      setTimeout(() => {
        overlay.querySelector("#plRoomChatInput")?.focus?.({ preventScroll: true });
      }, 80);
    });
  }

  function closeRoomChat() {
    const overlay = document.getElementById("plRoomChatOverlay");
    roomChatState.open = false;
    roomChatState.pendingNew = 0;
    roomChatState.nearBottom = true;
    updateRoomChatNewMessagesButton();
    document.documentElement.classList.remove("pl-room-chat-open");

    if (!overlay) return;
    overlay.hidden = true;
    overlay.setAttribute("aria-hidden", "true");
  }

  function sendRoomChatMessage() {
    if (roomChatState.sending) return;

    const overlay = ensureRoomChatOverlay();
    const input = overlay.querySelector("#plRoomChatInput");
    const sendButton = overlay.querySelector("#plRoomChatSend");
    const counter = overlay.querySelector("#plRoomChatCount");
    const form = overlay.querySelector("#plRoomChatForm");
    const content = String(input?.value || "").trim();
    if (!content) return;

    roomChatState.sending = true;
    if (sendButton) sendButton.disabled = true;
    form?.classList.add("is-sending");

    socket.emit("room:chat:send", roomChatPayload({ content }), res => {
      roomChatState.sending = false;
      if (sendButton) sendButton.disabled = false;
      form?.classList.remove("is-sending");

      if (!res?.ok) {
        return privateLobbyToast(res?.error || "Impossible d’envoyer le message.");
      }

      if (input) {
        input.value = "";
        resizeRoomChatInput(input);
      }
      if (counter) counter.textContent = "0/200";
      roomChatState.nearBottom = true;
      scrollRoomChatToBottom("smooth");
      input?.focus?.({ preventScroll: true });
    });
  }

  function receiveRoomChatMessage(message) {
    const state = currentLobbyState();
    if (
      !state ||
      !["private", "public", "quick"].includes(state.mode) ||
      String(message?.roomCode || "") !== String(state.code || "")
    ) {
      return;
    }

    syncRoomChatContext();

    if (roomChatState.messages.some(existing => String(existing?.id || "") === String(message?.id || ""))) {
      return;
    }

    roomChatState.messages.push(message);
    if (roomChatState.messages.length > 50) {
      roomChatState.messages.splice(0, roomChatState.messages.length - 50);
    }

    if (roomChatState.open) {
      const list = document.getElementById(
        "plRoomChatMessages"
      );
      const nearBottom =
        roomChatNearBottom(list) ||
        String(message?.playerId || "") ===
          String(session?.playerId || "");

      roomChatState.nearBottom = nearBottom;

      if (!nearBottom) {
        roomChatState.pendingNew += 1;
        updateRoomChatNewMessagesButton();
      }

      renderRoomChatMessages({
        forceBottom: nearBottom,
        preserveScroll: !nearBottom
      });
    } else {
      roomChatState.unread += 1;
      updateRoomChatBadge();
    }
  }

  function ensurePublicMatchesPrivateStyles() {
    if (document.getElementById("ptbPublicMatchesPrivateV3Styles")) {
      return;
    }

    const style = document.createElement("style");
    style.id = "ptbPublicMatchesPrivateV3Styles";
    style.textContent = `
      /* =====================================================
         PUBLIC = PRIVÉ — seules les mentions Public/Privé changent
         ===================================================== */

      html body main.pl-private-v3.pl-public-mode[data-mode="public"]
        .pl-settings {
        border:1.5px solid #b94cff!important;
        border-radius:14px!important;
        background:
          radial-gradient(
            circle at 50% 0%,
            rgba(180,61,255,.10),
            transparent 56%
          ),
          linear-gradient(
            145deg,
            rgba(26,20,82,.96),
            rgba(11,22,68,.96)
          )!important;
        box-shadow:
          0 0 12px rgba(193,66,255,.28),
          inset 0 0 20px rgba(174,60,255,.10)!important;
      }

      /* Supprime les anciens coins décoratifs spécifiques au Public. */
      html body main.pl-private-v3.pl-public-mode[data-mode="public"]
        .pl-settings::before,
      html body main.pl-private-v3.pl-public-mode[data-mode="public"]
        .pl-settings::after {
        content:none!important;
        display:none!important;
      }

      html body main.pl-private-v3.pl-public-mode[data-mode="public"]
        .pl-setting-grid {
        gap:0!important;
      }

      html body main.pl-private-v3.pl-public-mode[data-mode="public"]
        .pl-setting-grid .lobby-v5-setting-card {
        position:relative!important;
        border:0!important;
        border-radius:0!important;
        background:transparent!important;
        box-shadow:none!important;
      }

      html body main.pl-private-v3.pl-public-mode[data-mode="public"]
        .pl-setting-grid .lobby-v5-setting-card:not(:last-child)::after {
        content:""!important;
        position:absolute!important;
        right:-1px!important;
        top:50%!important;
        width:2px!important;
        height:30px!important;
        min-height:30px!important;
        max-height:30px!important;
        border-radius:999px!important;
        background:#d35cff!important;
        box-shadow:
          0 0 4px #d35cff,
          0 0 9px rgba(196,66,255,.88),
          0 0 14px rgba(149,48,255,.50)!important;
        transform:translateY(-50%)!important;
        pointer-events:none!important;
      }

      html body main.pl-private-v3.pl-public-mode[data-mode="public"]
        .pl-settings h2 {
        color:#fff!important;
        text-shadow:none!important;
      }

      html body main.pl-private-v3.pl-public-mode[data-mode="public"]
        .pl-settings h2 > img,
      html body main.pl-private-v3.pl-public-mode[data-mode="public"]
        .pl-setting-grid .lobby-v5-setting-icon {
        filter:none!important;
      }

      html body main.pl-private-v3.pl-public-mode[data-mode="public"]
        .pl-setting-grid small {
        color:#adbbe1!important;
        text-shadow:none!important;
      }

      html body main.pl-private-v3.pl-public-mode[data-mode="public"]
        .pl-setting-grid strong {
        color:#fff!important;
        text-shadow:none!important;
      }

      html body main.pl-private-v3.pl-public-mode[data-mode="public"]
        .pl-setting-grid .is-difficulty strong {
        color:#63e8c9!important;
        text-shadow:none!important;
      }


      /* Le bandeau Public reprend exactement les mesures du Privé. */
      html body main.lobby-v5.pl-private.pl-private-v3.pl-public-mode[data-mode="public"] {
        padding-top:4px!important;
      }

      html body main.lobby-v5.pl-private.pl-private-v3.pl-public-mode[data-mode="public"]
        > .pl-header {
        position:relative!important;
        z-index:20!important;
        width:calc(100% + 24px)!important;
        min-height:48px!important;
        height:48px!important;
        margin:0 -12px!important;
        padding:0 12px!important;
        display:grid!important;
        grid-template-columns:42px minmax(0,1fr) auto!important;
        align-items:center!important;
        gap:6px!important;
        overflow:visible!important;
        background:linear-gradient(
          90deg,
          rgba(49,19,111,.98) 0%,
          rgba(32,24,119,.97) 42%,
          rgba(10,35,104,.96) 100%
        )!important;
        box-shadow:
          10px 0 0 rgba(10,35,104,.96),
          inset 0 0 18px rgba(107,83,255,.14)!important;
      }

      html body main.lobby-v5.pl-private.pl-private-v3.pl-public-mode[data-mode="public"]
        > .pl-header::before,
      html body main.lobby-v5.pl-private.pl-private-v3.pl-public-mode[data-mode="public"]
        > .pl-header::after {
        content:""!important;
        position:absolute!important;
        left:-10px!important;
        right:-10px!important;
        height:1px!important;
        background:rgba(195,58,255,.84)!important;
        box-shadow:0 0 12px rgba(210,54,255,.42)!important;
        pointer-events:none!important;
        z-index:7!important;
      }

      html body main.lobby-v5.pl-private.pl-private-v3.pl-public-mode[data-mode="public"]
        > .pl-header::before {
        top:0!important;
      }

      html body main.lobby-v5.pl-private.pl-private-v3.pl-public-mode[data-mode="public"]
        > .pl-header::after {
        bottom:0!important;
      }

      html body main.lobby-v5.pl-private.pl-private-v3.pl-public-mode[data-mode="public"]
        > .pl-header > #lobbyV5Leave {
        width:42px!important;
        min-width:42px!important;
        height:42px!important;
        padding:0!important;
        border:0!important;
        background:transparent!important;
        display:grid!important;
        place-items:center!important;
        justify-self:start!important;
      }

      html body main.lobby-v5.pl-private.pl-private-v3.pl-public-mode[data-mode="public"]
        > .pl-header > #lobbyV5Leave img {
        width:34px!important;
        min-width:34px!important;
        height:34px!important;
        object-fit:contain!important;
        filter:drop-shadow(0 0 7px rgba(188,76,255,.55))!important;
      }

      html body main.lobby-v5.pl-private.pl-private-v3.pl-public-mode[data-mode="public"]
        .pl-title-mode {
        min-width:0!important;
        display:flex!important;
        align-items:center!important;
        gap:6px!important;
        overflow:hidden!important;
      }



      html body main.lobby-v5.pl-private.pl-private-v3.pl-public-mode[data-mode="public"]
        .pl-mode-toggle {
        flex:none!important;
        min-width:54px!important;
        height:24px!important;
        padding:0 6px!important;
        gap:4px!important;
        border-color:#8d67df!important;
        background:rgba(21,22,71,.70)!important;
        color:#e3dcff!important;
        font-size:9px!important;
        box-shadow:0 0 8px rgba(168,79,255,.10)!important;
      }

      html body main.lobby-v5.pl-private.pl-private-v3.pl-public-mode[data-mode="public"]
        > .pl-header .pl-header-code {
        width:auto!important;
        min-width:62px!important;
        height:32px!important;
        padding:2px 7px!important;
        border:1px solid rgba(142,86,220,.78)!important;
        border-radius:10px!important;
        background:rgba(14,22,75,.68)!important;
        display:grid!important;
        grid-template-columns:auto 16px!important;
        gap:0 5px!important;
        text-align:left!important;
      }

      html body main.lobby-v5.pl-private.pl-private-v3.pl-public-mode[data-mode="public"]
        > .pl-header .pl-header-code small {
        font-size:8px!important;
        line-height:10px!important;
      }

      html body main.lobby-v5.pl-private.pl-private-v3.pl-public-mode[data-mode="public"]
        > .pl-header .pl-header-code strong {
        font-size:11px!important;
        line-height:13px!important;
      }

      html body main.lobby-v5.pl-private.pl-private-v3.pl-public-mode[data-mode="public"]
        > .pl-header .pl-header-code img {
        width:16px!important;
        min-width:16px!important;
        height:16px!important;
      }

      @media(max-width:370px) {
        html body main.lobby-v5.pl-private.pl-private-v3.pl-public-mode[data-mode="public"]
          > .pl-header {
          grid-template-columns:38px minmax(0,1fr) auto!important;
          gap:4px!important;
          padding-left:9px!important;
          padding-right:9px!important;
        }

        html body main.lobby-v5.pl-private.pl-private-v3.pl-public-mode[data-mode="public"]
          .pl-title-mode {
          gap:4px!important;
        }


        html body main.lobby-v5.pl-private.pl-private-v3.pl-public-mode[data-mode="public"]
          .pl-mode-toggle {
          min-width:48px!important;
          height:22px!important;
          padding:0 5px!important;
          font-size:8px!important;
        }

        html body main.lobby-v5.pl-private.pl-private-v3.pl-public-mode[data-mode="public"]
          > .pl-header .pl-header-code {
          min-width:55px!important;
          padding-left:5px!important;
          padding-right:5px!important;
        }
      }

      /* Le PNG du tag a exactement la même taille/rendu qu'en Privé. */
      html body main.pl-private-v3.pl-public-mode[data-mode="public"]
        .pl-player-title.private-tag-image {
        width:auto!important;
        max-width:100%!important;
        min-height:20px!important;
        height:20px!important;
        padding:0!important;
        border:0!important;
        border-radius:0!important;
        background:transparent!important;
        box-shadow:none!important;
        overflow:visible!important;
      }

      html body main.pl-private-v3.pl-public-mode[data-mode="public"]
        .pl-player-title.private-tag-image > img {
        display:block!important;
        width:auto!important;
        max-width:100%!important;
        height:20px!important;
        max-height:20px!important;
        margin:0!important;
        padding:0!important;
        border:0!important;
        object-fit:contain!important;
        object-position:left center!important;
      }

      html body main.pl-private-v3.pl-public-mode[data-mode="public"]
        .pl-profile-v2-title-row
        .pl-player-title.private-tag-image {
        min-height:25px!important;
        height:25px!important;
      }

      html body main.pl-private-v3.pl-public-mode[data-mode="public"]
        .pl-profile-v2-title-row
        .pl-player-title.private-tag-image > img {
        height:25px!important;
        max-height:25px!important;
      }

      @media(max-width:370px) {
        html body main.pl-private-v3.pl-public-mode[data-mode="public"]
          .pl-player-title.private-tag-image,
        html body main.pl-private-v3.pl-public-mode[data-mode="public"]
          .pl-player-title.private-tag-image > img {
          height:16px!important;
          min-height:16px!important;
          max-height:16px!important;
        }
      }
    `;

    document.head.appendChild(style);
  }

  const LOBBY_TAG_ASSETS = Object.freeze({
    tag_quantique: {
      name:"Tag Quantique",
      asset:"/tag-quantique.png"
    },
    tag_game_over: {
      name:"Game Over",
      asset:"/tag-game-over.png"
    }
  });

  function lobbyTagVisual(tagId) {
    const id = String(tagId || "").trim();
    if (!id) return null;

    let item = null;

    try {
      item = window.PtitBacInventory?.tags?.[id] || null;
    } catch {}

    item = item || LOBBY_TAG_ASSETS[id] || null;

    const asset = String(item?.asset || "").trim();
    if (!asset) return null;

    return {
      asset,
      name:String(item?.name || id).trim()
    };
  }

  function applyLobbyTagImage(target, tagId) {
    if (!target) return;

    const visual = lobbyTagVisual(tagId);
    if (!visual) return;

    if (
      target.dataset.privateTagAsset === visual.asset &&
      target.querySelector(":scope > img")
    ) {
      return;
    }

    const img = document.createElement("img");
    img.src = visual.asset;
    img.alt = visual.name;
    img.draggable = false;

    img.addEventListener("error", () => {
      if (!target.isConnected) return;

      target.classList.remove("private-tag-image");
      delete target.dataset.privateTagAsset;

      const strong = document.createElement("strong");
      strong.textContent = visual.name;
      target.replaceChildren(strong);
    }, { once:true });

    target.classList.add("private-tag-image");
    target.dataset.privateTagAsset = visual.asset;
    target.replaceChildren(img);
  }

  function syncLobbyTagImages(root) {
    if (!root) return;

    const players = currentLobbyState()?.players || [];
    const myId = String(session?.playerId || "");

    root
      .querySelectorAll(".pl-player-v2[data-lobby-player-profile]")
      .forEach(card => {
        const playerId = String(
          card.dataset.lobbyPlayerProfile || ""
        );

        const player = players.find(
          item => String(item?.id || "") === playerId
        );

        let tagId = String(player?.tagId || "").trim();

        if (!tagId && playerId === myId) {
          try {
            tagId = String(
              window.PtitBacInventory?.state?.()?.equipped?.tag || ""
            ).trim();
          } catch {}
        }

        if (!tagId) return;

        applyLobbyTagImage(
          card.querySelector(
            ".pl-player-title-row .pl-player-title"
          ),
          tagId
        );
      });

    const modalTarget = root.querySelector(
      ".pl-profile-v2-title-row .pl-player-title"
    );

    if (!modalTarget) return;

    const modalName = String(
      root.querySelector(
        ".pl-profile-v2-name-row > strong"
      )?.textContent || ""
    ).trim();

    const modalPlayer = players.find(
      item => String(item?.name || "").trim() === modalName
    );

    let modalTagId = String(modalPlayer?.tagId || "").trim();

    if (
      !modalTagId &&
      String(modalPlayer?.id || "") === myId
    ) {
      try {
        modalTagId = String(
          window.PtitBacInventory?.state?.()?.equipped?.tag || ""
        ).trim();
      } catch {}
    }

    if (modalTagId) {
      applyLobbyTagImage(modalTarget, modalTagId);
    }
  }

  function decoratePlayerCards(root) {
    const players = currentLobbyState()?.players || [];

    root.querySelectorAll(".pl-player").forEach((card, index) => {
      const playerId = String(players[index]?.id || "");
      if (playerId) card.dataset.voicePlayerId = playerId;

      const avatarShell = card.querySelector(".pl-avatar-shell");
      const titleRow = card.querySelector(".pl-player-title-row");
      const crown = titleRow?.querySelector(".pl-host-crown-inline");
      const quickMode = currentLobbyState()?.mode === "quick";

      if (quickMode) {
        crown?.remove();
        card.classList.remove("is-host");
      } else if (avatarShell && crown) {
        crown.classList.remove("pl-host-crown-inline");
        crown.classList.add("pl-host-crown-top");
        avatarShell.insertBefore(crown, avatarShell.firstChild);
      }
    });
  }

  function decoratePlayersHeader(root) {
    const players = root.querySelector(".pl-players");
    if (!players || players.querySelector(".pl-v3-players-bar")) return;

    const title = players.querySelector(":scope > h2");
    const actions = root.querySelector(":scope > .pl-actions > .pl-social");
    if (!title) return;

    const state = currentLobbyState();
    const count = Array.isArray(state?.players) ? state.players.length : 0;

    const bar = document.createElement("div");
    bar.className = "pl-v3-players-bar";

    title.innerHTML = `
      <img src="/friends.png" alt="">
      <span class="pl-v3-player-label">Joueurs</span>
      <span class="pl-v3-player-count">(${count}/${lobbyMaxPlayers(state)})</span>
    `;

    bar.appendChild(title);

    if (actions) {
      const inviteText = actions.querySelector(".pl-invite span");
      if (inviteText) inviteText.textContent = "Inviter des amis";

      const shareText = actions.querySelector(".pl-share span");
      if (shareText) shareText.remove();

      bar.appendChild(actions);
    }

    players.insertBefore(bar, players.firstChild);
  }

  function decorateSettings(root) {
    const settings = root.querySelector(":scope > .pl-settings");
    if (!settings) return;

    const state = currentLobbyState();
    const shortcut = settings.querySelector("#lobbySettingsShortcut");
    const quickMode =
      root.classList.contains("pl-quick-v3") ||
      root.dataset.lobbyKind === "quick" ||
      state?.mode === "quick";
    const hostCanEdit =
      !quickMode &&
      (
        !!shortcut ||
        currentLobbyUser()?.isHost === true
      );

    const items = settingMeta(state);

    // IMPORTANT : cleanupCurrentScreen() est aussi appelé par le
    // MutationObserver global. Ne jamais reconstruire la grille si son
    // contenu n'a pas réellement changé, sinon on crée une boucle :
    // mutation -> décoration -> mutation -> décoration...
    const signature = JSON.stringify({
      hostCanEdit,
      items: items.map(item => [
        item.key,
        item.value,
        item.difficulty === true
      ])
    });

    const grid = settings.querySelector(".pl-setting-grid");
    if (!grid) return;

    const heading = settings.querySelector(":scope > h2");
    if (
      heading &&
      heading.dataset.v3Decorated !== "1"
    ) {
      heading.innerHTML = `
        <img src="/settings.png" alt="">
        <span>Paramètres de la partie</span>
      `;
      heading.dataset.v3Decorated = "1";
    }

    shortcut?.remove();

    if (
      grid.dataset.v3SettingsSignature === signature &&
      grid.querySelector(".pl-v3-stepper")
    ) {
      return;
    }

    grid.dataset.v3SettingsSignature = signature;

    const fragment = document.createDocumentFragment();
    items.forEach(item => {
      fragment.appendChild(
        buildSettingRow(item, hostCanEdit, false)
      );
    });

    grid.replaceChildren(fragment);
  }

  function decorateBottom(root) {
    root.querySelector(".pl-launch-hint")?.remove();

    if (
      root.classList.contains("pl-quick-v3") ||
      root.dataset.lobbyKind === "quick"
    ) {
      root.querySelector("#startBtn")?.remove();
    }
  }

  function decoratePrivateLobbyV3() {
    if (privateLobbyV3State.decorating) return;

    const root = document.querySelector(
      'main.lobby-v5.pl-private[data-mode="private"], ' +
      'main.lobby-v5.pl-private.pl-public-mode[data-mode="public"], ' +
      'main.lobby-v5[data-mode="quick"], ' +
      'main.lobby-v5.pl-quick-v3'
    );

    if (!root) return;

    privateLobbyV3State.decorating = true;

    try {
      root.classList.add("pl-private-v3");
      ensurePublicMatchesPrivateStyles();

      const codeLabel = root.querySelector(".pl-header-code small");
      if (codeLabel) codeLabel.textContent = "Code salon";

      const liveMode =
        root.classList.contains("pl-quick-v3") ||
        root.dataset.lobbyKind === "quick"
          ? "quick"
          : root.classList.contains("pl-public-mode") ||
              root.dataset.lobbyKind === "public"
            ? "public"
            : currentLobbyState()?.mode || root.dataset.mode;

      const roomTitle = root.querySelector(".pl-title-mode > h1");
      if (roomTitle) {
        roomTitle.textContent =
          currentLobbyState()?.gameType === "bombe"
            ? "Bombe - Salon Privé"
            : liveMode === "quick"
            ? "Baccalauréat - Partie Rapide"
            : liveMode === "public"
              ? "Baccalauréat - Salon Public"
              : "Baccalauréat - Salon Privé";
      }

      if (liveMode === "quick") {
        root.querySelector("#plModeToggle")?.remove();
      }

      decorateSettings(root);

      if (!root.querySelector(":scope > .pl-v3-comms")) {
        const settings = root.querySelector(":scope > .pl-settings");
        settings?.insertAdjacentElement("afterend", buildCommsPanel());
      }

      decoratePlayersHeader(root);
      decoratePlayerCards(root);
      syncLobbyTagImages(root);
      decorateBottom(root);

      if (
        root.classList.contains("pl-quick-v3") ||
        root.dataset.lobbyKind === "quick" ||
        currentLobbyState()?.mode === "quick"
      ) {
        root
          .querySelectorAll(
            ".quick-search-panel, .quick-ready-bottom-panel"
          )
          .forEach(node => node.remove());

        root.classList.remove("quick-ready-bottom-active");
        root.querySelector("#startBtn")?.remove();
        syncQuickLobbyV3ReadyUi();
      }
    } finally {
      privateLobbyV3State.decorating = false;
    }
  }

  function cycleValue(values, current, direction) {
    let index = values.indexOf(current);
    if (index < 0) index = 0;
    return values[(index + direction + values.length) % values.length];
  }

  function updatePrivateLobbySetting(setting, direction) {
    if (privateLobbyV3State.busy) return;

    const root = document.querySelector(
      'main.lobby-v5.pl-private.pl-private-v3:is([data-mode="private"],[data-mode="public"],.pl-quick-v3)'
    );
    if (!root) return;

    const state = currentLobbyState();
    const user = currentLobbyUser();

    if (!state) return;

    if (state.mode === "quick") {
      return;
    }

    if (user?.isHost !== true) {
      return privateLobbyToast("Seul l’hôte peut modifier les paramètres.");
    }

    const rounds = [1, 3, 5];
    const categoryCounts = [6, 8, 10];
    const durations = [30, 60, 90];
    const difficulties = ["beginner", "medium", "hard"];

    let nextRounds = Number(state.rounds || 1);
    let nextCategoryCount = Number(
      state.categoryCount || state.categories?.length || 6
    );
    let nextDuration = Number(state.duration || 60);
    let nextDifficulty = state.categoryDifficulty || "medium";
    let nextBombLives = Number(state.bombLives || 3);
    let nextBombSpeed = state.bombSpeed || "medium";

    if (setting === "rounds") {
      nextRounds = cycleValue(rounds, nextRounds, direction);
    } else if (state.gameType === "bombe" && setting === "bombLives") {
      nextBombLives = cycleValue([1, 2, 3], nextBombLives, direction);
    } else if (state.gameType === "bombe" && setting === "bombSpeed") {
      nextBombSpeed = cycleValue(["fast", "medium", "slow"], nextBombSpeed, direction);
    } else if (setting === "categoryCount") {
      const normalized = categoryCounts.includes(nextCategoryCount)
        ? nextCategoryCount
        : 6;
      nextCategoryCount = cycleValue(
        categoryCounts,
        normalized,
        direction
      );
    } else if (setting === "duration") {
      const normalized = durations.includes(nextDuration)
        ? nextDuration
        : 60;
      nextDuration = cycleValue(durations, normalized, direction);
    } else if (setting === "categoryDifficulty") {
      nextDifficulty = cycleValue(
        difficulties,
        nextDifficulty,
        direction
      );
    } else {
      return;
    }

    privateLobbyV3State.busy = true;

    root.querySelectorAll("[data-v3-setting-step]").forEach(button => {
      button.disabled = true;
    });

    socket.emit(
      "room:updateSettings",
      {
        code: state.code,
        playerId: session.playerId,
        rounds: nextRounds,
        duration: nextDuration,
        categoryCount: nextCategoryCount,
        categoryDifficulty: nextDifficulty,
        bombLives: nextBombLives,
        bombSpeed: nextBombSpeed
      },
      res => {
        privateLobbyV3State.busy = false;

        if (!res?.ok) {
          root.querySelectorAll("[data-v3-setting-step]").forEach(button => {
            button.disabled = false;
          });
          return privateLobbyToast(
            res?.error || "Impossible de modifier ce paramètre."
          );
        }

        if (res.state) {
          session.state = res.state;
        }
      }
    );
  }

  document.addEventListener("click", async event => {
    const share = event.target.closest?.(
      'main.pl-quick-v3 #plShare'
    );
    if (!share) return;

    event.preventDefault();
    event.stopPropagation();

    const code = String(currentLobbyState()?.code || "").trim();
    if (!code) return;

    try {
      if (navigator.share) {
        await navigator.share({
          title:"P’tit Bac",
          text:`Rejoins ma Partie Rapide P’tit Bac avec le code ${code}`
        });
      } else {
        await navigator.clipboard.writeText(code);
        privateLobbyToast("Code copié !");
      }
    } catch (error) {
      if (error?.name !== "AbortError") {
        privateLobbyToast(`Code : ${code}`);
      }
    }
  }, true);

  document.addEventListener("click", event => {
    const settingButton = event.target.closest?.("[data-v3-setting-step]");

    if (settingButton) {
      event.preventDefault();
      event.stopPropagation();

      updatePrivateLobbySetting(
        settingButton.dataset.v3SettingStep,
        Number(settingButton.dataset.dir) || 1
      );

      return;
    }

    if (event.target.closest?.("#plVoiceMic")) {
      event.preventDefault();
      event.stopPropagation();
      toggleRoomVoiceMic();
      return;
    }

    if (event.target.closest?.("#plVoiceHeadphones")) {
      event.preventDefault();
      event.stopPropagation();
      toggleRoomVoiceHeadphones();
      return;
    }

    if (event.target.closest?.("#plVoiceSettings")) {
      event.preventDefault();
      event.stopPropagation();
      openRoomVoiceSettings();
      return;
    }

    if (event.target.closest?.("#plRoomChatOpen")) {
      event.preventDefault();
      event.stopPropagation();
      openRoomChat();
      return;
    }
  }, true);

  document.addEventListener("click", event => {
    const legacyTrigger = event.target.closest?.(
      "#homePlaqueCrown, #betaAdminTrigger"
    );

    if (!legacyTrigger) return;

    event.preventDefault();
    event.stopPropagation();
    event.stopImmediatePropagation();
  }, true);

  document.addEventListener("change", event => {
    if (!event.target.closest?.("#admCoins, #admLives")) return;
    setTimeout(refreshAdminState, 180);
  }, true);

  document.addEventListener("click", event => {
    if (!event.target.closest?.(
      "#adminActivationValidate, .admin-v1-crown-btn, #admValidate"
    )) return;

    setTimeout(refreshAdminState, 250);
  }, true);



  function syncQuickLobbyV3ReadyUi() {
    if (currentLobbyState()?.mode !== "quick") return;

    const root = document.querySelector(
      "main.lobby-v5.pl-quick-v3"
    );
    if (!root) return;

    const ready = root.querySelector("#plReady");
    if (ready) {
      ready.classList.toggle(
        "selected",
        quickLobbyV3State.ready
      );
      ready.setAttribute(
        "aria-pressed",
        quickLobbyV3State.ready ? "true" : "false"
      );
      ready.disabled = !!quickLobbyV3State.starting;
      ready.textContent =
        quickLobbyV3State.ready ? "Annuler" : "✓ Prêt";
    }

    const start = root.querySelector("#startBtn");
    if (start) {
      start.disabled = true;
      start.textContent =
        quickLobbyV3State.starting
          ? "▶ Lancement…"
          : "▶ Lancer la partie";
    }

    root
      .querySelectorAll(
        ".pl-player-v2[data-lobby-player-profile]"
      )
      .forEach(card => {
        const id = String(
          card.dataset.lobbyPlayerProfile || ""
        );

        const status = card.querySelector(".pl-card-status");
        if (!status) return;

        const playerState = quickLobbyV3State.players.get(id);
        if (!playerState) {
          status.lastChild &&
            (status.lastChild.textContent = " Pas prêt");
          return;
        }

        status.lastChild &&
          (status.lastChild.textContent =
            playerState.ready ? " Prêt" : " Pas prêt");
      });
  }

  document.addEventListener("click", event => {
    const button = event.target.closest?.(
      "main.pl-quick-v3 #plReady"
    );

    if (!button) return;

    event.preventDefault();
    event.stopPropagation();
    event.stopImmediatePropagation();

    if (button.disabled || quickLobbyV3State.starting) return;

    const next = !quickLobbyV3State.ready;
    button.disabled = true;

    socket.timeout(8000).emit(
      "quick:ready",
      { ready:next },
      (error, response) => {
        button.disabled = false;

        if (error || !response?.ok) {
          return privateLobbyToast(
            response?.error ||
            "Impossible de modifier ton état Prêt."
          );
        }

        quickLobbyV3State.ready = !!response.ready;
        quickLobbyV3State.starting = !!response.starting;
        quickLobbyV3State.deadline =
          Number(response.deadline || 0);

        syncQuickLobbyV3ReadyUi();
      }
    );
  }, true);

  try {
    socket?.on?.("quick:ready-state", payload => {
      if (currentLobbyState()?.mode !== "quick") return;

      quickLobbyV3State.starting = !!payload?.starting;
      quickLobbyV3State.deadline =
        Number(payload?.deadline || 0);

      quickLobbyV3State.players.clear();

      for (const item of payload?.players || []) {
        const id = String(item?.playerId || "");
        if (!id) continue;

        quickLobbyV3State.players.set(id, {
          ready:!!item?.ready
        });

        if (
          id === String(session?.playerId || "")
        ) {
          quickLobbyV3State.ready = !!item?.ready;
        }
      }

      syncQuickLobbyV3ReadyUi();
    });

    socket?.on?.("quick:matched", () => {
      quickLobbyV3State.ready = false;
      quickLobbyV3State.starting = false;
      quickLobbyV3State.deadline = 0;
      quickLobbyV3State.players.clear();
    });

    socket?.on?.("quick:error", () => {
      quickLobbyV3State.starting = false;
      syncQuickLobbyV3ReadyUi();
    });
  } catch {}

  function cleanupCurrentScreen() {
    const hud = document.getElementById("economyHud");
    const reports = document.querySelector(".admin-v1-page");

    if (hud) {
      if (reports) {
        hud.setAttribute("aria-hidden", "true");
      } else {
        hud.removeAttribute("aria-hidden");
      }
    }

    decoratePrivateLobbyV3();
    syncRoomChatContext();
    syncRoomVoiceContext();
  }

  document.addEventListener(
    "ptitbac:screen-rendered",
    cleanupCurrentScreen
  );
  document.addEventListener(
    "ptitbac:dom-updated",
    cleanupCurrentScreen
  );

  if (typeof socket !== "undefined") {
    socket.on("connect", () => setTimeout(refreshAdminState, 120));
    socket.on("room:chat:message", receiveRoomChatMessage);
    socket.on("room:voice:signal", receiveRoomVoiceSignal);
    socket.on("room:voice:peer-joined", receiveRoomVoicePeerJoined);
    socket.on("room:voice:peer-left", receiveRoomVoicePeerLeft);
    socket.on("disconnect", () => {
      if (roomVoiceState.joined || roomVoiceState.joining) {
        leaveRoomVoice({ silent: true });
      }
    });
  }

  window.addEventListener("online", () => setTimeout(refreshAdminState, 120));
  document.addEventListener("visibilitychange", () => {
    if (!document.hidden) setTimeout(refreshAdminState, 120);
  });

  document.addEventListener("keydown", event => {
    if (event.key !== "Escape") return;

    const voiceSettings = document.getElementById(
      "plRoomVoiceSettingsOverlay"
    );

    if (voiceSettings && !voiceSettings.hidden) {
      closeRoomVoiceSettings();
      return;
    }

    if (roomChatState.open) closeRoomChat();
  });

  setTimeout(refreshAdminState, 250);
  setInterval(refreshAdminState, 30000);

  cleanupCurrentScreen();

  window.PtitBacUiRuntime = Object.freeze({
    refreshAdminState,
    cleanupCurrentScreen,
    decoratePrivateLobbyV3,
    openRoomChat,
    closeRoomChat
  });
})();
