const CLIENT_BUILD = "1.48.0";
const socket = io({ auth: callback => callback({ sessionToken:localStorage.getItem("ptitbac_account_session") || "" }) });
const app = document.getElementById("app");
const toastEl = document.getElementById("toast");

const session = {
  code: localStorage.getItem("petitbac_code") || "",
  playerId: localStorage.getItem("petitbac_playerId") || "",
  state: null,
  localAnswers: {},
  timerHandle: null,
  walletToken: localStorage.getItem("petitbac_walletToken") || "",
  walletBalance: Number(localStorage.getItem("petitbac_walletBalance") || "0"),
  serverTimeOffsetMs: 0,
};


function getProfile() {
  return {
    name: localStorage.getItem("petitbac_profile_name") || "",
    icon: localStorage.getItem("petitbac_profile_icon") || "🐼"
  };
}

function saveProfile(name, icon) {
  localStorage.setItem("petitbac_profile_name", String(name || "").trim().slice(0, 24));
  localStorage.setItem("petitbac_profile_icon", icon || "🐼");
}

function getCoins() {
  return Math.max(0, Math.floor(Number(session.walletBalance) || 0));
}

function setWalletState(token, balance) {
  if (token) {
    session.walletToken = token;
    localStorage.setItem("petitbac_walletToken", token);
  }
  if (Number.isFinite(Number(balance))) {
    session.walletBalance = Math.max(0, Math.floor(Number(balance)));
    localStorage.setItem("petitbac_walletBalance", String(session.walletBalance));
  }
}

function initWallet(cb = () => {}) {
  socket.emit("wallet:init", { token: session.walletToken }, res => {
    if (!res?.ok) return cb(false);
    setWalletState(res.token, res.balance);
    document.dispatchEvent(new CustomEvent("ptitbac:wallet-ready", {
      detail: {
        walletToken: session.walletToken,
        balance: session.walletBalance
      }
    }));
    cb(true);
  });
}

function syncServerClock(state) {
  const serverNow = Number(state?.serverNow);
  if (!Number.isFinite(serverNow) || serverNow <= 0) return;
  session.serverTimeOffsetMs = serverNow - Date.now();
}

function serverNowMs() {
  return Date.now() + (Number(session.serverTimeOffsetMs) || 0);
}

function syncLocalAnswersFromState(state, { overwrite = false } = {}) {
  if (!state || state.phase !== "round") return;
  if (!state.myAnswers || typeof state.myAnswers !== "object") return;

  for (const category of state.categories || []) {
    const key = `${Number(state.roundIndex || 0)}:${category}`;
    if (
      !overwrite &&
      Object.prototype.hasOwnProperty.call(session.localAnswers, key)
    ) {
      continue;
    }
    session.localAnswers[key] = String(state.myAnswers[category] || "");
  }
}

function toast(message) {
  toastEl.textContent = message;
  toastEl.classList.add("show");
  clearTimeout(toastEl._t);
  toastEl._t = setTimeout(() => toastEl.classList.remove("show"), 2200);
}

socket.on("toast", toast);
socket.on("wallet:update", ({ balance } = {}) => {
  setWalletState(session.walletToken, balance);
  document.querySelectorAll(".bomb-header-coins strong").forEach(node => {
    node.textContent = String(getCoins());
  });
  const bombRerollButton = document.getElementById("bombRerollButton");
  if (bombRerollButton && bombRerollButton.dataset.pending !== "true") {
    bombRerollButton.disabled = getCoins() < Number(bombRerollButton.dataset.cost || 20);
  }
  if (!session.state) renderHome();
});
socket.on("room:kicked", () => {
  toast("Tu as été retiré du salon.");
  clearSession();
  renderHome();
});
socket.on("room:closed", payload => {
  if (payload?.reason !== "pre_game_cancelled") return;

  clearSession();

  const finish = () => {
    renderHome();
    toast(
      payload?.message ||
      "La partie a été annulée avant la première manche."
    );
  };

  if (typeof initWallet === "function") {
    initWallet(finish);
  } else {
    finish();
  }
});
socket.on("room:state", state => {
  const previous = session.state;
  syncServerClock(state);
  syncLocalAnswersFromState(state, {
    overwrite: previous?.phase !== "round"
  });
  session.state = state;
  if (state.phase === "bomb" && previous?.phase === "bomb" &&
      state.bomb?.status === "playing" && previous.bomb?.status === "playing" &&
      state.bomb?.cycle === previous.bomb?.cycle &&
      state.bomb?.turnVersion === previous.bomb?.turnVersion &&
      state.bomb?.checkingPlayerId === previous.bomb?.checkingPlayerId &&
      document.querySelector(".bomb-answer-input")) return;
  // Keep the actual input nodes (and the mobile keyboard) during peer updates.
  if (state.phase === "round" && previous?.phase === "round" &&
      state.code === previous.code && state.roundEndsAt === previous.roundEndsAt &&
      !me()?.submitted && document.querySelector(".asv1-input")) return;
  render();
});

function continueConnectedSession() {
  if (session.code && session.playerId && session.walletToken) {
    socket.emit("room:reconnect", { code: session.code, playerId: session.playerId, walletToken: session.walletToken }, res => {
      if (res?.ok) {
        setWalletState(session.walletToken, res.balance);
        syncServerClock(res.state);
        syncLocalAnswersFromState(res.state, { overwrite:true });
        session.state = res.state;
        render();
      } else {
        clearSession();
        renderHome();
      }
    });
    return;
  }

  if ((session.code || session.playerId) && !session.walletToken) {
    clearSession();
  }
  renderHome();
}

socket.on("connect", () => {
  const explicitGuest = localStorage.getItem("ptitbac_guest_mode") === "1";

  // Ne crée plus de portefeuille anonyme avant que le joueur ait choisi
  // « invité » ou qu'une identité existante soit connue. Un compte déjà
  // enregistré sera repris par account-v1.js, qui installera ensuite son
  // portefeuille permanent avant de reconnecter le socket.
  if (!session.walletToken && !explicitGuest) {
    continueConnectedSession();
    return;
  }

  initWallet(() => continueConnectedSession());
});

function saveSession(code, playerId) {
  session.code = code;
  session.playerId = playerId;
  localStorage.setItem("petitbac_code", code);
  localStorage.setItem("petitbac_playerId", playerId);
}

function clearSession() {
  clearInterval(session.timerHandle);
  session.timerHandle = null;
  stopBombAudio(true);
  session.code = "";
  session.playerId = "";
  session.state = null;
  session.localAnswers = {};
  localStorage.removeItem("petitbac_code");
  localStorage.removeItem("petitbac_playerId");
}

function me() {
  return session.state?.players.find(p => p.id === session.playerId);
}

function escapeHtml(value = "") {
  return String(value).replace(/[&<>"']/g, c => ({
    "&":"&amp;", "<":"&lt;", ">":"&gt;", '"':"&quot;", "'":"&#039;"
  }[c]));
}

const CATEGORY_ICONS = {
  "Prénom":"👤", "Animal":"🐾", "Lieu":"📍", "Métier":"💼", "Nourriture":"🍽️",
  "Marque":"🏷️", "Fruit / Légume":"🍏", "Objet":"🧊", "Sport":"🏆", "Mot":"🔤",
  "Vêtement":"👕", "Cadeau":"🎁", "Chose orange":"🟠", "Chose verte":"🟢",
  "Chose jaune":"🟡", "Cuisine":"🍳", "Maison":"🏠", "Salle de bain":"🚿",
  "Animal marin":"🐠", "Petit-déjeuner":"🥐", "Cinéma":"🎬", "Jeu vidéo":"🎮",
  "Personnage fictif":"🦸", "Dessert":"🍰", "Mobile":"📱",
  "Application / Réseau social":"📲", "Artiste / Chanteur":"🎤",
  "Chose dans une chambre":"🛏️", "Chose au supermarché":"🛒", "Vacances":"🧳",
  "Restaurant":"🍴", "Célébrité":"⭐", "Chose du frigo":"🧊",
  "Mot de 4 lettres":"🔡", "Chose qu’on achète sur Internet":"🛍️",
  "Chose qui fait peur":"😱", "Chose chère":"💰", "Chose à l’école":"🏫",
  "Plage":"🏖️", "Mode / Beauté":"💄", "Couleur":"🎨", "Ciel":"☁️", "Mythes":"🏛️"
};

