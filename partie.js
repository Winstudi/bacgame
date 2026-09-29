/* ==== category-selection-v2.js ==== */
(() => {
  "use strict";

  let categoryExitMenuOpen = false;
  let pendingCategoryReroll = null;

  function categoryRequestId(prefix = "category") {
    try {
      if (globalThis.crypto?.randomUUID) {
        return `${prefix}:${globalThis.crypto.randomUUID()}`;
      }
    } catch {}
    return `${prefix}:${Date.now()}:${Math.random().toString(16).slice(2)}`;
  }

  function renderForfeitWinScreen(payload = {}) {
    if (Number.isFinite(Number(payload.balance))) {
      setWalletState(session.walletToken, Number(payload.balance));
    }

    const reward = Math.max(0, Math.floor(Number(payload.reward || 0)));
    const quitterName = String(payload.quitterName || "L’autre joueur");
    const winnerName = String(payload.winnerName || getProfile()?.name || "Joueur");

    categoryExitMenuOpen = false;
    clearSession();

    setScreen(`
      <main class="screen ptb-forfeit-screen">
        <section class="ptb-forfeit-card">
          <div class="ptb-forfeit-trophy">🏆</div>
          <small>PARTIE TERMINÉE</small>
          <h1>Victoire par forfait</h1>
          <p><strong>${escapeHtml(quitterName)}</strong> a quitté la partie.</p>
          <div class="ptb-forfeit-winner">${escapeHtml(winnerName)} remporte la partie</div>

          ${reward > 0 ? `
            <div class="ptb-forfeit-reward">
              <img src="/coin.png" alt="">
              <strong>+${reward}</strong>
              <span>pièces</span>
            </div>
          ` : ""}

          <button id="forfeitHomeBtn" type="button">Retour à l’accueil</button>
        </section>

        <footer class="ptb-shared-footer" aria-hidden="true">
          <img src="/shared-footer-v1.png" alt="">
        </footer>
      </main>
    `);

    document.getElementById("forfeitHomeBtn")?.addEventListener("click", () => {
      renderHome();
    });
  }

  socket.on("room:closed", payload => {
    if (!payload || payload.reason !== "forfeit_win") return;
    renderForfeitWinScreen(payload);
  });

  function categoryDecorLetters() {
    return "";
  }

  function categoryExitMenu() {
    if (!categoryExitMenuOpen) return "";

    return `
      <div class="cat-v2-exit-backdrop" id="categoryExitBackdrop">
        <section class="cat-v2-exit-modal" role="dialog" aria-modal="true" aria-labelledby="categoryExitTitle">
          <h2 id="categoryExitTitle">Voulez-vous quitter la partie ?</h2>

          <div class="cat-v2-exit-actions">
            <button id="categoryExitNo" class="cat-v2-exit-no" type="button">
              Non
            </button>

            ${me()?.isHost && Number(session.state?.roundIndex ?? -1) < 0 && session.state?.mode !== "quick" ? `<button id="categoryExitLobby" class="cat-v2-exit-lobby" type="button">
              Revenir au salon
            </button>` : ""}

            <button id="categoryExitHome" class="cat-v2-exit-home" type="button">
              Revenir à l’accueil
            </button>
          </div>
        </section>
      </div>`;
  }

  function categoryCoinPill(value, extra = "") {
    return `
      <span class="cat-v2-coin-pill ${extra}">
        <img src="/coin.png" alt="">
        <strong>${Number(value || 0)}</strong>
      </span>
    `;
  }

  function categoryCard(category, index) {
    return `
      <article class="category-pick-card cat-v2-card" style="--pick-index:${index}">
        <span class="category-pick-icon cat-v2-icon">${categoryIcon(category)}</span>
        <strong>${escapeHtml(category)}</strong>
      </article>
    `;
  }

  function categoryChooserAvatar(player) {
    const raw = String(player?.avatar || "").trim();
    const seed = player?.id || player?.name || raw || "category-chooser";

    if (window.PtitBacAvatars?.normalize) {
      return window.PtitBacAvatars.normalize(raw, seed);
    }

    return "/a1.webp";
  }

  function categoryChooserCard(player) {
    const name = String(player?.name || "Un joueur");
    const avatar = categoryChooserAvatar(player);

    return `
      <section class="cat-existing-chooser" data-chooser-id="${escapeHtml(String(player?.id || ""))}" role="status">
        <div class="cat-existing-chooser-avatar">
          <img src="${escapeHtml(avatar)}" alt="" draggable="false">
        </div>

        <div class="cat-existing-chooser-copy">
          <small>C’est à</small>
          <strong>${escapeHtml(name)}</strong>
          <span>de choisir les catégories</span>
        </div>
      </section>
    `;
  }

  let lastDraw = "";
  function renderCategorySelectionV2() {
    if (!session?.state || session.state.phase !== "category_selection") return;

    clearInterval(session.timerHandle);

    const state = session.state;
    session.localAnswers = {};
    const user = me();
    const categories = Array.isArray(state.categories) ? state.categories : [];
    const categoryRerollCost = Number(state.categoryRerollCost || 20);
    const balance = getCoins();
    const chooser = state.players.find(p => p.id === state.categoryChooserPlayerId);
    const host = !!user && user.id === state.categoryChooserPlayerId;
    const insufficient = balance < categoryRerollCost;
    const missingCoins = Math.max(0, categoryRerollCost - balance);
    const drawKey = JSON.stringify([state.code, state.gameSessionId, state.roundIndex, categories]);
    if (pendingCategoryReroll?.drawKey !== drawKey) {
      pendingCategoryReroll = null;
    }
    const reveal = drawKey !== lastDraw;
    lastDraw = drawKey;
    const categoryCountClass =
      categories.length >= 9 ? "cat-v2-many" :
      categories.length >= 7 ? "cat-v2-medium" : "cat-v2-normal";

    setScreen(`
      <main class="screen category-pick-screen cat-v2 cat-prototype ${categoryCountClass} ${reveal ? "cat-reveal" : ""}">
        <div class="cat-v2-glow glow-a"></div>
        <div class="cat-v2-glow glow-b"></div>
        ${categoryDecorLetters()}

        <header class="category-pick-header cat-v2-top">
          ${user
            ? `<button class="pregame-return-btn cat-v2-back" id="returnLobbyCategoriesBtn" type="button" aria-label="Retour au salon">
                <img src="/lobby-exit.png" alt="">
              </button>`
            : `<span class="pregame-return-spacer cat-v2-back-spacer"></span>`}

          <img class="cat-brand" src="/ptitbac.logo.png" alt="P’tit Bac" width="62" height="52">
          ${categoryCoinPill(balance, "cat-v2-balance")}
        </header>

        <nav class="cat-steps" aria-label="Étapes de préparation">
          <span aria-current="step">Catégories</span><i aria-hidden="true">•</i>
          <span>Lettre</span><i aria-hidden="true">•</i><span>À vous de jouer</span>
        </nav>
        <section class="category-pick-copy cat-v2-copy">
          <p>${categories.length} catégories <b>•</b> Niveau ${difficultyLabel(state.categoryDifficulty)}</p>
        </section>

        ${categoryChooserCard(chooser)}

        <section class="category-pick-grid cat-v2-grid" aria-label="Catégories tirées">
          ${categories.map(categoryCard).join("")}
        </section>

        ${host ? `
          <section class="category-pick-actions cat-v2-actions">
            <button class="category-reroll-btn cat-v2-reroll" id="rerollCategoriesBtn" type="button" ${insufficient ? "disabled" : ""}>
              <span class="cat-v2-reroll-title">
                <b class="cat-v2-reroll-icon">↻</b>
                Relancer le tirage
              </span>
              ${categoryCoinPill(categoryRerollCost, "cat-v2-cost")}
              <small>Obtenez ${categories.length} nouvelles catégories aléatoires.</small>
            </button>

            ${insufficient
              ? `<p class="letter-cost-note cat-v2-cost-note">
                  Il te manque ${missingCoins} pièce${missingCoins > 1 ? "s" : ""} pour relancer le tirage.
                </p>`
              : ""}

            <button class="btn btn-primary category-confirm-btn cat-v2-confirm" id="confirmCategoriesBtn" type="button">
              Continuer vers la lettre <span>→</span>
            </button>
          </section>
        ` : `
          <section class="cat-v2-wait">
            <span class="spinner small-spinner"></span>
            <strong>${chooser ? "En attente de " + escapeHtml(chooser.name) + "…" : "En attente d’un joueur…"}</strong>
            <small>Le joueur désigné valide le tirage avant la lettre.</small>
          </section>
        `}

        ${categoryExitMenu()}
      </main>
    `);

    const backBtn = document.getElementById("returnLobbyCategoriesBtn");
    if (backBtn) {
      backBtn.onclick = () => {
        categoryExitMenuOpen = true;
        renderCategorySelectionV2();
      };
    }

    const closeExitMenu = () => {
      categoryExitMenuOpen = false;
      renderCategorySelectionV2();
    };

    document.getElementById("categoryExitNo")?.addEventListener("click", closeExitMenu);

    document.getElementById("categoryExitBackdrop")?.addEventListener("click", event => {
      if (event.target.id === "categoryExitBackdrop") closeExitMenu();
    });

    document.getElementById("categoryExitLobby")?.addEventListener("click", () => {
      const buttons = document.querySelectorAll(".cat-v2-exit-actions button");
      buttons.forEach(button => { button.disabled = true; });

      if (!socket.connected) {
        buttons.forEach(button => { button.disabled = false; });
        categoryExitMenuOpen = true;
        return toast("Connexion interrompue. Attends la reconnexion.");
      }

      categoryExitMenuOpen = false;

      socket.emit(
        "game:returnLobby",
        {
          code: state.code,
          playerId: session.playerId
        }
      );

      setTimeout(() => {
        const current = session.state;
        const stillInPreparation =
          current?.phase === "category_selection" &&
          String(current?.code || "") === String(state.code || "");

        if (socket.connected && stillInPreparation) {
          buttons.forEach(button => { button.disabled = false; });
          categoryExitMenuOpen = true;
          toast("Le retour au salon n’a pas été confirmé. Réessaie.");
        }
      }, 8000);
    });

    document.getElementById("categoryExitHome")?.addEventListener("click", () => {
      const buttons = document.querySelectorAll(".cat-v2-exit-actions button");
      buttons.forEach(button => { button.disabled = true; });

      socket.emit("game:leave", {
        code: state.code,
        playerId: session.playerId
      }, res => {
        if (!res?.ok) {
          buttons.forEach(button => { button.disabled = false; });
          return toast(res?.error || "Impossible de quitter la partie.");
        }

        categoryExitMenuOpen = false;
        clearSession();

        if (typeof initWallet === "function") {
          initWallet(() => {
            renderHome();
            if (res?.message) toast(res.message);
          });
        } else {
          renderHome();
          if (res?.message) toast(res.message);
        }
      });
    });

    if (host) {
      const rerollBtn = document.getElementById("rerollCategoriesBtn");
      const confirmBtn = document.getElementById("confirmCategoriesBtn");

      if (rerollBtn) {
        rerollBtn.onclick = () => {
          if (rerollBtn.disabled) return;
          if (!socket.connected) {
            return toast("Connexion interrompue. Attends la reconnexion.");
          }

          const requestedDrawKey = drawKey;
          const requestId =
            pendingCategoryReroll?.drawKey === requestedDrawKey
              ? pendingCategoryReroll.requestId
              : categoryRequestId("category-reroll");
          pendingCategoryReroll = { drawKey: requestedDrawKey, requestId };

          rerollBtn.classList.add("is-loading");
          rerollBtn.disabled = true;
          if (confirmBtn) confirmBtn.disabled = true;

          socket.emit(
            "game:rerollCategories",
            {
              code: state.code,
              playerId: session.playerId,
              requestId
            }
          );

          setTimeout(() => {
            const current = session.state;
            const currentDrawKey = current
              ? JSON.stringify([
                  current.code,
                  current.gameSessionId,
                  current.roundIndex,
                  Array.isArray(current.categories) ? current.categories : []
                ])
              : "";

            const stillSameDraw =
              current?.phase === "category_selection" &&
              String(current?.categoryChooserPlayerId || "") ===
                String(session.playerId || "") &&
              currentDrawKey === requestedDrawKey;

            if (socket.connected && rerollBtn.isConnected && stillSameDraw) {
              rerollBtn.classList.remove("is-loading");
              rerollBtn.disabled = getCoins() < categoryRerollCost;
              if (confirmBtn?.isConnected) confirmBtn.disabled = false;
              toast("La relance n’a pas été confirmée. Réessaie.");
            }
          }, 8000);
        };
      }

      if (confirmBtn) {
        confirmBtn.onclick = () => {
          if (!socket.connected) {
            return toast("Connexion interrompue. Attends la reconnexion.");
          }

          confirmBtn.disabled = true;
          if (rerollBtn) rerollBtn.disabled = true;

          socket.emit(
            "game:confirmCategories",
            {
              code: state.code,
              playerId: session.playerId
            }
          );

          setTimeout(() => {
            const current = session.state;
            const stillChoosingCategories =
              current?.phase === "category_selection" &&
              String(current?.categoryChooserPlayerId || "") ===
                String(session.playerId || "");

            if (
              socket.connected &&
              confirmBtn.isConnected &&
              stillChoosingCategories
            ) {
              confirmBtn.disabled = false;
              if (rerollBtn?.isConnected) {
                rerollBtn.disabled = getCoins() < categoryRerollCost;
                rerollBtn.classList.remove("is-loading");
              }
              toast("Le passage à la lettre n’a pas été confirmé. Réessaie.");
            }
          }, 8000);
        };
      }
    }
  }

  // Remplace uniquement l'écran de sélection des catégories.
  // Le reste de la logique de partie reste dans app.js.
  window.renderCategorySelection = renderCategorySelectionV2;

  // Dans les scripts classiques, le binding global et window partagent la fonction.
  // Cette affectation couvre aussi les navigateurs qui gardent la référence globale.
  try {
    renderCategorySelection = renderCategorySelectionV2;
  } catch (_) {}
})();

