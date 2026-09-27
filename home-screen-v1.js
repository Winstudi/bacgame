(() => {
  "use strict";

  let homeTimer = null;

  function economyState() {
    try {
      const live = window.PtitBacEconomy?.state?.();
      if (live) return live;
    } catch {}

    return {
      coins: Number(localStorage.getItem("petitbac_walletBalance") || 0),
      lives: 5,
      maxLives: 5,
      secondsToNext: 0,
      gems: 0
    };
  }

  function formatRecharge(seconds) {
    const total = Math.max(0, Math.floor(Number(seconds) || 0));
    const min = Math.floor(total / 60);
    const sec = total % 60;
    if (min >= 1) return `${min} min`;
    return `${sec}s`;
  }

  function safeAvatar(value) {
    if (window.PtitBacAvatars?.normalize) {
      return window.PtitBacAvatars.normalize(value);
    }

    return "/avatar-base-01.webp";
  }

  function homeAvatarMarkup(value) {
    const avatar = safeAvatar(value);

    if (window.PtitBacAvatars?.isBaseAvatar?.(avatar)) {
      return `<img src="${avatar}" alt="" draggable="false">`;
    }

    return escapeHtml(avatar);
  }

  function refreshHomeResources() {
    const state = economyState();
    const coin = document.getElementById("homePlaqueCoins");
    const lives = document.getElementById("homePlaqueLives");
    const gems = document.getElementById("homeGems");
    const quickLives = document.getElementById("homeQuickLives");

    if (coin) coin.textContent = String(Math.max(0, Number(state.coins) || 0));
    if (lives) {
      lives.textContent =
        `${Math.max(0, Number(state.lives) || 0)}/${Math.max(1, Number(state.maxLives) || 5)}`;
    }
    if (gems) gems.textContent = String(Math.max(0, Number(state.gems) || 0));
    if (quickLives) quickLives.textContent = String(Math.max(0, Number(state.lives) || 0));

    refreshResourcePopup();

    const quick = document.getElementById("homePlaqueQuick");
    if (quick) {
      const disabled = Number(state.lives) < 1;
      quick.disabled = disabled;
      quick.setAttribute("aria-disabled", disabled ? "true" : "false");
    }
  }

  function closeResourcePopup() {
    document.getElementById("homeResourcePopover")?.remove();
  }

  function resourcePopupContent(type) {
    const state = economyState();
    const lives = Math.max(0, Number(state.lives) || 0);
    const maxLives = Math.max(1, Number(state.maxLives) || 5);
    const isFull = lives >= maxLives;

    if (type === "coins") {
      return `
        <div class="home-resource-popup-card home-resource-popup-info" role="dialog" aria-label="À quoi servent les pièces ?">
          <p>
            Les <span class="hm-resource-word is-coins">pièces</span> servent à acheter des cosmétiques.
            Récupérez des <span class="hm-resource-word is-coins">pièces</span> via le pass,
            les évents ou le magasin.
          </p>
        </div>`;
    }

    if (type === "gems") {
      return `
        <div class="home-resource-popup-card home-resource-popup-info" role="dialog" aria-label="À quoi servent les gemmes ?">
          <p>
            Les <span class="hm-resource-word is-gems">gemmes</span> servent à acheter des ressources
            et des cosmétiques. Obtenez des <span class="hm-resource-word is-gems">gemmes</span>
            dans le pass, les évents ou dans le magasin.
          </p>
        </div>`;
    }

    return `
      <div class="home-resource-popup-card home-resource-popup-lives ${isFull ? "is-full" : ""}" role="dialog" aria-label="Mes vies">
        <strong class="home-resource-popup-value">
          <img src="/heart.png" alt="">
          <span>${lives}/${maxLives}</span>
        </strong>

        ${isFull
          ? ""
          : `<small>Prochaine vie : ${formatRecharge(state.secondsToNext)}</small>`}
      </div>`;
  }

  function positionResourcePopup(layer, anchor) {
    const home = document.querySelector(".home-mobile");
    if (!home || !layer || !anchor) return;

    const homeRect = home.getBoundingClientRect();
    const anchorRect = anchor.getBoundingClientRect();
    const popupWidth = 80;

    const center =
      anchorRect.left -
      homeRect.left +
      (anchorRect.width / 2);

    const left =
      Math.max(
        6,
        Math.min(
          homeRect.width - popupWidth - 6,
          center - (popupWidth / 2)
        )
      );

    const top =
      anchorRect.bottom -
      homeRect.top +
      6;

    layer.style.left = `${left}px`;
    layer.style.top = `${top}px`;
  }

  function openResourcePopup(type, anchor) {
    const current = document.getElementById("homeResourcePopover");

    if (current?.dataset.type === type) {
      current.remove();
      return;
    }

    current?.remove();

    const layer = document.createElement("div");
    layer.id = "homeResourcePopover";
    layer.className = "home-resource-popover";
    layer.dataset.type = type;
    layer.dataset.anchorId = anchor?.id || "";
    layer.innerHTML = resourcePopupContent(type);

    document.querySelector(".home-mobile")?.appendChild(layer);
    positionResourcePopup(layer, anchor);

    layer.addEventListener("click", event => {
      event.stopPropagation();
    });

  }

  function refreshResourcePopup() {
    const popup = document.getElementById("homeResourcePopover");
    if (!popup) return;

    const oldCard = popup.querySelector(".home-resource-popup-card");
    if (!oldCard) return;

    const wrapper = document.createElement("div");
    wrapper.innerHTML = resourcePopupContent(popup.dataset.type);
    oldCard.replaceWith(wrapper.firstElementChild);

    const anchor =
      document.getElementById(
        popup.dataset.anchorId || ""
      );

    positionResourcePopup(popup, anchor);
  }

  function bindHomeGameActions() {
    let staleRoomCleanupPending = false;

    const runAfterOldRoomCleanup = action => {
      if (typeof action !== "function") return;

      const code = String(
        session?.code ||
        localStorage.getItem("petitbac_code") ||
        ""
      ).trim().toUpperCase();
      const playerId = String(
        session?.playerId ||
        localStorage.getItem("petitbac_playerId") ||
        ""
      ).trim();

      // Aucun ancien salon connu : on peut continuer immédiatement.
      if (!code || !playerId) {
        action();
        return;
      }

      if (staleRoomCleanupPending) return;
      if (!socket?.connected) {
        toast("Connexion interrompue. Attends la reconnexion.");
        return;
      }

      staleRoomCleanupPending = true;

      const finishWithoutOldRoom = () => {
        staleRoomCleanupPending = false;
        clearSession();
        action();
      };

      const leaveOldRoom = () => {
        socket.timeout(4500).emit(
          "game:leave",
          { code, playerId },
          (leaveError, leaveResponse) => {
            if (leaveError) {
              staleRoomCleanupPending = false;
              toast("Impossible de fermer l’ancienne partie. Réessaie.");
              return;
            }

            // Si le salon/joueur a déjà disparu, la session locale était
            // simplement périmée : elle ne doit pas empêcher une nouvelle partie.
            if (!leaveResponse?.ok) {
              const message = String(leaveResponse?.error || "").toLowerCase();
              const alreadyGone =
                message.includes("introuvable") ||
                message.includes("invalide") ||
                message.includes("session");

              if (!alreadyGone) {
                staleRoomCleanupPending = false;
                toast(leaveResponse?.error || "Impossible de quitter l’ancienne partie.");
                return;
              }
            }

            finishWithoutOldRoom();
          }
        );
      };

      // Après une coupure/rechargement, le serveur conserve volontairement
      // la place quelques secondes pour permettre une reconnexion. On reprend
      // d'abord cette place avec le même portefeuille, puis on la quitte
      // explicitement afin que le serveur retire réellement le joueur.
      socket.timeout(4500).emit(
        "room:reconnect",
        {
          code,
          playerId,
          walletToken:session.walletToken
        },
        (reconnectError, reconnectResponse) => {
          if (!reconnectError && reconnectResponse?.ok) {
            leaveOldRoom();
            return;
          }

          // Le serveur ne connaît plus cette ancienne session : nettoyage local.
          finishWithoutOldRoom();
        }
      );
    };

    const ensureProfile = () => {
      const profile = getProfile();

      if (!String(profile.name || "").trim()) {
        toast("Choisis d’abord ton pseudo.");
        renderProfile();
        return null;
      }

      return {
        ...profile,
        icon: safeAvatar(profile.icon)
      };
    };

    const enterRoom = (response, fallbackError) => {
      if (!response?.ok) {
        toast(response?.error || fallbackError);
        return;
      }

      if (response.walletToken) {
        setWalletState(response.walletToken, response.balance);
      }

      saveSession(response.code, response.playerId);
      session.state = response.state;
      render();
    };

    document.getElementById("homePlaqueAvatar")?.addEventListener("click", renderProfile);

    document.getElementById("homePlaqueCoinsBtn")?.addEventListener("click", event => {
      event.stopPropagation();
      openResourcePopup("coins", event.currentTarget);
    });

    document.getElementById("homePlaqueLivesBtn")?.addEventListener("click", event => {
      event.stopPropagation();
      openResourcePopup("lives", event.currentTarget);
    });

    document.getElementById("homePlaqueQuick")?.addEventListener("click", () => {
      const profile = ensureProfile();
      if (!profile) return;

      const eco = economyState();

      if (Number(eco.lives) < 1) {
        return toast(`Plus de vie. Recharge dans ${formatRecharge(eco.secondsToNext)}.`);
      }

      runAfterOldRoomCleanup(() => {
        window.startQuickPlay(profile);
      });
    });

    document.getElementById("homePlaqueCreate")?.addEventListener("click", () => {
      const profile = ensureProfile();
      if (!profile) return;

      runAfterOldRoomCleanup(() => {
        socket.emit("room:create", {
          name: profile.name.trim(),
          rounds: 1,
          categoryCount: 6,
          categoryDifficulty: "medium",
          duration: 60,
          avatar: profile.icon,
          friendCode: String(localStorage.getItem("petitbac_friendCode") || "").trim(),
          walletToken: session.walletToken
        }, response => enterRoom(response, "Impossible de créer le salon."));
      });
    });

    const codeInput = document.getElementById("homePlaqueCode");

    if (codeInput) {
      codeInput.addEventListener("input", () => {
        codeInput.value = codeInput.value
          .toUpperCase()
          .replace(/[^A-Z0-9]/g, "")
          .slice(0, 5);
      });

      codeInput.addEventListener("keydown", event => {
        if (event.key === "Enter") {
          event.preventDefault();
          document.getElementById("homePlaqueJoin")?.click();
        }
      });
    }

    document.getElementById("homePlaqueJoin")?.addEventListener("click", () => {
      const profile = ensureProfile();
      if (!profile) return;

      const code = String(codeInput?.value || "").trim();

      if (code.length !== 5) {
        return toast("Entre le code à 5 caractères du salon.");
      }

      runAfterOldRoomCleanup(() => {
        socket.emit("room:join", {
          code,
          name: profile.name.trim(),
          avatar: profile.icon,
          friendCode: String(localStorage.getItem("petitbac_friendCode") || "").trim(),
          walletToken: session.walletToken
        }, response => enterRoom(response, "Impossible de rejoindre."));
      });
    });

    document.getElementById("homePlaqueShop")?.addEventListener("click", renderShop);

    // E3: ancien déclencheur admin caché supprimé.
    // L’administration passe uniquement par le menu admin authentifié.
  }

  function chevronIcon() {
    return `
      <span class="hm-chevron" aria-hidden="true">
        <svg viewBox="0 0 24 24">
          <path d="m9 5 7 7-7 7"></path>
        </svg>
      </span>`;
  }

  function refreshHomeAdminEntry() {
    const button = document.getElementById("homeAdminMenu");
    if (!button) return;

    const walletToken = String(
      session?.walletToken ||
      localStorage.getItem("petitbac_walletToken") ||
      ""
    );

    socket.emit("admin:status", { walletToken }, response => {
      if (!button.isConnected) return;
      button.hidden = response?.admin !== true;
    });
  }

  function openHomeAdminMenu() {
    if (window.PtitBacAdmin?.open) {
      window.PtitBacAdmin.open("tools");
      return;
    }

    toast("Menu admin indisponible pour le moment.");
  }

  function renderPlaquetteHome() {
    if (session.state) return render();

    clearInterval(homeTimer);

    const profile = getProfile();
    const coins = getCoins();
    const eco = economyState();
    const lives = Math.max(0, Number(eco.lives) || 0);
    const maxLives = Math.max(1, Number(eco.maxLives) || 5);
    const avatar = safeAvatar(profile.icon);

    const img = file =>
      `<img src="/${file}.png" alt="" draggable="false">`;

    const side = (id, file, label, soon = false) => `
      <button
        type="button"
        id="${id}"
        ${soon ? `data-soon="${label}"` : ""}
        aria-label="${label}${soon ? ", bientôt disponible" : ""}"
      >
        ${img(file)}
        <b>${label}</b>
      </button>`;

    const milestones = [
      ["coin", "100", "is-active"],
      ["gem", "250", "is-active"],
      ["rewards", "500", ""],
      ["rewards", "750", ""],
      ["rewards", "1000", ""]
    ];

    setScreen(`
      <main class="home-mobile">
        <header class="hm-header">
          <button id="homePlaqueAvatar" class="hm-profile" type="button" aria-label="Mon profil">
            <span class="hm-avatar">${homeAvatarMarkup(avatar)}</span>
            <span class="hm-profile-copy">
              <b>${escapeHtml(profile.name || "Mon profil")}</b>
              <small title="Système de niveau à venir">Niv. —</small>
            </span>
          </button>

          <button
            id="homeLevelsOpen"
            type="button"
            aria-label="Ouvrir la page des niveaux"
            style="position:absolute;left:0;top:38px;width:168px;height:68px;padding:0;border:0;background:transparent;z-index:35;opacity:0;pointer-events:auto;touch-action:manipulation;"
          ></button>

          <div class="hm-resources" aria-label="Mes ressources">
            <button id="homePlaqueLivesBtn" type="button" aria-label="Mes vies">
              ${img("heart")}
              <b id="homePlaqueLives" style="font-size:.832rem">${lives}/${maxLives}</b>
            </button>

            <button id="homePlaqueCoinsBtn" type="button" aria-label="Mes pièces">
              ${img("coin")}
              <b id="homePlaqueCoins" style="font-size:.8rem">${coins}</b>
            </button>

            <button id="homeGemButton" type="button" aria-label="Mes gemmes">
              ${img("gem")}
              <b id="homeGems" style="font-size:.832rem">${Math.max(0, Number(eco.gems) || 0)}</b>
            </button>
          </div>

          <button
            id="homeMenuButton"
            class="hm-menu-button"
            type="button"
            aria-label="Ouvrir le menu"
            aria-expanded="false"
            aria-controls="homeMenu"
            style="position:relative"
          >
            <span></span><span></span><span></span>
            <i
              id="homeMenuInboxBadge"
              class="hm-menu-button-badge"
              hidden
              aria-label="Messages non lus"
            >0</i>
          </button>

          <nav id="homeMenu" class="hm-menu" aria-label="Menu" hidden>
            <button id="homeSettings" type="button">${img("settings")}<span>Paramètres</span></button>
            <button id="homeGameJournal" type="button">${img("task")}<span>Journal de partie</span></button>
            <button id="homeInbox" type="button">
              ${img("info")}
              <span>Boîte de réception</span>
              <i id="homeInboxBadge" class="hm-menu-inbox-badge" hidden>0</i>
            </button>
            <button id="homeAdminMenu" class="hm-menu-admin" type="button" hidden>
              ${img("admin-crown")}
              <span>Menu admin</span>
            </button>
            <button id="homeMenuClose" class="hm-menu-close" type="button">Fermer</button>
          </nav>
        </header>

        <section class="hm-hero" aria-label="P’tit Bac">
          <div class="hm-letters" aria-hidden="true">
            <span>A</span><span>C</span><span>E</span><span>B</span>
          </div>

          <nav class="hm-side hm-left" aria-label="Activités">
            ${side("homeQuests", "task", "Quêtes", true)}
            ${side("homePlaqueShop", "shop", "Magasin")}
          </nav>

          <nav class="hm-side hm-right" aria-label="Communauté">
            ${side("homeInfo", "info", "Info", true)}
            ${side("homeFriends", "friends", "Amis")}
          </nav>

          <div class="hm-brand">
            <div class="hm-brand-glow" aria-hidden="true"></div>
            <img
              id="homeBrandLogo"
              class="hm-logo"
              src="/ptitbac.logo.png"
              alt="P’tit Bac"
              fetchpriority="high"
            >
          </div>

          <div class="hm-book" aria-hidden="true">
            <span>ANIMAL<br>PAYS<br>PRÉNOM</span>
            <span>OBJET<br>MÉTIER<br>COULEUR</span>
          </div>
        </section>

        <section class="hm-modes hm-modes-v3" aria-labelledby="homeModesTitle">
          <h1 id="homeModesTitle"><span aria-hidden="true">✦</span>Choisis ton mode de jeu<span aria-hidden="true">✦</span></h1>
          <div class="hm-mode-grid">
            <button id="homePlaqueQuick" class="hm-quick" type="button">
              ${img("lightning")}
              <b>Classique ${chevronIcon()}</b>
              <span class="hm-quick-lives"><span><strong id="homeQuickLives">${lives}</strong> vie(s) restante(s)</span></span>
            </button>
            <button id="homeBomb" class="hm-bomb" type="button" data-soon="Mode Bombe" aria-label="Bombe, bientôt disponible">
              <svg class="hm-bomb-icon" viewBox="0 0 100 100" aria-hidden="true"><defs><radialGradient id="hmBombBody" cx="30%" cy="24%"><stop stop-color="#ad8aff"/><stop offset=".45" stop-color="#6043a4"/><stop offset="1" stop-color="#21133d"/></radialGradient></defs><path d="M61 26Q56 8 78 15" fill="none" stroke="#ffbd57" stroke-width="5"/><path d="m81 3 3 10 11-3-7 9 8 7-12-2-5 12-2-13-12-3 12-3z" fill="#ffde5b" stroke="#ff9026" stroke-width="2"/><path d="m52 23 14 5-4 13-14-5z" fill="#41305d" stroke="#c49cff" stroke-width="2"/><circle cx="47" cy="61" r="32" fill="url(#hmBombBody)" stroke="#c5a4ff" stroke-width="2"/><ellipse cx="34" cy="45" rx="9" ry="5" fill="#eee3ff" opacity=".7" transform="rotate(-35 34 45)"/><path d="M34 65a13 13 0 1 1 26 0q0 8-7 10v6H41v-6q-7-2-7-10" fill="#cbb2ff"/><circle cx="42" cy="64" r="4" fill="#35234f"/><circle cx="53" cy="64" r="4" fill="#35234f"/><path d="m47 70-3 4h6z" fill="#35234f"/></svg>
              <b>Bombe ${chevronIcon()}</b>
            </button>
            <button class="hm-coming" type="button" disabled aria-label="Nouveau mode à venir">
              ${img("join")}
              <b><span>À venir</span></b>
            </button>
          </div>
          <div class="hm-room-actions">
            <button id="homePlaqueCreate" class="hm-room-create" type="button">
              ${img("create")}<b>Créer un salon</b>
            </button>
            <div class="hm-room-join" role="group" aria-label="Rejoindre un salon">
              ${img("join")}
              <input id="homePlaqueCode" aria-label="Code du salon" maxlength="5" autocomplete="off" autocapitalize="characters" spellcheck="false" placeholder="Code du salon…">
              <button id="homePlaqueJoin" type="button">Rejoindre</button>
            </div>
          </div>
        </section>

        <section class="hm-bottom" aria-label="Progression et inventaire">
          <button class="hm-trophies" type="button" data-soon="La voie des trophées">
            <b class="hm-trophies-title">
              ${img("scoreboard-trophy")}
              <span>La voie des trophées</span>
              ${chevronIcon()}
            </b>

            <div class="hm-milestones" aria-hidden="true">
              <div class="hm-trophy-track">
                <span class="hm-trophy-track-fill"></span>
              </div>

              ${milestones.map(([icon, value, state]) => `
                <span class="${state}">
                  <span class="hm-milestone-icon">${img(icon)}</span>
                  <i></i>
                  <small>${value}</small>
                </span>
              `).join("")}
            </div>
          </button>

          <button id="homeInventory" class="hm-inventory" type="button">
            ${img("inventaire")}
            <b>Inventaire ${chevronIcon()}</b>
          </button>
        </section>

        <dialog id="homeDetailDialog" class="hm-dialog">
          <form method="dialog">
            <button class="hm-close" aria-label="Fermer">×</button>
          </form>
          <div id="homeDetailContent"></div>
        </dialog>
      </main>
    `);

    bindHomeGameActions();

    document.getElementById("homeLevelsOpen")?.addEventListener("click", event => {
      event.preventDefault();
      event.stopPropagation();

      if (window.PtitBacProgression?.openLevels) {
        window.PtitBacProgression.openLevels(event.currentTarget);
        return;
      }

      toast("Page des niveaux indisponible pour le moment.");
    });

    const menu = document.getElementById("homeMenu");
    const trigger = document.getElementById("homeMenuButton");
    const screen = document.querySelector(".home-mobile");

    const closeMenu = () => {
      if (!menu || !trigger) return;
      menu.hidden = true;
      trigger.setAttribute("aria-expanded", "false");
    };

    trigger?.addEventListener("click", event => {
      event.stopPropagation();
      menu.hidden = !menu.hidden;
      trigger.setAttribute("aria-expanded", String(!menu.hidden));

      if (!menu.hidden) {
        refreshHomeAdminEntry();
      }
    });

    document.getElementById("homeMenuClose")?.addEventListener("click", () => {
      closeMenu();
      trigger?.focus();
    });

    screen?.addEventListener("click", event => {
      if (!menu?.contains(event.target) && !trigger?.contains(event.target)) {
        closeMenu();
      }

      const resourcePopup =
        document.getElementById("homeResourcePopover");

      if (
        resourcePopup &&
        !resourcePopup.contains(event.target) &&
        !event.target.closest?.(".hm-resources")
      ) {
        closeResourcePopup();
      }
    });

    screen?.addEventListener("keydown", event => {
      if (event.key === "Escape") closeMenu();
    });

    const showDetails = html => {
      closeMenu();
      const content = document.getElementById("homeDetailContent");
      const dialog = document.getElementById("homeDetailDialog");
      if (!content || !dialog) return;

      content.innerHTML = html;
      dialog.showModal();
    };

    document.getElementById("homeGemButton")?.addEventListener("click", event => {
      event.stopPropagation();
      openResourcePopup("gems", event.currentTarget);
    });

    document.querySelectorAll("[data-soon]").forEach(button => {
      button.addEventListener("click", () => {
        toast(`${button.dataset.soon} : bientôt disponible.`);
      });
    });

    document.getElementById("homeFriends")?.addEventListener("click", () => {
      window.PtitBacFriends?.open?.();
    });

    document.getElementById("homeGameJournal")?.addEventListener("click", () => {
      showDetails(`
        <h2>Journal de partie</h2>
        <p>Ton historique de parties apparaîtra ici prochainement.</p>
      `);
    });

    document.getElementById("homeInbox")?.addEventListener("click", () => {
      closeMenu();

      if (window.PtitBacInbox?.open) {
        window.PtitBacInbox.open();
        return;
      }

      toast("Boîte de réception indisponible.");
    });

    document.getElementById("homeAdminMenu")?.addEventListener("click", () => {
      closeMenu();
      openHomeAdminMenu();
    });

    refreshHomeAdminEntry();
    window.PtitBacInbox?.refreshCount?.();

    document.getElementById("homeSettings")?.addEventListener("click", () => {
      showDetails(`
        <h2>Paramètres</h2>
        <p>Les réglages du jeu arrivent bientôt.</p>
      `);
    });

    document.getElementById("homeInventory")?.addEventListener("click", () => {
      if (window.PtitBacInventory?.open) {
        window.PtitBacInventory.open();
        return;
      }

      toast("Inventaire indisponible pour le moment.");
    });

    window.PtitBacEconomy?.refresh?.();
    refreshHomeResources();

    homeTimer = setInterval(() => {
      if (!document.querySelector(".home-mobile")) {
        clearInterval(homeTimer);
        return;
      }

      refreshHomeResources();
    }, 1000);
  }

  window.renderHome = renderPlaquetteHome;

  try {
    renderHome = renderPlaquetteHome;
  } catch {}

  if (!session.state && document.getElementById("app")?.children.length) {
    renderPlaquetteHome();
  }
})();