function categoryIcon(category) {
  return CATEGORY_ICONS[category] || "✨";
}

function isImageAvatar(value) {
  return typeof value === "string" && /^data:image\/(?:png|jpeg|webp);base64,/i.test(value);
}

function avatarMarkup(player, index = 0, extra = "") {
    const raw = String(player?.avatar || "");
    const safeExtra = String(extra || "").replace(/[^a-zA-Z0-9 _-]/g, "");

    if (isImageAvatar(raw)) {
      return `
        <div class="avatar avatar-${index % 6} ptb-avatar-photo ${safeExtra}">
          <img src="${raw}" alt="" draggable="false">
        </div>`;
    }

    const fallback = raw || String(player?.name || "?").charAt(0).toUpperCase();
    return `
      <div class="avatar avatar-${index % 6} ${raw ? "avatar-emoji" : ""} ${safeExtra}">
        ${typeof escapeHtml === "function" ? escapeHtml(fallback) : fallback}
      </div>`;
  }

function updateGameViewport() {
  const viewport = window.visualViewport;
  if (viewport && viewport.scale !== 1) return; // Preserve pinch zoom.
  document.documentElement.style.setProperty("--game-height", (viewport?.height || window.innerHeight) + "px");
  document.documentElement.style.setProperty("--game-top", (viewport?.offsetTop || 0) + "px");
  window.requestAnimationFrame(() => {
    const input = document.activeElement;
    if (!input?.matches(".asv1-input")) return;
    const list = input.closest(".asv1-list");
    if (!list) return;
    const field = input.getBoundingClientRect(), area = list.getBoundingClientRect();
    if (field.bottom > area.bottom - 8) list.scrollTop += field.bottom - area.bottom + 8;
    else if (field.top < area.top + 8) list.scrollTop -= area.top - field.top + 8;
  });
}
window.visualViewport?.addEventListener("resize", updateGameViewport);
window.visualViewport?.addEventListener("scroll", updateGameViewport);
window.addEventListener("resize", updateGameViewport);

function setScreen(html) {
  const old = app.querySelector("main");
  const previousScreen = old?.className.replace(" flow-enter", "");
  const previousScroll = window.scrollY;
  const scrollers = [...app.querySelectorAll(".flow-content,.asv1-list,.cat-v2-grid,.wsv1-players,.pri-categories-panel")].map(el => [el.className, el.scrollTop]);
  app.innerHTML = html;
  const screen = app.querySelector("main");
  const gameplay = !!screen?.matches(".cat-v2,.pbw1-screen,.pri-screen,.asv1-screen,.wsv1-screen,.vsv1-screen,.ssv1-screen,.fsv1-screen");
  document.documentElement.classList.toggle("gameplay-flow", gameplay);
  updateGameViewport();
  if (gameplay) {
    screen.classList.add("flow-screen");
    screen.dataset.mode = session.state?.mode || "private";
    const footerImage = screen.querySelector("footer > img");
    if (footerImage) {
      footerImage.src = "/ptitbac.logo.png";
      footerImage.width = 44;
      footerImage.height = 36;
    }
    const scrollSelectors = screen.matches(".ssv1-screen")
      ? ".ssv1-board-shell,.ssv1-winner"
      : screen.matches(".fsv1-screen") ? ".fsv1-podium,.fsv1-ranking,.fsv1-stats,.fsv1-gain" : null;
    if (scrollSelectors) {
      const children = [...screen.querySelectorAll(scrollSelectors)];
      if (children.length) {
        const content = document.createElement("div");
        content.className = "flow-content";
        content.tabIndex = 0;
        content.setAttribute("aria-label", "Résultats de la partie");
        children[0].before(content);
        children.forEach(child => content.append(child));
      }
    }
    if (previousScreen !== screen.className) screen.classList.add("flow-enter");
  }
  window.scrollTo({ top: previousScreen === screen?.className.replace(" flow-enter", "") ? previousScroll : 0, behavior: "instant" });
  if (previousScreen === screen?.className.replace(" flow-enter", "")) {
    for (const [className, scrollTop] of scrollers) {
      const node = [...screen.querySelectorAll(".flow-content,.asv1-list,.cat-v2-grid,.wsv1-players,.pri-categories-panel")].find(el => el.className === className);
      if (node) node.scrollTop = scrollTop;
    }
  }

  // E4: signal unique après chaque rendu d'écran.
  queueMicrotask(() => {
    document.dispatchEvent(new CustomEvent("ptitbac:screen-rendered", {
      detail: {
        phase: session.state?.phase || "",
        mode: session.state?.mode || "",
        screenClass: screen?.className || ""
      }
    }));
  });
}

// E4: un seul MutationObserver partagé pour les composants qui ajoutent
// du DOM en dehors de setScreen() (amis, chat, dialogues, etc.).
let ptbDomUpdateScheduled = false;

function schedulePtbDomUpdated() {
  if (ptbDomUpdateScheduled) return;
  ptbDomUpdateScheduled = true;

  requestAnimationFrame(() => {
    ptbDomUpdateScheduled = false;
    document.dispatchEvent(new CustomEvent("ptitbac:dom-updated"));
  });
}

const ptbSharedDomObserver = new MutationObserver(records => {
  const hasAddedElement = records.some(record =>
    [...record.addedNodes].some(node => node.nodeType === Node.ELEMENT_NODE)
  );

  if (hasAddedElement) schedulePtbDomUpdated();
});

ptbSharedDomObserver.observe(document.documentElement, {
  childList: true,
  subtree: true
});


function homeCoin(sizeClass = "") {
  return `<span class="home-coin ${sizeClass}" aria-hidden="true"><svg viewBox="0 0 24 24"><circle cx="12" cy="12" r="9" fill="currentColor" opacity=".18"/><path d="M8.1 13.7h7.8M8.7 10.6l1.8 1.4 1.5-3 1.5 3 1.8-1.4-.8 5H9.5l-.8-5Z" fill="currentColor" stroke="currentColor" stroke-width=".7" stroke-linejoin="round"/></svg></span>`;
}

function renderHome() {
  setScreen('<main class="screen center-screen"><p role="status">Chargement…</p></main>');
}

function renderProfile() {
  return renderHome();
}

function renderShop() {
  return renderHome();
}

function render() {
  syncBombAudio(session.state);
  if (!session.state) return renderHome();
  clearInterval(session.timerHandle);
  session.timerHandle = null;

  if (session.state.gameType === "bombe") {
    if (session.state.phase === "bomb") return renderBombGame();
    if (session.state.phase === "finished") return renderBombResults();
  }

  switch (session.state.phase) {
    case "lobby": return renderLobby();
    case "category_selection": return renderCategorySelection();
    case "letter_selection": return renderLetterSelection();
    case "round": return me()?.submitted ? renderRoundWaiting() : renderRound();
    case "validation": return renderValidation();
    case "scoreboard": return renderScoreboard();
    case "finished": return renderFinished();
    default: return renderHome();
  }
}

