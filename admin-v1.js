(() => {
  "use strict";

  const state = {
    admin:false,
    infiniteCoins:false,
    infiniteLives:false,
    reports:[],
    activeTab:"tools",
    reportFilter:"all",
    itemCatalog:[],
    itemTypeFilter:"all",
    player:null,
    messageImageData:""
  };

  const token = () =>
    String(
      window.session?.walletToken ||
      localStorage.getItem("petitbac_walletToken") ||
      ""
    );

  const friendCode = () =>
    String(
      localStorage.getItem("petitbac_friendCode") ||
      ""
    ).replace(/^#/,"");

  const profile = () =>
    window.getProfile?.() ||
    { name:"Joueur" };

  function mutationRequestId(scope = "mutation") {
    const random =
      globalThis.crypto?.randomUUID?.() ||
      `${Date.now().toString(36)}-${Math.random().toString(36).slice(2,12)}`;
    return `${String(scope || "mutation").slice(0,24)}:${random}`.slice(0,80);
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

  function modal(inner, extraClass="") {
    document
      .querySelector(".admin-v1-overlay")
      ?.remove();

    const overlay = document.createElement("div");
    overlay.className =
      `admin-v1-overlay ${extraClass}`.trim();

    overlay.innerHTML = `
      <div class="admin-v1-modal">
        ${inner}
      </div>
    `;

    document.body.appendChild(overlay);

    overlay.addEventListener("click",event => {
      if (event.target === overlay) {
        overlay.remove();
      }
    });

    return overlay;
  }

  function icon(name) {
    const icons = {
      tools:`
        <svg viewBox="0 0 24 24">
          <path d="M12 8.2a3.8 3.8 0 1 0 0 7.6 3.8 3.8 0 0 0 0-7.6Z"></path>
          <path d="M19 13a8 8 0 0 0 0-2l2-1.5-2-3.4-2.4 1a8 8 0 0 0-1.6-.9L14.7 3h-5.4L9 6.2a8 8 0 0 0-1.6.9l-2.4-1-2 3.4L5 11a8 8 0 0 0 0 2l-2 1.5 2 3.4 2.4-1a8 8 0 0 0 1.6.9l.3 3.2h5.4l.3-3.2a8 8 0 0 0 1.6-.9l2.4 1 2-3.4L19 13Z"></path>
        </svg>`,
      reports:`
        <svg viewBox="0 0 24 24">
          <path d="M6 3h9l4 4v14H6V3Z"></path>
          <path d="M15 3v5h4M9 12h6M9 16h6"></path>
        </svg>`,
      users:`
        <svg viewBox="0 0 24 24">
          <circle cx="9" cy="8" r="3"></circle>
          <path d="M3.5 19a5.5 5.5 0 0 1 11 0"></path>
          <circle cx="17" cy="9" r="2.3"></circle>
          <path d="M15.5 14.5c2.7.1 4.7 1.4 5 3.7"></path>
        </svg>`,
      messages:`
        <svg viewBox="0 0 24 24">
          <path d="M4 5h16v12H8l-4 4V5Z"></path>
          <path d="M8 9h8M8 13h5"></path>
        </svg>`,
      coins:`
        <svg viewBox="0 0 24 24">
          <ellipse cx="12" cy="6" rx="7" ry="3"></ellipse>
          <path d="M5 6v4c0 1.7 3.1 3 7 3s7-1.3 7-3V6"></path>
          <path d="M5 10v4c0 1.7 3.1 3 7 3s7-1.3 7-3v-4"></path>
          <path d="M5 14v4c0 1.7 3.1 3 7 3s7-1.3 7-3v-4"></path>
        </svg>`,
      gift:`
        <svg viewBox="0 0 24 24">
          <path d="M4 10h16v10H4V10ZM3 6h18v4H3V6Z"></path>
          <path d="M12 6v14M12 6c-1.3 0-4.2-.4-4.2-2.2C7.8 2.6 9 2 10 2c1.4 0 2 1.1 2 4Zm0 0c1.3 0 4.2-.4 4.2-2.2C16.2 2.6 15 2 14 2c-1.4 0-2 1.1-2 4Z"></path>
        </svg>`,
      search:`
        <svg viewBox="0 0 24 24">
          <circle cx="10.5" cy="10.5" r="6.5"></circle>
          <path d="m15.5 15.5 5 5"></path>
        </svg>`
    };

    return `<span class="admin-v4-icon">${icons[name] || icons.tools}</span>`;
  }

  function shell() {
    return `
      <header class="admin-page-v2-head">
        <button
          class="admin-page-v2-back"
          type="button"
          aria-label="Retour"
        >←</button>

        <div class="admin-page-v2-brand">
          <img src="/admin-crown.png" alt="">
          <div>
            <small>ESPACE PRIVÉ</small>
            <h1>Administration</h1>
            <p>Gestion et modération de P’tit Bac.</p>
          </div>
        </div>
      </header>

      <nav class="admin-v4-main-tabs admin-page-v2-tabs" aria-label="Menu administrateur">
        <button data-admin-tab="tools" class="${state.activeTab === "tools" ? "active" : ""}">
          ${icon("tools")}
          <span>Outils</span>
        </button>

        <button data-admin-tab="reports" class="${state.activeTab === "reports" ? "active" : ""}">
          ${icon("reports")}
          <span>Reports</span>
        </button>

        <button data-admin-tab="players" class="${state.activeTab === "players" ? "active" : ""}">
          ${icon("users")}
          <span>Joueurs</span>
        </button>

        <button data-admin-tab="messages" class="${state.activeTab === "messages" ? "active" : ""}">
          ${icon("messages")}
          <span>Messages</span>
        </button>

        <button data-admin-tab="items" class="${state.activeTab === "items" ? "active" : ""}">
          ${icon("gift")}
          <span>Items</span>
        </button>
      </nav>

      <main id="adminV4Body" class="admin-v4-body admin-page-v2-body"></main>
    `;
  }

  async function refreshAdmin() {
    const response = await emit("admin:status");

    state.admin = !!response.admin;
    state.infiniteCoins = !!response.infiniteCoins;
    state.infiniteLives = !!response.infiniteLives;

    if (!state.admin) {
      document.querySelectorAll(".admin-v1-crown-btn").forEach(button => button.remove());
    }

    decorate();

    const crowns = document.querySelectorAll(
      ".admin-v1-crown-btn"
    );

    crowns.forEach(crown => {
      crown.setAttribute(
        "aria-label",
        state.admin
          ? "Ouvrir le menu admin"
          : "Activer l’espace admin"
      );

      crown.onclick = () =>
        state.admin
          ? adminMenu()
          : adminActivationModal();
    });

    return response;
  }

  async function adminMenu(initialTab = "tools") {
    if (!state.admin) {
      const result = await refreshAdmin();

      if (!result?.admin) {
        return adminActivationModal();
      }
    }

    state.activeTab = initialTab;

    document.querySelector(".admin-page-v2")?.remove();

    const page = document.createElement("section");
    page.className = "admin-page-v2";
    page.innerHTML = shell();
    document.body.appendChild(page);
    document.body.classList.add("admin-page-v2-open");

    const closePage = () => {
      page.remove();
      document.body.classList.remove("admin-page-v2-open");
    };

    page
      .querySelector(".admin-page-v2-back")
      ?.addEventListener("click",closePage);

    page
      .querySelectorAll("[data-admin-tab]")
      .forEach(button => {
        button.addEventListener("click",() => {
          state.activeTab = button.dataset.adminTab;

          page
            .querySelectorAll("[data-admin-tab]")
            .forEach(item => {
              item.classList.toggle(
                "active",
                item === button
              );
            });

          renderActiveTab(page);
        });
      });

    await renderActiveTab(page);
  }

  async function renderActiveTab(overlay) {
    if (!overlay?.isConnected) return;

    if (state.activeTab === "reports") {
      return renderReportsTab(overlay);
    }

    if (state.activeTab === "players") {
      return renderPlayersTab(overlay);
    }

    if (state.activeTab === "messages") {
      return renderMessagesTab(overlay);
    }

    if (state.activeTab === "items") {
      return renderItemsTab(overlay);
    }

    return renderToolsTab(overlay);
  }

  const ITEM_RARITY_LABELS = Object.freeze({
    commun:"Commun",
    rare:"Rare",
    epique:"Épique",
    ultra:"Ultra",
    exclusif:"Exclusif"
  });

  const ITEM_RARITY_HELP = Object.freeze({
    commun:"Boutique · Coffres (à venir)",
    rare:"Boutique · Coffres, avec une chance plus faible",
    epique:"Boutique · Coffres très rares",
    ultra:"Boutique · Coffres extrêmement rares",
    exclusif:"Boutique · Niveaux · Voie des trophées · Jamais dans les coffres"
  });

  function adminItemTypeLabel(type) {
    if (type === "avatar") return "Avatar";
    if (type === "frame") return "Cadre";
    if (type === "tag") return "Titre";
    return "Item";
  }

  function rarityOptions(selected) {
    return Object.entries(ITEM_RARITY_LABELS)
      .map(([key,label]) => `
        <option value="${key}" ${selected === key ? "selected" : ""}>
          ${label}
        </option>
      `)
      .join("");
  }

  async function renderItemsTab(overlay) {
    const body = overlay.querySelector("#adminV4Body");
    if (!body) return;

    body.innerHTML = `
      <section class="admin-v4-card admin-items-intro">
        <div>
          <small>CATALOGUE DU JEU</small>
          <h3>Gestion des items</h3>
          <p>
            Les items sont ajoutés au jeu par code. Ici tu règles leur rareté,
            leur prix et leur monnaie. La boutique sera gérée séparément plus tard.
          </p>
        </div>
      </section>

      <div class="admin-v1-empty">Chargement du catalogue…</div>
    `;

    const catalog = await emit("admin:itemCatalog");

    if (!catalog.ok) {
      body.innerHTML = `
        <div class="admin-v1-empty">
          ${esc(catalog.error || "Catalogue indisponible.")}
        </div>
      `;
      return;
    }

    state.itemCatalog = catalog.items || [];

    const render = () => {
      const filtered = state.itemCatalog.filter(item =>
        state.itemTypeFilter === "all" ||
        item.type === state.itemTypeFilter
      );

      body.innerHTML = `
        <section class="admin-v4-card admin-items-intro">
          <div>
            <small>CATALOGUE DU JEU</small>
            <h3>Gestion des items</h3>
            <p>
              Modifie les paramètres des avatars, cadres et titres existants.
              Aucun bouton n’ajoute directement un item à la boutique.
            </p>
          </div>

          <div id="admItemTypeFilter" class="admin-items-filter">
            <button data-item-filter="all" type="button">Tous</button>
            <button data-item-filter="avatar" type="button">Avatars</button>
            <button data-item-filter="frame" type="button">Cadres</button>
            <button data-item-filter="tag" type="button">Titres</button>
          </div>
        </section>

        <section class="admin-v4-card admin-rarity-guide">
          <h3>Raretés</h3>
          <div class="admin-rarity-guide-grid">
            <span class="rarity-common"><b>Commun</b><small>Boutique · Coffres</small></span>
            <span class="rarity-rare"><b>Rare</b><small>Boutique · Coffres plus rares</small></span>
            <span class="rarity-epic"><b>Épique</b><small>Boutique · Coffres très rares</small></span>
            <span class="rarity-ultra"><b>Ultra</b><small>Boutique · Coffres super rares</small></span>
            <span class="rarity-exclusive"><b>Exclusif</b><small>Boutique · Niveaux · Trophées · Pas de coffre</small></span>
          </div>
        </section>

        <section class="admin-items-list">
          ${
            filtered.length
              ? filtered.map(item => {
                  const rarity = ITEM_RARITY_LABELS[item.rarity]
                    ? item.rarity
                    : "commun";

                  return `
                    <article
                      class="admin-item-card"
                      data-admin-item-key="${esc(item.key)}"
                      data-rarity="${esc(rarity)}"
                    >
                      <header class="admin-item-card-head">
                        <div class="admin-item-card-icon">${esc(item.icon || "🎁")}</div>
                        <div class="admin-item-card-copy">
                          <b>${esc(item.label)}</b>
                          <small>${esc(adminItemTypeLabel(item.type))} · ${esc(item.key)}</small>
                        </div>
                        <span class="admin-item-rarity" data-item-rarity-label>
                          ${esc(ITEM_RARITY_LABELS[rarity])}
                        </span>
                      </header>

                      <div class="admin-item-fields">
                        <label>
                          <span>Rareté</span>
                          <select data-item-rarity>
                            ${rarityOptions(rarity)}
                          </select>
                        </label>

                        <label>
                          <span>Prix</span>
                          <input
                            data-item-price
                            type="number"
                            inputmode="numeric"
                            min="0"
                            max="999999"
                            value="${Number(item.price || 0)}"
                          >
                        </label>

                        <label>
                          <span>Monnaie</span>
                          <select data-item-currency>
                            <option value="coins" ${item.currency === "gems" ? "" : "selected"}>🪙 Pièces</option>
                            <option value="gems" ${item.currency === "gems" ? "selected" : ""}>💎 Gemmes</option>
                          </select>
                        </label>
                      </div>

                      <div class="admin-item-acquisition" data-item-acquisition>
                        ${esc(ITEM_RARITY_HELP[rarity])}
                      </div>

                      <button
                        data-item-save
                        class="admin-v1-primary admin-item-save"
                        type="button"
                      >Enregistrer</button>
                    </article>
                  `;
                }).join("")
              : `<div class="admin-v1-empty">Aucun item dans cette catégorie.</div>`
          }
        </section>
      `;

      body
        .querySelectorAll("[data-item-filter]")
        .forEach(button => {
          button.classList.toggle(
            "active",
            button.dataset.itemFilter === state.itemTypeFilter
          );

          button.addEventListener("click",() => {
            state.itemTypeFilter = button.dataset.itemFilter;
            render();
          });
        });

      body
        .querySelectorAll("[data-admin-item-key]")
        .forEach(card => {
          const rarityField = card.querySelector("[data-item-rarity]");
          const acquisition = card.querySelector("[data-item-acquisition]");
          const rarityLabel = card.querySelector("[data-item-rarity-label]");

          rarityField?.addEventListener("change",() => {
            const rarity = rarityField.value;
            card.dataset.rarity = rarity;

            if (acquisition) {
              acquisition.textContent =
                ITEM_RARITY_HELP[rarity] ||
                ITEM_RARITY_HELP.commun;
            }

            if (rarityLabel) {
              rarityLabel.textContent =
                ITEM_RARITY_LABELS[rarity] ||
                ITEM_RARITY_LABELS.commun;
            }
          });

          card
            .querySelector("[data-item-save]")
            ?.addEventListener("click",async event => {
              const button = event.currentTarget;
              const itemKey = card.dataset.adminItemKey;
              const rarity = rarityField?.value || "commun";
              const price = Number(
                card.querySelector("[data-item-price]")?.value || 0
              );
              const currency =
                card.querySelector("[data-item-currency]")?.value || "coins";

              if (!Number.isFinite(price) || price < 0 || price > 999999) {
                return toast("Prix invalide.");
              }

              button.disabled = true;
              button.textContent = "Enregistrement…";

              const response = await emit(
                "admin:itemConfigUpdate",
                { itemKey,rarity,price,currency }
              );

              button.disabled = false;
              button.textContent = "Enregistrer";

              if (!response.ok || !response.item) {
                return toast(
                  response.error ||
                  "Configuration impossible."
                );
              }

              const index = state.itemCatalog.findIndex(
                item => item.key === response.item.key
              );

              if (index >= 0) {
                state.itemCatalog[index] = response.item;
              }

              toast(`${response.item.label} enregistré.`);
              render();
            });
        });
    };

    render();
  }

  async function renderToolsTab(overlay) {
    const body = overlay.querySelector("#adminV4Body");
    if (!body) return;

    if (!state.itemCatalog.length) {
      const catalog = await emit("admin:itemCatalog");
      if (catalog.ok) {
        state.itemCatalog = catalog.items || [];
      }
    }

    body.innerHTML = `
      <section class="admin-v4-card">
        <h3>${icon("tools")}<span>Avantages admin</span></h3>

        <label class="admin-v1-toggle">
          <span>
            <b>Pièces infinies</b>
            <small>Ton portefeuille ne diminue plus</small>
          </span>

          <input
            id="admCoins"
            type="checkbox"
            ${state.infiniteCoins ? "checked" : ""}
          >
          <i></i>
        </label>

        <label class="admin-v1-toggle">
          <span>
            <b>Vies infinies</b>
            <small>Tes vies restent disponibles</small>
          </span>

          <input
            id="admLives"
            type="checkbox"
            ${state.infiniteLives ? "checked" : ""}
          >
          <i></i>
        </label>
      </section>

      <section class="admin-v4-card">
        <h3>${icon("coins")}<span>Gérer les ressources</span></h3>

        <div class="admin-v4-choice-grid">
          <div>
            <small>Mode</small>
            <div class="admin-v4-segment" id="admResourceMode">
              <button class="active" data-mode="set" type="button">Définir</button>
              <button data-mode="add" type="button">Ajouter</button>
            </div>
          </div>

          <div>
            <small>Ressource</small>
            <div class="admin-v4-segment" id="admResourceType">
              <button class="active" data-resource="coins" type="button">🪙 Pièces</button>
              <button data-resource="gems" type="button">💎 Gemmes</button>
            </div>
          </div>
        </div>

        <div class="admin-v1-fields">
          <label>
            ID du joueur
            <input
              id="admResourceId"
              inputmode="numeric"
              maxlength="6"
              placeholder="#84251"
            >
          </label>

          <label>
            Montant
            <input
              id="admResourceAmount"
              inputmode="numeric"
              type="number"
              min="0"
              max="999999"
              placeholder="100"
            >
          </label>
        </div>

        <button
          id="admResourceValidate"
          class="admin-v1-primary"
          type="button"
        >Valider</button>
      </section>

      <section class="admin-v4-card">
        <h3>${icon("gift")}<span>Donner un objet</span></h3>

        <div class="admin-v4-object-grid">
          <label>
            ID du joueur
            <input
              id="admItemId"
              inputmode="numeric"
              maxlength="6"
              placeholder="#84251"
            >
          </label>

          <label>
            Objet
            <select id="admItemKey">
              ${
                state.itemCatalog.length
                  ? state.itemCatalog
                      .map(item => `
                        <option value="${esc(item.key)}">
                          ${esc(item.icon || "🎁")} ${esc(item.label)}
                        </option>
                      `)
                      .join("")
                  : `<option value="">Aucun objet</option>`
              }
            </select>
          </label>

          <label>
            Quantité
            <input
              id="admItemQuantity"
              inputmode="numeric"
              type="number"
              min="1"
              max="99"
              value="1"
            >
          </label>
        </div>

        <button
          id="admItemSend"
          class="admin-v1-primary"
          type="button"
        >Envoyer l’objet</button>
      </section>

      <aside class="admin-v4-note">
        <span>✓</span>
        <div>
          <b>Outils réservés aux administrateurs</b>
          <small>Chaque modification sensible est enregistrée dans les logs admin.</small>
        </div>
      </aside>
    `;

    const saveSettings = async () => {
      const response = await emit(
        "admin:selfSettings",
        {
          infiniteCoins:
            body.querySelector("#admCoins")?.checked,
          infiniteLives:
            body.querySelector("#admLives")?.checked
        }
      );

      if (!response.ok) {
        return toast(
          response.error ||
          "Modification impossible."
        );
      }

      state.infiniteCoins = !!response.infiniteCoins;
      state.infiniteLives = !!response.infiniteLives;

      toast("Options admin enregistrées.");
    };

    body
      .querySelector("#admCoins")
      ?.addEventListener("change",saveSettings);

    body
      .querySelector("#admLives")
      ?.addEventListener("change",saveSettings);

    let mode = "set";
    let resource = "coins";

    body
      .querySelectorAll("#admResourceMode button")
      .forEach(button => {
        button.addEventListener("click",() => {
          mode = button.dataset.mode;

          body
            .querySelectorAll("#admResourceMode button")
            .forEach(item => {
              item.classList.toggle(
                "active",
                item === button
              );
            });
        });
      });

    body
      .querySelectorAll("#admResourceType button")
      .forEach(button => {
        button.addEventListener("click",() => {
          resource = button.dataset.resource;

          body
            .querySelectorAll("#admResourceType button")
            .forEach(item => {
              item.classList.toggle(
                "active",
                item === button
              );
            });
        });
      });

    body
      .querySelector("#admResourceValidate")
      ?.addEventListener("click",async event => {
        const button = event.currentTarget;

        const friendCode =
          String(
            body.querySelector("#admResourceId")?.value ||
            ""
          ).replace("#","").trim();

        const amount =
          Number(
            body.querySelector("#admResourceAmount")?.value
          );

        if (!/^\d{5}$/.test(friendCode)) {
          return toast("Entre un ID joueur valide.");
        }

        if (
          !Number.isFinite(amount) ||
          amount < 0
        ) {
          return toast("Entre un montant valide.");
        }

        button.disabled = true;
        button.textContent = "Modification…";

        const response = await emit(
          "admin:resourceAdjust",
          {
            friendCode,
            mode,
            resource,
            amount,
            requestId:mutationRequestId("resource")
          }
        );

        button.disabled = false;
        button.textContent = "Valider";

        if (!response.ok) {
          return toast(
            response.error ||
            "Modification impossible."
          );
        }

        const label =
          resource === "gems"
            ? "gemmes"
            : "pièces";

        const value =
          resource === "gems"
            ? response.gems
            : response.coins;

        toast(
          `${response.name} : ${value} ${label}.`
        );
      });

    body
      .querySelector("#admItemSend")
      ?.addEventListener("click",async event => {
        const button = event.currentTarget;

        const friendCode =
          String(
            body.querySelector("#admItemId")?.value ||
            ""
          ).replace("#","").trim();

        const itemKey =
          body.querySelector("#admItemKey")?.value || "";

        const quantity =
          Number(
            body.querySelector("#admItemQuantity")?.value ||
            1
          );

        if (!/^\d{5}$/.test(friendCode)) {
          return toast("Entre un ID joueur valide.");
        }

        if (!itemKey) {
          return toast("Choisis un objet.");
        }

        button.disabled = true;
        button.textContent = "Envoi…";

        const response = await emit(
          "admin:grantItem",
          {
            friendCode,
            itemKey,
            quantity
          }
        );

        button.disabled = false;
        button.textContent = "Envoyer l’objet";

        if (!response.ok) {
          return toast(
            response.error ||
            "Envoi impossible."
          );
        }

        toast(
          `${response.item} ×${response.quantity} envoyé à ${response.name}.`
        );
      });
  }

  function reportBadge(report) {
    if (report.type === "report-avis") {
      return "AVIS";
    }

    if (report.type === "report-joueur") {
      return "JOUEUR";
    }

    return "RÉPONSE / BUG";
  }

  function isReportTreated(report) {
    return [
      "admin_treated",
      "admin_validated",
      "admin_deleted"
    ].includes(String(report?.status || ""));
  }

  function reportActions(report) {
    if (isReportTreated(report)) {
      if (report.status === "admin_validated") {
        return `
          <div class="admin-v4-report-valid">
            ✓ VALIDÉ — APPRIS PAR L’IA
          </div>
        `;
      }

      if (report.status === "admin_deleted") {
        return `
          <div class="admin-v5-report-treated is-deleted">
            ✓ TRAITÉ — REPORT SUPPRIMÉ
          </div>
        `;
      }

      return `
        <div class="admin-v5-report-treated">
          ✓ REPORT TRAITÉ
        </div>
      `;
    }

    if (
      report.source === "answer" &&
      report.type === "report-bug" &&
      report.letter &&
      report.category &&
      report.answer
    ) {
      return `
        <div class="admin-v4-report-actions">
          <button
            type="button"
            class="adm-answer-validate"
            data-id="${esc(report.id)}"
          >✓ Valider</button>

          <button
            type="button"
            class="adm-answer-delete"
            data-id="${esc(report.id)}"
          >Supprimer</button>
        </div>
      `;
    }

    return `
      <div class="admin-v4-report-actions single">
        <button
          type="button"
          class="adm-report-treated"
          data-id="${esc(report.id)}"
          data-source="${esc(report.source || "")}"
        >✓ Marquer comme traité</button>
      </div>
    `;
  }

  async function loadReports(force = false) {
    if (
      state.reports.length &&
      !force
    ) {
      return true;
    }

    const response = await emit("admin:reports");

    if (!response.ok) {
      toast(
        response.error ||
        "Impossible de charger les reports."
      );
      return false;
    }

    state.reports = response.reports || [];
    return true;
  }

  async function renderReportsTab(overlay) {
    const body = overlay.querySelector("#adminV4Body");
    if (!body) return;

    body.innerHTML = `
      <section class="admin-v4-card admin-v4-reports-card">
        <div class="admin-v4-section-head">
          <h3>${icon("reports")}<span>Reports</span></h3>
          <button id="admReportsRefresh" type="button">Actualiser</button>
        </div>

        <div class="admin-v4-report-filters">
          <button data-filter="all">Tous</button>
          <button data-filter="report-avis">Avis</button>
          <button data-filter="report-bug">Réponses / bugs</button>
          <button data-filter="report-joueur">Joueurs</button>
          <button data-filter="treated">Traités</button>
        </div>

        <div id="admReportList" class="admin-v1-list">
          <div class="admin-v1-empty">Chargement…</div>
        </div>
      </section>
    `;

    const renderList = () => {
      const listNode =
        body.querySelector("#admReportList");

      if (!listNode) return;

      const list = state.reports.filter(report => {
        const treated = isReportTreated(report);

        if (state.reportFilter === "treated") {
          return treated;
        }

        if (treated) {
          return false;
        }

        if (state.reportFilter === "all") {
          return true;
        }

        return report.type === state.reportFilter;
      });

      body
        .querySelectorAll("[data-filter]")
        .forEach(button => {
          button.classList.toggle(
            "active",
            button.dataset.filter ===
              state.reportFilter
          );
        });

      listNode.innerHTML = list.length
        ? list.map(report => `
            <article class="admin-v1-report">
              <div class="admin-v1-report-top">
                <span class="admin-v1-badge ${esc(report.type)}">
                  ${reportBadge(report)}
                </span>

                <time>
                  ${
                    report.created_at
                      ? new Date(report.created_at)
                          .toLocaleString("fr-FR")
                      : ""
                  }
                </time>
              </div>

              <h4>
                ${esc(report.player_name || "Signalement")}
                ${
                  report.friend_code
                    ? `<small>#${esc(report.friend_code)}</small>`
                    : ""
                }
              </h4>

              ${
                report.letter
                  ? `<p class="admin-v1-context"><b>Lettre ${esc(report.letter)}</b></p>`
                  : ""
              }

              ${
                report.category
                  ? `<p class="admin-v1-context"><b>Catégorie :</b> ${esc(report.category)}</p>`
                  : ""
              }

              ${
                report.answer
                  ? `<p class="admin-v1-context"><b>Réponse :</b> « ${esc(report.answer)} »</p>`
                  : ""
              }

              <p>${esc(report.message || "Signalement")}</p>

              ${
                report.room_code
                  ? `<small>Salon ${esc(report.room_code)}</small>`
                  : ""
              }

              ${reportActions(report)}
            </article>
          `).join("")
        : `<div class="admin-v1-empty">Aucun report dans cette catégorie.</div>`;

      listNode
        .querySelectorAll(".adm-answer-validate")
        .forEach(button => {
          button.addEventListener("click",async () => {
            button.disabled = true;
            button.textContent = "Validation…";

            const response = await emit(
              "admin:answerReportAction",
              {
                reportId:button.dataset.id,
                action:"validate"
              }
            );

            if (!response.ok) {
              button.disabled = false;
              button.textContent = "✓ Valider";

              return toast(
                response.error ||
                "Erreur."
              );
            }

            toast(
              `Réponse validée : ${response.answer}`
            );

            await loadReports(true);
            renderList();
          });
        });

      listNode
        .querySelectorAll(".adm-answer-delete")
        .forEach(button => {
          button.addEventListener("click",async () => {
            button.disabled = true;
            button.textContent = "Suppression…";

            const response = await emit(
              "admin:answerReportAction",
              {
                reportId:button.dataset.id,
                action:"delete"
              }
            );

            if (!response.ok) {
              button.disabled = false;
              button.textContent = "Supprimer";

              return toast(
                response.error ||
                "Erreur."
              );
            }

            toast("Report supprimé.");

            await loadReports(true);
            renderList();
          });
        });

      listNode
        .querySelectorAll(".adm-report-treated")
        .forEach(button => {
          button.addEventListener("click",async () => {
            button.disabled = true;
            button.textContent = "Traitement…";

            const response = await emit(
              "admin:reportMarkTreated",
              {
                reportId:button.dataset.id,
                source:button.dataset.source
              }
            );

            if (!response.ok) {
              button.disabled = false;
              button.textContent = "✓ Marquer comme traité";

              return toast(
                response.error ||
                "Erreur."
              );
            }

            toast("Report marqué comme traité.");

            await loadReports(true);
            renderList();
          });
        });
    };

    body
      .querySelectorAll("[data-filter]")
      .forEach(button => {
        button.addEventListener("click",() => {
          state.reportFilter = button.dataset.filter;
          renderList();
        });
      });

    body
      .querySelector("#admReportsRefresh")
      ?.addEventListener("click",async () => {
        await loadReports(true);
        renderList();
      });

    await loadReports();
    renderList();
  }

  async function renderPlayersTab(overlay) {
    const body = overlay.querySelector("#adminV4Body");
    if (!body) return;

    body.innerHTML = `
      <section class="admin-v4-card">
        <h3>${icon("users")}<span>Rechercher un joueur</span></h3>

        <div class="admin-v4-player-search">
          <label>
            ID du joueur
            <input
              id="admPlayerSearch"
              inputmode="numeric"
              maxlength="6"
              placeholder="#84251"
            >
          </label>

          <button
            id="admPlayerSearchBtn"
            type="button"
            class="admin-v1-primary"
          >
            ${icon("search")}
            <span>Rechercher</span>
          </button>
        </div>
      </section>

      <div id="admPlayerResult"></div>
    `;

    const resultNode =
      body.querySelector("#admPlayerResult");

    const renderPlayer = player => {
      if (!player) {
        resultNode.innerHTML = "";
        return;
      }

      resultNode.innerHTML = `
        <section class="admin-v4-card admin-v4-player-card">
          <div class="admin-v4-player-head">
            <div class="admin-v4-player-avatar">
              ${esc(player.avatar || "🧠")}
            </div>

            <div>
              <h3>${esc(player.name || "Joueur")}</h3>
              <small>#${esc(player.friendCode || "-----")}</small>
            </div>

            <div class="admin-v5-player-statuses">
              <span class="admin-v4-online ${player.online ? "is-online" : ""}">
                ${player.online ? "En ligne" : "Hors ligne"}
              </span>

              ${
                player.banned
                  ? `<span class="admin-v5-banned-pill">Banni</span>`
                  : ""
              }
            </div>
          </div>

          <div class="admin-v4-player-stats">
            <article>
              <small>Pièces</small>
              <strong>🪙 ${Number(player.coins || 0)}</strong>
            </article>

            <article>
              <small>Gemmes</small>
              <strong>💎 ${Number(player.gems || 0)}</strong>
            </article>

            <article>
              <small>Vies</small>
              <strong>❤️ ${Number(player.lives || 0)}/5</strong>
            </article>

            <article>
              <small>Reports</small>
              <strong>⚑ ${Number(player.reports || 0)}</strong>
            </article>
          </div>

          <div class="admin-v4-player-meta">
            <p>
              <b>Membre depuis</b>
              <span>${player.createdAt ? new Date(player.createdAt).toLocaleDateString("fr-FR") : "—"}</span>
            </p>

            <p>
              <b>Dernière activité</b>
              <span>${player.lastSeen ? new Date(player.lastSeen).toLocaleString("fr-FR") : "—"}</span>
            </p>

            ${
              player.banned
                ? `<p class="admin-v5-ban-reason">
                    <b>Motif du ban</b>
                    <span>${esc(player.banReason || "Non précisé")}</span>
                  </p>`
                : ""
            }
          </div>

          <div class="admin-v4-items">
            <b>Objets</b>
            ${
              player.items?.length
                ? `<div>${player.items.map(item => `
                    <span>${esc(item.label)} ×${Number(item.quantity || 0)}</span>
                  `).join("")}</div>`
                : `<small>Aucun objet attribué.</small>`
            }
          </div>

          <section class="admin-v5-player-moderation">
            <h4>Modération du joueur</h4>

            <div class="admin-v5-mod-block">
              <label>
                Modifier le pseudo
                <div class="admin-v5-inline-action">
                  <input
                    id="admRenameInput"
                    maxlength="16"
                    value="${esc(player.name || "")}"
                    placeholder="Nouveau pseudo"
                  >
                  <button id="admRenameBtn" type="button">Modifier</button>
                </div>
              </label>
            </div>

            <div class="admin-v5-mod-block">
              <label>
                Avertir le joueur
                <textarea
                  id="admWarningText"
                  maxlength="300"
                  placeholder="Écris l’avertissement qui sera affiché au joueur…"
                ></textarea>
              </label>

              <button
                id="admWarnBtn"
                class="admin-v5-warning-btn"
                type="button"
              >Envoyer l’avertissement</button>
            </div>

            <div class="admin-v5-mod-block admin-v5-ban-block">
              ${
                player.banned
                  ? `
                    <p>Ce joueur est actuellement banni.</p>
                    <button
                      id="admBanToggle"
                      class="admin-v5-unban-btn"
                      type="button"
                      data-action="unban"
                    >Débannir le joueur</button>
                  `
                  : `
                    <label>
                      Motif du bannissement
                      <input
                        id="admBanReason"
                        maxlength="240"
                        placeholder="Ex. insultes répétées, triche…"
                      >
                    </label>

                    <button
                      id="admBanToggle"
                      class="admin-v5-ban-btn"
                      type="button"
                      data-action="ban"
                    >Bannir le joueur</button>
                  `
              }
            </div>
          </section>

          <button
            id="admPlayerReports"
            class="admin-v4-secondary"
            type="button"
          >Voir les reports de ce joueur</button>
        </section>
      `;

      const runModeration = async (action,payload={}) => {
        const response = await emit(
          "admin:playerModeration",
          {
            friendCode:player.friendCode,
            action,
            ...payload
          }
        );

        if (!response.ok) {
          toast(
            response.error ||
            "Action impossible."
          );
          return null;
        }

        if (response.message) {
          toast(response.message);
        }

        if (response.player) {
          state.player = response.player;
          renderPlayer(response.player);
        }

        return response;
      };

      resultNode
        .querySelector("#admRenameBtn")
        ?.addEventListener("click",async () => {
          const name =
            resultNode
              .querySelector("#admRenameInput")
              ?.value || "";

          await runModeration(
            "rename",
            { name }
          );
        });

      resultNode
        .querySelector("#admWarnBtn")
        ?.addEventListener("click",async () => {
          const message =
            resultNode
              .querySelector("#admWarningText")
              ?.value || "";

          const response =
            await runModeration(
              "warn",
              { message }
            );

          if (response) {
            const field =
              resultNode.querySelector("#admWarningText");

            if (field) field.value = "";
          }
        });

      resultNode
        .querySelector("#admBanToggle")
        ?.addEventListener("click",async event => {
          const action =
            event.currentTarget.dataset.action;

          if (action === "ban") {
            const reason =
              resultNode
                .querySelector("#admBanReason")
                ?.value || "";

            if (
              !window.confirm(
                `Bannir ${player.name} ?`
              )
            ) {
              return;
            }

            await runModeration(
              "ban",
              { reason }
            );
            return;
          }

          if (
            !window.confirm(
              `Débannir ${player.name} ?`
            )
          ) {
            return;
          }

          await runModeration("unban");
        });

      resultNode
        .querySelector("#admPlayerReports")
        ?.addEventListener("click",async () => {
          state.activeTab = "reports";
          state.reportFilter = "report-joueur";

          overlay
            .querySelectorAll("[data-admin-tab]")
            .forEach(button => {
              button.classList.toggle(
                "active",
                button.dataset.adminTab === "reports"
              );
            });

          await renderReportsTab(overlay);
        });
    };

    const search = async () => {
      const code =
        String(
          body.querySelector("#admPlayerSearch")?.value ||
          ""
        ).replace("#","").trim();

      if (!/^\d{5}$/.test(code)) {
        return toast("Entre un ID joueur valide.");
      }

      resultNode.innerHTML = `
        <div class="admin-v1-empty">
          Recherche…
        </div>
      `;

      const response = await emit(
        "admin:playerLookup",
        { friendCode:code }
      );

      if (!response.ok) {
        resultNode.innerHTML = `
          <div class="admin-v1-empty">
            ${esc(response.error || "Joueur introuvable.")}
          </div>
        `;
        return;
      }

      state.player = response.player;
      renderPlayer(response.player);
    };

    body
      .querySelector("#admPlayerSearchBtn")
      ?.addEventListener("click",search);

    body
      .querySelector("#admPlayerSearch")
      ?.addEventListener("keydown",event => {
        if (event.key === "Enter") {
          event.preventDefault();
          search();
        }
      });

    if (state.player) {
      renderPlayer(state.player);
    }
  }

  async function compressAdminImage(file) {
    if (!file) return "";

    if (!/^image\/(?:jpeg|png|webp)$/i.test(file.type)) {
      throw new Error("Choisis une image JPG, PNG ou WebP.");
    }

    const dataUrl =
      await new Promise((resolve,reject) => {
        const reader = new FileReader();
        reader.onload = () => resolve(String(reader.result || ""));
        reader.onerror = () => reject(new Error("Lecture de l’image impossible."));
        reader.readAsDataURL(file);
      });

    const image =
      await new Promise((resolve,reject) => {
        const img = new Image();
        img.onload = () => resolve(img);
        img.onerror = () => reject(new Error("Image invalide."));
        img.src = dataUrl;
      });

    const maxWidth = 900;
    const maxHeight = 540;
    const ratio =
      Math.min(
        1,
        maxWidth / image.width,
        maxHeight / image.height
      );

    const canvas =
      document.createElement("canvas");

    canvas.width =
      Math.max(
        1,
        Math.round(image.width * ratio)
      );

    canvas.height =
      Math.max(
        1,
        Math.round(image.height * ratio)
      );

    const ctx =
      canvas.getContext("2d");

    ctx.drawImage(
      image,
      0,
      0,
      canvas.width,
      canvas.height
    );

    let result =
      canvas.toDataURL(
        "image/webp",
        .76
      );

    if (result.length > 600000) {
      result =
        canvas.toDataURL(
          "image/jpeg",
          .58
        );
    }

    if (result.length > 650000) {
      throw new Error("Image trop lourde. Choisis une image plus petite.");
    }

    return result;
  }

  async function renderMessagesTab(overlay) {
    const body =
      overlay.querySelector("#adminV4Body");

    if (!body) return;

    if (!state.itemCatalog.length) {
      const catalog =
        await emit("admin:itemCatalog");

      if (catalog.ok) {
        state.itemCatalog =
          catalog.items || [];
      }
    }

    state.messageImageData = "";

    body.innerHTML = `
      <section class="admin-v4-card admin-v6-message-card">
        <h3>${icon("messages")}<span>Envoyer un message</span></h3>

        <div class="admin-v6-message-target">
          <small>Destinataire</small>

          <div class="admin-v4-segment" id="admMessageTarget">
            <button class="active" data-target="player" type="button">
              Un joueur
            </button>

            <button data-target="all" type="button">
              Tous les joueurs
            </button>
          </div>
        </div>

        <label id="admMessagePlayerWrap" class="admin-v6-field">
          ID du joueur
          <input
            id="admMessagePlayer"
            inputmode="numeric"
            maxlength="6"
            placeholder="#84251"
          >
        </label>

        <label class="admin-v6-field">
          Titre
          <input
            id="admMessageTitle"
            maxlength="80"
            placeholder="Ex. Récompense de bienvenue"
          >
        </label>

        <label class="admin-v6-field">
          Message
          <textarea
            id="admMessageBody"
            maxlength="1800"
            placeholder="Écris le message qui apparaîtra dans la boîte de réception…"
          ></textarea>
        </label>

        <div class="admin-v6-image-field">
          <span>Image jointe <small>(facultatif)</small></span>

          <label class="admin-v6-upload">
            <input
              id="admMessageImage"
              type="file"
              accept="image/jpeg,image/png,image/webp"
            >
            <span>＋ Choisir une image</span>
          </label>

          <div id="admMessageImagePreview" class="admin-v6-image-preview" hidden>
            <img alt="Aperçu de l’image jointe">
            <button id="admMessageImageRemove" type="button">Retirer</button>
          </div>
        </div>
      </section>

      <section class="admin-v4-card">
        <h3>${icon("gift")}<span>Objet / récompense</span></h3>

        <div class="admin-v6-reward-types" id="admMessageRewardType">
          <button class="active" data-reward="none" type="button">Aucune</button>
          <button data-reward="coins" type="button">🪙 Pièces</button>
          <button data-reward="gems" type="button">💎 Gemmes</button>
          <button data-reward="item" type="button">🎁 Objet</button>
        </div>

        <div id="admMessageRewardAmountWrap" class="admin-v6-field" hidden>
          <label>
            Quantité
            <input
              id="admMessageRewardAmount"
              type="number"
              inputmode="numeric"
              min="1"
              max="999999"
              value="100"
            >
          </label>
        </div>

        <div id="admMessageRewardItemWrap" class="admin-v6-field" hidden>
          <label>
            Objet
            <select id="admMessageRewardItem">
              ${
                state.itemCatalog
                  .map(item => `
                    <option value="${esc(item.key)}">
                      ${esc(item.icon || "🎁")} ${esc(item.label)}
                    </option>
                  `)
                  .join("")
              }
            </select>
          </label>

          <label>
            Quantité
            <input
              id="admMessageRewardItemAmount"
              type="number"
              inputmode="numeric"
              min="1"
              max="99"
              value="1"
            >
          </label>
        </div>
      </section>

      <section class="admin-v6-message-preview">
        <small>APERÇU</small>
        <strong id="admMessagePreviewTitle">Ton titre apparaîtra ici</strong>
        <p id="admMessagePreviewBody">Ton message apparaîtra ici.</p>
        <div id="admMessagePreviewReward" hidden></div>
      </section>

      <button
        id="admMessageSend"
        class="admin-v1-primary admin-v6-send-message"
        type="button"
      >Envoyer le message</button>
    `;

    let target = "player";
    let rewardType = "none";

    const playerWrap =
      body.querySelector("#admMessagePlayerWrap");

    const amountWrap =
      body.querySelector("#admMessageRewardAmountWrap");

    const itemWrap =
      body.querySelector("#admMessageRewardItemWrap");

    const previewTitle =
      body.querySelector("#admMessagePreviewTitle");

    const previewBody =
      body.querySelector("#admMessagePreviewBody");

    const previewReward =
      body.querySelector("#admMessagePreviewReward");

    const updatePreview = () => {
      const title =
        String(
          body.querySelector("#admMessageTitle")?.value ||
          ""
        ).trim();

      const message =
        String(
          body.querySelector("#admMessageBody")?.value ||
          ""
        ).trim();

      previewTitle.textContent =
        title || "Ton titre apparaîtra ici";

      previewBody.textContent =
        message || "Ton message apparaîtra ici.";

      let rewardText = "";

      if (rewardType === "coins") {
        rewardText =
          `🪙 ${Number(body.querySelector("#admMessageRewardAmount")?.value || 0)} pièces`;
      } else if (rewardType === "gems") {
        rewardText =
          `💎 ${Number(body.querySelector("#admMessageRewardAmount")?.value || 0)} gemmes`;
      } else if (rewardType === "item") {
        const select =
          body.querySelector("#admMessageRewardItem");

        const label =
          select?.selectedOptions?.[0]?.textContent || "Objet";

        rewardText =
          `${label} ×${Number(body.querySelector("#admMessageRewardItemAmount")?.value || 1)}`;
      }

      previewReward.hidden = !rewardText;
      previewReward.textContent = rewardText;
    };

    body
      .querySelectorAll("#admMessageTarget button")
      .forEach(button => {
        button.addEventListener("click",() => {
          target = button.dataset.target;

          body
            .querySelectorAll("#admMessageTarget button")
            .forEach(item => {
              item.classList.toggle(
                "active",
                item === button
              );
            });

          playerWrap.hidden =
            target === "all";
        });
      });

    body
      .querySelectorAll("#admMessageRewardType button")
      .forEach(button => {
        button.addEventListener("click",() => {
          rewardType =
            button.dataset.reward;

          body
            .querySelectorAll("#admMessageRewardType button")
            .forEach(item => {
              item.classList.toggle(
                "active",
                item === button
              );
            });

          amountWrap.hidden =
            !["coins","gems"].includes(rewardType);

          itemWrap.hidden =
            rewardType !== "item";

          updatePreview();
        });
      });

    body
      .querySelector("#admMessageTitle")
      ?.addEventListener("input",updatePreview);

    body
      .querySelector("#admMessageBody")
      ?.addEventListener("input",updatePreview);

    body
      .querySelector("#admMessageRewardAmount")
      ?.addEventListener("input",updatePreview);

    body
      .querySelector("#admMessageRewardItem")
      ?.addEventListener("change",updatePreview);

    body
      .querySelector("#admMessageRewardItemAmount")
      ?.addEventListener("input",updatePreview);

    body
      .querySelector("#admMessageImage")
      ?.addEventListener("change",async event => {
        const file =
          event.target.files?.[0];

        if (!file) return;

        const preview =
          body.querySelector("#admMessageImagePreview");

        const image =
          preview?.querySelector("img");

        try {
          state.messageImageData =
            await compressAdminImage(file);

          if (image) {
            image.src =
              state.messageImageData;
          }

          if (preview) {
            preview.hidden = false;
          }
        } catch (error) {
          event.target.value = "";
          state.messageImageData = "";
          toast(error.message || "Image invalide.");
        }
      });

    body
      .querySelector("#admMessageImageRemove")
      ?.addEventListener("click",() => {
        state.messageImageData = "";

        const input =
          body.querySelector("#admMessageImage");

        const preview =
          body.querySelector("#admMessageImagePreview");

        if (input) input.value = "";
        if (preview) preview.hidden = true;
      });

    body
      .querySelector("#admMessageSend")
      ?.addEventListener("click",async event => {
        const button =
          event.currentTarget;

        const playerCode =
          String(
            body.querySelector("#admMessagePlayer")?.value ||
            ""
          )
            .replace("#","")
            .trim();

        const title =
          String(
            body.querySelector("#admMessageTitle")?.value ||
            ""
          ).trim();

        const message =
          String(
            body.querySelector("#admMessageBody")?.value ||
            ""
          ).trim();

        if (
          target === "player" &&
          !/^\d{5}$/.test(playerCode)
        ) {
          return toast("Entre un ID joueur valide.");
        }

        if (!title) {
          return toast("Ajoute un titre.");
        }

        if (!message) {
          return toast("Écris un message.");
        }

        let rewardKey = "";
        let rewardAmount = 0;

        if (
          rewardType === "coins" ||
          rewardType === "gems"
        ) {
          rewardAmount =
            Number(
              body.querySelector("#admMessageRewardAmount")?.value ||
              0
            );
        }

        if (rewardType === "item") {
          rewardKey =
            body.querySelector("#admMessageRewardItem")?.value ||
            "";

          rewardAmount =
            Number(
              body.querySelector("#admMessageRewardItemAmount")?.value ||
              1
            );
        }

        button.disabled = true;
        button.textContent = "Envoi…";

        const response =
          await emit(
            "admin:messageSend",
            {
              target,
              friendCode:playerCode,
              title,
              message,
              imageData:state.messageImageData,
              rewardType,
              rewardKey,
              rewardAmount
            }
          );

        button.disabled = false;
        button.textContent = "Envoyer le message";

        if (!response.ok) {
          return toast(
            response.error ||
            "Envoi impossible."
          );
        }

        toast(
          target === "all"
            ? "Message envoyé à tous les joueurs."
            : "Message envoyé au joueur."
        );

        await renderMessagesTab(overlay);
      });

    updatePreview();
  }

  function feedbackModal(type="report-avis") {
    const isBug = type === "report-bug";

    const overlay = modal(
      `
        <button
          class="admin-v1-x"
          type="button"
        >×</button>

        <div class="admin-v1-feedback-icon">
          ${isBug ? "⚑" : "✦"}
        </div>

        <h2>
          ${isBug ? "Signaler une réponse" : "Donne-nous ton avis"}
        </h2>

        <p class="admin-v1-sub">
          ${
            isBug
              ? "Explique pourquoi tu penses que la réponse devrait être acceptée."
              : "Une idée ou quelque chose à améliorer ? Ton avis nous aide."
          }
        </p>

        <textarea
          id="feedbackText"
          maxlength="1000"
          placeholder="${isBug ? "Explique le problème…" : "Écris ton avis…"}"
        ></textarea>

        <button
          id="feedbackSend"
          class="admin-v1-primary"
          type="button"
        >Envoyer</button>
      `,
      "admin-v1-feedback"
    );

    overlay
      .querySelector(".admin-v1-x")
      ?.addEventListener("click",() => {
        overlay.remove();
      });

    overlay
      .querySelector("#feedbackSend")
      ?.addEventListener("click",async () => {
        const response = await emit(
          "feedback:submit",
          {
            type,
            message:
              overlay.querySelector("#feedbackText")?.value,
            friendCode:friendCode(),
            playerName:profile().name,
            roomCode:session?.code || ""
          }
        );

        if (response.ok) {
          overlay.remove();
          toast("Merci, ton message a bien été envoyé !");
        } else {
          toast(
            response.error ||
            "Envoi impossible."
          );
        }
      });
  }

  function adminActivationModal() {
    if (state.admin) {
      return adminMenu();
    }

    const overlay = modal(
      `
        <button
          class="admin-v1-x"
          type="button"
          aria-label="Fermer"
        >×</button>

        <div class="admin-v1-brand admin-v1-activation-brand">
          <img src="/admin-crown.png" alt="">
          <div>
            <small>ACCÈS PRIVÉ</small>
            <h2>Administration</h2>
          </div>
        </div>

        <p class="admin-v1-sub">
          Entre ton code administrateur pour lier ce compte à l’espace admin.
        </p>

        <label class="admin-v1-code-label">
          Code administrateur
          <input
            id="adminActivationCode"
            type="password"
            autocomplete="off"
            autocapitalize="off"
            spellcheck="false"
            placeholder="••••••••"
          >
        </label>

        <p
          id="adminActivationError"
          class="admin-v1-inline-error"
          hidden
        ></p>

        <button
          id="adminActivationValidate"
          class="admin-v1-primary"
          type="button"
        >Activer l’espace admin</button>
      `,
      "admin-v1-activation"
    );

    const input =
      overlay.querySelector("#adminActivationCode");

    const error =
      overlay.querySelector("#adminActivationError");

    const validate =
      overlay.querySelector("#adminActivationValidate");

    overlay
      .querySelector(".admin-v1-x")
      ?.addEventListener("click",() => {
        overlay.remove();
      });

    const submit = async () => {
      const code =
        String(input?.value || "").trim();

      if (!code) {
        error.hidden = false;
        error.textContent =
          "Entre le code administrateur.";
        return;
      }

      validate.disabled = true;
      error.hidden = true;

      const response = await emit(
        "admin:claim",
        { code }
      );

      if (!response.ok) {
        validate.disabled = false;
        error.hidden = false;
        error.textContent =
          response.error ||
          "Activation impossible.";
        return;
      }

      overlay.remove();
      toast("Espace administrateur activé.");

      await refreshAdmin();
      adminMenu();
    };

    validate?.addEventListener("click",submit);

    input?.addEventListener("keydown",event => {
      if (event.key === "Enter") {
        submit();
      }
    });

    setTimeout(() => input?.focus(),120);
  }

  function decorate() {
    const root =
      document.querySelector(
        ".profile-v10,.profile-v2-final"
      );

    if (
      state.admin &&
      root &&
      !root.querySelector(".admin-v1-crown-btn")
    ) {
      const button = document.createElement("button");

      button.className = "admin-v1-crown-btn";
      button.type = "button";

      button.setAttribute(
        "aria-label",
        state.admin
          ? "Ouvrir le menu admin"
          : "Activer l’espace admin"
      );

      button.innerHTML =
        '<img src="/admin-crown.png" alt="">';

      button.onclick = () =>
        state.admin
          ? adminMenu()
          : adminActivationModal();

      root.appendChild(button);
    }

    const text =
      (
        document.querySelector("#app")
          ?.textContent ||
        ""
      ).toLowerCase();

    if (
      (text.includes("résultat") || text.includes("score")) &&
      !document.querySelector(".admin-v1-answer-report")
    ) {
      const button =
        document.createElement("button");

      button.className =
        "admin-v1-answer-report";

      button.textContent =
        "⚑ Signaler une réponse";

      button.onclick = () =>
        feedbackModal("report-bug");

      document
        .querySelector("main.screen")
        ?.appendChild(button);
    }
  }

  socket.on("admin:profile-sync", payload => {
    const name =
      String(payload?.name || "")
        .trim()
        .slice(0,16);

    if (!name) return;

    const current =
      typeof getProfile === "function"
        ? getProfile()
        : { name:"", icon:"🧠" };

    if (current.name === name) return;

    try {
      if (typeof saveProfile === "function") {
        saveProfile(
          name,
          current.icon || "🧠"
        );
      } else {
        localStorage.setItem(
          "petitbac_profile_name",
          name
        );
      }

      const homeName =
        document.querySelector(
          ".hm-profile-copy b"
        );

      if (homeName) {
        homeName.textContent = name;
      }

      const profileInput =
        document.getElementById(
          "profileV10Name"
        );

      if (profileInput) {
        profileInput.value = name;
      }

      if (payload?.moderated) {
        toast("Ton pseudo a été modifié par la modération.");
      }
    } catch {}
  });

  socket.on("admin:account-banned", payload => {
    const reason =
      String(payload?.reason || "Compte suspendu.")
        .trim();

    document
      .querySelector(".admin-v5-ban-screen")
      ?.remove();

    const screen =
      document.createElement("div");

    screen.className =
      "admin-v5-ban-screen";

    screen.innerHTML = `
      <div>
        <img src="/admin-crown.png" alt="">
        <small>MODÉRATION</small>
        <h1>Compte suspendu</h1>
        <p>${esc(reason)}</p>
        <span>
          Tu pourras rejouer lorsque ton compte aura été débanni.
        </span>
      </div>
    `;

    document.body.appendChild(screen);
  });

  const observer =
    new MutationObserver(() => decorate());

  observer.observe(
    document.getElementById("app"),
    {
      childList:true,
      subtree:true
    }
  );

  socket.on("connect",() => {
    setTimeout(refreshAdmin,300);
  });

  window.PtitBacAdmin = {
    open(tab="tools") {
      if (state.admin) {
        return adminMenu(tab);
      }

      return adminActivationModal();
    },

    refresh:refreshAdmin,

    isAdmin() {
      return state.admin;
    }
  };

  setTimeout(refreshAdmin,600);
})();
