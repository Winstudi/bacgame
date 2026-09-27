(() => {
  "use strict";

  const FALLBACK_AVATARS = Object.freeze([
    "/a1.webp",
    "/a2.webp",
    "/a3.webp",
    "/a4.webp",
    "/a5.webp"
  ]);

  const PROFILE_STATS_CACHE_KEY = "ptitbac_profile_stats_v1";
  let accountStatsState = null;
  let accountStatsWalletToken = "";

  function esc(value = "") {
    try {
      if (typeof escapeHtml === "function") return escapeHtml(value);
    } catch {}

    return String(value).replace(/[&<>"']/g, char => ({
      "&": "&amp;",
      "<": "&lt;",
      ">": "&gt;",
      '"': "&quot;",
      "'": "&#039;"
    }[char]));
  }

  function avatars() {
    const list = window.PtitBacAvatars?.list;
    return Array.isArray(list) && list.length
      ? list
      : FALLBACK_AVATARS;
  }

  function safeAvatar(value, seed = "") {
    if (window.PtitBacAvatars?.normalize) {
      return window.PtitBacAvatars.normalize(value, seed);
    }

    const list = avatars();
    const avatar = String(value || "").trim();
    return list.includes(avatar) ? avatar : list[0];
  }

  function currentProfile() {
    try {
      if (typeof getProfile === "function") {
        const profile = getProfile() || {};
        return {
          name: String(profile.name || "Joueur").trim().slice(0, 16) || "Joueur",
          icon: safeAvatar(profile.icon, profile.name)
        };
      }
    } catch {}

    const name = String(
      localStorage.getItem("petitbac_profile_name") || "Joueur"
    ).trim().slice(0, 16) || "Joueur";

    return {
      name,
      icon: safeAvatar(
        localStorage.getItem("petitbac_profile_icon"),
        name
      )
    };
  }

  function saveLocalProfile(name, icon) {
    const safeName = String(name || "Joueur")
      .trim()
      .replace(/\s+/g, " ")
      .slice(0, 16) || "Joueur";

    const safeIcon = safeAvatar(icon, safeName);

    try {
      if (typeof saveProfile === "function") {
        saveProfile(safeName, safeIcon);
      } else {
        localStorage.setItem("petitbac_profile_name", safeName);
        localStorage.setItem("petitbac_profile_icon", safeIcon);
      }
    } catch {
      localStorage.setItem("petitbac_profile_name", safeName);
      localStorage.setItem("petitbac_profile_icon", safeIcon);
    }

    return { name: safeName, icon: safeIcon };
  }

  function publicId() {
    const code = String(
      localStorage.getItem("petitbac_friendCode") || ""
    ).trim();

    return /^\d{5}$/.test(code) ? code : "-----";
  }

  function avatarMarkup(value, seed = "") {
    const avatar = safeAvatar(value, seed);
    return `<img src="${esc(avatar)}" alt="" draggable="false">`;
  }

  function readStat(keys, fallback = 0) {
    for (const key of keys) {
      const raw = localStorage.getItem(key);
      if (raw == null || raw === "") continue;
      const value = Number(raw);
      if (Number.isFinite(value)) {
        return Math.max(0, Math.floor(value));
      }
    }
    return fallback;
  }

  function connectedAccount() {
    try {
      return window.PtitBacAccount?.state?.() || null;
    } catch {
      return null;
    }
  }

  function formatMemberSince(value, fallback = "Bêta") {
    if (!value) return fallback;
    const date = new Date(value);
    if (Number.isNaN(date.getTime())) return fallback;
    const month = String(date.getMonth() + 1).padStart(2, "0");
    return `${month}/${date.getFullYear()}`;
  }

  function normalizeAccountStats(value) {
    if (!value || typeof value !== "object") return null;
    const games = Math.max(0, Math.floor(Number(value.games) || 0));
    const wins = Math.max(0, Math.floor(Number(value.wins) || 0));
    const correct = Math.max(0, Math.floor(Number(value.correct) || 0));
    const friends = Math.max(0, Math.floor(Number(value.friends) || 0));
    return {
      games,
      wins,
      correct,
      friends,
      winRate: games > 0 ? Math.min(100, Math.round((wins / games) * 100)) : 0,
      memberSince: formatMemberSince(value.memberSince, "Compte")
    };
  }

  function accountStatsFromCache() {
    const token = walletToken();
    if (!token || !connectedAccount()) return null;
    if (accountStatsWalletToken === token && accountStatsState) {
      return accountStatsState;
    }

    accountStatsWalletToken = token;
    accountStatsState = null;
    try {
      const cached = JSON.parse(localStorage.getItem(PROFILE_STATS_CACHE_KEY) || "null");
      if (cached?.walletToken === token) {
        accountStatsState = normalizeAccountStats(cached.stats);
      }
    } catch {}
    return accountStatsState;
  }

  function saveAccountStats(value) {
    const token = walletToken();
    const stats = normalizeAccountStats(value);
    if (!token || !stats) return null;
    accountStatsWalletToken = token;
    accountStatsState = stats;
    try {
      localStorage.setItem(PROFILE_STATS_CACHE_KEY, JSON.stringify({
        walletToken: token,
        stats: { ...value }
      }));
    } catch {}
    return stats;
  }

  function requestAccountStats() {
    const token = walletToken();
    if (!token || !connectedAccount() || typeof socket === "undefined" || !socket?.connected) {
      return Promise.resolve(null);
    }

    return new Promise(resolve => {
      socket.timeout(8000).emit("auth:profileStats", {}, (error, response) => {
        if (error || !response?.ok || !response.stats) return resolve(null);
        if (walletToken() !== token || !connectedAccount()) return resolve(null);
        resolve(saveAccountStats(response.stats));
      });
    });
  }

  function patchProfileStats(stats) {
    if (!stats) return;
    const values = {
      profileStatGames: stats.games,
      profileStatWins: stats.wins,
      profileStatRate: `${stats.winRate}%`,
      profileStatCorrect: stats.correct,
      profileStatFriends: stats.friends,
      profileStatMember: stats.memberSince
    };
    for (const [id, value] of Object.entries(values)) {
      const node = document.getElementById(id);
      if (node) node.textContent = String(value);
    }
  }

  function getProfileStats() {
    if (connectedAccount()) {
      return accountStatsFromCache() || {
        games:0, wins:0, correct:0, friends:0, winRate:0, memberSince:"Compte"
      };
    }
    let objectStats = {};

    try {
      objectStats = JSON.parse(
        localStorage.getItem("petitbac_stats") || "{}"
      ) || {};
    } catch {}

    const games = Math.max(
      0,
      Math.floor(
        Number(
          objectStats.gamesPlayed ??
          objectStats.partiesPlayed
        ) ||
        readStat(
          ["petitbac_stats_gamesPlayed", "petitbac_gamesPlayed"],
          0
        )
      )
    );

    const wins = Math.max(
      0,
      Math.floor(
        Number(
          objectStats.wins ??
          objectStats.victories
        ) ||
        readStat(
          ["petitbac_stats_wins", "petitbac_wins"],
          0
        )
      )
    );

    const correct = Math.max(
      0,
      Math.floor(
        Number(
          objectStats.correctAnswers ??
          objectStats.answersCorrect
        ) ||
        readStat(
          ["petitbac_stats_correctAnswers", "petitbac_correctAnswers"],
          0
        )
      )
    );

    const friends = Math.max(
      0,
      Math.floor(
        Number(
          objectStats.friendsAdded ??
          objectStats.friends
        ) ||
        readStat(
          ["petitbac_stats_friendsAdded", "petitbac_friendsAdded"],
          0
        )
      )
    );

    const winRate = games > 0
      ? Math.min(100, Math.round((wins / games) * 100))
      : 0;

    let memberSince = String(
      localStorage.getItem("petitbac_memberSince") || ""
    );

    memberSince = formatMemberSince(memberSince, "Bêta");

    return {
      games,
      wins,
      correct,
      friends,
      winRate,
      memberSince
    };
  }

  function editIcon() {
    return `
      <svg viewBox="0 0 24 24" aria-hidden="true">
        <path d="M4 20h4.2L19 9.2 14.8 5 4 15.8V20Z"></path>
        <path d="m13.7 6.1 4.2 4.2"></path>
      </svg>
    `;
  }

  function copyIcon() {
    return `
      <svg viewBox="0 0 24 24" aria-hidden="true">
        <rect x="8" y="7" width="10" height="12" rx="2"></rect>
        <path d="M6 16H5a2 2 0 0 1-2-2V6a2 2 0 0 1 2-2h8a2 2 0 0 1 2 2v1"></path>
      </svg>
    `;
  }

  function statIcon(type) {
    const icons = {
      games: `
        <svg viewBox="0 0 24 24" aria-hidden="true">
          <path d="M8 4h8v3.5c0 3.3-1.7 5.5-4 5.5s-4-2.2-4-5.5V4Z"></path>
          <path d="M8 6H5v1.5c0 2.1 1.3 3.5 3.4 3.8M16 6h3v1.5c0 2.1-1.3 3.5-3.4 3.8M12 13v4M8.5 20h7M10 17h4"></path>
        </svg>`,
      wins: `
        <svg viewBox="0 0 24 24" aria-hidden="true">
          <path d="m3 17 2-9 5 4 2-7 2 7 5-4 2 9H3Z"></path>
          <path d="M5 20h14"></path>
        </svg>`,
      rate: `
        <svg viewBox="0 0 24 24" aria-hidden="true">
          <circle cx="12" cy="12" r="7"></circle>
          <circle cx="12" cy="12" r="3"></circle>
          <path d="M15 9 21 3M17 3h4v4"></path>
        </svg>`,
      correct: `
        <svg viewBox="0 0 24 24" aria-hidden="true">
          <path d="m13 2-8 12h6l-1 8 9-13h-6V2Z"></path>
        </svg>`,
      friends: `
        <svg viewBox="0 0 24 24" aria-hidden="true">
          <circle cx="9" cy="8" r="3"></circle>
          <path d="M3.5 18a5.5 5.5 0 0 1 11 0"></path>
          <circle cx="17" cy="9" r="2.3"></circle>
          <path d="M15.5 14.5c2.7.1 4.7 1.4 5 3.7"></path>
        </svg>`,
      member: `
        <svg viewBox="0 0 24 24" aria-hidden="true">
          <rect x="4" y="5" width="16" height="15" rx="3"></rect>
          <path d="M8 3v4M16 3v4M4 10h16M8 14h2M12 14h2M16 14h1M8 17h2M12 17h2"></path>
        </svg>`
    };

    return icons[type] || icons.games;
  }

  function closeAvatarPicker() {
    const overlay = document.getElementById("profileAvatarPicker");
    if (!overlay) return;

    document.documentElement.classList.remove(
      "profile-avatar-picker-open"
    );
    overlay.remove();
  }

  function openProfileAvatarPicker() {
    closeAvatarPicker();

    const current = currentProfile();
    const selectedAvatar = safeAvatar(current.icon, current.name);
    const list = avatars();

    const overlay = document.createElement("div");
    overlay.id = "profileAvatarPicker";
    overlay.className = "profile-avatar-picker-backdrop";
    overlay.innerHTML = `
      <section
        class="profile-avatar-picker"
        role="dialog"
        aria-modal="true"
        aria-labelledby="profileAvatarPickerTitle"
      >
        <header class="profile-avatar-picker-head">
          <div>
            <small>MON PROFIL</small>
            <h2 id="profileAvatarPickerTitle">Choisir un avatar</h2>
          </div>

          <button
            id="profileAvatarPickerClose"
            class="profile-avatar-picker-close"
            type="button"
            aria-label="Fermer"
          >×</button>
        </header>

        <p class="profile-avatar-picker-subtitle">
          Appuie sur un avatar pour le sélectionner.
        </p>

        <div class="profile-avatar-picker-grid">
          ${list.map((icon, index) => `
            <button
              type="button"
              class="profile-avatar-choice ${icon === selectedAvatar ? "is-selected" : ""}"
              data-avatar="${esc(icon)}"
              aria-label="Choisir l’avatar ${index + 1}"
            >
              <img src="${esc(icon)}" alt="" draggable="false">
              <i aria-hidden="true">✓</i>
            </button>
          `).join("")}
        </div>
      </section>
    `;

    document.body.appendChild(overlay);
    document.documentElement.classList.add(
      "profile-avatar-picker-open"
    );

    const close = () => closeAvatarPicker();

    document
      .getElementById("profileAvatarPickerClose")
      ?.addEventListener("click", close);

    overlay.addEventListener("click", event => {
      if (event.target === overlay) close();
    });

    overlay.querySelectorAll("[data-avatar]").forEach(button => {
      button.addEventListener("click", async () => {
        const nextAvatar = safeAvatar(
          button.dataset.avatar,
          current.name
        );

        overlay.querySelectorAll("button").forEach(item => { item.disabled = true; });
        const response = await equipProfileAvatarOnServer(nextAvatar);
        if (!response?.ok) {
          overlay.querySelectorAll("button").forEach(item => { item.disabled = false; });
          if (typeof toast === "function") {
            toast(response?.error || "Impossible d’équiper cet avatar.");
          }
          return;
        }

        const latest = currentProfile();
        saveLocalProfile(latest.name, nextAvatar);
        close();

        if (typeof toast === "function") {
          toast("Avatar modifié !");
        }

        if (typeof window.renderProfile === "function") {
          window.renderProfile();
        }
      });
    });

    requestAnimationFrame(() => {
      overlay.classList.add("is-open");
      overlay
        .querySelector(".profile-avatar-choice.is-selected")
        ?.focus({ preventScroll: true });
    });
  }

  function confirmNameChange(nextName) {
    return new Promise(resolve => {
      document
        .querySelector(".profile-v16-confirm-layer")
        ?.remove();

      const layer = document.createElement("div");
      layer.className = "profile-v16-confirm-layer";
      layer.innerHTML = `
        <section
          class="profile-v16-confirm"
          role="dialog"
          aria-modal="true"
          aria-labelledby="profileV16ConfirmTitle"
        >
          <button
            class="profile-v16-confirm-close"
            type="button"
            aria-label="Fermer"
          >×</button>

          <h2 id="profileV16ConfirmTitle">
            Changer de pseudo ?
          </h2>

          <p>
            Voulez-vous changer votre pseudo en
            <strong>« ${esc(nextName)} »</strong> ?
          </p>

          <div class="profile-v16-confirm-actions">
            <button
              class="profile-v16-cancel"
              type="button"
            >Annuler</button>

            <button
              class="profile-v16-confirm-btn"
              type="button"
            >Confirmer</button>
          </div>
        </section>
      `;

      let finished = false;

      const finish = result => {
        if (finished) return;
        finished = true;
        layer.remove();
        resolve(Boolean(result));
      };

      layer.addEventListener("click", event => {
        if (event.target === layer) finish(false);
      });

      layer
        .querySelector(".profile-v16-confirm-close")
        ?.addEventListener("click", () => finish(false));

      layer
        .querySelector(".profile-v16-cancel")
        ?.addEventListener("click", () => finish(false));

      layer
        .querySelector(".profile-v16-confirm-btn")
        ?.addEventListener("click", () => finish(true));

      document.body.appendChild(layer);
    });
  }

  function activeGameState() {
    try {
      return typeof session !== "undefined"
        ? session?.state || null
        : null;
    } catch {
      return null;
    }
  }

  function walletToken() {
    try {
      if (typeof session !== "undefined" && session?.walletToken) {
        return String(session.walletToken);
      }
    } catch {}

    return String(
      localStorage.getItem("petitbac_walletToken") || ""
    );
  }

  function equipProfileAvatarOnServer(avatar) {
    return new Promise(resolve => {
      const token = walletToken();
      if (!token || typeof socket === "undefined" || !socket?.connected) {
        resolve({ ok:false, error:"Inventaire indisponible." });
        return;
      }

      socket.timeout(8000).emit("inventory:equip", {
        walletToken: token,
        type: "avatar",
        id: avatar
      }, (error, response) => {
        if (error) {
          resolve({ ok:false, error:"Le serveur ne répond pas. Réessaie." });
          return;
        }
        resolve(response || { ok:false, error:"Impossible d’équiper cet avatar." });
      });
    });
  }

  function updateProfileNameOnServer(name) {
    return new Promise(resolve => {
      const token = walletToken();

      if (
        typeof socket === "undefined" ||
        !socket ||
        !token
      ) {
        resolve({
          ok: false,
          error: "Profil indisponible."
        });
        return;
      }

      socket.emit(
        "profile:update",
        {
          walletToken: token,
          name
        },
        result => resolve(result || {})
      );
    });
  }

  function renderProfileModule() {
    if (activeGameState()) {
      try {
        if (typeof render === "function") return render();
      } catch {}
      return;
    }

    const profile = currentProfile();
    const stats = getProfileStats();

    setScreen(`
      <main class="screen profile-v10 profile-v13">
        <header class="profile-v10-top">
          <button
            id="profileV10Back"
            class="profile-v10-back"
            type="button"
            aria-label="Retour"
          >
            <img src="/back-arrow.png" alt="">
          </button>
          <h1>Mon profil</h1>
          <span
            class="profile-v10-admin-space"
            aria-hidden="true"
          ></span>
        </header>

        <section class="profile-v10-card profile-v10-identity-card">
          <button
            id="profileV10Avatar"
            class="profile-v10-avatar"
            type="button"
            aria-label="Choisir mon avatar"
          >
            <span class="profile-v10-avatar-visual">
              ${avatarMarkup(profile.icon, profile.name)}
            </span>
            <span
              class="profile-v10-avatar-edit"
              aria-hidden="true"
            >${editIcon()}</span>
          </button>

          <div class="profile-v10-identity-copy">
            <div class="profile-v13-field">
              <label for="profileV10Name">Pseudo</label>
              <div class="profile-v10-name-row">
                <input
                  id="profileV10Name"
                  type="text"
                  maxlength="16"
                  autocomplete="nickname"
                  value="${esc(profile.name)}"
                  aria-label="Pseudo"
                >
                <button
                  id="profileV10EditName"
                  type="button"
                  aria-label="Modifier le pseudo"
                >${editIcon()}</button>
              </div>
            </div>

            <div class="profile-v13-field">
              <label>Code ami</label>
              <button
                id="profileV10CopyCode"
                class="profile-v10-code-row"
                type="button"
                aria-label="Copier mon code ami"
              >
                <strong># ${esc(publicId())}</strong>
                <span aria-hidden="true">${copyIcon()}</span>
              </button>
            </div>
          </div>
        </section>

        <section class="profile-v10-card profile-v10-stats">
          <h2>
            <span class="profile-v10-bars" aria-hidden="true">
              <i></i><i></i><i></i>
            </span>
            Mes statistiques
          </h2>

          <div class="profile-v10-stats-grid">
            <article>
              <span class="profile-v10-stat-icon stat-games">
                ${statIcon("games")}
              </span>
              <div>
                <strong id="profileStatGames">${stats.games}</strong>
                <small>Parties jouées</small>
              </div>
            </article>

            <article>
              <span class="profile-v10-stat-icon stat-wins">
                ${statIcon("wins")}
              </span>
              <div>
                <strong id="profileStatWins">${stats.wins}</strong>
                <small>Victoires</small>
              </div>
            </article>

            <article>
              <span class="profile-v10-stat-icon stat-rate">
                ${statIcon("rate")}
              </span>
              <div>
                <strong id="profileStatRate">${stats.winRate}%</strong>
                <small>Taux de victoire</small>
              </div>
            </article>

            <article>
              <span class="profile-v10-stat-icon stat-correct">
                ${statIcon("correct")}
              </span>
              <div>
                <strong id="profileStatCorrect">${stats.correct}</strong>
                <small>Réponses correctes</small>
              </div>
            </article>

            <article>
              <span class="profile-v10-stat-icon stat-friends">
                ${statIcon("friends")}
              </span>
              <div>
                <strong id="profileStatFriends">${stats.friends}</strong>
                <small>Amis</small>
              </div>
            </article>

            <article>
              <span class="profile-v10-stat-icon stat-member">
                ${statIcon("member")}
              </span>
              <div>
                <small>Membre depuis</small>
                <strong id="profileStatMember" class="profile-v10-date">
                  ${esc(stats.memberSince)}
                </strong>
              </div>
            </article>
          </div>
        </section>

        <footer class="ptb-shared-footer" aria-hidden="true">
          <img src="/shared-footer-v1.png" alt="">
        </footer>
      </main>
    `);

    if (connectedAccount()) {
      requestAccountStats().then(patchProfileStats).catch(() => {});
    }

    document
      .getElementById("profileV10Back")
      ?.addEventListener("click", () => {
        if (typeof window.renderHome === "function") {
          window.renderHome();
        }
      });

    document
      .getElementById("profileV10Avatar")
      ?.addEventListener("click", openProfileAvatarPicker);

    const nameInput = document.getElementById("profileV10Name");
    const editNameButton = document.getElementById("profileV10EditName");
    let lastSavedName = profile.name;
    let savingName = false;

    const saveName = async () => {
      if (!nameInput || savingName) return false;

      const next = String(nameInput.value || "")
        .trim()
        .replace(/\s+/g, " ")
        .slice(0, 16);

      if (!next) {
        if (typeof toast === "function") toast("Choisis un pseudo.");
        nameInput.value = lastSavedName;
        return false;
      }

      if (next === lastSavedName) {
        editNameButton?.classList.remove("is-editing");
        return true;
      }

      const confirmed = await confirmNameChange(next);

      if (!confirmed) {
        nameInput.value = lastSavedName;
        editNameButton?.classList.remove("is-editing");
        return false;
      }

      savingName = true;
      editNameButton?.classList.add("is-editing");

      const response = await updateProfileNameOnServer(next);

      savingName = false;
      editNameButton?.classList.remove("is-editing");

      if (!response.ok) {
        nameInput.value = lastSavedName;
        if (typeof toast === "function") {
          toast(
            response.error ||
            "Impossible d’enregistrer le pseudo."
          );
        }
        return false;
      }

      const saved = String(response.name || next)
        .trim()
        .replace(/\s+/g, " ")
        .slice(0, 16) || next;

      const latest = currentProfile();
      saveLocalProfile(saved, latest.icon);

      nameInput.value = saved;
      lastSavedName = saved;

      if (typeof toast === "function") {
        toast("Pseudo modifié !");
      }

      return true;
    };

    nameInput?.addEventListener("focus", () => {
      editNameButton?.classList.add("is-editing");
    });

    nameInput?.addEventListener("input", () => {
      editNameButton?.classList.add("is-editing");
    });

    editNameButton?.addEventListener("click", async () => {
      if (!nameInput) return;

      if (document.activeElement !== nameInput) {
        nameInput.focus();
        try {
          nameInput.setSelectionRange(
            nameInput.value.length,
            nameInput.value.length
          );
        } catch {}
        return;
      }

      await saveName();
      nameInput.blur();
    });

    nameInput?.addEventListener("keydown", async event => {
      if (event.key !== "Enter") return;
      event.preventDefault();
      await saveName();
      nameInput.blur();
    });

    nameInput?.addEventListener("blur", () => {
      void saveName();
    });

    document
      .getElementById("profileV10CopyCode")
      ?.addEventListener("click", async () => {
        const code = publicId();

        try {
          await navigator.clipboard.writeText(code);
          if (typeof toast === "function") toast("Code ami copié !");
        } catch {
          if (typeof toast === "function") toast(`# ${code}`);
        }
      });
  }

  document.addEventListener("ptitbac:identity-changed", () => {
    accountStatsState = null;
    accountStatsWalletToken = "";
  });

  window.openProfileAvatarPicker = openProfileAvatarPicker;
  window.renderProfileEdit = openProfileAvatarPicker;
  window.renderProfile = renderProfileModule;

  try {
    renderProfile = renderProfileModule;
  } catch {}
})();