function bombAvatarMarkup(player) {
  const avatar = String(player.avatar || "🐼");
  const markup = avatar.startsWith("/")
    ? `<img src="${escapeHtml(avatar)}" alt="">`
    : `<span>${escapeHtml(avatar)}</span>`;
  const frame = window.PtitBacFrames?.asset?.(player.frameId) || "";
  return markup + (frame
    ? `<img class="ptb-equipped-frame-overlay" src="${escapeHtml(frame)}" alt="" aria-hidden="true" draggable="false">`
    : "");
}

function bombResultAvatarMarkup(player) {
  const frameId = String(player.frameId || "");
  const frame = window.PtitBacFrames?.asset?.(frameId) || "";
  return `<span class="fin-avatar ${frame ? "ptb-has-equipped-frame" : ""}" ${frame ? `data-frame-id="${escapeHtml(frameId)}"` : ""}>${bombAvatarMarkup({...player, frameId:""})}${frame ? `<img class="ptb-equipped-frame-overlay" src="${escapeHtml(frame)}" alt="" aria-hidden="true" draggable="false">` : ""}</span>`;
}

function bombResultTagMarkup(player) {
  const tag = window.PtitBacInventory?.tags?.[String(player.tagId || "")];
  if (!tag) return "";
  const classes = `inv-tag bomb-result-tag ${escapeHtml(tag.className || "")}`;
  if (tag.asset) {
    return `<span class="${classes} inv-tag-image"><img src="${escapeHtml(tag.asset)}" alt="${escapeHtml(tag.name || "Tag")}" draggable="false"></span>`;
  }
  return `<span class="${classes}"><span aria-hidden="true">${escapeHtml(tag.icon || "")}</span><strong>${escapeHtml(tag.name || "")}</strong></span>`;
}

function bombLeave(confirmBeforeLeave = true) {
  if (confirmBeforeLeave && !window.confirm("Quitter la partie Bombe ?")) return;
  socket.emit("room:leave", { code:session.code, playerId:session.playerId }, response => {
    if (!response?.ok) return toast(response?.error || "Impossible de quitter la partie.");
    window.stopFinalVictoryEffects?.();
    clearSession();
    renderHome();
  });
}

// Keep the animation clock across room snapshots, which replace the screen DOM.
let bombTurnVisual = null;

// Sound is controlled from room state so DOM re-renders never restart the tracks.
const bombAudio = {
  tickling:null, explosion:null, snapshot:null, resumeTimer:null,
  lastExplosionKey:"", shouldPlayLoops:false, primed:false
};

function getBombAudio() {
  if (!bombAudio.tickling) {
    bombAudio.tickling = new Audio("/bomb-tickling.wav");
    bombAudio.explosion = new Audio("/bomb-explosion.wav");
    bombAudio.tickling.loop = true;
    bombAudio.tickling.preload = "auto";
    bombAudio.explosion.preload = "auto";
    bombAudio.tickling.volume = .32;
    bombAudio.explosion.volume = .8;
  }
  return bombAudio;
}

function startBombLoops() {
  const audio = getBombAudio();
  bombAudio.shouldPlayLoops = true;
  if (!audio.tickling.paused) return;
  const playback = audio.tickling.play();
  playback?.catch?.(() => {});
}

function pauseBombLoops(reset = true) {
  const track = bombAudio.tickling;
  if (track) {
    track.pause();
    if (reset) try { track.currentTime = 0; } catch {}
  }
  bombAudio.shouldPlayLoops = false;
}

function stopBombAudio(resetSnapshot = false) {
  clearTimeout(bombAudio.resumeTimer);
  bombAudio.resumeTimer = null;
  pauseBombLoops();
  if (bombAudio.explosion) {
    bombAudio.explosion.pause();
    try { bombAudio.explosion.currentTime = 0; } catch {}
  }
  if (resetSnapshot) {
    bombAudio.snapshot = null;
    bombAudio.lastExplosionKey = "";
  }
}

function primeBombAudioFromGesture() {
  if (bombAudio.primed) return;
  bombAudio.primed = true;
  const audio = getBombAudio();
  const tracks = [audio.tickling, audio.explosion];
  Promise.allSettled(tracks.map(track => {
    if (!track.paused) return Promise.resolve();
    track.muted = true;
    const playback = track.play();
    if (!playback?.then) {
      track.pause();
      track.muted = false;
      return Promise.resolve();
    }
    return playback.then(() => {
      track.pause();
      try { track.currentTime = 0; } catch {}
      track.muted = false;
    }).catch(() => { track.muted = false; });
  })).then(() => {
    if (bombAudio.shouldPlayLoops) startBombLoops();
  });
}

document.addEventListener("pointerdown", primeBombAudioFromGesture, { capture:true });
document.addEventListener("keydown", primeBombAudioFromGesture, { capture:true });

function syncBombAudio(state) {
  const bomb = state?.gameType === "bombe" && state.phase === "bomb" ? state.bomb : null;
  const previous = bombAudio.snapshot;
  const next = bomb ? {
    code:state.code, round:bomb.round, cycle:bomb.cycle,
    turnPlayerId:bomb.turnPlayerId, turnVersion:bomb.turnVersion,
    status:bomb.status, explosionAt:bomb.lastExplosion?.at || null
  } : null;
  bombAudio.snapshot = next;

  if (!next || next.status === "intermission" || next.status === "finished") {
    stopBombAudio();
    return;
  }
  if (next.status === "exploding") {
    clearTimeout(bombAudio.resumeTimer);
    bombAudio.resumeTimer = null;
    pauseBombLoops();
    const explosionKey = `${next.code}:${next.round}:${next.explosionAt || ""}`;
    if (next.explosionAt && explosionKey !== bombAudio.lastExplosionKey) {
      const audio = getBombAudio().explosion;
      bombAudio.lastExplosionKey = explosionKey;
      audio.pause();
      try { audio.currentTime = 0; } catch {}
      const playback = audio.play();
      playback?.catch?.(() => {});
    }
    return;
  }
  if (next.status !== "playing") {
    stopBombAudio();
    return;
  }

  clearTimeout(bombAudio.resumeTimer);
  bombAudio.resumeTimer = null;
  const resumedAfterExplosion = previous?.status === "exploding" ||
    previous?.status === "intermission" || previous?.code !== next.code ||
    previous?.round !== next.round || previous?.cycle !== next.cycle;
  if (resumedAfterExplosion || !previous || previous.status !== "playing") startBombLoops();
}

function prepareBombTurnVisual(state) {
  const bomb = state.bomb;
  const previous = document.querySelector(".bomb-arena") ? bombTurnVisual : null;
  const index = state.players.findIndex(player => player.id === bomb.turnPlayerId);
  const angle = index < 0 ? 0 : 360 * index / state.players.length;
  const answerKey = JSON.stringify(bomb.lastAnswer || null);
  const sameRound = previous && previous.code === state.code && previous.round === bomb.round;
  let transition = sameRound && previous.cycle === bomb.cycle ? previous.transition : null;
  if (!sameRound || bomb.status !== "playing") transition = null;
  else if (previous.playerId !== bomb.turnPlayerId) {
    transition = null;
    if (previous.playerId && bomb.turnPlayerId) {
      const pointer = document.querySelector(".bomb-pointer");
      const matrix = pointer && getComputedStyle(pointer).transform;
      let from = previous.angle;
      // Use the visible angle if another answer arrives before the sweep finishes.
      if (matrix && matrix !== "none" && typeof DOMMatrixReadOnly !== "undefined") {
        const transform = new DOMMatrixReadOnly(matrix);
        from = (Math.atan2(transform.b, transform.a) * 180 / Math.PI + 360) % 360;
      }
      const sweep = (angle - from + 360) % 360;
      transition = {
        startedAt:performance.now(), from, to:from + sweep,
        wordChanged:!!bomb.lastAnswer && answerKey !== previous.answerKey
      };
    }
  } else if (previous.version !== bomb.turnVersion || previous.cycle !== bomb.cycle) {
    transition = null;
  }
  bombTurnVisual = {
    code:state.code, round:bomb.round, cycle:bomb.cycle,
    version:bomb.turnVersion, playerId:bomb.turnPlayerId, angle, answerKey, transition,
    cycleStartedAt:sameRound && previous.cycle === bomb.cycle ? previous.cycleStartedAt : performance.now()
  };
}