/* ==== letter-wheel-v1.js ==== */
(() => {
  "use strict";

  const LETTERS = "ABCDEFGHIJKLMNOPQRSTUVWXYZ".split("");
  const SEGMENT = 360 / LETTERS.length;

  const runtime = {
    rotation: 0,
    animating: false,
    animationFrame: 0,
    lastVersion: null,
    activeCode: "",
    spinKey: "",
    dragged: false,
    spinAudio: null,
    spinAudioUnlocked: false,
    spinAudioStartedAt: 0
  };
  let pendingLetterReroll = null;

  function letterRequestId(prefix = "letter") {
    try {
      if (globalThis.crypto?.randomUUID) {
        return `${prefix}:${globalThis.crypto.randomUUID()}`;
      }
    } catch {}
    return `${prefix}:${Date.now()}:${Math.random().toString(16).slice(2)}`;
  }

  const clamp = (n, min, max) => Math.max(min, Math.min(max, n));

  function adminCoins() {
    const st = window.PtitBacAdminDisplayState;
    if (st?.admin && st?.infiniteCoins) return "∞";
    if (document.documentElement.classList.contains("ptb-admin-infinite-coins")) return "∞";
    return typeof getCoins === "function" ? String(getCoins()) : "0";
  }

  /* =========================================================
     Effets visuels de la roue
     - étoiles multicolores pendant la rotation
     - burst + rayons + pop de la lettre à l'arrêt
     - animations limitées à transform/opacity pour rester fluides
     ========================================================= */

  const SPIN_STARS = [
    ["8%","23%","14px","0s","1.12s","#b45cff","-10px","-8px"],
    ["19%","9%","11px",".18s","1.34s","#55d8ff","-4px","-11px"],
    ["36%","4%","15px",".42s","1.22s","#ffd95e","3px","-10px"],
    ["58%","5%","12px",".08s","1.45s","#6cf5bb","6px","-11px"],
    ["79%","12%","16px",".31s","1.18s","#ff72ca","10px","-7px"],
    ["92%","30%","11px",".55s","1.32s","#7c78ff","11px","-3px"],
    ["95%","52%","15px",".15s","1.26s","#ffd45c","12px","3px"],
    ["87%","75%","12px",".49s","1.41s","#54dfff","10px","8px"],
    ["69%","89%","16px",".25s","1.20s","#ff72cb","6px","11px"],
    ["47%","94%","11px",".62s","1.30s","#78f1ad","0px","12px"],
    ["27%","89%","14px",".11s","1.38s","#ffd95e","-6px","11px"],
    ["10%","75%","11px",".38s","1.16s","#9d69ff","-11px","7px"],
    ["5%","52%","16px",".68s","1.28s","#59dfff","-12px","2px"],
    ["14%","40%","10px",".23s","1.47s","#ff7bc8","-10px","0px"],
    ["84%","42%","10px",".74s","1.36s","#6cf5bb","10px","0px"],
    ["52%","11%","9px",".35s","1.55s","#ffffff","3px","-10px"]
  ];

  const BURST_STARS = [
    ["50%","1%","22px","0s","#ffd858","0px","-38px"],
    ["71%","7%","18px",".04s","#5ee6ff","25px","-31px"],
    ["89%","22%","21px",".09s","#ff72c9","36px","-22px"],
    ["98%","48%","17px",".13s","#8b69ff","42px","0px"],
    ["89%","74%","20px",".07s","#65efb3","35px","27px"],
    ["69%","91%","18px",".15s","#ffd95e","24px","37px"],
    ["47%","98%","22px",".02s","#ff78c8","0px","43px"],
    ["24%","91%","17px",".11s","#5fddff","-27px","35px"],
    ["8%","76%","21px",".06s","#a76cff","-37px","27px"],
    ["2%","51%","17px",".16s","#ffd95e","-43px","1px"],
    ["10%","26%","20px",".03s","#68f0b6","-36px","-25px"],
    ["28%","8%","17px",".12s","#ff72c9","-24px","-34px"]
  ];

  function wheelFxMarkup() {
    const spinStars =
      SPIN_STARS.map(
        ([x,y,size,delay,duration,color,dx,dy], index) => `
          <i
            class="pbw1-fx-star pbw1-fx-spin-star"
            style="
              --fx-x:${x};
              --fx-y:${y};
              --fx-size:${size};
              --fx-delay:${delay};
              --fx-duration:${duration};
              --fx-color:${color};
              --fx-dx:${dx};
              --fx-dy:${dy};
              --fx-rot:${index % 2 ? "38deg" : "-34deg"};
            "
          ></i>
        `
      ).join("");

    const burstStars =
      BURST_STARS.map(
        ([x,y,size,delay,color,dx,dy], index) => `
          <i
            class="pbw1-fx-star pbw1-fx-burst-star"
            style="
              --fx-x:${x};
              --fx-y:${y};
              --fx-size:${size};
              --fx-delay:${delay};
              --fx-color:${color};
              --fx-dx:${dx};
              --fx-dy:${dy};
              --fx-rot:${index % 2 ? "78deg" : "-72deg"};
            "
          ></i>
        `
      ).join("");

    return `
      <div class="pbw1-fx-layer" aria-hidden="true">
        <div class="pbw1-fx-spin">
          ${spinStars}
        </div>

        <div class="pbw1-fx-land">
          <div class="pbw1-fx-rays"></div>
          <div class="pbw1-fx-glow"></div>
          ${burstStars}
        </div>
      </div>
    `;
  }

  /* =========================================================
     Son de la roue — V4 iOS
     Une seule piste audio de 3,5 s jouée une fois par rotation.
     Aucun play() dans requestAnimationFrame => roue fluide.
     ========================================================= */

  const WHEEL_SPIN_AUDIO = "/letter-wheel-spin.wav";

  function ensureSpinAudio() {
    if (runtime.spinAudio) {
      return runtime.spinAudio;
    }

    if (typeof Audio !== "function") {
      return null;
    }

    const audio =
      new Audio(WHEEL_SPIN_AUDIO);

    audio.preload = "auto";
    audio.volume = 0.85;
    audio.setAttribute(
      "playsinline",
      ""
    );

    runtime.spinAudio = audio;

    return audio;
  }

  function primeSpinAudio() {
    const audio =
      ensureSpinAudio();

    if (!audio) return;

    try {
      audio.load?.();
    } catch {}
  }

  function stopSpinSound() {
    const audio =
      runtime.spinAudio;

    runtime.spinAudioStartedAt = 0;

    if (!audio) return;

    try {
      audio.pause();
      audio.currentTime = 0;
    } catch {}
  }

  function startSpinSoundFromGesture() {
    const audio =
      ensureSpinAudio();

    if (!audio) return false;

    try {
      audio.pause();
      audio.currentTime = 0;
      audio.volume = 0.68;

      runtime.spinAudioStartedAt =
        performance.now();

      const promise =
        audio.play();

      if (
        promise &&
        typeof promise.then ===
          "function"
      ) {
        promise
          .then(() => {
            runtime.spinAudioUnlocked =
              true;
          })
          .catch(() => {
            runtime.spinAudioStartedAt =
              0;
          });
      } else {
        runtime.spinAudioUnlocked =
          true;
      }

      return true;
    } catch {
      runtime.spinAudioStartedAt = 0;
      return false;
    }
  }

  function playSpinSound(duration) {
    if (duration < 0.2) return;

    const audio =
      ensureSpinAudio();

    if (!audio) return;

    /*
      Si le son a déjà été lancé par le clic/tap qui a demandé
      la roue, surtout ne pas le couper/rejouer quand le serveur
      renvoie la lettre. C'est ce qui rend le son fiable sur iOS
      et garde la roue fluide.
    */
    const gestureStartedRecently =
      runtime.spinAudioStartedAt > 0 &&
      performance.now() -
        runtime.spinAudioStartedAt <
        1200 &&
      !audio.paused;

    if (gestureStartedRecently) {
      return;
    }

    try {
      audio.currentTime = 0;
      audio.volume = 0.68;

      const promise =
        audio.play();

      runtime.spinAudioStartedAt =
        performance.now();

      if (
        promise &&
        typeof promise.catch ===
          "function"
      ) {
        promise.catch(() => {
          runtime.spinAudioStartedAt =
            0;
        });
      }
    } catch {
      runtime.spinAudioStartedAt = 0;
    }
  }

  /*
    On prépare le son dès une interaction dans l'application,
    et surtout lors du bouton "Lancer la roue".
  */
  ["pointerdown", "touchstart", "click"]
    .forEach(eventName => {
      window.addEventListener(
        eventName,
        primeSpinAudio,
        {
          once:true,
          passive:true
        }
      );
    });

  function stopAnimation(stopSound = true) {
    if (runtime.animationFrame) {
      cancelAnimationFrame(
        runtime.animationFrame
      );
    }

    runtime.animationFrame = 0;
    runtime.animating = false;

    if (stopSound) {
      stopSpinSound();
    }
  }

  function setRotation(value) {
    runtime.rotation = value;

    const wheel =
      document.getElementById("pbw1Wheel");

    if (!wheel) return;

    wheel.style.setProperty(
      "--pbw1-rotation",
      `${value}deg`
    );

    wheel.style.transform =
      `rotate(${value}deg)`;
  }

  function exactTarget(
    letter,
    start,
    direction = 1
  ) {
    const index =
      Math.max(
        0,
        LETTERS.indexOf(letter)
      );

    // Pointer is at 12 o'clock. Sector centers start at 0deg.
    const desired =
      -index * SEGMENT;

    if (direction >= 0) {
      let target = desired;

      while (
        target <= start + 1440
      ) {
        target += 360;
      }

      return target;
    }

    let target = desired;

    while (
      target >= start - 1440
    ) {
      target -= 360;
    }

    return target;
  }

  function animateToLetter(
    letter,
    version
  ) {
    const wheel =
      document.getElementById("pbw1Wheel");

    const zone =
      document.getElementById("pbw1WheelZone");

    const actions =
      document.getElementById("pbw1Actions");

    if (!wheel) return;

    stopAnimation(false);
    primeSpinAudio();

    runtime.animating = true;

    zone?.classList.remove(
      "is-landed"
    );

    zone?.classList.add(
      "is-spinning"
    );

    const currentCenter =
      document.getElementById(
        "pbw1CenterLetter"
      );

    currentCenter?.classList.remove(
      "pbw1-letter-reveal"
    );

    actions?.classList.remove(
      "is-visible"
    );

    const start =
      runtime.rotation || 0;

    const direction = 1;

    const base =
      exactTarget(
        letter,
        start,
        direction
      );

    const target =
      base + 360 * 3;

    const duration =
      window.matchMedia?.(
        "(prefers-reduced-motion: reduce)"
      ).matches
        ? 1
        : 3500;

    const started =
      performance.now();

    playSpinSound(
      duration / 1000
    );

    const tick = now => {
      if (
        session.state?.phase !==
          "letter_selection" ||
        !document.getElementById(
          "pbw1Wheel"
        )
      ) {
        stopAnimation();
        return;
      }

      const t =
        clamp(
          (now - started) / duration,
          0,
          1
        );

      // Garde une rotation visible jusqu'à la toute fin.
      const eased =
        1 - Math.pow(1 - t, 3);

      // Très léger rebond seulement sur les 3% finaux.
      let value =
        start +
        (target - start) * eased;

      if (t > 0.97) {
        const local =
          (t - 0.97) / 0.03;

        value +=
          Math.sin(
            local * Math.PI
          ) * 0.65;
      }

      setRotation(value);

      if (t < 1) {
        runtime.animationFrame =
          requestAnimationFrame(tick);

        return;
      }

      setRotation(target);

      // Affiche la lettre sur la même frame que l'arrêt exact de la roue.
      const center =
        document.getElementById(
          "pbw1CenterLetter"
        );

      const landedZone =
        document.getElementById(
          "pbw1WheelZone"
        );

      if (center) {
        center.textContent = letter;
        center.classList.remove(
          "pbw1-letter-reveal"
        );

        // Force un nouveau départ de l'animation même après une relance.
        void center.offsetWidth;

        center.classList.add(
          "pbw1-letter-reveal"
        );
      }

      runtime.animating = false;
      runtime.lastVersion = version;

      landedZone?.classList.remove(
        "is-spinning"
      );

      landedZone?.classList.remove(
        "is-landed"
      );

      if (landedZone) {
        // Même principe : permet de rejouer le burst après un reroll.
        void landedZone.offsetWidth;
        landedZone.classList.add(
          "is-landed"
        );
      }

      const revealDelay =
        window.matchMedia?.(
          "(prefers-reduced-motion: reduce)"
        ).matches
          ? 0
          : 740;

      window.setTimeout(
        () => {
          if (
            session.state?.phase !==
            "letter_selection"
          ) {
            return;
          }

          document
            .getElementById(
              "pbw1Actions"
            )
            ?.classList.add(
              "is-visible"
            );
        },
        revealDelay
      );
    };

    runtime.animationFrame =
      requestAnimationFrame(tick);
  }

  function renderLetterWheelV1() {
    clearInterval(
      session.timerHandle
    );

    const state =
      session.state;

    const user =
      me();

    if (
      !state ||
      state.phase !==
        "letter_selection"
    ) {
      return render();
    }

    const contextKey =
      JSON.stringify([
        state.code,
        state.gameSessionId,
        state.roundIndex
      ]);

    if (
      runtime.activeCode !==
        contextKey ||
      !state.pendingLetter
    ) {
      stopAnimation();

      runtime.lastVersion = null;
      runtime.spinKey = "";
      runtime.rotation = 0;
    }

    runtime.activeCode =
      contextKey;

    const chooser =
      state.players.find(
        p =>
          p.id ===
          state.letterChooserPlayerId
      );

    const isChooser =
      user?.id ===
      state.letterChooserPlayerId;

    const selectedLetter =
      String(
        state.pendingLetter || ""
      ).slice(0, 1);

    const version =
      Number(
        state.letterSpinVersion || 0
      );

    const rerollCost =
      Number(
        state.letterRerollCost || 20
      );

    const letterRerollContextKey = JSON.stringify([
      state.code,
      state.gameSessionId,
      state.roundIndex,
      version,
      selectedLetter
    ]);

    if (pendingLetterReroll?.contextKey !== letterRerollContextKey) {
      pendingLetterReroll = null;
    }

    const canReroll =
      typeof getCoins !== "function" ||
      getCoins() >= rerollCost;

    const sectors =
      LETTERS.map((_, i) => {
        const start =
          i * SEGMENT;

        const end =
          (i + 1) * SEGMENT;

        const color =
          i % 2
            ? "#242166"
            : "#7534c9";

        return (
          `${color} ${start}deg ${end}deg`
        );
      }).join(",");

    const labels =
      LETTERS.map(
        (letter, i) => {
          const angle =
            i * SEGMENT;

          return `
            <span
              class="pbw1-letter"
              style="--pbw1-angle:${angle}deg"
            >
              <b>${letter}</b>
            </span>
          `;
        }
      ).join("");

    const chooserName =
      chooser?.name ||
      "Un joueur";

    setScreen(`
      <main class="pbw1-screen letter-prototype">
        <header class="pbw1-top">
          <button
            class="pbw1-exit"
            id="pbw1Exit"
            type="button"
            aria-label="Quitter"
          >
            <img
              src="/lobby-exit.png"
              alt=""
            >
          </button>

          <img
            class="pbw1-brand"
            src="/ptitbac.logo.png"
            alt="P’tit Bac"
            width="62"
            height="52"
          >

          <div class="pbw1-wallet">
            <img
              src="/coin.png"
              alt=""
            >
            <strong>${adminCoins()}</strong>
          </div>
        </header>

        <nav
          class="pbw1-steps"
          aria-label="Étapes de la manche"
        >
          <span>Catégories</span>
          <i>•</i>
          <strong aria-current="step">
            Lettre
          </strong>
          <i>•</i>
          <span>À vous de jouer</span>
        </nav>

        <section class="pbw1-chooser">
          <div class="pbw1-lightning">
            <img
              src="/lightning.png"
              alt=""
            >
          </div>

          <div class="pbw1-chooser-copy">
            <small>C’est à</small>
            <strong>
              ${escapeHtml(chooserName)}
            </strong>
            <span>
              de lancer la roue
            </span>
          </div>
        </section>

        <section
          class="pbw1-wheel-zone ${
            isChooser &&
            !selectedLetter
              ? "is-ready"
              : ""
          }"
          id="pbw1WheelZone"
          ${
            isChooser &&
            !selectedLetter
              ? 'role="button" tabindex="0" aria-label="Lancer la roue"'
              : ""
          }
        >
          ${wheelFxMarkup()}

          <div
            class="pbw1-pointer"
            aria-hidden="true"
          ></div>

          <div class="pbw1-wheel-shell">
            <div
              class="pbw1-wheel"
              id="pbw1Wheel"
              style="
                --pbw1-sectors:
                  conic-gradient(
                    from -${SEGMENT / 2}deg,
                    ${sectors}
                  );
                --pbw1-rotation:
                  ${runtime.rotation}deg
              "
            >
              ${labels}
            </div>

            <div
              class="pbw1-center"
              id="pbw1Center"
            >
              <strong
                id="pbw1CenterLetter"
                aria-live="polite"
              >
                ↻
              </strong>
            </div>
          </div>
        </section>

        ${
          isChooser &&
          selectedLetter
            ? `
              <section
                class="pbw1-actions ${
                  runtime.lastVersion ===
                  version
                    ? "is-visible"
                    : ""
                }"
                id="pbw1Actions"
              >
                ${
                  state.mode !== "quick"
                    ? `
                      <button
                        class="pbw1-reroll"
                        id="pbw1Reroll"
                        type="button"
                        ${
                          canReroll
                            ? ""
                            : "disabled"
                        }
                      >
                        <span>
                          ↻ Relancer
                        </span>

                        <b>
                          <img
                            src="/coin.png"
                            alt=""
                          >
                          ${rerollCost}
                        </b>
                      </button>
                    `
                    : ""
                }

                <button
                  class="pbw1-confirm"
                  id="pbw1Confirm"
                  type="button"
                >
                  Valider la lettre
                  ${escapeHtml(
                    selectedLetter
                  )}
                  <span>→</span>
                </button>
              </section>
            `
            : isChooser
              ? `
                <section
                  class="pbw1-actions is-visible"
                >
                  <button
                    class="pbw1-confirm"
                    id="pbw1Launch"
                    type="button"
                  >
                    Lancer la roue
                    <span>↻</span>
                  </button>
                </section>
              `
              : `
                <p
                  class="pbw1-wait"
                  role="status"
                >
                  ${
                    selectedLetter
                      ? "La lettre va être validée…"
                      : `En attente de ${escapeHtml(
                          chooserName
                        )}…`
                  }
                </p>
              `
        }
      </main>
    `);

    setRotation(
      runtime.rotation
    );

    document
      .getElementById(
        "pbw1Exit"
      )
      ?.addEventListener(
        "click",
        () =>
          gameExitModal(
            state,
            user,
            "pbw1"
          )
      );

    if (selectedLetter) {
      if (
        runtime.lastVersion !==
        version
      ) {
        const spinKey =
          version +
          ":" +
          selectedLetter;

        if (
          !runtime.animating ||
          runtime.spinKey !==
            spinKey
        ) {
          runtime.spinKey =
            spinKey;

          animateToLetter(
            selectedLetter,
            version
          );
        }
      } else {
        document
          .getElementById(
            "pbw1Actions"
          )
          ?.classList.add(
            "is-visible"
          );

        const center =
          document.getElementById(
            "pbw1CenterLetter"
          );

        if (center) {
          center.textContent =
            selectedLetter;
        }
      }
    }

    if (
      isChooser &&
      !selectedLetter
    ) {
      const zone =
        document.getElementById(
          "pbw1WheelZone"
        );

      const wheel =
        document.getElementById(
          "pbw1Wheel"
        );

      let dragging = false;
      let moved = false;
      let previousAngle = 0;
      let localRotation =
        runtime.rotation;

      const pointerAngle = e => {
        const rect =
          zone.getBoundingClientRect();

        const cx =
          rect.left +
          rect.width / 2;

        const cy =
          rect.top +
          rect.height / 2;

        return (
          Math.atan2(
            e.clientY - cy,
            e.clientX - cx
          ) *
          180 /
          Math.PI
        );
      };

      const shortestDelta =
        (a, b) => {
          let d = a - b;

          while (d > 180) {
            d -= 360;
          }

          while (d < -180) {
            d += 360;
          }

          return d;
        };

      const launch = () => {
        if (
          zone.classList.contains(
            "is-requesting"
          )
        ) {
          return;
        }

        if (!socket.connected) {
          return toast(
            "Connexion interrompue. Attends la reconnexion."
          );
        }

        startSpinSoundFromGesture();

        zone.classList.add(
          "is-requesting"
        );

        const button =
          document.getElementById(
            "pbw1Launch"
          );

        if (button) {
          button.disabled = true;
          button.textContent =
            "Lancement…";
        }

        socket.emit(
          "game:spinLetter",
          {
            code:state.code,
            playerId:
              session.playerId
          }
        );

        setTimeout(() => {
          const current =
            session.state;

          const stillWaitingForSpin =
            current?.phase ===
              "letter_selection" &&
            String(
              current?.letterChooserPlayerId ||
              ""
            ) === String(
              session.playerId ||
              ""
            ) &&
            !current?.pendingLetter;

          if (
            socket.connected &&
            zone.isConnected &&
            stillWaitingForSpin
          ) {
            zone.classList.remove(
              "is-requesting"
            );

            stopSpinSound();

            if (button?.isConnected) {
              button.disabled = false;
              button.innerHTML =
                'Lancer la roue <span>↻</span>';
            }

            toast(
              "Le lancement de la roue n’a pas été confirmé. Réessaie."
            );
          }
        }, 8000);
      };

      document
        .getElementById(
          "pbw1Launch"
        )
        ?.addEventListener(
          "click",
          launch
        );

      zone.addEventListener(
        "pointerdown",
        e => {
          if (
            runtime.animating
          ) {
            return;
          }

          primeSpinAudio();

          dragging = true;
          moved = false;

          previousAngle =
            pointerAngle(e);

          localRotation =
            runtime.rotation;

          zone.setPointerCapture?.(
            e.pointerId
          );

          e.preventDefault();
        }
      );

      zone.addEventListener(
        "pointermove",
        e => {
          if (!dragging) return;

          const angle =
            pointerAngle(e);

          const delta =
            shortestDelta(
              angle,
              previousAngle
            );

          if (
            Math.abs(delta) >
            0.8
          ) {
            moved = true;
          }

          localRotation +=
            delta;

          previousAngle =
            angle;

          setRotation(
            localRotation
          );

          e.preventDefault();
        }
      );

      const finish = e => {
        if (!dragging) return;

        dragging = false;

        zone.releasePointerCapture?.(
          e.pointerId
        );

        launch();
      };

      zone.addEventListener(
        "pointerup",
        finish
      );

      zone.addEventListener(
        "pointercancel",
        () => {
          dragging = false;
          moved = true;
        }
      );

      zone.addEventListener(
        "click",
        () => {
          if (!moved) {
            launch();
          }
        }
      );

      zone.addEventListener(
        "keydown",
        e => {
          if (
            e.key !== "Enter" &&
            e.key !== " "
          ) {
            return;
          }

          e.preventDefault();
          launch();
        }
      );

      if (wheel) {
        wheel.style.touchAction =
          "none";
      }
    }

    document
      .getElementById(
        "pbw1Reroll"
      )
      ?.addEventListener(
        "click",
        () => {
          if (
            runtime.animating ||
            runtime.lastVersion !==
              version
          ) {
            return;
          }

          if (!canReroll) {
            return toast(
              `Il te faut ${rerollCost} pièces pour relancer.`
            );
          }

          startSpinSoundFromGesture();

          const reroll =
            document.getElementById(
              "pbw1Reroll"
            );

          const confirm =
            document.getElementById(
              "pbw1Confirm"
            );

          if (reroll) {
            reroll.disabled = true;
          }

          if (confirm) {
            confirm.disabled = true;
          }

          if (!socket.connected) {
            if (reroll) {
              reroll.disabled = !canReroll;
            }
            if (confirm) {
              confirm.disabled = false;
            }
            stopSpinSound();
            return toast(
              "Connexion interrompue. Attends la reconnexion."
            );
          }

          const requestedVersion =
            version;

          const requestedLetter =
            selectedLetter;

          const requestId =
            pendingLetterReroll?.contextKey === letterRerollContextKey
              ? pendingLetterReroll.requestId
              : letterRequestId("letter-reroll");
          pendingLetterReroll = {
            contextKey: letterRerollContextKey,
            requestId
          };

          socket.emit(
            "game:rerollLetter",
            {
              code:state.code,
              playerId:
                session.playerId,
              requestId
            }
          );

          setTimeout(() => {
            const current =
              session.state;

            const stillSameLetter =
              current?.phase ===
                "letter_selection" &&
              String(
                current?.letterChooserPlayerId ||
                ""
              ) === String(
                session.playerId ||
                ""
              ) &&
              Number(
                current?.letterSpinVersion ||
                0
              ) === requestedVersion &&
              String(
                current?.pendingLetter ||
                ""
              ).slice(0,1) ===
                requestedLetter;

            if (socket.connected && stillSameLetter) {
              stopSpinSound();

              if (reroll?.isConnected) {
                reroll.disabled =
                  typeof getCoins ===
                    "function" &&
                  getCoins() <
                    rerollCost;
              }

              if (confirm?.isConnected) {
                confirm.disabled = false;
              }

              toast(
                "La relance de la lettre n’a pas été confirmée. Réessaie."
              );
            }
          }, 8000);
        }
      );

    document
      .getElementById(
        "pbw1Confirm"
      )
      ?.addEventListener(
        "click",
        () => {
          if (
            runtime.animating ||
            runtime.lastVersion !==
              version
          ) {
            return;
          }

          const reroll =
            document.getElementById(
              "pbw1Reroll"
            );

          const confirm =
            document.getElementById(
              "pbw1Confirm"
            );

          if (reroll) {
            reroll.disabled = true;
          }

          if (confirm) {
            confirm.disabled = true;
          }

          if (!socket.connected) {
            if (reroll) {
              reroll.disabled = !canReroll;
            }
            if (confirm) {
              confirm.disabled = false;
            }
            return toast(
              "Connexion interrompue. Attends la reconnexion."
            );
          }

          socket.emit(
            "game:confirmLetter",
            {
              code:state.code,
              playerId:
                session.playerId
            }
          );

          setTimeout(() => {
            const current =
              session.state;

            const stillWaitingForConfirm =
              current?.phase ===
                "letter_selection" &&
              String(
                current?.letterChooserPlayerId ||
                ""
              ) === String(
                session.playerId ||
                ""
              ) &&
              String(
                current?.pendingLetter ||
                ""
              ).slice(0,1) ===
                selectedLetter;

            if (socket.connected && stillWaitingForConfirm) {
              if (reroll?.isConnected) {
                reroll.disabled =
                  typeof getCoins ===
                    "function" &&
                  getCoins() <
                    rerollCost;
              }

              if (confirm?.isConnected) {
                confirm.disabled = false;
              }

              toast(
                "Le lancement de la manche n’a pas été confirmé. Réessaie."
              );
            }
          }, 10000);
        }
      );
  }

  // Nouveau point d'entrée unique pour la phase letter_selection.
  window.renderLetterSelection =
    renderLetterWheelV1;

  try {
    renderLetterSelection =
      renderLetterWheelV1;
  } catch {}
})();

