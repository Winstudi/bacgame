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
  return avatar.startsWith("/")
    ? `<img src="${escapeHtml(avatar)}" alt="">`
    : `<span>${escapeHtml(avatar)}</span>`;
}

function bombLeave() {
  if (!window.confirm("Quitter la partie Bombe ?")) return;
  socket.emit("room:leave", { code:session.code, playerId:session.playerId }, response => {
    if (!response?.ok) return toast(response?.error || "Impossible de quitter la partie.");
    clearSession();
    renderHome();
  });
}

function renderBombGame() {
  const state = session.state;
  const bomb = state.bomb;
  if (!bomb) return renderHome();
  const active = bomb.status === "playing";
  const myTurn = active && bomb.turnPlayerId === session.playerId;
  const checking = bomb.checkingPlayerId === session.playerId;
  const current = state.players.find(player => player.id === bomb.turnPlayerId);
  const explosion = bomb.lastExplosion;
  const unlucky = state.players.find(player => player.id === explosion?.playerId);
  const winner = state.players.find(player => bomb.status === "intermission" && player.id === bomb.lastWinnerId);
  const players = state.players.map((player, index) => {
    const angle = 2 * Math.PI * index / state.players.length - Math.PI / 2;
    const x = 50 + 40 * Math.cos(angle);
    const y = 50 + 40 * Math.sin(angle);
    const lives = Number(bomb.lives?.[player.id] || 0);
    return `<div class="bomb-player ${player.id === bomb.turnPlayerId ? "is-turn" : ""} ${lives === 0 ? "is-out" : ""}" style="left:${x}%;top:${y}%">
      <div class="bomb-player-badge">
        <div class="bomb-player-avatar">${bombAvatarMarkup(player)}</div>
        <strong>${escapeHtml(player.name)}</strong>
        <span class="bomb-hearts" aria-label="${lives} vie${lives > 1 ? "s" : ""}">${"♥".repeat(lives)}${"♡".repeat(Math.max(0, Number(state.bombLives || 3) - lives))}</span>
      </div>
    </div>`;
  }).join("");
  const status = bomb.status === "intermission"
    ? `Manche ${bomb.round} terminée${winner ? ` · ${escapeHtml(winner.name)} gagne` : ""}`
    : explosion && Date.now() - explosion.at < 4500 && unlucky
      ? `${escapeHtml(unlucky.name)} perd une vie${explosion.eliminated ? " et quitte cette manche" : ""} !`
      : myTurn ? "À toi de jouer !" : `Au tour de ${escapeHtml(current?.name || "un joueur")}`;

  setScreen(`<main class="screen bomb-screen">
    <header class="bomb-header"><button id="bombLeave" type="button" aria-label="Quitter la partie"><img src="/back-arrow.png" alt=""></button><img class="bomb-brand" src="/ptitbac.logo.png" alt="P'tit Bac"><span>Manche ${bomb.round}/${state.rounds}</span></header>
    <div class="bomb-content">
      <div class="bomb-arena" aria-label="Joueurs autour de la bombe">
        <div class="bomb-orbit"></div>${players}
        <div class="bomb-center ${explosion && Date.now() - explosion.at < 1600 ? "is-explosion" : ""}" aria-label="${active ? "Bombe en cours" : "Manche terminée"}"><img src="/bomb-neon.png?v=1.48.0-bombe-assets2" alt=""></div>
        ${active && current ? `<div class="bomb-pointer" style="--bomb-angle:${360 * state.players.indexOf(current) / state.players.length - 90}deg" aria-hidden="true"><img src="/bomb-arrow-neon.png?v=1.48.0-bombe-assets2" alt=""></div>` : ""}
      </div>
      <p class="bomb-status" role="status">${status}</p>
      <div class="bomb-prompt"><div class="bomb-category"><span>Catégorie</span><strong>${escapeHtml(bomb.category || "—")}</strong></div><div class="bomb-letter"><span>Lettre</span><b>${escapeHtml(bomb.letter || "—")}</b></div></div>
      ${bomb.status === "intermission" ? `<p class="bomb-next">Nouvelle manche dans quelques secondes… Les vies vont être réinitialisées.</p>` : myTurn ? `
      <form id="bombAnswerForm" class="bomb-form">
        <div><input id="bombAnswerInput" class="bomb-answer-input" type="text" maxlength="80" autocomplete="off" autocapitalize="sentences" placeholder="Écris ta réponse" aria-label="Écris ta réponse" ${myTurn && !checking ? "" : "disabled"} required><button type="submit" aria-label="Envoyer la réponse" title="Envoyer la réponse" ${myTurn && !checking ? "" : "disabled"}><svg viewBox="0 0 24 24" aria-hidden="true"><path d="M3 11.2 21 3l-5.3 18-3.1-7.1L3 11.2Zm9.6 2.7L21 3"/></svg></button></div>
      </form>` : ""}
    </div>
  </main>`);
  document.getElementById("bombLeave")?.addEventListener("click", bombLeave);
  document.getElementById("bombAnswerForm")?.addEventListener("submit", event => {
    event.preventDefault();
    const input = document.getElementById("bombAnswerInput");
    const answer = input?.value.trim();
    if (!answer || !myTurn || checking) return;
    const button = event.currentTarget.querySelector("button");
    input.disabled = true;
    button.disabled = true;
    button.setAttribute("aria-busy", "true");
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
  const ranking = [...state.players].sort((a, b) => (wins[b.id] || 0) - (wins[a.id] || 0));
  const maximum = Math.max(0, ...Object.values(wins).map(Number));
  const leaders = ranking.filter(player => (wins[player.id] || 0) === maximum);
  const ready = !!me()?.rematchReady;
  setScreen(`<main class="screen bomb-screen bomb-results">
    <header class="bomb-header"><button id="bombLeave" type="button" aria-label="Retour à l'accueil"><img src="/back-arrow.png" alt=""></button><img class="bomb-brand" src="/ptitbac.logo.png" alt="P'tit Bac"><span>Résultats</span></header>
    <div class="bomb-result-content"><span class="bomb-result-icon">🏆</span><h1>Partie terminée</h1>
      <p>${leaders.length === 1 ? `${escapeHtml(leaders[0]?.name || "")} remporte la partie !` : "Égalité !"}</p>
      <div class="bomb-ranking">${ranking.map((player, index) => `<div><span>${index + 1}.</span>${bombAvatarMarkup(player)}<strong>${escapeHtml(player.name)}</strong><b>${wins[player.id] || 0} manche${(wins[player.id] || 0) > 1 ? "s" : ""}</b></div>`).join("")}</div>
      <button id="bombRematch" type="button">${ready ? "Annuler" : "✓ Rejouer"}</button>
      ${me()?.isHost && state.rematch?.allReady ? `<button id="bombRestart" type="button">Retourner au salon</button>` : `<small>${state.rematch?.readyCount || 0}/${state.rematch?.count || 0} joueurs prêts pour rejouer</small>`}
    </div>
  </main>`);
  document.getElementById("bombLeave")?.addEventListener("click", bombLeave);
  document.getElementById("bombRematch")?.addEventListener("click", () => {
    socket.emit("game:rematchReady", { code:state.code, playerId:session.playerId, ready:!ready }, response => {
      if (!response?.ok) toast(response?.error || "Impossible de rejouer.");
    });
  });
  document.getElementById("bombRestart")?.addEventListener("click", () => {
    socket.emit("game:restart", { code:state.code, playerId:session.playerId }, response => {
      if (!response?.ok) toast(response?.error || "Impossible de retourner au salon.");
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
