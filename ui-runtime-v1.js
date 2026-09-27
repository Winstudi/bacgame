(() => {
  "use strict";

  window.PtitBacVoiceGameBuild = "V2.1";

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

      document.getElementById("plGameVoiceHud")
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
    updateRoomVoiceGameHudUi();
  }

  function roomVoiceGameHudShouldShow() {
    const state = currentLobbyState();

    return !!(
      roomVoiceState.joined &&
      state &&
      ["private", "public", "quick"].includes(state.mode) &&
      String(state.code || "") === String(roomVoiceState.roomCode || "") &&
      state.phase &&
      state.phase !== "lobby"
    );
  }

  function ensureRoomVoiceGameHud() {
    let hud = document.getElementById("plGameVoiceHud");
    if (hud) return hud;

    hud = document.createElement("aside");
    hud.id = "plGameVoiceHud";
    hud.className = "pl-game-voice-hud";
    hud.hidden = true;
    hud.setAttribute("role", "group");
    hud.setAttribute("aria-label", "Contrôles du chat vocal");

    hud.innerHTML = `
      <span class="pl-game-voice-status" aria-label="Joueurs connectés au vocal">
        <i aria-hidden="true"></i>
        <b id="plGameVoiceCount">1</b>
      </span>

      <button
        id="plGameVoiceMic"
        type="button"
        aria-label="Couper le micro"
        title="Micro"
      >
        ${micSvg}
      </button>

      <button
        id="plGameVoiceHeadphones"
        type="button"
        aria-label="Couper le son reçu"
        title="Son reçu"
      >
        ${headphonesSvg}
      </button>

      <button
        id="plGameVoiceSettings"
        type="button"
        aria-label="Réglages vocaux"
        title="Réglages vocaux"
      >
        ${settingsSvg}
      </button>
    `;

    document.body.appendChild(hud);
    return hud;
  }

  function updateRoomVoiceGameHudUi() {
    const shouldShow = roomVoiceGameHudShouldShow();
    const existing = document.getElementById("plGameVoiceHud");
    const hud = shouldShow
      ? ensureRoomVoiceGameHud()
      : existing;

    if (!hud) return;

    hud.hidden = !shouldShow;
    if (!shouldShow) return;

    const count = roomVoiceState.peers.size + 1;
    const countNode = hud.querySelector("#plGameVoiceCount");
    const mic = hud.querySelector("#plGameVoiceMic");
    const headphones = hud.querySelector("#plGameVoiceHeadphones");
    const settings = hud.querySelector("#plGameVoiceSettings");

    if (countNode) {
      const nextCount = String(count);
      if (countNode.textContent !== nextCount) {
        countNode.textContent = nextCount;
      }
    }

    mic?.classList.toggle(
      "is-active",
      roomVoiceState.micEnabled
    );
    mic?.classList.toggle(
      "is-muted",
      !roomVoiceState.micEnabled
    );
    mic?.setAttribute(
      "aria-label",
      roomVoiceState.micEnabled
        ? "Couper le micro"
        : "Réactiver le micro"
    );

    headphones?.classList.toggle(
      "is-active",
      !roomVoiceState.deafened
    );
    headphones?.classList.toggle(
      "is-muted",
      roomVoiceState.deafened
    );
    headphones?.setAttribute(
      "aria-label",
      roomVoiceState.deafened
        ? "Réactiver le son reçu"
        : "Couper le son reçu"
    );

    const overlay = document.getElementById(
      "plRoomVoiceSettingsOverlay"
    );

    settings?.classList.toggle(
      "is-active",
      !!overlay && !overlay.hidden
    );
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

    const sameActiveRoom =
      !!state &&
      ["private", "public", "quick"].includes(state.mode) &&
      !!String(state.code || "") &&
      String(state.code || "") === String(roomVoiceState.roomCode || "");

    /*
      Le vocal appartient à la room, pas à l'écran lobby.
      Il reste donc actif pendant :
      catégories -> lettre -> réponses -> correction -> résultats -> fin.
      Il est fermé uniquement si le joueur quitte réellement cette room.
    */
    if (
      roomVoiceState.joined &&
      !sameActiveRoom
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

    document.getElementById("plGameVoiceSettings")
      ?.classList.add("is-active");

    updateRoomVoiceSettingsUi();
    updateRoomVoiceGameHudUi();
  }

  function closeRoomVoiceSettings() {
    const overlay = document.getElementById("plRoomVoiceSettingsOverlay");
    if (overlay) overlay.hidden = true;

    document.getElementById("plVoiceSettings")
      ?.classList.remove("is-active");

    document.getElementById("plGameVoiceSettings")
      ?.classList.remove("is-active");

    updateRoomVoiceGameHudUi();
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
            <small id="plRoomChatSubtitle">Salon privé</small>
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
        state.mode === "quick"
          ? "Partie rapide"
          : state.mode === "public"
            ? "Salon public"
            : "Salon privé";
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
        .pl-title-mode > h1 {
        flex:0 1 auto!important;
        min-width:0!important;
        margin:0!important;
        font-size:0!important;
        line-height:1!important;
        white-space:nowrap!important;
      }

      html body main.lobby-v5.pl-private.pl-private-v3.pl-public-mode[data-mode="public"]
        .pl-title-mode > h1::after {
        content:"Salon Public"!important;
        display:inline-block!important;
        color:#fff!important;
        font-size:1.12rem!important;
        line-height:1!important;
        font-weight:1000!important;
        letter-spacing:-.03em!important;
        white-space:nowrap!important;
        text-shadow:
          0 2px 0 #5d20b3,
          0 0 8px #eb52ff,
          0 0 15px rgba(129,71,255,.72)!important;
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
          .pl-title-mode > h1::after {
          font-size:.94rem!important;
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
      <span class="pl-v3-player-count">(${count}/6)</span>
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
    root.querySelector(".pl-test")?.remove();
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
          liveMode === "quick"
            ? "Partie Classique Rapide"
            : liveMode === "public"
              ? "Salon Public"
              : "Salon Privé";
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

    if (setting === "rounds") {
      nextRounds = cycleValue(rounds, nextRounds, direction);
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
        categoryDifficulty: nextDifficulty
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

    if (
      event.target.closest?.("#plVoiceMic") ||
      event.target.closest?.("#plGameVoiceMic")
    ) {
      event.preventDefault();
      event.stopPropagation();
      toggleRoomVoiceMic();
      return;
    }

    if (
      event.target.closest?.("#plVoiceHeadphones") ||
      event.target.closest?.("#plGameVoiceHeadphones")
    ) {
      event.preventDefault();
      event.stopPropagation();
      toggleRoomVoiceHeadphones();
      return;
    }

    if (
      event.target.closest?.("#plVoiceSettings") ||
      event.target.closest?.("#plGameVoiceSettings")
    ) {
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