/* ==== answer-screen-v1.js ==== */
(() => {
  "use strict";

  let cleanupViewportBinding = null;

  function esc(value = "") {
    try {
      return escapeHtml(value);
    } catch {
      return String(value).replace(
        /[&<>"']/g,
        char => ({
          "&":"&amp;",
          "<":"&lt;",
          ">":"&gt;",
          '"':"&quot;",
          "'":"&#039;"
        }[char])
      );
    }
  }

  function icon(category) {
    try {
      return categoryIcon(category);
    } catch {
      return "✨";
    }
  }

  function bindViewport(screen) {
    cleanupViewportBinding?.();

    const viewport = window.visualViewport;
    let baselineHeight =
      viewport?.height ||
      window.innerHeight ||
      document.documentElement.clientHeight;

    let raf = 0;
    let observer = null;
    let cleaned = false;

    const activeAnswerInput = () =>
      document.activeElement?.classList?.contains("asv1-input");

    const sync = () => {
      cancelAnimationFrame(raf);

      raf = requestAnimationFrame(() => {
        if (!screen.isConnected) {
          cleanup();
          return;
        }

        const height =
          viewport?.height ||
          window.innerHeight ||
          document.documentElement.clientHeight;

        if (!activeAnswerInput()) {
          baselineHeight = Math.max(
            baselineHeight,
            height
          );
        }

        const keyboardOpen =
          activeAnswerInput() &&
          baselineHeight - height > 100;

        const offsetTop =
          keyboardOpen
            ? Math.max(
                0,
                Math.round(
                  viewport?.offsetTop || 0
                )
              )
            : 0;

        screen.style.setProperty(
          "--asv1-vh",
          `${Math.max(320, Math.round(height))}px`
        );

        screen.style.setProperty(
          "--asv1-vv-top",
          `${offsetTop}px`
        );

        screen.classList.toggle(
          "is-keyboard-open",
          keyboardOpen
        );

        if (window.scrollY !== 0) {
          window.scrollTo(0,0);
        }

        if (document.documentElement.scrollTop) {
          document.documentElement.scrollTop = 0;
        }

        if (document.body.scrollTop) {
          document.body.scrollTop = 0;
        }
      });
    };

    const delayedSync = () => {
      sync();
      setTimeout(sync, 80);
      setTimeout(sync, 260);
    };

    function cleanup() {
      if (cleaned) return;
      cleaned = true;

      cancelAnimationFrame(raf);

      viewport?.removeEventListener("resize", sync);
      viewport?.removeEventListener("scroll", sync);
      window.removeEventListener("resize", sync);
      window.removeEventListener(
        "orientationchange",
        delayedSync
      );

      observer?.disconnect();

      if (cleanupViewportBinding === cleanup) {
        cleanupViewportBinding = null;
      }
    }

    viewport?.addEventListener("resize", sync);
    viewport?.addEventListener("scroll", sync);
    window.addEventListener("resize", sync);
    window.addEventListener(
      "orientationchange",
      delayedSync
    );

    observer = new MutationObserver(() => {
      if (!screen.isConnected) cleanup();
    });

    observer.observe(
      document.getElementById("app") || document.body,
      {
        childList:true,
        subtree:true
      }
    );

    cleanupViewportBinding = cleanup;

    sync();

    return {
      sync,
      delayedSync,
      cleanup
    };
  }

  function renderAnswerScreenV1() {
    clearInterval(session.timerHandle);
    cleanupViewportBinding?.();

    const state = session.state;

    if (!state || state.phase !== "round") {
      return;
    }

    const categories =
      Array.isArray(state.categories)
        ? state.categories
        : [];

    const letter =
      String(state.currentLetter || "?")
        .slice(0,1)
        .toUpperCase();

    const fields = categories
      .map((category, index) => {
        const key = answerKey(category);
        const value =
          session.localAnswers[key] || "";

        const isLast =
          index === categories.length - 1;

        return `
          <div
            class="asv1-row ${value ? "has-value" : ""}"
            data-answer-row="${index}"
          >
            <div class="asv1-category">
              <span aria-hidden="true">${icon(category)}</span>
              <strong title="${esc(category)}">${esc(category)}</strong>
            </div>

            <div class="asv1-input-wrap">
              <input
                class="answer-input asv1-input"
                data-category="${esc(category)}"
                data-answer-index="${index}"
                maxlength="60"
                autocomplete="off"
                autocorrect="off"
                autocapitalize="words"
                spellcheck="false"
                inputmode="text"
                enterkeyhint="${isLast ? "done" : "next"}"
                aria-label="${esc(category)}"
                placeholder="Ta réponse..."
                value="${esc(value)}"
              >

              <button
                type="button"
                class="asv1-clear"
                data-clear-index="${index}"
                aria-label="Effacer la réponse"
              >×</button>
            </div>
          </div>`;
      })
      .join("");

    setScreen(`
      <main class="asv1-screen">
        <header class="asv1-header">
          <button
            class="asv1-quit"
            id="leaveGameBtn"
            type="button"
            aria-label="Quitter la partie"
          >
            <img src="/lobby-exit.png" alt="">
          </button>

          <span class="asv1-round-mini">
            <span>Manche</span>
            <strong>${Number(state.roundIndex || 0) + 1}/${Number(state.rounds || 1)}</strong>
          </span>
        </header>

        <section class="asv1-hero" aria-label="Lettre et temps restant">
          <div class="asv1-letter-card">
            <small>Lettre actuelle</small>
            <strong>${esc(letter)}</strong>
          </div>

          <div
            class="asv1-timer"
            id="timerRing"
            style="--progress:100%"
            aria-label="Temps restant"
          >
            <div>
              <strong id="timer">${Number(state.duration || 0)}</strong>
              <span>secondes</span>
            </div>
          </div>
        </section>

        <section
          class="asv1-list"
          id="answerList"
          aria-label="Réponses"
        >
          ${fields}
        </section>

        <div class="asv1-submit-wrap">
          <button
            class="asv1-submit"
            id="submitRound"
            type="button"
          >
            <span aria-hidden="true">➤</span>
            Valider mes réponses
          </button>
        </div>
      </main>
    `);

    const screen =
      document.querySelector(".asv1-screen");

    const list =
      document.getElementById("answerList");

    const inputs =
      [...document.querySelectorAll(".asv1-input")];

    const viewportBinding =
      screen
        ? bindViewport(screen)
        : null;

    const keepInputVisible = input => {
      setTimeout(() => {
        if (
          !input?.isConnected ||
          !list?.isConnected
        ) {
          return;
        }

        const row =
          input.closest(".asv1-row");

        if (!row) return;

        const rowTop =
          row.offsetTop;

        const rowBottom =
          rowTop + row.offsetHeight;

        const viewTop =
          list.scrollTop;

        const viewBottom =
          viewTop + list.clientHeight;

        const margin = 8;

        if (rowTop < viewTop + margin) {
          list.scrollTo({
            top:Math.max(
              0,
              rowTop - margin
            ),
            behavior:"auto"
          });
        } else if (
          rowBottom >
          viewBottom - margin
        ) {
          list.scrollTo({
            top:Math.max(
              0,
              rowBottom -
              list.clientHeight +
              margin
            ),
            behavior:"auto"
          });
        }

        if (window.scrollY !== 0) {
          window.scrollTo(0,0);
        }
      }, 280);
    };

    inputs.forEach((input, index) => {
      const row =
        input.closest(".asv1-row");

      input.addEventListener("focus", () => {
        row?.classList.add("is-active");
        viewportBinding?.delayedSync();
        keepInputVisible(input);
      });

      input.addEventListener("blur", () => {
        row?.classList.remove("is-active");
        viewportBinding?.delayedSync();
      });

      input.addEventListener("input", event => {
        const category =
          event.target.dataset.category;

        const value =
          event.target.value;

        session.localAnswers[
          answerKey(category)
        ] = value;

        row?.classList.toggle(
          "has-value",
          Boolean(value.trim())
        );

        socket.emit(
          "answer:update",
          {
            code:state.code,
            playerId:session.playerId,
            category,
            value
          }
        );
      });

      input.addEventListener("keydown", event => {
        if (event.key !== "Enter") return;

        event.preventDefault();

        const next =
          inputs[index + 1];

        if (next) {
          next.focus();
          keepInputVisible(next);
        } else {
          input.blur();
        }
      });
    });

    document
      .querySelectorAll("[data-clear-index]")
      .forEach(button => {
        button.addEventListener("click", () => {
          const index =
            Number(button.dataset.clearIndex);

          const input =
            inputs[index];

          if (!input) return;

          const category =
            input.dataset.category;

          input.value = "";

          session.localAnswers[
            answerKey(category)
          ] = "";

          input
            .closest(".asv1-row")
            ?.classList.remove("has-value");

          socket.emit(
            "answer:update",
            {
              code:state.code,
              playerId:session.playerId,
              category,
              value:""
            }
          );

          input.focus();
          keepInputVisible(input);
        });
      });

    document
      .getElementById("leaveGameBtn")
      ?.addEventListener("click", () => {
        gameExitModal(
          state,
          me(),
          "asv1-exit"
        );
      });

    document
      .getElementById("submitRound")
      ?.addEventListener("click", event => {
        if (!socket.connected) {
          return toast(
            "Connexion interrompue. Attends la reconnexion."
          );
        }

        const button = event.currentTarget;
        button.disabled = true;

        socket.emit(
          "round:submit",
          {
            code:state.code,
            playerId:session.playerId
          }
        );

        setTimeout(() => {
          const current = session.state;
          const stillWaitingForSubmit =
            current?.phase === "round" &&
            !me()?.submitted;

          if (
            socket.connected &&
            button.isConnected &&
            stillWaitingForSubmit
          ) {
            button.disabled = false;
            toast(
              "La validation n’a pas été confirmée. Réessaie."
            );
          }
        }, 8000);
      });

    const tick = () => {
      const timer =
        document.getElementById("timer");

      const ring =
        document.getElementById("timerRing");

      if (!timer) return;

      const remaining =
        Math.max(
          0,
          Number(state.roundEndsAt || 0) -
          (
            typeof serverNowMs === "function"
              ? serverNowMs()
              : Date.now()
          )
        );

      const seconds =
        Math.ceil(remaining / 1000);

      timer.textContent =
        String(seconds);

      const progress =
        Number(state.duration) > 0
          ? Math.max(
              0,
              Math.min(
                100,
                (
                  remaining /
                  (Number(state.duration) * 1000)
                ) * 100
              )
            )
          : 0;

      if (ring) {
        ring.style.setProperty(
          "--progress",
          `${progress}%`
        );

        ring.classList.toggle(
          "danger",
          seconds <= 10
        );
      }

      if (seconds <= 0) {
        document
          .querySelectorAll(
            ".asv1-input,.asv1-clear,#submitRound"
          )
          .forEach(element => {
            element.disabled = true;
          });
      }
    };

    tick();

    session.timerHandle =
      setInterval(tick, 100);
  }

  window.PtitBacAnswerScreen = Object.freeze({
    render: renderAnswerScreenV1
  });
})();

/* ==== round-intro-v1.js ==== */
(() => {
"use strict";

const INTRO_MS = 5000;
const introByRound = new Map();

function nowServer() {
  return typeof serverNowMs === "function"
    ? serverNowMs()
    : Date.now();
}

function renderAnswerScreen() {
  const renderer = window.PtitBacAnswerScreen?.render;
  if (typeof renderer !== "function") {
    console.error("P'tit Bac: écran de réponses indisponible.");
    return;
  }
  return renderer();
}

function roundKey(state) {
  return `${state?.code || "room"}:${state?.roundEndsAt || ""}:${Number(state?.roundIndex ?? -1)}`;
}

function getIntroState(state) {
  const key = roundKey(state);
  let entry = introByRound.get(key);
  if (!entry) {
    for (const old of introByRound.values()) clearTimeout(old.timeoutId);
    introByRound.clear();
    const endsAt = Number(state.roundStartsAt) || (Number(state.roundEndsAt) - Number(state.duration) * 1000);
    entry = { startedAt: nowServer(), endsAt: Number.isFinite(endsAt) ? endsAt : nowServer(), finished:false, timeoutId:null };
    entry.timeoutId = window.setTimeout(() => {
      if (entry.finished) return;
      entry.finished = true;
      const live = session?.state;
      if (!live || live.phase !== "round" || roundKey(live) !== key) return;
      renderAnswerScreen();
    }, Math.max(0, entry.endsAt - nowServer()));
    introByRound.set(key, entry);
  }
  return entry;
}

function categoryEmoji(category) {
  try {
    if (typeof window.categoryIcon === "function") return window.categoryIcon(category);
    if (typeof categoryIcon === "function") return categoryIcon(category);
  } catch {}
  return "✨";
}

function escape(value) {
  try {
    if (typeof window.escapeHtml === "function") return window.escapeHtml(value);
    if (typeof escapeHtml === "function") return escapeHtml(value);
  } catch {}
  return String(value ?? "").replace(/[&<>"']/g, c => ({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#039;"}[c]));
}

function leaveRound(state) { gameExitModal(state, me(), "pri-exit"); }

function renderRoundIntro(state, entry) {
  clearInterval(session.timerHandle);
  const letter = String(state.currentLetter || state.letters?.[state.roundIndex] || "?").slice(0,1).toUpperCase();
  const roundNumber = Math.max(1, Number(state.roundIndex || 0) + 1);
  const categories = Array.isArray(state.categories) ? state.categories : [];
  const duration = Math.max(0, Number(state.duration || 0));
  const categoryCards = categories.map(category => `
    <div class="recap-category">
      <span class="recap-category-icon" aria-hidden="true">${categoryEmoji(category)}</span>
      <strong>${escape(category)}</strong>
    </div>`).join("");

  setScreen(`
    <main class="pri-screen recap-screen">
      <header class="recap-top">
        <button class="recap-exit" id="priExit" type="button" aria-label="Quitter la partie"><img src="/lobby-exit.png" alt=""></button>
        <img class="recap-brand" src="/ptitbac.logo.png" alt="P’tit Bac" width="62" height="52">
        <span class="recap-round">Manche ${roundNumber}/${Math.max(roundNumber, Number(state.rounds) || 1)}</span>
      </header>

      <nav class="recap-steps" aria-label="Étapes de la manche">
        <span>Catégories</span><i>•</i><span>Lettre</span><i>•</i><strong aria-current="step">À vous de jouer</strong>
      </nav>

      <section class="recap-hero">
        <div class="recap-flag" aria-hidden="true"><img src="/round-flag.png" alt=""></div>
        <h1>Manche <span>${roundNumber}</span></h1>
        <p>Prépare-toi !</p>
      </section>

      <section class="recap-countdown-card">
        <p>La manche commence dans</p>
        <div class="pri-countdown-ring"><strong id="priCountdown">5</strong></div>
      </section>

      <section class="recap-stats" aria-label="Récapitulatif de la manche">
        <article class="recap-letter-card">
          <small>Lettre</small>
          <div class="recap-letter">${escape(letter)}</div>
        </article>
        <div class="recap-facts">
          <div><img src="/lobby-categories.png" alt=""><strong>${categories.length}</strong><span>catégories</span></div>
          <div><img src="/lobby-clock.png" alt=""><strong>${duration}</strong><span>secondes</span></div>
        </div>
      </section>

      <section class="recap-categories-panel" aria-labelledby="recapCategoriesTitle">
        <div class="recap-panel-title"><i></i><strong id="recapCategoriesTitle">Les catégories de cette manche</strong><i></i></div>
        <div class="recap-categories-grid">${categoryCards}</div>
      </section>
    </main>`);

  document.getElementById("priExit")?.addEventListener("click", () => leaveRound(state));
  const countdown = document.getElementById("priCountdown");
  countdown?.closest(".pri-countdown-ring")?.style.setProperty("--pri-progress","1");

  const finishIntro = () => {
    if (entry.finished) return;
    entry.finished = true;
    if (entry.timeoutId) { clearTimeout(entry.timeoutId); entry.timeoutId = null; }
    const live = session?.state;
    if (!live || live.phase !== "round" || roundKey(live) !== roundKey(state)) return;
    renderAnswerScreen();
  };

  const tick = () => {
    if (!countdown || !countdown.isConnected || entry.finished) return;
    const remaining = entry.endsAt - nowServer();
    if (remaining <= 0) { finishIntro(); return; }
    countdown.textContent = String(Math.ceil(remaining / 1000));
    const ring = countdown.closest(".pri-countdown-ring");
    if (ring) ring.style.setProperty("--pri-progress", String(Math.max(0, Math.min(1, remaining / INTRO_MS))));
    window.requestAnimationFrame(tick);
  };
  tick();
}

function renderRoundPhase() {
  const state = session?.state;
  if (!state || state.phase !== "round") return;
  const entry = getIntroState(state);
  if (entry.finished || nowServer() >= entry.endsAt) {
    entry.finished = true;
    return renderAnswerScreen();
  }
  renderRoundIntro(state, entry);
}

window.renderRound = renderRoundPhase;
try { renderRound = renderRoundPhase; } catch {}

if (typeof socket !== "undefined") {
  socket.on("room:state", state => {
    if (!state) return;
    const currentIndex = Number(state.roundIndex ?? -1);
    for (const key of introByRound.keys()) {
      const index = Number(key.split(":").pop());
      if (index < currentIndex - 1) {
        const old = introByRound.get(key);
        if (old?.timeoutId) clearTimeout(old.timeoutId);
        introByRound.delete(key);
      }
    }
  });
}
})();

