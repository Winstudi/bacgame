(() => {
  "use strict";

  const ACCOUNT_SESSION_KEY = "ptitbac_account_session";
  const GUEST_MODE_KEY = "ptitbac_guest_mode";
  const IDENTITY_EPOCH_KEY = "ptitbac_identity_epoch";
  const IDENTITY_EPOCH = "accounts-v1-cleanstart-20260916";
  const PROFILE_SETUP_PENDING_KEY = "ptitbac_profile_setup_pending";
  const PROFILE_SETUP_AVATARS = Object.freeze([
    "/a1.webp",
    "/a2.webp",
    "/a3.webp",
    "/a4.webp",
    "/a5.webp"
  ]);

  let accountState = null;
  let gateRequired = false;
  let authBusy = false;
  let announcedIdentityKey = "";

  function clearLegacyIdentityOnce() {
    if (localStorage.getItem(IDENTITY_EPOCH_KEY) === IDENTITY_EPOCH) return;

    const keys = [];
    for (let index = 0; index < localStorage.length; index += 1) {
      const key = localStorage.key(index);
      if (key && /^(petitbac_|ptitbac_)/.test(key)) keys.push(key);
    }
    keys.forEach(key => localStorage.removeItem(key));
    localStorage.setItem(IDENTITY_EPOCH_KEY, IDENTITY_EPOCH);

    try {
      session.code = "";
      session.playerId = "";
      session.state = null;
      session.localAnswers = {};
      session.walletToken = "";
      session.walletBalance = 0;
    } catch {}

    if (typeof socket !== "undefined" && socket.connected) {
      socket.disconnect();
      queueMicrotask(() => socket.connect());
    }
  }

  function esc(value) {
    try { return escapeHtml(value); }
    catch {
      return String(value || "").replace(/[&<>"']/g, char => ({
        "&":"&amp;", "<":"&lt;", ">":"&gt;", '"':"&quot;", "'":"&#039;"
      }[char]));
    }
  }

  function accountSessionToken() {
    return String(localStorage.getItem(ACCOUNT_SESSION_KEY) || "").trim();
  }

  function isGuestMode() {
    return localStorage.getItem(GUEST_MODE_KEY) === "1";
  }

  function profileSetupPending() {
    return localStorage.getItem(PROFILE_SETUP_PENDING_KEY) === "1";
  }

  function markProfileSetupPending() {
    localStorage.setItem(PROFILE_SETUP_PENDING_KEY, "1");
  }

  function completeProfileSetup() {
    localStorage.removeItem(PROFILE_SETUP_PENDING_KEY);
  }

  function currentWalletToken() {
    try {
      if (typeof session !== "undefined" && session?.walletToken) {
        return String(session.walletToken);
      }
    } catch {}
    return String(localStorage.getItem("petitbac_walletToken") || "").trim();
  }

  function identityKey() {
    const token = currentWalletToken();
    if (accountState?.userId) return `account:${accountState.userId}:${token}`;
    if (isGuestMode()) return `guest:${token}`;
    return "signed-out";
  }

  function announceIdentityChange(reason = "identity", { force = false } = {}) {
    const nextKey = identityKey();
    if (!force && nextKey === announcedIdentityKey) return;
    announcedIdentityKey = nextKey;

    document.dispatchEvent(new CustomEvent("ptitbac:identity-changed", {
      detail: {
        reason,
        walletToken: currentWalletToken(),
        guest: isGuestMode(),
        accountUserId: accountState?.userId || ""
      }
    }));
  }

  function clearPlayerCaches({ profile = false } = {}) {
    for (const key of [
      "petitbac_inventory_v1",
      "petitbac_progression_v1",
      "ptitbac_profile_stats_v1",
      "petitbac_stats",
      "petitbac_stats_gamesPlayed",
      "petitbac_stats_wins",
      "petitbac_stats_correctAnswers",
      "petitbac_stats_friendsAdded",
      "petitbac_gamesPlayed",
      "petitbac_wins",
      "petitbac_correctAnswers",
      "petitbac_friendsAdded",
      "petitbac_memberSince"
    ]) {
      localStorage.removeItem(key);
    }

    if (profile) {
      localStorage.removeItem("petitbac_profile_name");
      localStorage.removeItem("petitbac_profile_icon");
    }
  }

  function overlay() {
    return document.getElementById("ptbAccountGate");
  }

  function setMessage(message, kind = "") {
    const node = document.getElementById("ptbAccountMessage");
    if (!node) return;
    node.textContent = String(message || "");
    node.className = `ptb-account-message ${kind ? `is-${kind}` : ""}`;
  }

  function setBusy(value) {
    authBusy = Boolean(value);
    overlay()?.querySelectorAll("button,input").forEach(element => {
      element.disabled = authBusy;
    });
  }

  function closeGate() {
    gateRequired = false;
    overlay()?.remove();
  }

  function baseShell(content, { closable = false } = {}) {
    return `
      <div class="ptb-account-backdrop" aria-hidden="true"></div>
      <section class="ptb-account-card" role="dialog" aria-modal="true" aria-label="Compte P’tit Bac">
        ${closable ? `<button class="ptb-account-close" id="ptbAccountClose" type="button" aria-label="Fermer">×</button>` : ""}
        <div class="ptb-account-brand">
          <img src="/ptitbac.logo.png" alt="P’tit Bac">
          <div>
            <small>Ton espace joueur</small>
            <strong>Compte P’tit Bac</strong>
          </div>
        </div>
        ${content}
        <p id="ptbAccountMessage" class="ptb-account-message" role="status" aria-live="polite"></p>
      </section>`;
  }

  function loginContent() {
    return `
      <div class="ptb-account-tabs" role="tablist" aria-label="Compte">
        <button class="is-active" id="ptbShowLogin" type="button">Connexion</button>
        <button id="ptbShowRegister" type="button">Créer un compte</button>
      </div>
      <form id="ptbLoginForm" class="ptb-account-form">
        <label>
          <span>E-mail</span>
          <input id="ptbLoginEmail" type="email" autocomplete="email" inputmode="email" maxlength="254" required placeholder="ton@email.fr">
        </label>
        <label>
          <span>Mot de passe</span>
          <input id="ptbLoginPassword" type="password" autocomplete="current-password" minlength="8" maxlength="128" required placeholder="••••••••">
        </label>
        <button class="ptb-account-primary" type="submit">Se connecter</button>
      </form>
      <button class="ptb-account-guest" id="ptbContinueGuest" type="button">Continuer en invité</button>
      <small class="ptb-account-note">Ton compte servira à retrouver ton profil, tes pièces, gemmes, vies et ta progression sur un autre appareil.</small>`;
  }

  function registerContent() {
    return `
      <div class="ptb-account-tabs" role="tablist" aria-label="Compte">
        <button id="ptbShowLogin" type="button">Connexion</button>
        <button class="is-active" id="ptbShowRegister" type="button">Créer un compte</button>
      </div>
      <form id="ptbRegisterForm" class="ptb-account-form">
        <label>
          <span>E-mail</span>
          <input id="ptbRegisterEmail" type="email" autocomplete="email" inputmode="email" maxlength="254" required placeholder="ton@email.fr">
        </label>
        <label>
          <span>Mot de passe</span>
          <input id="ptbRegisterPassword" type="password" autocomplete="new-password" minlength="8" maxlength="128" required placeholder="8 caractères minimum">
        </label>
        <label>
          <span>Confirmer</span>
          <input id="ptbRegisterConfirm" type="password" autocomplete="new-password" minlength="8" maxlength="128" required placeholder="Répète ton mot de passe">
        </label>
        <button class="ptb-account-primary" type="submit">Créer mon compte</button>
      </form>
      <button class="ptb-account-guest" id="ptbContinueGuest" type="button">Continuer en invité</button>
      <small class="ptb-account-note">Ton pseudo et ton avatar seront choisis juste après.</small>`;
  }

  function profileSetupContent() {
    const storedName = String(localStorage.getItem("petitbac_profile_name") || "").trim();
    const initialName = storedName && storedName.toLowerCase() !== "joueur"
      ? storedName.slice(0, 16)
      : "";
    const storedAvatar = String(localStorage.getItem("petitbac_profile_icon") || "").trim();
    const initialAvatar = PROFILE_SETUP_AVATARS.includes(storedAvatar)
      ? storedAvatar
      : PROFILE_SETUP_AVATARS[0];

    return `
      <section class="ptb-profile-setup" aria-labelledby="ptbProfileSetupTitle">
        <div class="ptb-profile-setup-head">
          <small>DERNIÈRE ÉTAPE</small>
          <h2 id="ptbProfileSetupTitle">Crée ton profil</h2>
          <p>Choisis le pseudo et l’avatar qui seront affichés aux autres joueurs.</p>
        </div>

        <form id="ptbProfileSetupForm" class="ptb-account-form ptb-profile-setup-form">
          <label>
            <span>Pseudo</span>
            <input
              id="ptbProfileSetupName"
              type="text"
              autocomplete="nickname"
              minlength="2"
              maxlength="16"
              required
              value="${esc(initialName)}"
              placeholder="Ton pseudo"
            >
          </label>

          <fieldset class="ptb-profile-setup-avatars">
            <legend>Choisis ton avatar</legend>
            <div>
              ${PROFILE_SETUP_AVATARS.map((avatar, index) => `
                <button
                  type="button"
                  class="ptb-profile-setup-avatar ${avatar === initialAvatar ? "is-selected" : ""}"
                  data-profile-setup-avatar="${avatar}"
                  aria-label="Avatar ${index + 1}"
                  aria-pressed="${avatar === initialAvatar ? "true" : "false"}"
                >
                  <img src="${avatar}" alt="" draggable="false">
                  <i aria-hidden="true">✓</i>
                </button>
              `).join("")}
            </div>
          </fieldset>

          <input id="ptbProfileSetupAvatar" type="hidden" value="${initialAvatar}">
          <button class="ptb-account-primary" type="submit">Continuer</button>
        </form>
      </section>`;
  }

  function accountContent() {
    const storedName = String(localStorage.getItem("petitbac_profile_name") || "").trim();
    const storedAvatar = String(localStorage.getItem("petitbac_profile_icon") || "").trim();
    const account = {
      ...(accountState || {}),
      username:storedName || accountState?.username || "Joueur",
      avatar:storedAvatar || accountState?.avatar || "/a1.webp"
    };
    return `
      <div class="ptb-account-connected">
        <div class="ptb-account-avatar">
          ${String(account.avatar || "").startsWith("/")
            ? `<img src="${esc(account.avatar)}" alt="">`
            : `<span>${esc(account.avatar || "👤")}</span>`}
        </div>
        <div>
          <small>Connecté</small>
          <strong>${esc(account.username || "Joueur")}</strong>
          <span>${esc(account.email || "")}</span>
        </div>
      </div>
      <div class="ptb-account-security">
        <span>✓ Identité joueur permanente</span>
        <span>✓ Portefeuille lié au compte</span>
        <span>✓ Session restaurable</span>
      </div>
      <button class="ptb-account-secondary" id="ptbAccountLogout" type="button">Se déconnecter</button>`;
  }

  function renderGate(mode = "login", { required = gateRequired } = {}) {
    gateRequired = Boolean(required);
    overlay()?.remove();

    const layer = document.createElement("div");
    layer.id = "ptbAccountGate";
    layer.className = "ptb-account-gate";
    layer.innerHTML = baseShell(
      mode === "account"
        ? accountContent()
        : mode === "register"
          ? registerContent()
          : mode === "profileSetup"
            ? profileSetupContent()
            : loginContent(),
      { closable: !gateRequired && mode !== "profileSetup" }
    );
    document.body.appendChild(layer);

    document.getElementById("ptbAccountClose")?.addEventListener("click", closeGate);
    document.getElementById("ptbShowLogin")?.addEventListener("click", () => renderGate("login", { required:gateRequired }));
    document.getElementById("ptbShowRegister")?.addEventListener("click", () => renderGate("register", { required:gateRequired }));
    document.getElementById("ptbContinueGuest")?.addEventListener("click", () => {
      localStorage.setItem(GUEST_MODE_KEY, "1");
      localStorage.removeItem(ACCOUNT_SESSION_KEY);
      accountState = null;
      markProfileSetupPending();

      const finishGuest = ok => {
        if (ok === false) {
          setBusy(false);
          setMessage("Impossible de créer la session invitée. Réessaie.", "error");
          return;
        }
        setBusy(false);
        announceIdentityChange("guest");
        renderGate("profileSetup", { required:true });
      };

      if (currentWalletToken()) {
        finishGuest(true);
      } else if (typeof initWallet === "function" && socket?.connected) {
        setBusy(true);
        initWallet(finishGuest);
      } else {
        // app.js créera le portefeuille au prochain événement « connect »,
        // uniquement parce que le mode invité vient d'être choisi explicitement.
        finishGuest(true);
      }
    });

    document.querySelectorAll("[data-profile-setup-avatar]").forEach(button => {
      button.addEventListener("click", () => {
        const avatar = String(button.dataset.profileSetupAvatar || "");
        if (!PROFILE_SETUP_AVATARS.includes(avatar)) return;

        const hidden = document.getElementById("ptbProfileSetupAvatar");
        if (hidden) hidden.value = avatar;

        document.querySelectorAll("[data-profile-setup-avatar]").forEach(choice => {
          const selected = choice === button;
          choice.classList.toggle("is-selected", selected);
          choice.setAttribute("aria-pressed", selected ? "true" : "false");
        });
      });
    });

    document.getElementById("ptbLoginForm")?.addEventListener("submit", handleLogin);
    document.getElementById("ptbRegisterForm")?.addEventListener("submit", handleRegister);
    document.getElementById("ptbProfileSetupForm")?.addEventListener("submit", handleProfileSetup);
    document.getElementById("ptbAccountLogout")?.addEventListener("click", handleLogout);
  }

  function emitAck(event, payload, timeoutMs = 12000) {
    return new Promise(resolve => {
      if (!socket?.connected) {
        resolve({ ok:false, error:"Connexion au serveur interrompue." });
        return;
      }
      socket.timeout(timeoutMs).emit(event, payload, (error, response) => {
        if (error) {
          resolve({ ok:false, error:"Le serveur ne répond pas. Réessaie." });
          return;
        }
        resolve(response || { ok:false, error:"Réponse serveur invalide." });
      });
    });
  }

  function saveAccount(result) {
    const account = result?.account;
    if (!account?.sessionToken || !account?.walletToken) return false;

    localStorage.setItem(ACCOUNT_SESSION_KEY, account.sessionToken);
    localStorage.removeItem(GUEST_MODE_KEY);
    localStorage.setItem("petitbac_profile_name", String(account.username || "Joueur"));
    localStorage.setItem("petitbac_profile_icon", String(account.avatar || "/a1.webp"));
    if (account.friendCode) localStorage.setItem("petitbac_friendCode", String(account.friendCode));

    if (account.profileCompleted === false) markProfileSetupPending();
    else if (account.profileCompleted === true) completeProfileSetup();

    accountState = { ...account };
    return true;
  }

  function switchToAccountWallet(account) {
    if (!account?.walletToken) return;

    clearPlayerCaches();

    try {
      clearSession();
      setWalletState(account.walletToken, account.balance);
    } catch {
      session.walletToken = account.walletToken;
      session.walletBalance = Math.max(0, Number(account.balance) || 0);
      localStorage.setItem("petitbac_walletToken", account.walletToken);
      localStorage.setItem("petitbac_walletBalance", String(session.walletBalance));
    }

    if (socket.connected) socket.disconnect();
    announceIdentityChange("account-wallet", { force:true });
    setTimeout(() => socket.connect(), 0);
  }

  async function handleLogin(event) {
    event.preventDefault();
    if (authBusy) return;

    setBusy(true);
    setMessage("Connexion…");
    const result = await emitAck("auth:login", {
      email: document.getElementById("ptbLoginEmail")?.value || "",
      password: document.getElementById("ptbLoginPassword")?.value || ""
    });

    if (!result?.ok || !saveAccount(result)) {
      setBusy(false);
      setMessage(result?.error || "Connexion impossible.", "error");
      return;
    }

    setMessage("Compte connecté.", "success");
    switchToAccountWallet(result.account);
  }

  async function handleRegister(event) {
    event.preventDefault();
    if (authBusy) return;

    const password = document.getElementById("ptbRegisterPassword")?.value || "";
    const confirm = document.getElementById("ptbRegisterConfirm")?.value || "";
    if (password !== confirm) {
      setMessage("Les deux mots de passe sont différents.", "error");
      return;
    }

    setBusy(true);
    setMessage("Création du compte…");
    const result = await emitAck("auth:register", {
      username:"Joueur",
      email: document.getElementById("ptbRegisterEmail")?.value || "",
      password
    }, 15000);

    if (!result?.ok || !saveAccount(result)) {
      setBusy(false);
      setMessage(result?.error || "Création impossible.", "error");
      return;
    }

    markProfileSetupPending();
    setMessage("Compte créé. Choisis maintenant ton profil.", "success");
    switchToAccountWallet(result.account);
  }

  async function handleProfileSetup(event) {
    event.preventDefault();
    if (authBusy) return;

    const name = String(document.getElementById("ptbProfileSetupName")?.value || "")
      .trim()
      .replace(/\s+/g, " ")
      .slice(0, 16);
    const avatar = String(document.getElementById("ptbProfileSetupAvatar")?.value || "").trim();
    const walletToken = currentWalletToken();

    if (name.length < 2) {
      setMessage("Choisis un pseudo d’au moins 2 caractères.", "error");
      return;
    }
    if (!PROFILE_SETUP_AVATARS.includes(avatar)) {
      setMessage("Choisis un avatar.", "error");
      return;
    }
    if (!walletToken || !socket?.connected) {
      setMessage("Connexion au profil en cours. Réessaie dans un instant.", "error");
      return;
    }

    setBusy(true);
    setMessage("Création de ton profil…");

    let profileResult = null;
    let completionResult = null;

    if (accountState?.userId) {
      completionResult = await emitAck("auth:completeProfile", {
        username:name,
        avatar
      }, 12000);

      if (!completionResult?.ok) {
        setBusy(false);
        setMessage(completionResult?.error || "Impossible de finaliser ton profil.", "error");
        return;
      }

      // Le profil du compte, l'avatar équipé et le statut d'onboarding sont
      // désormais enregistrés atomiquement côté serveur. Le bootstrap amis
      // ne sert plus qu'à synchroniser la partie sociale et ne peut plus
      // laisser le compte à moitié configuré en cas d'échec réseau.
      profileResult = await emitAck("friends:bootstrap", {
        walletToken,
        username:name,
        avatar
      }, 12000);
    } else {
      // Un invité n'a pas de compte permanent : il conserve le flux social +
      // inventaire historique, qui sont ses seules sources de persistance.
      profileResult = await emitAck("friends:bootstrap", {
        walletToken,
        username:name,
        avatar
      }, 12000);

      if (!profileResult?.ok) {
        setBusy(false);
        setMessage(profileResult?.error || "Impossible d’enregistrer ton profil.", "error");
        return;
      }

      const inventoryResult = await emitAck("inventory:equip", {
        walletToken,
        type:"avatar",
        id:avatar
      }, 12000);

      if (!inventoryResult?.ok) {
        setBusy(false);
        setMessage(inventoryResult?.error || "Impossible d’équiper cet avatar.", "error");
        return;
      }
    }

    try {
      if (typeof saveProfile === "function") saveProfile(name, avatar);
      else {
        localStorage.setItem("petitbac_profile_name", name);
        localStorage.setItem("petitbac_profile_icon", avatar);
      }
    } catch {
      localStorage.setItem("petitbac_profile_name", name);
      localStorage.setItem("petitbac_profile_icon", avatar);
    }

    const friendCode =
      profileResult?.profile?.friendCode ||
      completionResult?.account?.friendCode ||
      accountState?.friendCode ||
      "";

    if (friendCode) {
      localStorage.setItem("petitbac_friendCode", String(friendCode));
    }

    if (accountState) {
      accountState = {
        ...accountState,
        username:name,
        avatar,
        friendCode,
        profileCompleted:true
      };
    }

    completeProfileSetup();
    setBusy(false);
    closeGate();
    announceIdentityChange("profile-setup", { force:true });

    try { window.PtitBacInventory?.refresh?.(); } catch {}
    try { window.PtitBacFriends?.myProfile?.(); } catch {}

    if (typeof window.renderHome === "function") window.renderHome();
    else enhanceHome();
  }

  async function handleLogout() {
    if (authBusy) return;
    setBusy(true);

    const token = accountSessionToken();
    if (token && socket.connected) {
      await emitAck("auth:logout", { sessionToken:token }, 8000);
    }

    localStorage.removeItem(ACCOUNT_SESSION_KEY);
    localStorage.removeItem(GUEST_MODE_KEY);
    localStorage.removeItem("petitbac_walletToken");
    localStorage.removeItem("petitbac_walletBalance");
    localStorage.removeItem("petitbac_friendCode");
    localStorage.removeItem(PROFILE_SETUP_PENDING_KEY);
    clearPlayerCaches({ profile:true });
    accountState = null;

    try {
      clearSession();
      session.walletToken = "";
      session.walletBalance = 0;
    } catch {}

    announceIdentityChange("logout", { force:true });

    if (socket.connected) socket.disconnect();
    renderGate("login", { required:true });
    setTimeout(() => socket.connect(), 0);
  }

  async function resumeAccount() {
    const token = accountSessionToken();
    if (!token) {
      if (!isGuestMode()) renderGate("login", { required:true });
      else if (profileSetupPending()) renderGate("profileSetup", { required:true });
      return;
    }

    const result = await emitAck("auth:resume", { sessionToken:token }, 10000);
    if (!result?.ok || !result.account?.walletToken) {
      authBusy = false;
      localStorage.removeItem(ACCOUNT_SESSION_KEY);
      accountState = null;
      renderGate("login", { required:true });
      setMessage("Ta session a expiré. Reconnecte-toi.", "error");
      return;
    }

    saveAccount(result);
    const currentWallet = String(session?.walletToken || "");
    if (currentWallet !== result.account.walletToken) {
      switchToAccountWallet(result.account);
      return;
    }

    authBusy = false;
    if (profileSetupPending()) {
      renderGate("profileSetup", { required:true });
      return;
    }
    closeGate();
    announceIdentityChange("account-resume");
    enhanceHome();
  }

  function enhanceHome() {
    const menu = document.getElementById("homeMenu");
    if (!menu || document.getElementById("homeAccount")) return;

    const button = document.createElement("button");
    button.id = "homeAccount";
    button.type = "button";
    button.className = "ptb-home-account-entry";
    button.innerHTML = `
      <span class="ptb-home-account-icon" aria-hidden="true">👤</span>
      <span>${accountState ? "Mon compte" : "Compte"}</span>`;

    const settings = document.getElementById("homeSettings");
    if (settings?.parentNode === menu) settings.after(button);
    else menu.prepend(button);

    button.addEventListener("click", () => {
      document.getElementById("homeMenu")?.setAttribute("hidden", "");
      renderGate(accountState ? "account" : "login", { required:false });
    });
  }

  clearLegacyIdentityOnce();

  if (!accountSessionToken() && !isGuestMode()) {
    renderGate("login", { required:true });
  } else if (profileSetupPending()) {
    renderGate("profileSetup", { required:true });
  }

  function handleExpiredSession() {
    localStorage.removeItem(ACCOUNT_SESSION_KEY);
    localStorage.removeItem("petitbac_walletToken");
    localStorage.removeItem("petitbac_walletBalance");
    localStorage.removeItem(GUEST_MODE_KEY);
    accountState = null;
    clearPlayerCaches();
    clearSession();
    session.walletToken = "";
    session.walletBalance = 0;
    renderGate("login", { required:true });
    setMessage("Ta session a expiré. Reconnecte-toi.", "error");
    socket.disconnect();
    socket.connect();
  }
  socket.on("connect_error", error => {
    if (error?.data?.code === "session_expired") handleExpiredSession();
  });
  socket.on("auth:expired", handleExpiredSession);

  socket.on("connect", () => {
    setTimeout(resumeAccount, 0);
  });

  document.addEventListener("ptitbac:wallet-ready", () => {
    if (isGuestMode() && !accountSessionToken()) {
      announceIdentityChange("guest-wallet");
      if (profileSetupPending()) renderGate("profileSetup", { required:true });
    }
  });

  // Avec les scripts defer, Socket.IO peut déjà être connecté lorsque ce
  // module est évalué. Dans ce cas la session de compte doit quand même être
  // reprise, sans attendre une future reconnexion réseau.
  if (socket?.connected) {
    setTimeout(resumeAccount, 0);
  }

  document.addEventListener("ptitbac:screen-rendered", enhanceHome);
  document.addEventListener("ptitbac:dom-updated", enhanceHome);

  window.PtitBacAccount = {
    open() {
      renderGate(accountState ? "account" : "login", { required:false });
    },
    state() {
      return accountState ? { ...accountState } : null;
    },
    isGuest: isGuestMode,
    resume: resumeAccount
  };
})();