function animateBombTurn() {
  const transition = bombTurnVisual?.transition;
  if (!transition || window.matchMedia("(prefers-reduced-motion: reduce)").matches) return;
  const elapsed = performance.now() - transition.startedAt;
  const animate = (selector, frames, duration, delay = 0) => {
    const element = document.querySelector(selector);
    if (!element?.animate || elapsed >= duration + delay) return;
    const animation = element.animate(frames, {
      duration, delay, easing:"cubic-bezier(.22,.7,.3,1)", fill:"backwards"
    });
    animation.currentTime = Math.max(0, elapsed);
  };
  animate(".bomb-pointer", [
    { transform:`translateX(-50%) rotate(${transition.from}deg)` },
    { transform:`translateX(-50%) rotate(${transition.to}deg)` }
  ], 1050);
  if (transition.wordChanged) {
    animate(".bomb-last-word strong", [
      { opacity:0, transform:"translateY(5px) scale(.88)" },
      { opacity:1, transform:"translateY(0) scale(1.06)", offset:.65 },
      { opacity:1, transform:"translateY(0) scale(1)" }
    ], 440);
  }
  animate(".bomb-player.is-turn .bomb-player-badge", [
    { transform:"scale(1)", boxShadow:"0 0 6px #ffda5560" },
    { transform:"scale(1.06)", boxShadow:"0 0 15px #ffda55,0 0 25px #ffc83cba", offset:.45 },
    { transform:"scale(1)", boxShadow:"0 0 10px #ffda55e0,0 0 22px #ffc83cba,inset 0 0 12px #ffe6794d" }
  ], 530, 470);
  animate(".bomb-category strong", [
    { opacity:0, transform:"translateY(10px)" },
    { opacity:1, transform:"translateY(5px)" }
  ], 390);
  animate(".bomb-letter b", [
    { opacity:0, transform:"scale(.86)" },
    { opacity:1, transform:"scale(1)" }
  ], 390);
}

// The fuse particles share a cycle clock across room snapshots.
function animateBombTension(state) {
  if (state.bomb?.status !== "playing" ||
      window.matchMedia("(prefers-reduced-motion: reduce)").matches) return;
  const art = document.querySelector(".bomb-art");
  if (!art?.animate) return;
  const elapsed = Math.max(0, performance.now() - bombTurnVisual.cycleStartedAt);
  const spark = document.querySelector(".bomb-spark");
  if (spark?.animate) {
    const glow = spark.animate([
      { opacity:.3, transform:"translate(-50%,-50%) scale(.8)" },
      { opacity:.85, transform:"translate(-50%,-50%) scale(1.2)", offset:.4 },
      { opacity:.5, transform:"translate(-50%,-50%) scale(.95)", offset:.7 },
      { opacity:.3, transform:"translate(-50%,-50%) scale(.8)" }
    ], { duration:950, iterations:Infinity, easing:"ease-in-out" });
    glow.currentTime = elapsed;
  }
  document.querySelectorAll(".bomb-spark-particle").forEach((particle, index, particles) => {
    const angle = -Math.PI / 2 + index * Math.PI * 2 / particles.length;
    const phase = (index * 113) % 520;
    const distance = 20 + index % 4 * 9;
    const dx = Math.cos(angle) * distance;
    const dy = Math.sin(angle) * distance;
    const rotation = angle * 180 / Math.PI + 90;
    const effect = particle.animate([
      { opacity:0, transform:`translate(-50%,-50%) rotate(${rotation}deg) scale(.2,.4)`, offset:0 },
      { opacity:1, transform:`translate(-50%,-50%) rotate(${rotation}deg) scale(1,1)`, offset:.12 },
      { opacity:.85, transform:`translate(calc(-50% + ${dx*.35}px),calc(-50% + ${dy*.35}px)) rotate(${rotation}deg) scale(.8,.8)`, offset:.38 },
      { opacity:0, transform:`translate(calc(-50% + ${dx}px),calc(-50% + ${dy}px)) rotate(${rotation}deg) scale(.1,.25)` }
    ], { duration:420 + index % 5 * 75, delay:phase, iterations:Infinity, easing:"ease-out" });
    effect.currentTime = elapsed;
  });

}