/* ==== waiting-screen-v1.js ==== */
(() => {
"use strict";
function esc(value=""){try{return escapeHtml(value);}catch{return String(value).replace(/[&<>"']/g,c=>({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#039;"}[c]));}}
function playerAvatar(player,index){const raw=String(player?.avatar||"");const isImage=Boolean(window.PtitBacProfilePhoto?.isImageAvatar?.(raw))||/^data:image\//i.test(raw);if(isImage)return `<div class="wsv1-avatar"><img src="${raw}" alt="" draggable="false"></div>`;const content=raw||String(player?.name||"?").slice(0,1).toUpperCase();return `<div class="wsv1-avatar"><span>${esc(content)}</span></div>`;}
function renderWaitingV1(){
 clearInterval(session.timerHandle);const state=session.state;if(!state||state.phase!=="round")return;
 const players=Array.isArray(state.players)?state.players:[];const readyCount=players.filter(p=>p.submitted).length;const total=players.length;const allReady=total>0&&readyCount===total;
 setScreen(`
 <main class="wsv1-screen">
   <header class="wsv1-brandbar" style="display:grid;grid-template-columns:1fr 62px 1fr;align-items:center;min-height:52px;width:100%;">
     <button class="wsv1-exit" id="wsv1Exit" type="button" aria-label="Quitter la partie" style="justify-self:start;margin:0;">
       <img src="/lobby-exit.png" alt="">
     </button>
     <img class="wsv1-brand" src="/ptitbac.logo.png" alt="P’tit Bac" style="display:block;width:62px;height:52px;max-width:62px;max-height:52px;object-fit:contain;justify-self:center;">
     <span aria-hidden="true"></span>
   </header>

   <section class="wsv1-main">
     <div class="wsv1-timer" id="wsv1TimerRing" style="--wsv1-progress:100%"><div><strong id="wsv1Timer">${Math.max(0,Number(state.duration||0))}</strong><span>secondes</span></div></div>
     <h1 id="wsv1Title">${allReady?"Tout le monde est prêt !":"En attente des autres joueurs…"}</h1>
     <p>Tes réponses sont enregistrées.</p>
   </section>

   <section class="wsv1-players">
     <div class="wsv1-players-head"><h2>Joueurs prêts <span>(${readyCount}/${total})</span></h2>${!allReady?`<small>${total-readyCount} restant${total-readyCount>1?"s":""}</small>`:""}</div>
     <div class="wsv1-player-list">${players.map((p,index)=>`<article class="wsv1-player ${p.submitted?"is-ready":"is-writing"}">${playerAvatar(p,index)}<strong>${esc(p.name)}</strong><span class="wsv1-state">${p.submitted?`<b class="wsv1-check">✓</b> Prêt`:`<i class="wsv1-spinner" aria-hidden="true"></i> En cours…`}</span></article>`).join("")}</div>
   </section>
 </main>`);
 document.getElementById("wsv1Exit")?.addEventListener("click",()=>gameExitModal(state,me(),"wsv1-exit"));
 const tick=()=>{const timer=document.getElementById("wsv1Timer"),ring=document.getElementById("wsv1TimerRing");if(!timer||!ring)return;const remainingMs=Math.max(0,Number(state.roundEndsAt||0)-(typeof serverNowMs==="function"?serverNowMs():Date.now()));const seconds=Math.ceil(remainingMs/1000);timer.textContent=String(seconds);const durationMs=Math.max(1,Number(state.duration||0)*1000);const progress=Math.max(0,Math.min(100,(remainingMs/durationMs)*100));ring.style.setProperty("--wsv1-progress",`${progress}%`);ring.classList.toggle("is-danger",seconds<=10);if(seconds<=0)ring.classList.add("is-finished");};
 tick();session.timerHandle=setInterval(tick,100);
}
window.renderRoundWaiting=renderWaitingV1;try{renderRoundWaiting=renderWaitingV1;}catch{}
})();

