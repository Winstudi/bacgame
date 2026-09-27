(() => {
  "use strict";

  const state = {
    messages:[],
    filter:"all",
    unread:0,
    current:null
  };

  function token() {
    return String(
      window.session?.walletToken ||
      localStorage.getItem("petitbac_walletToken") ||
      ""
    );
  }

  function emit(name,payload={}) {
    return new Promise(resolve => {
      socket.emit(
        name,
        {
          ...payload,
          walletToken:token()
        },
        response => resolve(response || {})
      );
    });
  }

  function esc(value="") {
    if (typeof escapeHtml === "function") {
      return escapeHtml(value);
    }

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

  function badgeType(type) {
    if (type === "warning") {
      return {
        label:"MODÉRATION",
        className:"is-warning",
        icon:"!"
      };
    }

    if (type === "system") {
      return {
        label:"SYSTÈME",
        className:"is-system",
        icon:"i"
      };
    }

    return {
      label:"MESSAGE",
      className:"is-message",
      icon:"✦"
    };
  }

  function rewardLabel(message) {
    if (!message || message.rewardType === "none") {
      return "";
    }

    if (message.rewardType === "coins") {
      return `🪙 ${Number(message.rewardAmount || 0)} pièces`;
    }

    if (message.rewardType === "gems") {
      return `💎 ${Number(message.rewardAmount || 0)} gemmes`;
    }

    if (message.rewardType === "item") {
      return `${message.rewardIcon || "🎁"} ${message.rewardLabel || "Objet"} ×${Number(message.rewardAmount || 1)}`;
    }

    return "";
  }

  function updateBadge(unread = state.unread) {
    state.unread =
      Math.max(
        0,
        Number(unread) || 0
      );

    const value =
      state.unread > 99
        ? "99+"
        : String(state.unread);

    [
      document.getElementById("homeInboxBadge"),
      document.getElementById("homeMenuInboxBadge")
    ]
      .filter(Boolean)
      .forEach(badge => {
        badge.hidden =
          state.unread < 1;

        badge.textContent =
          value;
      });
  }

  async function refreshCount() {
    const walletToken = token();

    if (!walletToken) {
      updateBadge(0);
      return 0;
    }

    const response =
      await emit("inbox:count");

    if (response.ok) {
      updateBadge(response.unread);
    }

    return state.unread;
  }

  async function loadMessages() {
    const response =
      await emit("inbox:list");

    if (!response.ok) {
      toast(
        response.error ||
        "Impossible de charger la boîte de réception."
      );

      return false;
    }

    state.messages =
      response.messages || [];

    updateBadge(response.unread);

    return true;
  }

  function filteredMessages() {
    return state.messages.filter(message => {
      if (state.filter === "unread") {
        return !message.read;
      }

      if (state.filter === "rewards") {
        return message.rewardType !== "none";
      }

      if (state.filter === "moderation") {
        return message.type === "warning";
      }

      return true;
    });
  }

  function messageCard(message) {
    const type = badgeType(message.type);
    const reward =
      message.rewardType !== "none";

    return `
      <button
        class="inbox-v1-card ${message.read ? "is-read" : "is-unread"}"
        type="button"
        data-inbox-id="${esc(message.id)}"
      >
        <span class="inbox-v1-card-icon ${type.className}">
          ${type.icon}
        </span>

        <span class="inbox-v1-card-copy">
          <span class="inbox-v1-card-top">
            <small>${type.label}</small>
            <time>
              ${
                message.createdAt
                  ? new Date(message.createdAt).toLocaleDateString("fr-FR")
                  : ""
              }
            </time>
          </span>

          <strong>${esc(message.title)}</strong>

          <span class="inbox-v1-excerpt">
            ${esc(message.excerpt || "")}
          </span>

          <span class="inbox-v1-card-meta">
            ${
              message.hasImage
                ? `<i>▧ Image jointe</i>`
                : ""
            }

            ${
              reward
                ? `<i class="has-reward">🎁 Récompense${message.claimed ? " récupérée" : ""}</i>`
                : ""
            }
          </span>
        </span>

        ${
          message.read
            ? ""
            : `<span class="inbox-v1-unread-dot" aria-label="Non lu"></span>`
        }
      </button>
    `;
  }

  function renderList() {
    const root =
      document.querySelector(".inbox-v1");

    const list =
      root?.querySelector(
        "#inboxV1List"
      );

    if (!root || !list) return;

    root
      .querySelectorAll("[data-inbox-filter]")
      .forEach(button => {
        button.classList.toggle(
          "active",
          button.dataset.inboxFilter ===
            state.filter
        );
      });

    const messages =
      filteredMessages();

    list.innerHTML =
      messages.length
        ? messages
            .map(messageCard)
            .join("")
        : `
          <div class="inbox-v1-empty">
            <div>✉</div>
            <strong>Aucun message ici</strong>
            <small>Les nouveaux messages apparaîtront dans cette section.</small>
          </div>
        `;

    list
      .querySelectorAll("[data-inbox-id]")
      .forEach(button => {
        button.addEventListener(
          "click",
          () => openMessage(
            button.dataset.inboxId
          )
        );
      });
  }

  async function openMessage(messageId) {
    const response =
      await emit(
        "inbox:get",
        { messageId }
      );

    if (!response.ok) {
      return toast(
        response.error ||
        "Impossible d’ouvrir le message."
      );
    }

    state.current =
      response.message;

    const local =
      state.messages.find(
        item => item.id === messageId
      );

    if (local && !local.read) {
      local.read = true;
      state.unread =
        Math.max(0,state.unread - 1);
      updateBadge();
    }

    renderDetail();
  }

  function renderDetail() {
    const message =
      state.current;

    if (!message) return;

    const type =
      badgeType(message.type);

    const reward =
      rewardLabel(message);

    const layer =
      document.createElement("div");

    layer.className =
      "inbox-v1-detail-layer";

    layer.innerHTML = `
      <article class="inbox-v1-detail">
        <header>
          <div>
            <h2>${esc(message.title)}</h2>
            <time>
              ${
                message.createdAt
                  ? new Date(message.createdAt)
                      .toLocaleString("fr-FR")
                  : ""
              }
            </time>
          </div>

          <button
            class="inbox-v1-detail-close"
            type="button"
            aria-label="Fermer"
          >×</button>
        </header>

        ${
          message.imageData
            ? `
              <img
                class="inbox-v1-detail-image"
                src="${esc(message.imageData)}"
                alt=""
              >
            `
            : ""
        }

        <p class="inbox-v1-detail-body">
          ${esc(message.body)}
        </p>

        ${
          reward
            ? `
              <section class="inbox-v1-reward ${message.claimed ? "is-claimed" : ""}">
                <small>RÉCOMPENSE</small>
                <strong>${esc(reward)}</strong>

                <button
                  id="inboxV1Claim"
                  type="button"
                  ${message.claimed ? "disabled" : ""}
                >
                  ${
                    message.claimed
                      ? "✓ Récupérée"
                      : "Récupérer"
                  }
                </button>
              </section>
            `
            : ""
        }
      </article>
    `;

    document.body.appendChild(layer);

    const close = () => {
      layer.remove();
      renderList();
      refreshCount();
    };

    layer
      .querySelector(".inbox-v1-detail-close")
      ?.addEventListener("click",close);

    layer.addEventListener("click",event => {
      if (event.target === layer) {
        close();
      }
    });

    layer
      .querySelector("#inboxV1Claim")
      ?.addEventListener("click",async event => {
        const button =
          event.currentTarget;

        button.disabled = true;
        button.textContent =
          "Récupération…";

        const response =
          await emit(
            "inbox:claim",
            { messageId:message.id }
          );

        if (!response.ok) {
          button.disabled = false;
          button.textContent =
            "Récupérer";

          return toast(
            response.error ||
            "Impossible de récupérer la récompense."
          );
        }

        message.claimed = true;

        const local =
          state.messages.find(
            item => item.id === message.id
          );

        if (local) {
          local.claimed = true;
        }

        button.textContent =
          "✓ Récupérée";

        toast(
          response.rewardType === "item"
            ? `${response.itemLabel || "Objet"} ajouté à ton inventaire.`
            : "Récompense récupérée !"
        );
      });
  }

  async function open() {
    if (!token()) {
      return toast(
        "Attends le chargement de ton profil."
      );
    }

    setScreen(`
      <main class="screen inbox-v1">
        <header class="inbox-v1-head">
          <button
            id="inboxV1Back"
            class="inbox-v1-back"
            type="button"
            aria-label="Retour"
          >
            <img src="/back-arrow.png" alt="">
          </button>

          <div>
            <small>MESSAGES & RÉCOMPENSES</small>
            <h1>Boîte de réception</h1>
          </div>

          <button
            id="inboxV1ReadAll"
            class="inbox-v1-read-all"
            type="button"
          >Tout lire</button>
        </header>

        <nav class="inbox-v1-filters">
          <button class="active" data-inbox-filter="all" type="button">Tous</button>
          <button data-inbox-filter="unread" type="button">Non lus</button>
          <button data-inbox-filter="rewards" type="button">Récompenses</button>
          <button data-inbox-filter="moderation" type="button">Modération</button>
        </nav>

        <section id="inboxV1List" class="inbox-v1-list">
          <div class="inbox-v1-loading">Chargement…</div>
        </section>
      </main>
    `);

    document
      .getElementById("inboxV1Back")
      ?.addEventListener("click",() => {
        window.renderHome?.();
      });

    document
      .getElementById("inboxV1ReadAll")
      ?.addEventListener("click",async () => {
        const response =
          await emit(
            "inbox:markAllRead"
          );

        if (!response.ok) {
          return toast(
            response.error ||
            "Action impossible."
          );
        }

        state.messages.forEach(
          item => item.read = true
        );

        updateBadge(0);
        renderList();
      });

    document
      .querySelectorAll("[data-inbox-filter]")
      .forEach(button => {
        button.addEventListener("click",() => {
          state.filter =
            button.dataset.inboxFilter;

          renderList();
        });
      });

    state.filter = "all";

    if (await loadMessages()) {
      renderList();
    }
  }

  socket.on("inbox:new", payload => {
    refreshCount();

    if (payload?.type === "warning") {
      toast(
        "Nouvel avertissement dans ta boîte de réception."
      );
    } else if (payload?.hasReward) {
      toast(
        "Nouveau message avec une récompense !"
      );
    } else {
      toast(
        "Nouveau message dans ta boîte de réception."
      );
    }

    if (
      document.querySelector(
        ".inbox-v1"
      )
    ) {
      loadMessages()
        .then(ok => {
          if (ok) renderList();
        });
    }
  });

  socket.on("connect",() => {
    setTimeout(refreshCount,450);
  });

  document.addEventListener("ptitbac:screen-rendered", () => {
    updateBadge();
  });

  window.PtitBacInbox = {
    open,
    refreshCount
  };

  setTimeout(refreshCount,700);
})();