function animateBombExplosion(state) {
  if (state.bomb?.status !== "exploding") return;
  const elapsed = Math.max(0, serverNowMs() - state.bomb.lastExplosion.at);
  const reduced = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
  const arena = document.querySelector(".bomb-arena");
  const index = state.players.findIndex(player => player.id === state.bomb.lastExplosion.playerId);
  if (!arena || index < 0) return;
  const target = document.querySelector(".bomb-player.is-hit .bomb-player-avatar");
  const bombNode = document.querySelector(".bomb-center.is-flying");
  const bombRect = bombNode?.getBoundingClientRect();
  const targetRect = target?.getBoundingClientRect();
  const dx = bombRect && targetRect
    ? targetRect.left + targetRect.width / 2 - (bombRect.left + bombRect.width / 2)
    : arena.clientWidth * .4 * Math.cos(2 * Math.PI * index / state.players.length - Math.PI / 2);
  const dy = bombRect && targetRect
    ? targetRect.top + targetRect.height / 2 - (bombRect.top + bombRect.height / 2)
    : arena.clientHeight * .4 * Math.sin(2 * Math.PI * index / state.players.length - Math.PI / 2);
  const play = (selector, frames, duration, delay = 0) => {
    const node = document.querySelector(selector);
    if (!node?.animate || reduced) return;
    const effect = node.animate(frames, { duration, delay, fill:"both", easing:"ease-out" });
    effect.currentTime = elapsed;
  };
  play(".bomb-center.is-flying", [
    { opacity:1, transform:"translate(-50%,-50%) scale(1)" },
    { opacity:1, transform:`translate(calc(-50% + ${dx}px),calc(-50% + ${dy}px)) scale(.8)`, offset:.95 },
    { opacity:0, transform:`translate(calc(-50% + ${dx}px),calc(-50% + ${dy}px)) scale(.9)` }
  ], 420);
  play(".bomb-impact-flash", [
    {opacity:0,transform:"scale(.15)"},
    {opacity:1,transform:"scale(1)",offset:.12},
    {opacity:.75,transform:"scale(1.2)",offset:.3},
    {opacity:0,transform:"scale(1.8)"}
  ], 680, 390);
  play(".bomb-impact-core", [
    {opacity:0,transform:"scale(.2)"},
    {opacity:1,transform:"scale(1.15)",offset:.18},
    {opacity:.7,transform:"scale(.85)",offset:.45},
    {opacity:0,transform:"scale(.3)"}
  ], 620, 390);
  play(".bomb-impact-ring", [
    {opacity:1,transform:"scale(.1)"},
    {opacity:.95,transform:"scale(1)",offset:.12},
    {opacity:.65,transform:"scale(2.7)",offset:.58},
    {opacity:0,transform:"scale(3.5)"}
  ], 850, 390);
  play(".bomb-arena", [
    {transform:"translateX(0)"},
    {transform:"translateX(-6px)",offset:.12},
    {transform:"translateX(5px)",offset:.24},
    {transform:"translateX(-4px)",offset:.38},
    {transform:"translateX(3px)",offset:.53},
    {transform:"translateX(0)"}
  ], 620, 390);
  for (let i=0;i<16;i++) {
    const a=-Math.PI/2+i*Math.PI*2/16;
    const puffSize=34+(i%4)*12;
    const dx=Math.cos(a)*(34+(i%3)*14);
    const dy=Math.sin(a)*(20+(i%4)*10)-23;
    play(`.bomb-smoke-${i}`, [
      {opacity:0,transform:"translate(-50%,-50%) scale(.2)"},
      {opacity:.82,transform:`translate(calc(-50% + ${dx*.35}px),calc(-50% + ${dy*.35}px)) scale(1.05)`,offset:.2},
      {opacity:.62,transform:`translate(calc(-50% + ${dx}px),calc(-50% + ${dy}px)) scale(1.35)`,offset:.62},
      {opacity:0,transform:`translate(calc(-50% + ${dx*1.12}px),calc(-50% + ${dy*1.16}px)) scale(1.55)`}
    ], 1450+(i%4)*110, 410+(i%5)*32);
    play(`.bomb-impact-bit-${i}`, [
      {opacity:0,transform:"translate(-50%,-50%) scale(.1)"},
      {opacity:1,transform:"translate(-50%,-50%) scale(1.3)",offset:.12},
      {opacity:1,transform:`translate(calc(-50% + ${Math.cos(a)*puffSize*1.7}px),calc(-50% + ${Math.sin(a)*puffSize*1.7}px)) scale(.9)`,offset:.6},
      {opacity:0,transform:`translate(calc(-50% + ${Math.cos(a)*puffSize*2}px),calc(-50% + ${Math.sin(a)*puffSize*2}px)) scale(.1)`}
    ], 700+(i%3)*100, 390);
  }
  play(".bomb-player.is-hit .bomb-player-avatar", [
    {transform:"scale(1)",boxShadow:"0 0 0 rgba(255,190,80,0)"},
    {transform:"scale(1.2)",boxShadow:"0 0 38px 12px rgba(255,184,79,.95)",offset:.22},
    {transform:"scale(.96)",boxShadow:"0 0 22px 6px rgba(179,91,255,.75)",offset:.52},
    {transform:"scale(1)",boxShadow:"0 0 0 rgba(255,190,80,0)"}
  ], 900, 390);
  play(".bomb-player.is-hit .bomb-player-badge",[
    {transform:"translateX(0)",filter:"brightness(1)"},
    {transform:"translateX(-3px)",filter:"brightness(1.6)",offset:.2},
    {transform:"translateX(3px)",filter:"brightness(1.2)",offset:.45},
    {transform:"translateX(0)",filter:"brightness(1)"}
  ], 600, 390);
  play(".bomb-lost-heart-fill", [
    {opacity:1,transform:"translateY(0) scale(1)"},
    {opacity:0,transform:"translateY(-14px) scale(1.5)"}
  ], 750, 390);
}

function animateBombLastWord(state) {
  const answer = state.bomb?.lastAnswer;
  const word = document.querySelector(".bomb-last-word");
  if (!answer || !word?.animate) return;
  const elapsed = Math.max(0, serverNowMs() - Number(answer.at || Date.now()));
  if (elapsed >= 2000) { word.remove(); return; }
  const fade = word.animate([
    { opacity:1, transform:"translateX(-50%) scale(1)" },
    { opacity:1, transform:"translateX(-50%) scale(1)", offset:.82 },
    { opacity:0, transform:"translateX(-50%) scale(.94)" }
  ], { duration:2000, fill:"forwards", easing:"ease-out" });
  fade.currentTime = elapsed;
}

function renderBombIntermission(state) {
  const bomb = state.bomb;
  const winner = state.players.find(player => player.id === bomb.lastWinnerId);
  const originalOrder = new Map(state.players.map((player, index) => [player.id, index]));
  const eliminatedAt = new Map((bomb.eliminationOrder || []).map((playerId, index) => [playerId, index]));
  const orderedPlayers = [...state.players].sort((a, b) => {
    if (a.id === bomb.lastWinnerId) return -1;
    if (b.id === bomb.lastWinnerId) return 1;
    const aLives = Math.max(0, Number(bomb.lives?.[a.id] || 0));
    const bLives = Math.max(0, Number(bomb.lives?.[b.id] || 0));
    if (aLives > 0 && bLives === 0) return -1;
    if (bLives > 0 && aLives === 0) return 1;
    const aOut = eliminatedAt.get(a.id);
    const bOut = eliminatedAt.get(b.id);
    if (aOut !== undefined && bOut !== undefined) return bOut - aOut;
    if (aLives !== bLives) return bLives - aLives;
    return originalOrder.get(a.id) - originalOrder.get(b.id);
  });
  const players = orderedPlayers.map(player => {
    const lives = Math.max(0, Number(bomb.lives?.[player.id] || 0));
    const frame = !!window.PtitBacFrames?.asset?.(player.frameId);
    const isWinner = player.id === bomb.lastWinnerId;
    const validatedAnswers = Math.max(0, Number(bomb.validAnswers?.[player.id] || 0));
    return `<div class="bomb-summary-player ${lives ? "" : "is-out"} ${isWinner ? "is-winner" : ""}">
      <span class="bomb-summary-avatar bomb-player-avatar ${frame ? "ptb-has-equipped-frame" : ""}">${bombAvatarMarkup(player)}</span>
      <strong>${escapeHtml(player.name)}</strong>
      <span class="bomb-summary-lives" aria-label="${lives} vie${lives > 1 ? "s" : ""}">${"♥".repeat(lives)}${"♡".repeat(Math.max(0, Number(state.bombLives || 3) - lives))}</span>
      <small>${isWinner ? "Gagnant" : "Éliminé"}</small>
      <span class="bomb-summary-validated"><small>Réponses validées</small><strong>${validatedAnswers}</strong></span>
    </div>`;
  }).join("");
  const nextRoundAt = Number(bomb.nextRoundAt || serverNowMs() + 5000);

  setScreen(`<main class="screen bomb-screen bomb-intermission-screen">
    <header class="bomb-header"><button id="bombLeave" type="button" aria-label="Quitter la partie"><img src="/back-arrow.png" alt=""></button><img class="bomb-brand" src="/ptitbac.logo.png" alt="P'tit Bac"><span class="bomb-header-coins" aria-label="${getCoins()} pièces"><img src="/coin.png" alt=""><strong>${getCoins()}</strong></span><span>Manche ${bomb.round}/${state.rounds}</span></header>
    <section class="bomb-intermission-content" aria-labelledby="bombIntermissionTitle">
      <div class="bomb-intermission-heading"><span>PAUSE ENTRE LES MANCHES</span><h1 id="bombIntermissionTitle">Manche ${bomb.round} terminée</h1></div>
      <section class="bomb-intermission-card bomb-round-winner" aria-labelledby="bombRoundWinnerTitle">
        <h2 id="bombRoundWinnerTitle">Gagnant de la manche</h2>
        ${winner ? `<div class="bomb-summary-winner"><span class="bomb-summary-avatar bomb-player-avatar ${window.PtitBacFrames?.asset?.(winner.frameId) ? "ptb-has-equipped-frame" : ""}">${bombAvatarMarkup(winner)}</span><strong>${escapeHtml(winner.name)}</strong></div>` : `<p>Aucun gagnant</p>`}
      </section>
      <section class="bomb-round-players" aria-labelledby="bombRoundPlayersTitle">
        <h2 id="bombRoundPlayersTitle">Joueurs</h2><div class="bomb-summary-player-list">${players}</div>
      </section>
      <p class="bomb-intermission-countdown" aria-live="polite">La prochaine manche commence dans <strong id="bombIntermissionCountdown">5</strong>s</p>
    </section>
  </main>`);

  document.getElementById("bombLeave")?.addEventListener("click", bombLeave);
  const countdown = document.getElementById("bombIntermissionCountdown");
  const updateCountdown = () => {
    if (!countdown) return;
    countdown.textContent = String(Math.max(0, Math.ceil((nextRoundAt - serverNowMs()) / 1000)));
  };
  updateCountdown();
  session.timerHandle = window.setInterval(updateCountdown, 200);
}