/* ==== validation-screen-v1.js ==== */
(() => {
  "use strict";

  function renderValidationV2() {
    clearInterval(session.timerHandle);

    const state =
      session.state;

    const user =
      me();

    if (
      !state ||
      state.phase !== "validation"
    ) {
      return;
    }

    const validation =
      state.validation || {};

    const unavailable =
      validation.status ===
      "unavailable";

    const complete =
      validation.status ===
      "complete";

    setScreen(`
      <main class="vsv1-screen">
        <button
          class="vsv1-exit"
          id="vsv1Exit"
          type="button"
          aria-label="Quitter la partie"
        >
          <img
            src="/lobby-exit.png"
            alt=""
          >
        </button>

        <section
          class="vsv1-simple"
          role="status"
          aria-live="polite"
        >
          <div
            class="vsv1-spinner ${
              complete
                ? "is-complete"
                : unavailable
                  ? "is-error"
                  : ""
            }"
          >
            ${
              complete
                ? "✓"
                : unavailable
                  ? "!"
                  : ""
            }
          </div>

          <h1>
            ${
              complete
                ? "Vérification terminée !"
                : unavailable
                  ? "Vérification en pause"
                  : "Vérification des réponses…"
            }
          </h1>

          ${
            unavailable &&
            user?.isHost
              ? `
                <button
                  class="vsv1-retry"
                  id="vsv1Retry"
                  type="button"
                >
                  ↻ Réessayer
                </button>
              `
              : ""
          }
        </section>
      </main>
    `);

    document
      .getElementById("vsv1Exit")
      ?.addEventListener(
        "click",
        () =>
          gameExitModal(
            state,
            user,
            "vsv1"
          )
      );

    document
      .getElementById("vsv1Retry")
      ?.addEventListener(
        "click",
        () => {
          const button =
            document.getElementById(
              "vsv1Retry"
            );

          if (!socket.connected) {
            return toast(
              "Connexion interrompue. Attends la reconnexion."
            );
          }

          if (button) {
            button.disabled = true;
          }

          socket.emit(
            "validation:retry",
            {
              code:state.code,
              playerId:
                session.playerId
            }
          );

          setTimeout(() => {
            const current = session.state;
            const stillUnavailable =
              current?.phase === "validation" &&
              current?.validation?.status === "unavailable";

            if (
              socket.connected &&
              button?.isConnected &&
              stillUnavailable
            ) {
              button.disabled = false;
              toast(
                "La relance n’a pas été confirmée. Réessaie."
              );
            }
          }, 8000);
        }
      );
  }

  window.renderValidation =
    renderValidationV2;

  try {
    renderValidation =
      renderValidationV2;
  } catch {}
})();

