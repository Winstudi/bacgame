(() => {
  "use strict";

  let questStatus = null;
  let loading = false;
  let pageTimer = null;
  let syncTimer = null;
  let syncInFlight = false;

  function walletToken() {
    return String(
      window.session?.walletToken ||
      localStorage.getItem("petitbac_walletToken") ||
      ""
    ).trim();
  }

  function esc(value = "") {
    return String(value).replace(/[&<>"']/g, c => ({
      "&":"&amp;",
      "<":"&lt;",
      ">":"&gt;",
      '"':"&quot;",
      "'":"&#39;"
    })[c]);
  }

  function fmt(value) {
    return Math.max(0, Math.floor(Number(value) || 0)).toLocaleString("fr-FR");
  }

  function emitQuest(event, payload = {}) {
    return new Promise(resolve => {
      if (typeof socket === "undefined" || !socket?.connected) {
        return resolve({ ok:false, error:"Connexion interrompue." });
      }

      socket.timeout(6500).emit(
        event,
        { ...payload, walletToken:walletToken() },
        (err, response) => {
          if (err) return resolve({ ok:false, error:"Le serveur ne répond pas." });
          resolve(response || { ok:false, error:"Réponse invalide." });
        }
      );
    });
  }

  function questIcon(quest) {
    if (quest.icon === "trophy") {
      return `<img src="/scoreboard-trophy.png" alt="">`;
    }
    if (quest.icon === "answers") {
      return `<img src="/task.png" alt="">`;
    }
    return `
      <svg viewBox="0 0 24 24" aria-hidden="true">
        <path d="M19 7v5h-5"></path>
        <path d="M18.1 12a6.4 6.4 0 1 1-1.9-4.5L19 10"></path>
      </svg>`;
  }

  function timeRemaining(endsAt) {
    const ms = Math.max(0, Number(endsAt) - Date.now());
    const minutes = Math.ceil(ms / 60000);
    if (minutes <= 0) return "Maintenant";
    if (minutes < 60) return `${minutes} min`;
    const hours = Math.floor(minutes / 60);
    const mins = minutes % 60;
    return mins ? `${hours} h ${mins} min` : `${hours} h`;
  }

  function orderedQuests(quests = []) {
    return [...quests].sort((a, b) => {
      const aDone = Boolean(a?.completed || a?.claimed);
      const bDone = Boolean(b?.completed || b?.claimed);

      // Les quêtes encore en cours restent toujours avant les quêtes accomplies.
      if (aDone !== bDone) return aDone ? 1 : -1;

      // Dans chaque groupe, on conserve l'ordre prévu par le serveur.
      const aStart = Number(a?.startsAt) || 0;
      const bStart = Number(b?.startsAt) || 0;
      if (aStart !== bStart) return bStart - aStart;

      return (Number(a?.slot) || 0) - (Number(b?.slot) || 0);
    });
  }

  function questCardMarkup(quest) {
    const target = Math.max(1, Number(quest.target) || 1);
    const progress = Math.max(0, Math.min(target, Number(quest.progress) || 0));
    const percent = Math.max(0, Math.min(100, (progress / target) * 100));
    const state = quest.claimed
      ? "is-claimed"
      : quest.completed
        ? "is-complete"
        : "is-progress";

    return `
      <article class="qv1-quest ${state}" data-quest-id="${esc(quest.id)}">
        <div class="qv1-quest-top">
          <div class="qv1-quest-icon">${questIcon(quest)}</div>

          <div class="qv1-quest-copy">
            <h3>${esc(quest.title)}</h3>
          </div>
        </div>

        <div class="qv1-quest-bottom">
          <div class="qv1-progress">
            <span><i style="width:${percent}%"></i></span>
            <b>${progress}/${target}</b>
          </div>

          <div class="qv1-quest-reward" aria-label="Récompense ${fmt(quest.xp)} XP">
            <strong>+${fmt(quest.xp)}</strong><small>XP</small>
          </div>
        </div>
      </article>`;
  }

  function loadingMarkup() {
    return `
      <div class="qv1-loading">
        <span></span>
        <b>Chargement des quêtes…</b>
      </div>`;
  }

  function render() {
    if (typeof setScreen !== "function") return;

    const status = questStatus;
    const chest = status?.chest || {
      progress:0,
      required:4,
      claimable:false
    };
    const chestPercent = Math.max(
      0,
      Math.min(100, (Number(chest.progress) / Math.max(1, Number(chest.required))) * 100)
    );

    setScreen(`
      <main class="quests-v1">
        <div class="qv1-stars" aria-hidden="true">
          <i></i><i></i><i></i><i></i><i></i><i></i>
        </div>

        <header class="qv1-header">
          <button id="qv1Back" class="qv1-back" type="button" aria-label="Retour">
            <img src="/back-arrow.png" alt="">
          </button>

          <div class="qv1-brand">
            <img src="/task.png" alt="">
            <h1>Quêtes</h1>
          </div>

          <span class="qv1-reset qv1-reset-header">
            <span class="qv1-reset-clock" aria-hidden="true">
              <svg viewBox="0 0 24 24">
                <circle cx="12" cy="12" r="7.5"></circle>
                <path d="M12 7.6v4.8h4"></path>
              </svg>
            </span>
            <span class="qv1-reset-copy">
              Nouvelles quêtes dans
              <b data-qv1-reset>${status ? timeRemaining(status.refreshAt) : "—"}</b>
            </span>
          </span>
        </header>

        <section class="qv1-intro" aria-hidden="true"></section>

        <section class="qv1-chest ${chest.claimable ? "is-ready" : ""}">
          <div class="qv1-chest-copy">
            <span class="qv1-chest-kicker">RÉCOMPENSE</span>
            <h2>Coffre de quêtes</h2>
            <p>Valide 4 quêtes pour ouvrir un coffre normal.</p>

            <div class="qv1-chest-milestones">
              <div class="qv1-milestone-track" aria-hidden="true">
                ${[1,2,3,4].map(step => `<i class="${Number(chest.progress) >= step ? "is-hit" : ""}"></i>`).join("")}
              </div>
              <b>${Math.min(4, Number(chest.progress) || 0)}/4</b>
            </div>

            <div class="qv1-chest-progress" aria-hidden="true">
              <span><i style="width:${chestPercent}%"></i></span>
            </div>
          </div>

          <div class="qv1-chest-art">
            <span class="qv1-chest-sparkle qv1-sparkle-a" aria-hidden="true">✦</span>
            <span class="qv1-chest-sparkle qv1-sparkle-b" aria-hidden="true">✦</span>
            <img src="/reward-star-simple-closed.png" alt="Coffre">
            ${chest.claimable
              ? `<button id="qv1ChestClaim" type="button">Ouvrir</button>`
              : `<small>${Math.min(4, Number(chest.progress) || 0)}/4 quêtes</small>`}
          </div>
        </section>

        <section class="qv1-list" aria-label="Quêtes">
          ${loading
            ? loadingMarkup()
            : orderedQuests(status?.quests || []).map(questCardMarkup).join("")}
        </section>

        <div class="qv1-bottom-art" aria-hidden="true">
          <svg class="qv1-bottom-crown" viewBox="0 0 64 48">
            <path d="M7 38 3 12l17 12L32 5l12 19 17-12-5 26z"></path>
          </svg>
          <svg class="qv1-bottom-star" viewBox="0 0 48 48">
            <path d="m24 3 6 13 14 2-10 10 3 14-13-7-13 7 3-14L4 18l14-2z"></path>
          </svg>
          <span class="qv1-bottom-card"></span>
        </div>
      </main>
    `);

    bind();
  }

  function refreshTimer() {
    if (!document.querySelector(".quests-v1")) return;
    const reset = document.querySelector("[data-qv1-reset]");
    if (reset && questStatus?.refreshAt) {
      reset.textContent = timeRemaining(questStatus.refreshAt);
    }
  }

  function startPageTimer() {
    clearInterval(pageTimer);
    pageTimer = setInterval(() => {
      if (!document.querySelector(".quests-v1")) {
        clearInterval(pageTimer);
        pageTimer = null;
        return;
      }

      refreshTimer();

      if (
        questStatus?.refreshAt &&
        Date.now() >= Number(questStatus.refreshAt) + 500
      ) {
        void fetchStatus({ rerender:true });
      }
    }, 1000);
  }

  async function fetchStatus({ rerender = false } = {}) {
    const response = await emitQuest("quests:get");
    if (!response.ok) {
      loading = false;
      if (rerender) render();
      if (typeof toast === "function") toast(response.error || "Quêtes indisponibles.");
      return false;
    }

    questStatus = response.status;
    loading = false;

    const gainedXp = Math.max(0, Number(response.gainedXp) || 0);
    if (gainedXp > 0) {
      try { await window.PtitBacProgression?.refresh?.(); } catch {}
      if (typeof toast === "function") toast(`+${fmt(gainedXp)} XP de quête`);
    }

    if (rerender || document.querySelector(".quests-v1")) render();
    return true;
  }

  async function syncCompletedQuests({ rerender = false, showToast = true } = {}) {
    if (syncInFlight) return false;
    syncInFlight = true;

    try {
      const response = await emitQuest("quests:sync");
      if (!response.ok) return false;

      if (response.status) questStatus = response.status;

      const gainedXp = Math.max(0, Number(response.gainedXp) || 0);
      if (gainedXp > 0) {
        try { await window.PtitBacProgression?.refresh?.(); } catch {}
        if (showToast && typeof toast === "function") {
          toast(`+${fmt(gainedXp)} XP de quête`);
        }
      }

      if ((rerender || document.querySelector(".quests-v1")) && questStatus) render();
      return true;
    } finally {
      syncInFlight = false;
    }
  }

  function scheduleQuestSync(delay = 300) {
    clearTimeout(syncTimer);
    syncTimer = setTimeout(() => {
      syncTimer = null;
      void syncCompletedQuests({
        rerender:Boolean(document.querySelector(".quests-v1")),
        showToast:true
      });
    }, delay);
  }

  async function claimQuest(button) {
    const questId = String(button.dataset.questClaim || "");
    if (!questId || button.disabled) return;

    button.disabled = true;
    const old = button.textContent;
    button.textContent = "…";

    const response = await emitQuest("quests:claim", { questId });
    if (!response.ok) {
      button.disabled = false;
      button.textContent = old;
      if (typeof toast === "function") toast(response.error || "Récompense indisponible.");
      return;
    }

    questStatus = response.status;
    try { await window.PtitBacProgression?.refresh?.(); } catch {}
    if (typeof toast === "function") toast(`+${fmt(response.gainedXp)} XP`);
    render();
  }

  async function claimChest(button) {
    if (button.disabled) return;
    button.disabled = true;
    button.textContent = "…";

    const response = await emitQuest("quests:claimChest");
    if (!response.ok) {
      button.disabled = false;
      button.textContent = "Ouvrir";
      if (typeof toast === "function") toast(response.error || "Coffre indisponible.");
      return;
    }

    questStatus = response.status;
    render();

    if (response.grantedChest?.reward && window.PtitBacRewards?.receiveGranted) {
      window.PtitBacRewards.receiveGranted(response.grantedChest);
    }
  }

  function bind() {
    document.getElementById("qv1Back")?.addEventListener("click", () => {
      clearInterval(pageTimer);
      pageTimer = null;
      clearTimeout(syncTimer);
      syncTimer = null;
      if (typeof renderHome === "function") renderHome();
    });

    document.querySelectorAll("[data-quest-claim]").forEach(button => {
      button.addEventListener("click", () => claimQuest(button));
    });

    document.getElementById("qv1ChestClaim")?.addEventListener("click", event => {
      claimChest(event.currentTarget);
    });

    startPageTimer();
  }

  async function open() {
    loading = true;
    render();
    await fetchStatus({ rerender:true });
  }

  function patchHomeQuestButton() {
    const button = document.getElementById("homeQuests");
    if (!button) return;
    button.removeAttribute("data-soon");
    button.setAttribute("aria-label", "Quêtes");
  }

  document.addEventListener("click", event => {
    const button = event.target?.closest?.("#homeQuests");
    if (!button) return;

    event.preventDefault();
    event.stopPropagation();
    event.stopImmediatePropagation();
    open();
  }, true);

  document.addEventListener("ptitbac:screen-rendered", patchHomeQuestButton);
  document.addEventListener("ptitbac:dom-updated", patchHomeQuestButton);

  try {
    socket?.on?.("quests:update", status => {
      questStatus = status;
      if (document.querySelector(".quests-v1")) render();
    });

    socket?.on?.("progression:update", payload => {
      // Une mise à jour provenant elle-même d'une quête ne doit pas relancer
      // une synchronisation en boucle. Les gains de partie, eux, peuvent
      // terminer une quête de victoires ou de réponses.
      if (payload?.result?.source === "quest") return;
      scheduleQuestSync(260);
    });

    // Les relances payantes déclenchent un wallet:update côté serveur.
    // On resynchronise alors les quêtes pour créditer immédiatement l'XP
    // si l'objectif de relances vient d'être atteint.
    socket?.on?.("wallet:update", () => {
      scheduleQuestSync(320);
    });
  } catch {}

  window.PtitBacQuests = {
    open,
    refresh:() => fetchStatus({ rerender:true }),
    state:() => questStatus ? JSON.parse(JSON.stringify(questStatus)) : null
  };

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", patchHomeQuestButton, { once:true });
  } else {
    patchHomeQuestButton();
  }
})();