function renderBombGame() {
  const state = session.state;
  const bomb = state.bomb;
  if (!bomb) return renderHome();
  if (bomb.status === "intermission") return renderBombIntermission(state);
  prepareBombTurnVisual(state);
  const active = bomb.status === "playing";
  const myTurn = active && bomb.turnPlayerId === session.playerId;
  const checking = bomb.checkingPlayerId === session.playerId;
  const rerollCost = Math.max(0, Number(state.bombRerollCost || 20));
  const canAffordReroll = getCoins() >= rerollCost;
  const current = state.players.find(player => player.id === bomb.turnPlayerId);
  const explosion = bomb.lastExplosion;
  const exploding = bomb.status === "exploding";
  const lastAnswerAge = bomb.lastAnswer?.at ? serverNowMs() - Number(bomb.lastAnswer.at) : 0;
  const showLastAnswer = !!bomb.lastAnswer?.answer && lastAnswerAge >= 0 && lastAnswerAge < 2000;
  const lastAnswerPlayer = showLastAnswer ? state.players.find(player => player.id === bomb.lastAnswer.playerId) : null;
  const unlucky = state.players.find(player => player.id === explosion?.playerId);
  const players = state.players.map((player, index) => {
    const angle = 2 * Math.PI * index / state.players.length - Math.PI / 2;
    const x = 50 + 40 * Math.cos(angle);
    const y = 50 + 40 * Math.sin(angle);
    const lives = Number(bomb.lives?.[player.id] || 0);
    const hit = exploding && player.id === explosion?.playerId;
    const eliminatedNow = hit && !!explosion?.eliminated;
    const frame = !!(window.PtitBacFrames?.asset?.(player.frameId));
    const shownLives = Math.max(0, lives - (hit && lives > 0 ? 1 : 0));
    const eliminationDelay = eliminatedNow
      ? Math.max(0, 800 - Math.max(0, serverNowMs() - Number(explosion.at || serverNowMs())))
      : 800;
    const renderedHearts = "♥".repeat(shownLives) +
      (hit && lives > 0 ? '<span class="bomb-lost-heart"><span class="bomb-lost-heart-empty">♡</span><span class="bomb-lost-heart-fill">♥</span></span>' : "") +
      "♡".repeat(Math.max(0, Number(state.bombLives || 3) - lives));
    return `<div class="bomb-player ${hit ? "is-hit" : ""} ${hit && player.id === session.playerId ? "is-self-hit" : ""} ${player.id === bomb.turnPlayerId ? "is-turn" : ""} ${lives === 0 || eliminatedNow ? "is-out" : ""}" style="left:${x}%;top:${y}%;--bomb-elimination-delay:${eliminationDelay}ms">
      <div class="bomb-player-badge">
        <div class="bomb-player-avatar ${frame ? "ptb-has-equipped-frame" : ""}">${bombAvatarMarkup(player)}</div>
        <strong>${escapeHtml(player.name)}</strong>
        <span class="bomb-hearts" aria-label="${shownLives} vie${shownLives > 1 ? "s" : ""}">${renderedHearts}</span>
      </div>
    </div>`;
  }).join("");
  const explosionAge = explosion?.at ? Math.max(0, serverNowMs() - Number(explosion.at)) : Infinity;
  const showExplosionStatus = !!(explosion && explosionAge < 3000 && unlucky);
  const status = showExplosionStatus
      ? `${escapeHtml(unlucky.name)} perd une vie${explosion.eliminated ? " et quitte cette manche" : ""} !`
      : myTurn ? "À toi de jouer !" : `Au tour de ${escapeHtml(current?.name || "un joueur")}`;

  setScreen(`<main class="screen bomb-screen">
    <header class="bomb-header"><button id="bombLeave" type="button" aria-label="Quitter la partie"><img src="/back-arrow.png" alt=""></button><img class="bomb-brand" src="/ptitbac.logo.png" alt="P'tit Bac"><span class="bomb-header-coins" aria-label="${getCoins()} pièces"><img src="/coin.png" alt=""><strong>${getCoins()}</strong></span><span>Manche ${bomb.round}/${state.rounds}</span></header>
    <div class="bomb-content ${myTurn && !checking ? "has-bomb-reroll" : ""}">
      <div class="bomb-arena" aria-label="Joueurs autour de la bombe">
        <div class="bomb-orbit"></div>${players}
        <div class="bomb-scene-decor" aria-hidden="true">
          <span class="bomb-edge-ring"></span>
          <span class="bomb-core-ring"></span>
          <i class="bomb-sparkle" style="--x:13%;--y:32%;--size:11px;--delay:-1.3s"></i>
          <i class="bomb-sparkle is-dot" style="--x:8%;--y:47%;--size:4px;--delay:-.4s"></i>
          <i class="bomb-sparkle" style="--x:18%;--y:66%;--size:8px;--delay:-2.1s"></i>
          <i class="bomb-sparkle is-dot" style="--x:25%;--y:82%;--size:4px;--delay:-1s"></i>
          <i class="bomb-sparkle" style="--x:81%;--y:29%;--size:9px;--delay:-.8s"></i>
          <i class="bomb-sparkle is-dot" style="--x:91%;--y:43%;--size:4px;--delay:-2.4s"></i>
          <i class="bomb-sparkle" style="--x:84%;--y:68%;--size:12px;--delay:-1.7s"></i>
          <i class="bomb-sparkle is-dot" style="--x:73%;--y:84%;--size:4px;--delay:-.2s"></i>
          <i class="bomb-sparkle" style="--x:38%;--y:43%;--size:8px;--delay:-2.7s"></i>
          <i class="bomb-sparkle is-dot" style="--x:64%;--y:42%;--size:4px;--delay:-1.5s"></i>
          <i class="bomb-sparkle" style="--x:39%;--y:63%;--size:10px;--delay:-.6s"></i>
          <i class="bomb-sparkle is-dot" style="--x:63%;--y:65%;--size:4px;--delay:-2.2s"></i>
          <i class="bomb-sparkle" style="--x:4%;--y:22%;--size:8px;--delay:-1.8s"></i>
          <i class="bomb-sparkle is-dot" style="--x:96%;--y:23%;--size:5px;--delay:-.7s"></i>
          <i class="bomb-sparkle is-dot" style="--x:4%;--y:76%;--size:4px;--delay:-2.6s"></i>
          <i class="bomb-sparkle" style="--x:96%;--y:77%;--size:9px;--delay:-1.1s"></i>
          <i class="bomb-sparkle is-dot" style="--x:27%;--y:13%;--size:4px;--delay:-.3s"></i>
          <i class="bomb-sparkle" style="--x:75%;--y:14%;--size:7px;--delay:-2.3s"></i>
          <i class="bomb-sparkle" style="--x:25%;--y:87%;--size:7px;--delay:-1.4s"></i>
          <i class="bomb-sparkle is-dot" style="--x:77%;--y:87%;--size:4px;--delay:-.9s"></i>
        </div>
        ${exploding && unlucky ? `<div class="bomb-impact" aria-hidden="true" style="left:${50+40*Math.cos(2*Math.PI*state.players.indexOf(unlucky)/state.players.length-Math.PI/2)}%;top:${50+40*Math.sin(2*Math.PI*state.players.indexOf(unlucky)/state.players.length-Math.PI/2)}%"><span class="bomb-impact-ring"></span><span class="bomb-impact-ring bomb-impact-ring-second"></span><span class="bomb-impact-flash"></span><span class="bomb-impact-core"></span>${Array.from({length:16},(_,i)=>`<i class="bomb-smoke bomb-smoke-${i}" style="--smoke-size:${34+(i%5)*8}px"></i><i class="bomb-impact-bit bomb-impact-bit-${i}"></i>`).join("")}</div>` : ""}
        <div class="bomb-center ${exploding ? "is-flying" : ""}" aria-label="${active ? "Bombe en cours" : "Manche terminée"}"><div class="bomb-art"><img src="/bomb-neon.png?v=1.48.0-bombe-assets3" alt="">${active ? '<span class="bomb-spark" aria-hidden="true"></span>'+Array.from({length:16},()=>'<i class="bomb-spark-particle" aria-hidden="true"></i>').join("") : ""}</div></div>
        ${lastAnswerPlayer && bomb.lastAnswer?.answer ? `<div class="bomb-last-word" aria-live="polite"><span>${escapeHtml(lastAnswerPlayer.name)} a écrit</span><strong>${escapeHtml(bomb.lastAnswer.answer)}</strong></div>` : ""}
        ${active && current ? `<div class="bomb-pointer" style="--bomb-angle:${360 * state.players.indexOf(current) / state.players.length - 90}deg" aria-hidden="true"><img src="/bomb-arrow-neon.png?v=1.48.0-bombe-assets2" alt=""></div>` : ""}
      </div>
      <p class="bomb-status" role="status">${status}</p>
      <div class="bomb-prompt">
        ${myTurn && !checking ? `<button id="bombRerollButton" class="bomb-reroll-button" type="button" data-cost="${rerollCost}" aria-label="Relancer la catégorie et la lettre pour ${rerollCost} pièces" title="Relancer la catégorie et la lettre — ${rerollCost} pièces" ${canAffordReroll ? "" : "disabled"}><svg viewBox="0 0 24 24" aria-hidden="true"><path d="M17.65 6.35A7.95 7.95 0 0 0 12 4a8 8 0 1 0 7.93 9h-2.02A6 6 0 1 1 12 6c1.66 0 3.14.69 4.22 1.78L13 11h7V4l-2.35 2.35z"/></svg><b><img src="/coin.png" alt="">${rerollCost}</b></button>` : ""}
        <div class="bomb-category"><span>Catégorie</span><strong>${escapeHtml(bomb.category || "—")}</strong></div><div class="bomb-letter"><span>Lettre</span><b>${escapeHtml(bomb.letter || "—")}</b></div>
      </div>
      ${myTurn ? `
      <form id="bombAnswerForm" class="bomb-form">
        <div><input id="bombAnswerInput" class="bomb-answer-input" type="text" maxlength="80" autocomplete="off" autocapitalize="sentences" placeholder="Écris ta réponse" aria-label="Écris ta réponse" ${myTurn && !checking ? "" : "disabled"} required><button type="submit" aria-label="Envoyer la réponse" title="Envoyer la réponse" ${myTurn && !checking ? "" : "disabled"}><svg viewBox="0 0 24 24" aria-hidden="true"><path d="M3 11.2 21 3l-5.3 18-3.1-7.1L3 11.2Zm9.6 2.7L21 3"/></svg></button></div>
        <p id="bombAnswerFeedback" class="bomb-answer-feedback ${checking ? "is-visible" : ""}" role="status" aria-live="polite">${checking ? "Vérification du mot…" : ""}</p>
      </form>` : ""}
    </div>
  </main>`);
  animateBombTurn();
  animateBombTension(state);
  animateBombExplosion(state);
  animateBombLastWord(state);
  if (showExplosionStatus) {
    const statusNode = document.querySelector(".bomb-status");
    window.setTimeout(() => {
      if (!statusNode?.isConnected || session.state?.bomb?.lastExplosion?.at !== explosion.at) return;
      const latest = session.state;
      const latestPlayer = latest?.players?.find(player => player.id === latest?.bomb?.turnPlayerId);
      statusNode.textContent = latest?.bomb?.turnPlayerId === session.playerId
        ? "À toi de jouer !"
        : `Au tour de ${latestPlayer?.name || "un joueur"}`;
    }, Math.max(0, 3000 - explosionAge));
  }
  document.getElementById("bombLeave")?.addEventListener("click", bombLeave);
  document.getElementById("bombRerollButton")?.addEventListener("click", event => {
    const button = event.currentTarget;
    if (!myTurn || checking || !canAffordReroll || button.disabled) return;
    const requestId = `bomb-reroll:${state.code}:${session.playerId}:${bomb.cycle}:${bomb.turnVersion}:${Date.now()}:${Math.random().toString(16).slice(2)}`;
    button.disabled = true;
    button.dataset.pending = "true";
    button.classList.add("is-loading");
    socket.emit("bomb:reroll", {
      code:state.code,
      playerId:session.playerId,
      cycle:bomb.cycle,
      turnVersion:bomb.turnVersion,
      requestId
    }, response => {
      if (response?.ok) return;
      toast(response?.error || "Impossible de relancer la catégorie et la lettre.");
      if (button.isConnected) {
        button.dataset.pending = "false";
        button.classList.remove("is-loading");
        button.disabled = getCoins() < rerollCost;
      }
    });
  });
  document.getElementById("bombAnswerForm")?.addEventListener("submit", event => {
    event.preventDefault();
    const input = document.getElementById("bombAnswerInput");
    const answer = input?.value.trim();
    if (!answer || !myTurn || checking) return;
    const button = event.currentTarget.querySelector("button");
    input.disabled = true;
    button.disabled = true;
    button.setAttribute("aria-busy", "true");
    const feedback = document.getElementById("bombAnswerFeedback");
    if (feedback) {
      feedback.textContent = "Vérification du mot…";
      feedback.classList.add("is-visible");
    }
    socket.emit("bomb:answer", { code:state.code, playerId:session.playerId, answer }, response => {
      if (response?.ok) return;
      toast(response?.error || "Mot refusé.");
      if (session.state?.bomb?.turnPlayerId === session.playerId &&
          session.state?.bomb?.cycle === bomb.cycle &&
          session.state?.bomb?.turnVersion === bomb.turnVersion) {
        renderBombGame();
        const refreshed = document.getElementById("bombAnswerInput");
        if (refreshed) { refreshed.value = answer; refreshed.focus(); refreshed.select(); }
      }
    });
  });
}