/* ==== scoreboard-screen-v1.js ==== */
(() => {
"use strict";
let viewKey = "", selected = 0;
const reports = new Map();
function categoryIconSafe(category) {
 try { return categoryIcon(category); } catch { return "✨"; }
}
const esc = value => String(value ?? "").replace(/[&<>"']/g,c=>({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#39;"}[c]));
function avatar(p){
 const raw=String(p.avatar||"");
 if(window.PtitBacProfilePhoto?.isImageAvatar?.(raw)||/^data:image\//i.test(raw)) return '<img src="'+esc(raw)+'" alt="">';
 return '<span>'+esc(raw||String(p.name||"?").slice(0,1))+'</span>';
}
function render(){
 const state=session.state, user=me();
 if(!state||state.phase!=="scoreboard") return;
 const results=state.lastRoundResults||{}, categories=results.categories?.length?results.categories:(state.categories||[]);
 const round=Number(results.roundIndex??state.roundIndex??0);
 const key=JSON.stringify([state.code,state.gameSessionId,round]);
 if(key!==viewKey){viewKey=key;selected=0;reports.clear();}
 selected=Math.min(selected,Math.max(0,categories.length-1));
 const category=categories[selected], players=state.players||[], scores=state.lastRoundScores||{};
 const best=Math.max(0,...players.map(p=>Number(scores[p.id]||0)));
 const winners=players.filter(p=>Number(scores[p.id]||0)===best);
 const letter=String(results.letter||state.currentLetter||"?").slice(0,1).toUpperCase();
 const mine=results.byPlayer?.[session.playerId]?.[category];
 const reportKey=JSON.stringify([key,session.playerId,category]);
 const reportState=reports.get(reportKey);
 const eligible=!!(mine?.answer && mine.status==="invalid" && mine.reportable);
 const reported=mine?.reported||reportState==="sent";
 const pending=reportState==="pending";
 const rows=players.map(p=>{
   const r=results.byPlayer?.[p.id]?.[category]||{};
   const status=!String(r.answer||"").trim()?"empty":r.status==="valid"?"valid":r.status==="duplicate"?"duplicate":r.status==="unverified"?"unverified":"invalid";
   const rowClass=status==="unverified"?"empty":status;
   const symbol={empty:"—",valid:"✓",duplicate:"=",unverified:"?",invalid:"×"}[status];
   const reason=status==="invalid"?(r.correction||"Réponse refusée"):status==="duplicate"?(r.correction||"Réponse partagée"):status==="unverified"?(r.correction||"Non vérifiée — aucun point"):"";
   return '<article class="res-row '+rowClass+'"><div class="res-player"><div class="res-avatar">'+avatar(p)+'</div><strong>'+esc(p.name||"Joueur")+'</strong>'+(p.id===session.playerId?'<small>Toi</small>':'')+'</div><div class="res-answer"><strong>'+esc(status==="empty"?"Aucune réponse":r.answer)+'</strong>'+(reason?'<small>'+esc(reason)+'</small>':'')+'</div><div class="res-score"><b aria-label="'+({empty:"Sans réponse",valid:"Valide",duplicate:"Doublon",unverified:"Non vérifiée",invalid:"Refusée"}[status])+'">'+symbol+'</b><span>'+(status==="valid"?"+1 pt":"0 pt")+'</span></div></article>';
 }).join("");
 const last=round+1>=Number(state.rounds||1);
 setScreen('<main class="ssv1-screen results-screen"><header class="res-top"><button id="resExit" class="res-exit" aria-label="Quitter la partie"><img src="/lobby-exit.png" alt=""></button><img class="res-brand" src="/ptitbac.logo.png" alt="P’tit Bac"><span class="res-pill">Manche '+(round+1)+'/'+Number(state.rounds||1)+'</span></header>'+
 '<div class="res-heading"><h1>Résultats <span>de la manche</span></h1><span class="res-pill">Lettre '+esc(letter)+'</span></div>'+
 '<section class="res-winner"><img class="res-trophy" src="/scoreboard-trophy.png" alt=""><div class="res-winner-copy"><small>'+(winners.length>1?"Égalité sur la manche":"Vainqueur de la manche")+'</small><div>'+(winners.length===1?'<span class="res-avatar">'+avatar(winners[0])+'</span>':'')+'<strong>'+esc(winners.map(p=>p.name).join(" & ")||"Aucun joueur")+'</strong></div></div><b>'+best+' pts</b></section>'+
 '<section class="res-panel"><div class="res-panel-title"><h2>Les réponses</h2><span id="resPosition">'+(categories.length?selected+1:0)+' / '+categories.length+'</span></div>'+
 '<div class="res-nav" id="resSwipe" tabindex="0" aria-label="Choisir une catégorie"><button id="resPrev" aria-label="Catégorie précédente" '+(selected===0?'disabled':'')+'>‹</button><div class="res-category" aria-live="polite"><span aria-hidden="true">'+(category?categoryIconSafe(category):"")+'</span><strong>'+esc(category||"Aucune catégorie")+'</strong></div><button id="resNext" aria-label="Catégorie suivante" '+(selected>=categories.length-1?'disabled':'')+'>›</button></div>'+
 '<p class="res-swipe-hint">Glisse pour changer de catégorie</p><div class="res-dots">'+categories.map((c,i)=>'<button data-res-index="'+i+'" aria-label="'+esc(c)+'" '+(i===selected?'aria-current="true"':'')+'></button>').join("")+'</div>'+
 '<div class="res-rows">'+rows+'</div>'+
 '<button class="res-report" id="resReport" '+(!eligible||reported||pending?'disabled':'')+'>ⓘ '+(reported?'Signalé ✓':pending?'Envoi…':'Signaler une correction')+'</button>'+
 '<p class="res-legend"><span>✓ Valide</span><span>— Sans réponse</span><span>? Non vérifiée</span><span>× Refusée</span><span>= Doublon</span></p></section>'+
 ((user?.isHost||state.mode==="quick")?'<button id="resContinue" class="res-continue">'+(last?'Afficher le classement':'Prochaine manche')+' →</button>':'<p class="res-wait">En attente de l’hôte pour continuer</p>')+'</main>');
 const navigate=index=>{
  selected=Math.max(0,Math.min(categories.length-1,index));
  render();
  document.getElementById("resSwipe")?.focus({preventScroll:true});
 };
 document.getElementById("resExit").onclick=()=>gameExitModal(state,user,"ssv1");
 document.getElementById("resPrev").onclick=()=>navigate(selected-1);
 document.getElementById("resNext").onclick=()=>navigate(selected+1);
 document.querySelectorAll("[data-res-index]").forEach(b=>b.onclick=()=>navigate(Number(b.dataset.resIndex)));
 const swipe=document.getElementById("resSwipe");
 let start=null;
 swipe.addEventListener("pointerdown",e=>{if(e.isPrimary!==false)start={x:e.clientX,y:e.clientY};});
 swipe.addEventListener("pointerup",e=>{if(!start)return;const dx=e.clientX-start.x,dy=e.clientY-start.y;start=null;if(Math.abs(dx)>40&&Math.abs(dx)>Math.abs(dy)*1.5)navigate(selected+(dx<0?1:-1));});
 swipe.addEventListener("pointercancel",()=>{start=null;});
 swipe.addEventListener("keydown",e=>{if(e.key==="ArrowLeft"||e.key==="ArrowRight"){e.preventDefault();navigate(selected+(e.key==="ArrowRight"?1:-1));}});
 const next=document.getElementById("resContinue");
 if(next)next.onclick=()=>{
  if(next.disabled)return;
  if(!socket.connected)return toast("Connexion interrompue. Attends la reconnexion.");
  next.disabled=true;
  socket.emit(
    "game:nextRound",
    {code:state.code,playerId:session.playerId}
  );
  setTimeout(()=>{
    const current=session.state;
    const stillSameScoreboard=
      current?.phase==="scoreboard" &&
      JSON.stringify([
        current.code,
        current.gameSessionId,
        Number(current.lastRoundResults?.roundIndex??current.roundIndex??0)
      ])===key;
    if(socket.connected&&next.isConnected&&stillSameScoreboard){
      next.disabled=false;
      toast("Le passage à la suite n’a pas été confirmé. Réessaie.");
    }
  },12000);
 };
 document.getElementById("resReport").onclick=()=>{
  if(!eligible||reported||reports.get(reportKey)==="pending")return;
  reports.set(reportKey,"pending");
  const playerId=session.playerId;
  render();
  socket.emit("answer:report",{code:state.code,playerId,roundIndex:round,category},res=>{
    if(viewKey!==key)return;
    reports.set(reportKey,res?.ok?"sent":"error");
    if(session.state?.phase==="scoreboard")render();
    toast(res?.ok?"Signalement envoyé.":res?.error||"Impossible d’envoyer le signalement.");
  });
 };
}
window.renderScoreboard=render;
try{renderScoreboard=render;}catch{}
})();