function renderBombResults() {
  const state = session.state;
  const wins = state.bomb?.wins || {};
  const count = player => Number(wins[player.id]) || 0;
  const ranking = [...(state.players || [])].sort((a, b) =>
    count(b) - count(a) || String(a.name || "").localeCompare(String(b.name || ""))
  );
  const rank = player => ranking.findIndex(item => count(item) === count(player)) + 1;
  const maximum = Math.max(0, ...ranking.map(count));
  const leaders = ranking.filter(player => count(player) === maximum);
  const top = ranking.slice(0, 3);
  const podiumOrder = top.length >= 3 ? [top[1], top[0], top[2]] : top;
  const podium = podiumOrder.map(player => {
    const place = rank(player);
    return `<article class="fin-podium-card place-${Math.min(place, 3)}">
      <div class="fin-medal">${place}</div>
      ${place === 1 ? '<img class="fin-rank-crown" src="/admin-crown.png" alt="" aria-hidden="true">' : ""}
      ${bombResultAvatarMarkup(player)}
      <strong>${escapeHtml(player.name)}</strong>
      ${bombResultTagMarkup(player)}
      ${player.id === session.playerId ? '<small class="fin-you">Toi</small>' : ""}
      <b>${count(player)} manche${count(player) > 1 ? "s" : ""}</b>
    </article>`;
  }).join("");
  const podiumIds = new Set(top.map(player => String(player.id)));
  const remaining = ranking.filter(player => !podiumIds.has(String(player.id)));
  const rows = remaining.map(player => `<div class="fin-row ${player.id === session.playerId ? "is-me" : ""}">
    <span class="fin-rank place-${Math.min(rank(player), 4)}">${rank(player)}</span>
    <div class="fin-player">${bombResultAvatarMarkup(player)}<div class="bomb-result-player-copy"><strong>${escapeHtml(player.name)}</strong>${bombResultTagMarkup(player)}${player.id === session.playerId ? '<small class="fin-you">Toi</small>' : ""}</div></div>
    <b>${count(player)} manche${count(player) > 1 ? "s" : ""}</b>
  </div>`).join("");
  const ready = !!me()?.rematchReady;
  const host = !!me()?.isHost;
  const allReady = !!state.rematch?.allReady;
  setScreen(`<main class="fsv1-screen final-mobile bomb-final-mobile">
    <header class="fin-top"><img class="fin-brand" src="/ptitbac.logo.png" alt="P'tit Bac"><span></span></header>
    <section class="fin-heading"><h1>Partie <span>terminée !</span></h1><p>${leaders.length === 1 ? `${escapeHtml(leaders[0]?.name || "")} remporte la partie !` : "Égalité !"}</p></section>
    <section class="fin-podium fin-podium-${Math.min(top.length, 3)} ${leaders.length > 1 ? "fin-podium-shared-win" : ""}" aria-label="Classement">${podium}</section>
    ${remaining.length ? `<section class="fin-ranking ${ranking.length >= 5 ? "is-many" : ""}">${rows}</section>` : ""}
    <div class="fin-actions">
      ${state.mode === "quick" ? "" : `<button id="bombRematch" class="fin-primary bomb-rematch-button" type="button" aria-pressed="${ready}"><span>${ready ? "✓ Partant · Annuler" : "↻ Je rejoue"}</span><span class="bomb-rematch-count" role="status">${Number(state.rematch?.readyCount || 0)} / ${Number(state.rematch?.count || 0)} joueurs partants</span></button>`}
      ${host && state.mode !== "quick" ? `<button id="bombRestart" class="fin-secondary" type="button" ${allReady ? "" : "disabled"}>Retour au salon</button>` : ""}
      <button id="bombLeave" class="fin-secondary" type="button">⌂ Retour à l’accueil</button>
    </div>
  </main>`);
  window.playFinalVictoryEffects?.(
    { ...state, gameType:"bombe" },
    ranking.map(player => ({ ...player, score:count(player) }))
  );
  document.getElementById("bombLeave")?.addEventListener("click", () => bombLeave(false));
  document.getElementById("bombRematch")?.addEventListener("click", () => {
    socket.emit("game:rematchReady", { code:state.code, playerId:session.playerId, ready:!ready }, response => {
      if (!response?.ok) toast(response?.error || "Impossible de rejouer.");
    });
  });
  document.getElementById("bombRestart")?.addEventListener("click", () => {
    socket.emit("game:restart", { code:state.code, playerId:session.playerId }, response => {
      if (!response?.ok) toast(response?.error || "Impossible de retourner au salon.");
      else window.stopFinalVictoryEffects?.();
    });
  });
}

function statIcon(type) {
  const icons = {
    player: `<svg viewBox="0 0 24 24" aria-hidden="true"><circle cx="12" cy="8" r="4" fill="currentColor"/><path d="M4.5 21a7.5 7.5 0 0 1 15 0H4.5Z" fill="currentColor"/></svg>`,
    round: `<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M6 3v18" stroke="currentColor" stroke-width="2.2" stroke-linecap="round"/><path d="M7 4h10l-2.3 4L17 12H7V4Z" fill="currentColor"/></svg>`,
    timer: `<svg viewBox="0 0 24 24" aria-hidden="true"><circle cx="12" cy="13" r="7" fill="none" stroke="currentColor" stroke-width="2.2"/><path d="M12 13V8.5M9 3h6M16.8 6.2l1.5-1.5" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round"/></svg>`
  };
  return icons[type] || "";
}

function renderLobby() {
  setScreen('<main class="screen center-screen"><p role="status">Chargement de la partie…</p></main>');
}

function difficultyLabel(value) {
  return value === "hard" ? "Difficile" : value === "medium" ? "Moyen" : "Facile";
}

function renderCategorySelection() {
  setScreen('<main class="screen center-screen"><p role="status">Chargement de la partie…</p></main>');
}


function renderLetterSelection() {
  setScreen('<main class="screen center-screen"><p role="status">Chargement de la partie…</p></main>');
}

function answerKey(category) {
  return `${session.state.roundIndex}:${category}`;
}

function renderRound() {
  setScreen('<main class="screen center-screen"><p role="status">Chargement de la partie…</p></main>');
}

function renderRoundWaiting() {
  setScreen('<main class="screen center-screen"><p role="status">Chargement de la partie…</p></main>');
}

function renderValidation() {
  setScreen('<main class="screen center-screen"><p role="status">Chargement de la partie…</p></main>');
}

function renderScoreboard() {
  setScreen('<main class="screen center-screen"><p role="status">Chargement de la partie…</p></main>');
}

function renderFinished() {
  setScreen('<main class="screen center-screen"><p role="status">Chargement de la partie…</p></main>');
}

window.addEventListener("beforeunload", () => {
  clearInterval(session.timerHandle);
});

// Shared by all six in-game exit buttons. Prefix keeps each screen’s CSS.
function gameExitModal(state, user, prefix) {
  document.querySelector(`.${prefix}-modal-backdrop`)?.remove();
  const overlay = document.createElement("div");
  overlay.className = `${prefix}-modal-backdrop`;
  overlay.innerHTML = `
    <section class="${prefix}-modal" role="dialog" aria-modal="true">
      <h2>Quitter la partie ?</h2>
      <div class="${prefix}-modal-actions">
        <button type="button" data-action="cancel">Non</button>
        ${user?.isHost ? '<button type="button" data-action="lobby">Revenir au salon</button>' : ""}
        <button type="button" class="danger" data-action="home">Revenir à l’accueil</button>
      </div>
    </section>
  `;

  overlay.addEventListener("click", e => {
    const action = e.target?.dataset?.action;
    if (e.target === overlay || action === "cancel") {
      overlay.remove();
      return;
    }
    if (action === "lobby") {
      socket.emit("game:returnLobby", { code: state.code, playerId: session.playerId });
      overlay.remove();
      return;
    }
    if (action === "home") {
      const buttons = overlay.querySelectorAll("button");
      buttons.forEach(button => { button.disabled = true; });

      socket.timeout(8000).emit(
        "game:leave",
        { code:state.code, playerId:session.playerId },
        (err, res) => {
          if (err || !res?.ok) {
            buttons.forEach(button => { button.disabled = false; });
            return toast(
              res?.error ||
              "Impossible de quitter la partie pour le moment."
            );
          }

          clearSession();
          overlay.remove();

          if (typeof initWallet === "function") {
            initWallet(() => renderHome());
          } else {
            renderHome();
          }

          if (res?.message) toast(res.message);
        }
      );
    }
  });
  document.body.appendChild(overlay);
}