/* ==== final-screen-v1.js ==== */
(() => {
  "use strict";

  const esc = value =>
    String(value ?? "").replace(
      /[&<>"']/g,
      char => ({
        "&":"&amp;",
        "<":"&lt;",
        ">":"&gt;",
        '"':"&quot;",
        "'":"&#39;"
      })[char]
    );

  function avatar(player) {
    const raw = String(player?.avatar || "");
    const image =
      window.PtitBacProfilePhoto?.isImageAvatar?.(raw) ||
      /^data:image\//i.test(raw);

    return (
      '<span class="fin-avatar">' +
        (
          image
            ? '<img src="' + esc(raw) + '" alt="" draggable="false">'
            : '<span>' +
                esc(
                  raw ||
                  String(player?.name || "?").slice(0, 1)
                ) +
              '</span>'
        ) +
      '</span>'
    );
  }

  const points = player =>
    Number(player?.score) || 0;

  const pts = player =>
    points(player) +
    " pt" +
    (points(player) > 1 ? "s" : "");


  const finalFxRuntime = {
    confettiKey:"",
    confettiTimer:0,
    soundKey:"",
    finalAudio:null,
    audioUnlockAttempted:false,
    audioUnlocked:false
  };

  const FINAL_VICTORY_SOUND =
    "data:audio/mpeg;base64,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ZPgB8ZQUy/g7GXgAAA0gAAABBUhVM+BmA+AAADSAAAAEkyPFWCtBo1OiwtmTLuzvey36gGCbxbAoNC1MQU1FMy4xMDBVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVUxBTUUzLjEwMFVVVVVVVf/7IGT4gfFyFUv4GpD4AAANIAAAAQXUVS3g7eToAAA0gAAABFVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVTEFNRTMuMTAwVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVX/+yBk+QHxaxVLeBlo+AAADSAAAAEGJFct4GoD4AAANIAAAARVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVV//sgZPiB8UwVTHgZEXgAAA0gAAABBexXLeHhpagAADSAAAAEVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVf/7QGT7A/SCKUl7L2Q4AAANIAAAAQD0AxSggAAgAAA0gAAABFVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVV//sQZN2P8AAAaQAAAAgAAA0gAAABAAABpAAAACAAADSAAAAEVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVX/+xBk3Y/wAABpAAAACAAADSAAAAEAAAGkAAAAIAAANIAAAARVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVQ==";

  function ensureFinalAudio() {
    if (finalFxRuntime.finalAudio) {
      return finalFxRuntime.finalAudio;
    }

    if (typeof Audio !== "function") {
      return null;
    }

    const audio =
      new Audio(
        FINAL_VICTORY_SOUND
      );

    audio.preload = "auto";
    audio.volume = 0.82;
    audio.setAttribute(
      "playsinline",
      ""
    );

    finalFxRuntime.finalAudio =
      audio;

    return audio;
  }

  function unlockFinalAudio() {
    if (
      finalFxRuntime.audioUnlocked ||
      finalFxRuntime.audioUnlockAttempted
    ) {
      return;
    }

    const audio =
      ensureFinalAudio();

    if (!audio) return;

    finalFxRuntime.audioUnlockAttempted =
      true;

    try {
      audio.pause();
      audio.currentTime = 0;
      audio.muted = false;
      audio.volume = 0.001;

      const promise =
        audio.play();

      const finishUnlock = () => {
        window.setTimeout(
          () => {
            try {
              audio.pause();
              audio.currentTime = 0;
              audio.volume = 0.82;
              audio.muted = false;
              finalFxRuntime.audioUnlocked =
                true;
            } catch {}
          },
          35
        );
      };

      if (
        promise &&
        typeof promise.then ===
          "function"
      ) {
        promise
          .then(finishUnlock)
          .catch(() => {
            finalFxRuntime.audioUnlockAttempted =
              false;
            audio.volume = 0.82;
          });
      } else {
        finishUnlock();
      }
    } catch {
      finalFxRuntime.audioUnlockAttempted =
        false;
      audio.volume = 0.82;
    }
  }

  function launchFinalSound(
    state,
    ranked
  ) {
    const key =
      [
        state.gameType || "classic",
        state.code || "",
        state.gameSessionId ||
          state.matchId ||
          "",
        ranked
          .map(
            player =>
              String(player.id) +
              ":" +
              String(points(player))
          )
          .join("|")
      ].join("::");

    if (
      finalFxRuntime.soundKey ===
      key
    ) {
      return;
    }

    finalFxRuntime.soundKey = key;

    const audio =
      ensureFinalAudio();

    if (!audio) return;

    try {
      audio.pause();
      audio.currentTime = 0;
      audio.muted = false;
      audio.volume = 0.82;

      const promise =
        audio.play();

      if (
        promise &&
        typeof promise.catch ===
          "function"
      ) {
        promise.catch(
          () => {}
        );
      }
    } catch {}
  }

  function stopFinalSound() {
    const audio =
      finalFxRuntime.finalAudio;

    if (!audio) return;

    try {
      audio.pause();
      audio.currentTime = 0;
    } catch {}
  }

  window.playFinalVictoryEffects = (state, ranked) => {
    if (!state || !Array.isArray(ranked) || !ranked.length) return;
    launchFinalConfetti(state, ranked);
    launchFinalSound(state, ranked);
  };

  window.stopFinalVictoryEffects = () => {
    stopFinalSound();
    document.getElementById("finConfetti")?.remove();
    if (finalFxRuntime.confettiTimer) {
      clearTimeout(finalFxRuntime.confettiTimer);
      finalFxRuntime.confettiTimer = 0;
    }
    finalFxRuntime.confettiKey = "";
    finalFxRuntime.soundKey = "";
  };

  /*
    Le fichier final est chargé dès le début du jeu.
    On prépare donc le même élément audio lors d'une interaction
    utilisateur pour que le son de victoire puisse se lancer
    automatiquement plus tard, notamment sur iPhone/Safari.
  */
  ["pointerdown","touchstart","click","keydown"]
    .forEach(eventName => {
      window.addEventListener(
        eventName,
        unlockFinalAudio,
        {
          once:true,
          passive:
            eventName !== "keydown"
        }
      );
    });

  function confettiMarkup() {
    const colors = [
      "#b84cff",
      "#ff58bd",
      "#54d8ff",
      "#ffd45d",
      "#6df0b5",
      "#ffffff"
    ];

    // Répartir les départs dans le temps et sur la largeur évite les paquets.
    const count = 56;
    const random = (min, max) => min + Math.random() * (max - min);
    const pick = values => values[Math.floor(Math.random() * values.length)];
    const starts = Array.from({ length:count }, (_, index) =>
      (index + random(0, 0.8)) * 6.2 / count
    );
    for (let index = starts.length - 1; index > 0; index--) {
      const other = Math.floor(Math.random() * (index + 1));
      [starts[index], starts[other]] = [starts[other], starts[index]];
    }

    return Array.from({ length:count }, (_, index) => {
      const left = (index + random(0.1, 0.9)) * 100 / count;
      const delay = starts[index];
      const duration = random(5.2, 7.1);
      const drift = random(-78, 78);
      const sway = random(12, 38) * (Math.random() < 0.5 ? -1 : 1);
      const spin = Math.round(random(390, 860)) * (Math.random() < 0.5 ? -1 : 1);
      const width = random(4, 7);
      const height = random(7, 13);
      const color = pick(colors);
      const round = pick(["0", "1px", "2px"]);

      return (
        '<i class="fin-confetti-piece" style="' +
          '--fin-left:' + left.toFixed(2) + '%;' +
          '--fin-delay:' + delay.toFixed(2) + 's;' +
          '--fin-duration:' + duration.toFixed(2) + 's;' +
          '--fin-drift:' + drift.toFixed(1) + 'px;' +
          '--fin-drift-mid:' + (drift * 0.45).toFixed(1) + 'px;' +
          '--fin-drift-sway:' + (drift + sway).toFixed(1) + 'px;' +
          '--fin-sway:' + sway.toFixed(1) + 'px;' +
          '--fin-spin-early:' + Math.round(spin * 0.22) + 'deg;' +
          '--fin-spin-mid:' + Math.round(spin * 0.48) + 'deg;' +
          '--fin-spin-late:' + Math.round(spin * 0.74) + 'deg;' +
          '--fin-spin:' + spin + 'deg;' +
          '--fin-width:' + width.toFixed(1) + 'px;' +
          '--fin-height:' + height.toFixed(1) + 'px;' +
          '--fin-color:' + color + ';' +
          '--fin-round:' + round + ';' +
        '"></i>'
      );
    }).join("");
  }

  function launchFinalConfetti(
    state,
    ranked
  ) {
    if (
      window.matchMedia?.(
        "(prefers-reduced-motion: reduce)"
      ).matches
    ) {
      return;
    }

    const key =
      [
        state.gameType || "classic",
        state.code || "",
        state.gameSessionId ||
          state.matchId ||
          "",
        ranked
          .map(
            player =>
              String(player.id) +
              ":" +
              String(points(player))
          )
          .join("|")
      ].join("::");

    if (
      finalFxRuntime.confettiKey ===
      key
    ) {
      return;
    }

    finalFxRuntime.confettiKey = key;

    document
      .getElementById(
        "finConfetti"
      )
      ?.remove();

    if (
      finalFxRuntime.confettiTimer
    ) {
      clearTimeout(
        finalFxRuntime.confettiTimer
      );
    }

    const layer =
      document.createElement("div");

    layer.id =
      "finConfetti";

    layer.className =
      "fin-confetti-layer";

    layer.setAttribute(
      "aria-hidden",
      "true"
    );

    layer.innerHTML =
      confettiMarkup();

    document.body.appendChild(
      layer
    );

    finalFxRuntime.confettiTimer =
      window.setTimeout(
        () => {
          layer.remove();

          if (
            finalFxRuntime.confettiTimer
          ) {
            finalFxRuntime.confettiTimer =
              0;
          }
        },
        13800
      );
  }

  function renderFinishedV2() {
    clearInterval(session.timerHandle);

    const state = session.state;
    const user = me();

    if (
      !state ||
      state.phase !== "finished"
    ) {
      return;
    }

    const ranked =
      [...(state.players || [])].sort(
        (a, b) =>
          points(b) - points(a) ||
          String(a.name || "").localeCompare(
            String(b.name || "")
          )
      );

    const rank = player =>
      ranked.findIndex(
        item =>
          points(item) === points(player)
      ) + 1;

    const winners =
      ranked.filter(
        player =>
          points(player) ===
          points(ranked[0])
      );

    const title =
      winners.length > 1
        ? "Victoire partagée : " +
          winners
            .map(player => player.name)
            .join(" & ")
        : winners.length
          ? winners[0].name +
            " remporte la partie !"
          : "Partie terminée";

    const top =
      ranked.slice(0, 3);

    const order =
      top.length >= 3
        ? [top[1], top[0], top[2]]
        : top.length > 1
          ? [top[1], top[0]]
          : top;

    const podium =
      order.map(player => {
        const playerRank =
          rank(player);

        return (
          '<article class="fin-podium-card place-' +
            Math.min(playerRank, 3) +
          '">' +
            '<div class="fin-medal">' +
              playerRank +
            '</div>' +

            (
              playerRank === 1
                ? '<img class="fin-crown" src="/admin-crown.png" alt="" aria-hidden="true">'
                : ""
            ) +

            avatar(player) +

            '<strong>' +
              esc(player.name) +
            '</strong>' +

            (
              winners.length > 1 && playerRank === 1
                ? '<span class="fin-you-slot">' +
                    (
                      player.id === session.playerId
                        ? '<small class="fin-you">Toi</small>'
                        : ""
                    ) +
                  '</span>'
                : (
                    player.id === session.playerId
                      ? '<small class="fin-you">Toi</small>'
                      : ""
                  )
            ) +

            '<b>' +
              pts(player) +
            '</b>' +

            '<div class="fin-pedestal" aria-hidden="true">' +
              playerRank +
            '</div>' +
          '</article>'
        );
      }).join("");

    /*
      Le classement inférieur ne répète jamais les joueurs
      déjà affichés sur le podium. Cela corrige notamment
      les égalités à deux joueurs.
    */
    const podiumIds =
      new Set(
        top.map(player => String(player.id))
      );

    const rankingPlayers =
      ranked.filter(
        player =>
          !podiumIds.has(String(player.id))
      );

    const rows =
      rankingPlayers.map(player => {
        const playerRank =
          rank(player);

        return (
          '<div class="fin-row ' +
            (
              player.id === session.playerId
                ? "is-me"
                : ""
            ) +
          '">' +

            '<span class="fin-rank place-' +
              Math.min(playerRank, 4) +
            '">' +
              playerRank +
            '</span>' +

            '<div class="fin-player">' +
              avatar(player) +
              '<strong>' +
                esc(player.name) +
              '</strong>' +
              (
                player.id === session.playerId
                  ? '<small class="fin-you">Toi</small>'
                  : ""
              ) +
            '</div>' +

            '<b>' +
              pts(player) +
            '</b>' +
          '</div>'
        );
      }).join("");

    const rankingSection =
      rankingPlayers.length
        ? (
          '<section class="fin-ranking ' +
            (
              ranked.length >= 5
                ? "is-many"
                : ""
            ) +
          '">' +
            rows +
          '</section>'
        )
        : "";

    const rawDifficulty =
      String(
        state.categoryDifficulty || ""
      ).toLowerCase();

    const difficulty =
      ["hard", "difficile"].includes(
        rawDifficulty
      )
        ? "Difficile"
        : ["medium", "normal", "moyen"]
            .includes(rawDifficulty)
          ? "Moyen"
          : "Facile";

    const quick =
      state.mode === "quick";

    setScreen(
      '<main class="fsv1-screen final-mobile">' +

        '<header class="fin-top">' +
          '<img class="fin-brand" src="/ptitbac.logo.png" alt="P’tit Bac">' +
          '<span></span>' +
        '</header>' +

        '<section class="fin-heading">' +
          '<h1>Partie <span>terminée !</span></h1>' +
          '<p>' +
            esc(title) +
          '</p>' +
        '</section>' +

        '<section class="fin-podium fin-podium-' +
          Math.min(top.length, 3) +
          (
            winners.length > 1
              ? " fin-podium-shared-win"
              : ""
          ) +
          '" aria-label="Podium">' +
          podium +
        '</section>' +

        rankingSection +

        '<section class="fin-stats">' +
          [
            [
              "/friends.png",
              ranked.length,
              "Joueurs"
            ],
            [
              "/lightning.png",
              Number(state.rounds) || 1,
              "Manche" +
                (
                  state.rounds > 1
                    ? "s"
                    : ""
                )
            ],
            [
              "/lobby-clock.png",
              (Number(state.duration) || 0) +
                " s",
              "Par manche"
            ],
            [
              "/difficulty.png",
              difficulty,
              "Niveau"
            ]
          ]
            .map(
              ([img, value, label]) =>
                '<div>' +
                  '<img src="' +
                    img +
                    '" alt="">' +
                  '<strong>' +
                    value +
                  '</strong>' +
                  '<small>' +
                    label +
                  '</small>' +
                '</div>'
            )
            .join("") +
        '</section>' +

        '<p class="fin-mode">' +
          (
            state.mode === "private"
              ? "Salon privé · Aucun gain de progression"
              : quick
                ? "Partie rapide · XP + trophées"
                : "Salon public · XP + trophées"
          ) +
        '</p>' +

        '<div class="fin-actions">' +
          (quick
            ? '<button id="finQuick" class="fin-primary">↻ Rejouer</button>'
            : '<p role="status">Revanche · ' + Number(state.rematch?.readyCount || 0) +
              ' / ' + Number(state.rematch?.count || 0) + ' joueurs partants</p>' +
              '<button id="finRematchReady" class="fin-primary" aria-pressed="' +
              (!!user?.rematchReady) + '">' +
              (user?.rematchReady ? '✓ Partant · Annuler' : '↻ Je rejoue') + '</button>' +
              (user?.isHost
                ? '<button id="finReplay" class="fin-secondary"' +
                  (state.rematch?.allReady ? '' : ' disabled') + '>Retour au même salon</button>'
                : '<p>L’hôte ramènera le groupe au salon.</p>')
          ) +

          '<button id="finHome" class="fin-secondary">⌂ Retour à l’accueil</button>' +
        '</div>' +

      '</main>'
    );

    launchFinalConfetti(
      state,
      ranked
    );

    launchFinalSound(
      state,
      ranked
    );

    const leave = (onLeft, onFailure) => {
      stopFinalSound();

      document
        .getElementById(
          "finConfetti"
        )
        ?.remove();

      if (
        finalFxRuntime.confettiTimer
      ) {
        clearTimeout(
          finalFxRuntime.confettiTimer
        );

        finalFxRuntime.confettiTimer =
          0;
      }

      socket.timeout(8000).emit(
        "room:leave",
        {
          code:state.code,
          playerId:session.playerId
        },
        (err, res) => {
          if (err || !res?.ok) {
            if (typeof onFailure === "function") onFailure();
            return toast(
              res?.error ||
              "Impossible de quitter le classement pour le moment."
            );
          }

          clearSession();
          if (typeof onLeft === "function") return onLeft();

          if (typeof initWallet === "function") {
            initWallet(() => renderHome());
          } else {
            renderHome();
          }
        }
      );
    };

    document
      .getElementById("finHome")
      .onclick = () => leave();

    const rematchButton = document.getElementById("finRematchReady");
    if (rematchButton) rematchButton.onclick = () => {
      if (rematchButton.disabled) return;
      rematchButton.disabled = true;
      socket.timeout(8000).emit("game:rematchReady", {
        code:state.code, playerId:session.playerId, ready:!user?.rematchReady
      }, (err, res) => {
        rematchButton.disabled = false;
        if (err || !res?.ok) toast(res?.error || "Choix non confirmé. Réessaie.");
      });
    };

    const replay = document.getElementById("finReplay");
    if (replay) replay.onclick = () => {
      if (replay.disabled) return;
      replay.disabled = true;
      socket.timeout(8000).emit("game:restart", {
        code:state.code, playerId:session.playerId
      }, (err, res) => {
        replay.disabled = false;
        if (err || !res?.ok) return toast(res?.error || "Retour au salon non confirmé. Réessaie.");
        stopFinalSound();
        document.getElementById("finConfetti")?.remove();
        clearTimeout(finalFxRuntime.confettiTimer);
        finalFxRuntime.confettiTimer = 0;
      });
    };

    const again =
      document.getElementById(
        "finQuick"
      );

    if (again) {
      again.onclick = () => {
        if (again.disabled) return;

        again.disabled = true;

        const profile = {
          name:user?.name || "Joueur",
          icon:user?.avatar || "🙂"
        };

        leave(() => {
          renderHome();
          window.startQuickPlay?.(profile);
        }, () => { again.disabled = false; });
      };
    }
  }

  window.renderFinished =
    renderFinishedV2;

  try {
    renderFinished =
      renderFinishedV2;
  } catch {}
})();

/* ==== Bandeau de partie 1 ==== */
    (() => {
      "use strict";

      let categoryHeaderScheduled = false;

      function categoryHeaderSync() {
        categoryHeaderScheduled = false;

        const root = document.querySelector(".cat-v2.cat-prototype");
        if (!root) return;

        const back = root.querySelector("#returnLobbyCategoriesBtn");
        const backImg = back?.querySelector("img");

        if (backImg && backImg.getAttribute("src") !== "/back-arrow.png") {
          backImg.src = "/back-arrow.png";
        }

        /* Fenêtre de confirmation demandée : Annuler / Quitter la partie. */
        const cancel = root.querySelector("#categoryExitNo");
        const quit = root.querySelector("#categoryExitHome");
        const returnLobby = root.querySelector("#categoryExitLobby");

        if (cancel) cancel.textContent = "Annuler";
        if (quit) quit.textContent = "Quitter la partie";

        /* La flèche sert à quitter la partie, pas à retourner au salon. */
        if (returnLobby) returnLobby.remove();
      }

      function categoryHeaderSchedule() {
        if (categoryHeaderScheduled) return;
        categoryHeaderScheduled = true;
        requestAnimationFrame(categoryHeaderSync);
      }

      function categoryHeaderStart() {
        categoryHeaderSchedule();

        document.addEventListener(
          "ptitbac:screen-rendered",
          categoryHeaderSchedule
        );

        document.addEventListener(
          "ptitbac:dom-updated",
          categoryHeaderSchedule
        );

        try {
          socket?.on?.("room:state", categoryHeaderSchedule);
        } catch {}

        const app = document.getElementById("app");

        if (app) {
          new MutationObserver(categoryHeaderSchedule).observe(app, {
            subtree:true,
            childList:true
          });
        }
      }

      if (document.readyState === "loading") {
        document.addEventListener(
          "DOMContentLoaded",
          categoryHeaderStart,
          { once:true }
        );
      } else {
        categoryHeaderStart();
      }
    })();

/* ==== Bandeau de partie 2 ==== */
    (() => {
      "use strict";

      let letterHeaderScheduled = false;
      let letterHeaderObserver = null;

      function letterHeaderPatchExitModal() {
        const modal = document.querySelector(".pbw1-modal-backdrop");
        if (!modal) return;

        const cancel = modal.querySelector('[data-action="cancel"]');
        const quit = modal.querySelector('[data-action="home"]');
        const returnLobby = modal.querySelector('[data-action="lobby"]');

        if (cancel) cancel.textContent = "Annuler";
        if (quit) quit.textContent = "Quitter la partie";

        /* Comme sur Catégories : pas de bouton "Revenir au salon". */
        returnLobby?.remove();
      }

      function letterHeaderSync() {
        letterHeaderScheduled = false;

        const root = document.querySelector(".pbw1-screen.letter-prototype");

        if (root) {
          const backImg = root.querySelector("#pbw1Exit img");

          if (
            backImg &&
            backImg.getAttribute("src") !== "/back-arrow.png"
          ) {
            backImg.src = "/back-arrow.png";
          }
        }

        letterHeaderPatchExitModal();
      }

      function letterHeaderSchedule() {
        if (letterHeaderScheduled) return;

        letterHeaderScheduled = true;
        requestAnimationFrame(letterHeaderSync);
      }

      function letterHeaderStart() {
        letterHeaderSchedule();

        document.addEventListener(
          "ptitbac:screen-rendered",
          letterHeaderSchedule
        );

        document.addEventListener(
          "ptitbac:dom-updated",
          letterHeaderSchedule
        );

        try {
          socket?.on?.("room:state", letterHeaderSchedule);
        } catch {}

        if (!letterHeaderObserver && document.body) {
          letterHeaderObserver =
            new MutationObserver(letterHeaderSchedule);

          letterHeaderObserver.observe(document.body, {
            subtree:true,
            childList:true
          });
        }
      }

      if (document.readyState === "loading") {
        document.addEventListener(
          "DOMContentLoaded",
          letterHeaderStart,
          { once:true }
        );
      } else {
        letterHeaderStart();
      }
    })();

/* ==== Bandeau de partie 3 ==== */
    (() => {
      "use strict";

      let recapHeaderScheduled = false;
      let recapHeaderObserver = null;

      function recapHeaderPatchExitModal() {
        const modal = document.querySelector(".pri-exit-modal-backdrop");
        if (!modal) return;

        const cancel = modal.querySelector('[data-action="cancel"]');
        const quit = modal.querySelector('[data-action="home"]');
        const returnLobby = modal.querySelector('[data-action="lobby"]');

        if (cancel) cancel.textContent = "Annuler";
        if (quit) quit.textContent = "Quitter la partie";

        returnLobby?.remove();
      }

      function recapHeaderSync() {
        recapHeaderScheduled = false;

        const root = document.querySelector(".pri-screen.recap-screen");

        if (root) {
          const backImg = root.querySelector("#priExit img");

          if (
            backImg &&
            backImg.getAttribute("src") !== "/back-arrow.png"
          ) {
            backImg.src = "/back-arrow.png";
          }
        }

        recapHeaderPatchExitModal();
      }

      function recapHeaderSchedule() {
        if (recapHeaderScheduled) return;
        recapHeaderScheduled = true;
        requestAnimationFrame(recapHeaderSync);
      }

      function recapHeaderStart() {
        recapHeaderSchedule();

        document.addEventListener(
          "ptitbac:screen-rendered",
          recapHeaderSchedule
        );

        document.addEventListener(
          "ptitbac:dom-updated",
          recapHeaderSchedule
        );

        try {
          socket?.on?.("room:state", recapHeaderSchedule);
        } catch {}

        if (!recapHeaderObserver && document.body) {
          recapHeaderObserver =
            new MutationObserver(recapHeaderSchedule);

          recapHeaderObserver.observe(document.body, {
            subtree:true,
            childList:true
          });
        }
      }

      if (document.readyState === "loading") {
        document.addEventListener(
          "DOMContentLoaded",
          recapHeaderStart,
          { once:true }
        );
      } else {
        recapHeaderStart();
      }
    })();

/* ==== Bandeau de partie 4 ==== */
    (() => {
      "use strict";

      let answerHeaderScheduled = false;
      let answerHeaderObserver = null;

      function answerHeaderPatchExitModal() {
        const modal =
          document.querySelector(".asv1-exit-modal-backdrop");

        if (!modal) return;

        const cancel =
          modal.querySelector('[data-action="cancel"]');

        const quit =
          modal.querySelector('[data-action="home"]');

        const returnLobby =
          modal.querySelector('[data-action="lobby"]');

        if (cancel) cancel.textContent = "Annuler";
        if (quit) quit.textContent = "Quitter la partie";

        returnLobby?.remove();
      }

      function answerHeaderSync() {
        answerHeaderScheduled = false;

        const root =
          document.querySelector(".asv1-screen");

        if (root) {
          const hero =
            root.querySelector(".asv1-hero");

          const letterCard =
            root.querySelector(".asv1-letter-card");

          const timer =
            root.querySelector(".asv1-timer");

          const letterLabel =
            letterCard?.querySelector("small");

          if (letterLabel) {
            letterLabel.textContent = "Lettre";
          }

          const backImg =
            root.querySelector("#leaveGameBtn img");

          if (
            backImg &&
            backImg.getAttribute("src") !== "/back-arrow.png"
          ) {
            backImg.src = "/back-arrow.png";
          }

          /* Ajoute le logo au centre du bandeau sans déplacer
             la lettre ni le chrono de leur bloc d'origine. */
          const header =
            root.querySelector(".asv1-header");

          if (
            header &&
            !header.querySelector(".asv1-brand")
          ) {
            const logo =
              document.createElement("img");

            logo.className = "asv1-brand";
            logo.src = "/ptitbac.logo.png";
            logo.alt = "P’tit Bac";
            logo.width = 62;
            logo.height = 52;

            header.appendChild(logo);
          }

          /* Sécurité pour une mise à jour à chaud :
             si l'ancienne version avait déplacé lettre/chrono dans le
             header, on les remet dans leur bloc d'origine. */
          if (
            hero &&
            letterCard &&
            letterCard.parentElement !== hero
          ) {
            hero.appendChild(letterCard);
          }

          if (
            hero &&
            timer &&
            timer.parentElement !== hero
          ) {
            hero.appendChild(timer);
          }

          hero?.removeAttribute("aria-hidden");
        }

        answerHeaderPatchExitModal();
      }

      function answerHeaderSchedule() {
        if (answerHeaderScheduled) return;

        answerHeaderScheduled = true;
        requestAnimationFrame(answerHeaderSync);
      }

      function answerHeaderStart() {
        answerHeaderSchedule();

        document.addEventListener(
          "ptitbac:screen-rendered",
          answerHeaderSchedule
        );

        document.addEventListener(
          "ptitbac:dom-updated",
          answerHeaderSchedule
        );

        try {
          socket?.on?.(
            "room:state",
            answerHeaderSchedule
          );
        } catch {}

        if (
          !answerHeaderObserver &&
          document.body
        ) {
          answerHeaderObserver =
            new MutationObserver(
              answerHeaderSchedule
            );

          answerHeaderObserver.observe(
            document.body,
            {
              subtree:true,
              childList:true
            }
          );
        }
      }

      if (document.readyState === "loading") {
        document.addEventListener(
          "DOMContentLoaded",
          answerHeaderStart,
          { once:true }
        );
      } else {
        answerHeaderStart();
      }
    })();

/* ==== Bandeau de partie 5 ==== */
    (() => {
      "use strict";

      let waitingHeaderScheduled = false;
      let waitingHeaderObserver = null;

      function waitingHeaderSync() {
        waitingHeaderScheduled = false;

        const root =
          document.querySelector(".wsv1-screen");

        if (!root) return;

        const backImg =
          root.querySelector("#wsv1Exit img");

        if (
          backImg &&
          backImg.getAttribute("src") !== "/back-arrow.png"
        ) {
          backImg.src = "/back-arrow.png";
        }
      }

      function waitingHeaderSchedule() {
        if (waitingHeaderScheduled) return;

        waitingHeaderScheduled = true;
        requestAnimationFrame(waitingHeaderSync);
      }

      function waitingHeaderStart() {
        waitingHeaderSchedule();

        document.addEventListener(
          "ptitbac:screen-rendered",
          waitingHeaderSchedule
        );

        document.addEventListener(
          "ptitbac:dom-updated",
          waitingHeaderSchedule
        );

        try {
          socket?.on?.(
            "room:state",
            waitingHeaderSchedule
          );
        } catch {}

        if (
          !waitingHeaderObserver &&
          document.body
        ) {
          waitingHeaderObserver =
            new MutationObserver(
              waitingHeaderSchedule
            );

          waitingHeaderObserver.observe(
            document.body,
            {
              subtree:true,
              childList:true
            }
          );
        }
      }

      if (document.readyState === "loading") {
        document.addEventListener(
          "DOMContentLoaded",
          waitingHeaderStart,
          { once:true }
        );
      } else {
        waitingHeaderStart();
      }
    })();

/* ==== Bandeau de partie 6 ==== */
    (() => {
      "use strict";

      let resultsHeaderScheduled = false;
      let resultsHeaderObserver = null;

      function resultsHeaderSync() {
        resultsHeaderScheduled = false;

        const root =
          document.querySelector(".ssv1-screen.results-screen");

        if (!root) return;

        const backImg =
          root.querySelector("#resExit img");

        if (
          backImg &&
          backImg.getAttribute("src") !== "/back-arrow.png"
        ) {
          backImg.src = "/back-arrow.png";
        }
      }

      function resultsHeaderSchedule() {
        if (resultsHeaderScheduled) return;

        resultsHeaderScheduled = true;
        requestAnimationFrame(resultsHeaderSync);
      }

      function resultsHeaderStart() {
        resultsHeaderSchedule();

        document.addEventListener(
          "ptitbac:screen-rendered",
          resultsHeaderSchedule
        );

        document.addEventListener(
          "ptitbac:dom-updated",
          resultsHeaderSchedule
        );

        try {
          socket?.on?.(
            "room:state",
            resultsHeaderSchedule
          );
        } catch {}

        if (
          !resultsHeaderObserver &&
          document.body
        ) {
          resultsHeaderObserver =
            new MutationObserver(
              resultsHeaderSchedule
            );

          resultsHeaderObserver.observe(
            document.body,
            {
              subtree:true,
              childList:true
            }
          );
        }
      }

      if (document.readyState === "loading") {
        document.addEventListener(
          "DOMContentLoaded",
          resultsHeaderStart,
          { once:true }
        );
      } else {
        resultsHeaderStart();
      }
    })();
