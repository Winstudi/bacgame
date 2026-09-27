(() => {
  "use strict";

  const CHESTS = Object.freeze([
    { type:"bag", value:"chest:bag", label:"🎒 Sac" },
    { type:"star", value:"chest:star", label:"⭐ Étoile" },
    { type:"legendary", value:"chest:legendary", label:"🌟 Étoile légendaire" }
  ]);

  const SHOP_SLOTS = Object.freeze({ 1:3, 2:3, 3:4 });
  const SHOP_DURATIONS = Object.freeze([
    [60,"1 heure"],
    [360,"6 heures"],
    [720,"12 heures"],
    [1440,"1 jour"],
    [4320,"3 jours"],
    [10080,"7 jours"],
    [20160,"14 jours"]
  ]);
  let shopCatalog = [];
  let shopOffers = [];
  let selectedShopOfferId = "";

  const walletToken = () => String(
    window.session?.walletToken ||
    localStorage.getItem("petitbac_walletToken") ||
    ""
  ).trim();

  function esc(value = "") {
    return String(value).replace(/[&<>"']/g, char => ({
      "&":"&amp;",
      "<":"&lt;",
      ">":"&gt;",
      '"':"&quot;",
      "'":"&#039;"
    }[char]));
  }

  function notify(message) {
    const text = String(message || "").trim();
    if (!text) return;

    const node = document.querySelector("#toast");
    if (!node) return;

    node.textContent = text;
    node.classList.add("show");
    clearTimeout(node.__adminExtraTimer);
    node.__adminExtraTimer = setTimeout(() => node.classList.remove("show"), 2600);
  }

  function emit(name, payload = {}) {
    return new Promise(resolve => {
      try {
        socket.emit(
          name,
          { ...payload, walletToken:walletToken() },
          response => resolve(response || {})
        );
      } catch {
        resolve({ ok:false, error:"Connexion au serveur indisponible." });
      }
    });
  }

  function isChestValue(value) {
    return /^chest:(bag|star|legendary)$/.test(String(value || ""));
  }

  function enhanceGiveItem() {
    const select = document.querySelector("#admItemKey");
    const button = document.querySelector("#admItemSend");
    const quantity = document.querySelector("#admItemQuantity");
    if (!select || !button) return;

    if (!select.querySelector('optgroup[data-admin-chests]')) {
      const group = document.createElement("optgroup");
      group.label = "Coffres";
      group.dataset.adminChests = "1";

      for (const chest of CHESTS) {
        const option = document.createElement("option");
        option.value = chest.value;
        option.textContent = chest.label;
        group.appendChild(option);
      }

      select.prepend(group);
    }

    const syncQuantity = () => {
      if (!quantity) return;
      const chestSelected = isChestValue(select.value);
      quantity.disabled = chestSelected;
      if (chestSelected) quantity.value = "1";
      quantity.closest("label")?.classList.toggle("admin-extra-disabled-field", chestSelected);
    };

    if (!select.dataset.adminExtraBound) {
      select.dataset.adminExtraBound = "1";
      select.addEventListener("change", syncQuantity);
    }
    syncQuantity();

    if (button.dataset.adminExtraBound) return;
    button.dataset.adminExtraBound = "1";

    button.addEventListener("click", async event => {
      if (!isChestValue(select.value)) return;

      event.preventDefault();
      event.stopImmediatePropagation();

      const friendCode = String(
        document.querySelector("#admItemId")?.value || ""
      ).replace("#", "").trim();

      if (!/^\d{5}$/.test(friendCode)) {
        notify("Entre un ID joueur valide.");
        return;
      }

      const chestType = select.value.split(":")[1];
      const chest = CHESTS.find(entry => entry.type === chestType);

      button.disabled = true;
      const previousText = button.textContent;
      button.textContent = "Envoi du coffre…";

      const response = await emit("admin:grantChest", {
        friendCode,
        chestType
      });

      button.disabled = false;
      button.textContent = previousText || "Envoyer l’objet";

      if (!response.ok) {
        notify(response.error || "Envoi du coffre impossible.");
        return;
      }

      const suffix = response.online
        ? " Le joueur peut l’ouvrir maintenant."
        : " Récompense attribuée (joueur hors ligne).";

      notify(`${response.chestLabel || chest?.label || "Coffre"} donné à ${response.name}.${suffix}`);
    }, true);
  }

  function playerFriendCode(card) {
    const text = card?.querySelector(".admin-v4-player-head small")?.textContent || "";
    return (text.match(/\d{5}/) || [""])[0];
  }

  function enhancePlayerInventoryReset() {
    const result = document.querySelector("#admPlayerResult");
    const card = result?.querySelector(".admin-v4-player-card");
    const moderation = card?.querySelector(".admin-v5-player-moderation");
    if (!card || !moderation || moderation.querySelector("#admResetInventoryBtn")) return;

    const block = document.createElement("div");
    block.className = "admin-v5-mod-block admin-extra-inventory-reset";
    block.innerHTML = `
      <div class="admin-extra-inventory-reset-copy">
        <b>Inventaire du joueur</b>
        <small>Supprime tous les objets débloqués et conserve uniquement les 5 avatars de base.</small>
      </div>
      <button id="admResetInventoryBtn" class="admin-extra-danger-btn" type="button">
        Réinitialiser l’inventaire
      </button>
    `;

    moderation.appendChild(block);

    block.querySelector("#admResetInventoryBtn")?.addEventListener("click", async event => {
      const button = event.currentTarget;
      const friendCode = playerFriendCode(card);

      if (!/^\d{5}$/.test(friendCode)) {
        notify("ID joueur introuvable.");
        return;
      }

      const confirmed = window.confirm(
        `Réinitialiser l’inventaire du joueur #${friendCode} ?\n\nTous ses avatars débloqués, cadres et titres seront supprimés. Seuls les 5 avatars de base resteront.`
      );
      if (!confirmed) return;

      button.disabled = true;
      button.textContent = "Réinitialisation…";

      const response = await emit("admin:inventoryReset", { friendCode });

      if (!response.ok) {
        button.disabled = false;
        button.textContent = "Réinitialiser l’inventaire";
        notify(response.error || "Réinitialisation impossible.");
        return;
      }

      notify(response.message || "Inventaire réinitialisé.");

      const searchInput = document.querySelector("#admPlayerSearch");
      if (searchInput) searchInput.value = friendCode;
      document.querySelector("#admPlayerSearchBtn")?.click();
    });
  }

  function bindInventoryResetSync() {
    try {
      if (typeof socket === "undefined" || !socket?.on || socket.__ptbAdminExtraResetBound) return;
      socket.__ptbAdminExtraResetBound = true;
      socket.on("admin:inventory-reset", payload => {
        const avatar = String(payload?.avatar || "/a1.webp");
        try {
          localStorage.setItem("petitbac_profile_icon", avatar);
        } catch {}
        document.dispatchEvent(new CustomEvent("ptitbac:inventory-changed"));
      });
    } catch {}
  }

  function shopTabIcon() {
    return `<span class="admin-v4-icon"><svg viewBox="0 0 24 24"><path d="M4 9h16l-1 11H5L4 9Z"></path><path d="M7 9V7a5 5 0 0 1 10 0v2"></path><path d="M9 13h6"></path></svg></span>`;
  }

  function formatRemaining(endsAt) {
    const ms = Math.max(0, Number(endsAt) - Date.now());
    if (!ms) return "Expirée";
    const minutes = Math.ceil(ms / 60000);
    if (minutes < 60) return `${minutes} min`;
    const hours = Math.floor(minutes / 60);
    if (hours < 24) return `${hours} h`;
    return `${Math.floor(hours / 24)} j ${hours % 24} h`;
  }

  function itemVisual(item) {
    if (!item) return `<span class="admin-shop-item-fallback">✦</span>`;
    if (item.type === "tag") return `<span class="admin-shop-tag-preview">🏷️ ${esc(item.label)}</span>`;
    const asset = String(item.asset || (item.type === "avatar" ? item.id : ""));
    return asset
      ? `<img src="${esc(asset)}" alt="">`
      : `<span class="admin-shop-item-fallback">✦</span>`;
  }

  function offerModeLabel(mode) {
    if (mode === "pack") return "PACK";
    if (mode === "choice") return "CHOIX";
    return "ITEM";
  }

  function offerItemKeys(offer = null) {
    const keys = Array.isArray(offer?.itemKeys) && offer.itemKeys.length
      ? offer.itemKeys
      : offer?.itemKey ? [offer.itemKey] : [];
    return [...new Set(keys.map(value => String(value || "").trim()).filter(Boolean))];
  }

  function itemsForKeys(keys = []) {
    return keys.map(key => shopCatalog.find(item => item.key === key)).filter(Boolean);
  }

  function itemsVisual(items = [], compact = false) {
    if (!items.length) return `<span class="admin-shop-item-fallback">✦</span>`;
    if (items.length === 1) return itemVisual(items[0]);
    const shown = items.slice(0,4);
    return `<div class="admin-shop-multi-art${compact ? " is-compact" : ""}">
      ${shown.map(item => `<span>${itemVisual(item)}</span>`).join("")}
      ${items.length > shown.length ? `<b>+${items.length - shown.length}</b>` : ""}
    </div>`;
  }

  function highestSelectedRarity(items = []) {
    const order = { commun:0, rare:1, epique:2, ultra:3, exclusif:4 };
    let best = null;
    items.forEach(item => {
      if (!best || (order[item.rarity] || 0) > (order[best.rarity] || 0)) best = item;
    });
    return best?.rarityLabel || "Commun";
  }

  function activeShopOffer(block, position) {
    return shopOffers.find(offer =>
      offer.active &&
      Number(offer.block) === block &&
      Number(offer.position) === position &&
      Number(offer.endsAt) > Date.now()
    ) || null;
  }

  function adminSlotMarkup(block, position, size) {
    if (Number(block) === 3 && Number(position) === 3) {
      return `
        <button class="admin-shop-slot size-${size} is-filled is-system-slot" type="button" disabled>
          <small>B3 · P3</small>
          <span class="admin-shop-mode-chip">SYSTÈME</span>
          <div class="admin-shop-slot-art"><img src="/reward-bag.png" alt=""></div>
          <b>Sac de Ressource</b>
          <span>▶ Pub récompensée</span>
          <em>Fixe</em>
        </button>`;
    }
    if (Number(block) === 3 && Number(position) === 4) {
      return `
        <button class="admin-shop-slot size-${size} is-filled is-system-slot" type="button" disabled>
          <small>B3 · P4</small>
          <span class="admin-shop-mode-chip">SYSTÈME</span>
          <div class="admin-shop-slot-art"><span class="admin-shop-item-fallback">🎁</span></div>
          <b>Récompense quotidienne</b>
          <span>Gratuite · 11h</span>
          <em>Rotation auto</em>
        </button>`;
    }

    const offer = activeShopOffer(block, position);
    const items = offer ? itemsForKeys(offerItemKeys(offer)) : [];
    return `
      <button class="admin-shop-slot size-${size}${offer ? " is-filled" : ""}" type="button" data-admin-shop-slot="${block}:${position}" ${offer ? `data-admin-shop-edit="${esc(offer.id)}"` : ""}>
        <small>B${block} · P${position}</small>
        ${offer ? `
          <span class="admin-shop-mode-chip mode-${esc(offer.offerMode || "single")}">${offerModeLabel(offer.offerMode)}${items.length > 1 ? ` ×${items.length}` : ""}</span>
          <div class="admin-shop-slot-art">${itemsVisual(items,true)}</div>
          <b>${esc(offer.name)}</b>
          <span>${offer.currency === "gems" ? "💎" : "🪙"} ${Number(offer.finalPrice || 0).toLocaleString("fr-FR")}</span>
          <em>${formatRemaining(offer.endsAt)}</em>
        ` : `<strong>+</strong><span>Ajouter</span>`}
      </button>`;
  }

  function shopBoardMarkup() {
    return `
      <div class="admin-shop-board">
        <section><h4>Bloc 1</h4><div class="admin-shop-grid block-1">
          ${adminSlotMarkup(1,1,"large")}${adminSlotMarkup(1,2,"small")}${adminSlotMarkup(1,3,"small")}
        </div></section>
        <section><h4>Bloc 2</h4><div class="admin-shop-grid block-2">
          ${adminSlotMarkup(2,1,"small")}${adminSlotMarkup(2,2,"small")}${adminSlotMarkup(2,3,"large")}
        </div></section>
        <section><h4>Bloc 3</h4><div class="admin-shop-grid block-3">
          ${adminSlotMarkup(3,1,"tiny")}${adminSlotMarkup(3,2,"tiny")}${adminSlotMarkup(3,3,"tiny")}${adminSlotMarkup(3,4,"tiny")}
        </div></section>
      </div>`;
  }

  function groupItemOptions(selectedKey = "", unavailableKeys = []) {
    const unavailable = new Set(unavailableKeys);
    const groups = { avatar:[], frame:[], tag:[], chest:[] };
    shopCatalog.forEach(item => groups[item.type]?.push(item));
    const labels = { avatar:"Avatars", frame:"Cadres", tag:"Tags", chest:"Coffres" };
    return Object.entries(groups).map(([type, items]) => items.length ? `
      <optgroup label="${labels[type]}">
        ${items.map(item => {
          const disabled = unavailable.has(item.key) && item.key !== selectedKey;
          return `<option value="${esc(item.key)}" ${item.key === selectedKey ? "selected" : ""} ${disabled ? "disabled" : ""}>${esc(item.label)} — ${esc(item.rarityLabel || "Commun")}</option>`;
        }).join("")}
      </optgroup>` : "").join("");
  }

  function groupItemRowMarkup(key = "", index = 0, allKeys = []) {
    const unavailable = allKeys.filter((_, itemIndex) => itemIndex !== index);
    return `
      <div class="admin-shop-group-row" data-admin-shop-group-row>
        <span class="admin-shop-group-index">${index + 1}</span>
        <select data-admin-shop-group-item>${groupItemOptions(key, unavailable)}</select>
        <button type="button" class="admin-shop-group-remove" data-admin-shop-group-remove aria-label="Retirer cet item">×</button>
      </div>`;
  }

  function singleItemSelectMarkup(selectedKey = "") {
    const groups = { avatar:[], frame:[], tag:[], chest:[] };
    shopCatalog.forEach(item => groups[item.type]?.push(item));
    const labels = { avatar:"Avatars", frame:"Cadres", tag:"Tags", chest:"Coffres" };
    return Object.entries(groups).map(([type, items]) => items.length ? `
      <optgroup label="${labels[type]}">
        ${items.map(item => `<option value="${esc(item.key)}" ${item.key === selectedKey ? "selected" : ""}>${esc(item.label)} — ${esc(item.rarityLabel || "Commun")}</option>`).join("")}
      </optgroup>` : "").join("");
  }

  function positionOptions(block, selected = 1) {
    const count = SHOP_SLOTS[Number(block)] || 3;
    return Array.from({ length:count }, (_, index) => index + 1)
      .map(position => `<option value="${position}" ${position === Number(selected) ? "selected" : ""}>Position ${position}</option>`)
      .join("");
  }

  function offerEditorMarkup(offer = null, presetBlock = 1, presetPosition = 1) {
    const selectedKeys = offerItemKeys(offer);
    if (!selectedKeys.length && shopCatalog[0]?.key) selectedKeys.push(shopCatalog[0].key);
    const selectedItems = itemsForKeys(selectedKeys);
    const item = selectedItems[0] || shopCatalog[0] || null;
    const mode = String(offer?.offerMode || "single");
    const block = Number(offer?.block || presetBlock || 1);
    const position = Number(offer?.position || presetPosition || 1);
    const price = Number(offer?.basePrice || item?.configuredPrice || 100);
    const currency = String(offer?.currency || item?.configuredCurrency || "coins");
    return `
      <section class="admin-v4-card admin-shop-editor" id="adminShopEditor">
        <div class="admin-shop-editor-head">
          <div><small>OFFRE</small><h3>${offer ? "Modifier l’offre" : "Créer une offre"}</h3></div>
          ${offer ? `<button id="admShopNew" type="button">Nouvelle</button>` : ""}
        </div>
        <div class="admin-shop-form">
          <label class="admin-shop-wide">Type d’offre
            <select id="admShopMode">
              <option value="single" ${mode === "single" ? "selected" : ""}>Item unique</option>
              <option value="pack" ${mode === "pack" ? "selected" : ""}>Pack — tous les items sont achetés ensemble</option>
              <option value="choice" ${mode === "choice" ? "selected" : ""}>Choix — le joueur choisit 1 item</option>
            </select>
          </label>
          <p class="admin-shop-mode-help admin-shop-wide" id="admShopModeHelp"></p>
          <label class="admin-shop-wide" id="admShopSingleItemWrap" ${mode === "single" ? "" : "hidden"}>Item de l’offre
            <select id="admShopSingleItem">${singleItemSelectMarkup(selectedKeys[0] || shopCatalog[0]?.key || "")}</select>
          </label>
          <div class="admin-shop-wide admin-shop-group-editor" id="admShopMultiItemsWrap" ${mode === "single" ? "hidden" : ""} data-initial-keys='${esc(JSON.stringify(selectedKeys))}'>
            <div class="admin-shop-items-head">
              <b>Items de l’offre</b>
              <small id="admShopItemCount">${selectedItems.length}/8</small>
            </div>
            <div class="admin-shop-group-list" id="admShopGroupItems"></div>
            <button class="admin-shop-add-item" id="admShopAddItem" type="button">+ Ajouter un item</button>
          </div>
          <div class="admin-shop-item-preview" id="admShopItemPreview">${itemsVisual(selectedItems)}</div>
          <label>Rareté dominante<input id="admShopRarity" value="${esc(highestSelectedRarity(selectedItems))}" disabled></label>
          <label class="admin-shop-wide">Nom affiché<input id="admShopName" maxlength="40" value="${esc(offer?.name || item?.label || "")}"></label>
          <label>Monnaie<select id="admShopCurrency"><option value="coins" ${currency === "coins" ? "selected" : ""}>Pièces</option><option value="gems" ${currency === "gems" ? "selected" : ""}>Gemmes</option></select></label>
          <label>Prix de l’offre<input id="admShopPrice" type="number" min="1" max="999999" value="${Math.max(1, price)}"></label>
          <label>Promotion<select id="admShopDiscount">${[0,10,20,30,40,50,60,70,80,90].map(v => `<option value="${v}" ${Number(offer?.discountPercent || 0) === v ? "selected" : ""}>${v ? `-${v}%` : "Aucune"}</option>`).join("")}</select></label>
          <label>Bloc<select id="admShopBlock">${[1,2,3].map(v => `<option value="${v}" ${block === v ? "selected" : ""}>Bloc ${v}</option>`).join("")}</select></label>
          <label>Position<select id="admShopPosition">${positionOptions(block, position)}</select></label>
          <label>Durée<select id="admShopDuration">${SHOP_DURATIONS.map(([value,label]) => `<option value="${value}" ${Number(offer?.durationMinutes || 60) === value ? "selected" : ""}>${label}</option>`).join("")}</select></label>
          <label class="admin-shop-wide">Badge facultatif<input id="admShopBadge" maxlength="24" placeholder="NOUVEAU, EXCLUSIF…" value="${esc(offer?.badge || "")}"></label>
          <label class="admin-shop-active"><input id="admShopActive" type="checkbox" ${offer?.active === false ? "" : "checked"}> Offre active</label>
        </div>
        <div class="admin-shop-editor-actions">
          <button id="admShopSave" class="admin-shop-primary" type="button">${offer ? "Enregistrer" : "Publier l’offre"}</button>
          ${offer ? `<button id="admShopDeactivate" class="admin-extra-danger-btn" type="button">Retirer de la boutique</button>` : ""}
        </div>
      </section>`;
  }

  function recentOffersMarkup() {
    const recent = shopOffers.slice(0,20);
    if (!recent.length) return `<div class="admin-v1-empty">Aucune offre enregistrée.</div>`;
    return `<div class="admin-shop-recent">${recent.map(offer => `
      <button type="button" data-admin-shop-edit="${esc(offer.id)}" class="${offer.active && Number(offer.endsAt) > Date.now() ? "is-live" : ""}">
        <span><b>${esc(offer.name)}</b><small>${offerModeLabel(offer.offerMode)} · ${Math.max(1, offerItemKeys(offer).length)} item${offerItemKeys(offer).length > 1 ? "s" : ""} · Bloc ${offer.block} · Position ${offer.position}</small></span>
        <em>${offer.active ? formatRemaining(offer.endsAt) : "Retirée"}</em>
      </button>`).join("")}</div>`;
  }

  function bindAdminShopEditor(body, presetBlock = 1, presetPosition = 1) {
    const editor = body.querySelector("#adminShopEditor");
    if (!editor) return;

    const modeSelect = editor.querySelector("#admShopMode");
    const blockSelect = editor.querySelector("#admShopBlock");
    const positionSelect = editor.querySelector("#admShopPosition");
    const singleSelect = editor.querySelector("#admShopSingleItem");
    const singleWrap = editor.querySelector("#admShopSingleItemWrap");
    const multiWrap = editor.querySelector("#admShopMultiItemsWrap");
    const groupList = editor.querySelector("#admShopGroupItems");
    const addItemButton = editor.querySelector("#admShopAddItem");

    let groupKeys = [];
    try {
      const parsed = JSON.parse(String(multiWrap?.dataset.initialKeys || "[]"));
      if (Array.isArray(parsed)) groupKeys = parsed.map(String).filter(Boolean).slice(0,8);
    } catch {}

    if (!groupKeys.length && singleSelect?.value) groupKeys = [singleSelect.value];

    const uniqueKeys = keys => {
      const seen = new Set();
      return (keys || []).map(String).filter(key => {
        if (!key || seen.has(key)) return false;
        seen.add(key);
        return true;
      }).slice(0,8);
    };

    const selectedKeys = () => {
      if (modeSelect?.value === "single") {
        const key = String(singleSelect?.value || "").trim();
        return key ? [key] : [];
      }
      return uniqueKeys(groupKeys);
    };

    const selectedItems = () => itemsForKeys(selectedKeys());

    const firstUnusedCatalogKey = () => {
      const used = new Set(groupKeys);
      return shopCatalog.find(item => !used.has(item.key))?.key || "";
    };

    const syncModeHelp = () => {
      const help = editor.querySelector("#admShopModeHelp");
      if (!help || !modeSelect) return;
      help.textContent = modeSelect.value === "pack"
        ? "Ajoute plusieurs items : ils seront tous achetés ensemble avec un seul prix."
        : modeSelect.value === "choice"
          ? "Ajoute plusieurs items : le joueur choisira lequel acheter dans cette case."
          : "Choisis l’item à afficher dans cette offre.";
    };

    const syncModeVisibility = () => {
      const single = modeSelect?.value === "single";
      if (singleWrap) singleWrap.hidden = !single;
      if (multiWrap) multiWrap.hidden = single;
    };

    const renderGroupRows = () => {
      groupKeys = uniqueKeys(groupKeys);

      if (groupList) {
        groupList.innerHTML = groupKeys.map((key, index) =>
          groupItemRowMarkup(key, index, groupKeys)
        ).join("");

        groupList.querySelectorAll("[data-admin-shop-group-item]").forEach((select, index) => {
          select.addEventListener("change", () => {
            const nextKey = String(select.value || "");
            const duplicateIndex = groupKeys.findIndex((key, keyIndex) => key === nextKey && keyIndex !== index);
            if (duplicateIndex >= 0) {
              notify("Cet item est déjà dans l’offre.");
              renderGroupRows();
              return;
            }
            groupKeys[index] = nextKey;
            renderGroupRows();
            syncItems({ overwriteName:false });
          });
        });

        groupList.querySelectorAll("[data-admin-shop-group-remove]").forEach((button, index) => {
          button.addEventListener("click", () => {
            groupKeys.splice(index, 1);
            renderGroupRows();
            syncItems({ overwriteName:false });
          });
        });
      }

      const count = editor.querySelector("#admShopItemCount");
      if (count) count.textContent = `${groupKeys.length}/8`;

      if (addItemButton) {
        addItemButton.disabled = groupKeys.length >= 8 || !firstUnusedCatalogKey();
      }
    };

    const syncItems = ({ overwriteName = false } = {}) => {
      const items = selectedItems();
      const preview = editor.querySelector("#admShopItemPreview");
      if (preview) preview.innerHTML = itemsVisual(items);

      const count = editor.querySelector("#admShopItemCount");
      if (count) count.textContent = `${selectedKeys().length}/8`;

      const rarity = editor.querySelector("#admShopRarity");
      if (rarity) rarity.value = highestSelectedRarity(items);

      const name = editor.querySelector("#admShopName");
      if (name && items.length && (overwriteName || !name.value.trim())) {
        name.value = modeSelect.value === "pack"
          ? `Pack ${items.length} objets`
          : modeSelect.value === "choice"
            ? `Choix ${items.length} objets`
            : items[0].label || "";
      }

      if (overwriteName && items[0]) {
        const price = editor.querySelector("#admShopPrice");
        const currency = editor.querySelector("#admShopCurrency");
        if (price && Number(items[0].configuredPrice) > 0) price.value = String(items[0].configuredPrice);
        if (currency) currency.value = items[0].configuredCurrency || "coins";
      }

      syncModeVisibility();
      syncModeHelp();
    };

    singleSelect?.addEventListener("change", () => {
      const key = String(singleSelect.value || "");
      if (key) groupKeys = [key];
      syncItems({ overwriteName:true });
    });

    addItemButton?.addEventListener("click", () => {
      if (groupKeys.length >= 8) return notify("Maximum 8 items dans une même offre.");
      const nextKey = firstUnusedCatalogKey();
      if (!nextKey) return notify("Tous les items disponibles sont déjà dans l’offre.");
      groupKeys.push(nextKey);
      renderGroupRows();
      syncItems({ overwriteName:false });
    });

    modeSelect?.addEventListener("change", () => {
      if (modeSelect.value === "single") {
        const key = String(groupKeys[0] || singleSelect?.value || shopCatalog[0]?.key || "");
        if (singleSelect && key) singleSelect.value = key;
        if (key) groupKeys = [key];
      } else {
        const key = String(singleSelect?.value || groupKeys[0] || shopCatalog[0]?.key || "");
        if (!groupKeys.length && key) groupKeys = [key];
        renderGroupRows();
      }
      syncItems({ overwriteName:true });
    });

    blockSelect?.addEventListener("change", () => {
      if (positionSelect) positionSelect.innerHTML = positionOptions(blockSelect.value, 1);
    });

    editor.querySelector("#admShopNew")?.addEventListener("click", () => {
      selectedShopOfferId = "";
      renderAdminShopEditor(body, null, presetBlock, presetPosition);
    });

    editor.querySelector("#admShopSave")?.addEventListener("click", async event => {
      const keys = selectedKeys();
      if (!keys.length) return notify("Choisis au moins un item.");
      if (modeSelect.value !== "single" && keys.length < 2) {
        return notify("Ajoute au moins 2 items pour une offre groupée.");
      }

      const button = event.currentTarget;
      button.disabled = true;
      button.textContent = "Enregistrement…";

      const response = await emit("admin:shopSave", {
        offerId:selectedShopOfferId,
        offerMode:modeSelect.value,
        itemKeys:keys,
        itemKey:keys[0],
        name:editor.querySelector("#admShopName")?.value,
        currency:editor.querySelector("#admShopCurrency")?.value,
        price:editor.querySelector("#admShopPrice")?.value,
        discountPercent:editor.querySelector("#admShopDiscount")?.value,
        block:blockSelect?.value,
        position:positionSelect?.value,
        durationMinutes:editor.querySelector("#admShopDuration")?.value,
        badge:editor.querySelector("#admShopBadge")?.value,
        active:editor.querySelector("#admShopActive")?.checked !== false
      });

      if (!response.ok) {
        button.disabled = false;
        button.textContent = selectedShopOfferId ? "Enregistrer" : "Publier l’offre";
        notify(response.error || "Enregistrement impossible.");
        return;
      }

      notify(modeSelect.value === "pack"
        ? `Pack de ${keys.length} items enregistré.`
        : modeSelect.value === "choice"
          ? `Offre avec ${keys.length} choix enregistrée.`
          : "Offre boutique enregistrée.");

      selectedShopOfferId = "";
      await renderAdminShop();
    });

    editor.querySelector("#admShopDeactivate")?.addEventListener("click", async () => {
      if (!selectedShopOfferId) return;
      if (!window.confirm("Retirer cette offre de la boutique ?")) return;
      const response = await emit("admin:shopDeactivate", { offerId:selectedShopOfferId });
      if (!response.ok) return notify(response.error || "Retrait impossible.");
      notify("Offre retirée.");
      selectedShopOfferId = "";
      await renderAdminShop();
    });

    renderGroupRows();
    syncItems();
  }

  function renderAdminShopEditor(body, offer = null, block = 1, position = 1) {
    body.querySelector("#adminShopEditor")?.remove();
    const holder = body.querySelector("#adminShopEditorHolder");
    if (!holder) return;
    holder.innerHTML = offerEditorMarkup(offer, block, position);
    bindAdminShopEditor(body, block, position);
    holder.scrollIntoView({ behavior:"smooth", block:"nearest" });
  }

  function bindAdminShopBody(body) {
    body.querySelectorAll("[data-admin-shop-slot]").forEach(slot => {
      slot.addEventListener("click", () => {
        const [block, position] = String(slot.dataset.adminShopSlot || "1:1").split(":").map(Number);
        const offer = shopOffers.find(item => item.id === slot.dataset.adminShopEdit) || null;
        selectedShopOfferId = offer?.id || "";
        renderAdminShopEditor(body, offer, block, position);
      });
    });

    body.querySelectorAll("[data-admin-shop-edit]").forEach(button => {
      if (button.hasAttribute("data-admin-shop-slot")) return;
      button.addEventListener("click", () => {
        const offer = shopOffers.find(item => item.id === button.dataset.adminShopEdit);
        if (!offer) return;
        selectedShopOfferId = offer.id;
        renderAdminShopEditor(body, offer, offer.block, offer.position);
      });
    });

    bindAdminShopEditor(body);
  }

  async function renderAdminShop() {
    const body = document.querySelector("#adminV4Body");
    if (!body) return;
    body.innerHTML = `<div class="admin-v1-empty">Chargement de la boutique…</div>`;

    const [catalogResponse, offersResponse] = await Promise.all([
      emit("admin:shopCatalog"),
      emit("admin:shopOffers")
    ]);

    if (!catalogResponse.ok || !offersResponse.ok) {
      body.innerHTML = `<div class="admin-v1-empty">${esc(catalogResponse.error || offersResponse.error || "Boutique admin indisponible.")}</div>`;
      return;
    }

    shopCatalog = Array.isArray(catalogResponse.items) ? catalogResponse.items : [];
    shopOffers = Array.isArray(offersResponse.offers) ? offersResponse.offers : [];
    selectedShopOfferId = "";

    body.innerHTML = `
      <section class="admin-v4-card admin-shop-intro">
        <small>BOUTIQUE DYNAMIQUE</small>
        <h3>Offre à l’affiche</h3>
        <p>10 emplacements fixes. Chaque case peut contenir un item, un pack acheté ensemble ou plusieurs items au choix.</p>
      </section>
      ${shopBoardMarkup()}
      <div id="adminShopEditorHolder">${offerEditorMarkup(null,1,1)}</div>
      <section class="admin-v4-card admin-shop-history">
        <small>OFFRES</small><h3>Actives et récentes</h3>${recentOffersMarkup()}
      </section>`;

    bindAdminShopBody(body);
  }

  function enhanceShopTab() {
    const nav = document.querySelector(".admin-v4-main-tabs");
    if (!nav) return;

    let button = nav.querySelector("[data-admin-extra-shop]");
    if (!button) {
      button = document.createElement("button");
      button.type = "button";
      button.dataset.adminExtraShop = "1";
      button.innerHTML = `${shopTabIcon()}<span>Boutique</span>`;
      nav.appendChild(button);
      button.addEventListener("click", () => {
        nav.querySelectorAll("[data-admin-tab]").forEach(item => item.classList.remove("active"));
        button.classList.add("active");
        renderAdminShop();
      });
    }

    if (!nav.dataset.adminShopNativeBound) {
      nav.dataset.adminShopNativeBound = "1";
      nav.addEventListener("click", event => {
        if (event.target.closest?.("[data-admin-tab]")) button?.classList.remove("active");
      });
    }
  }

  function bindShopAdminSocket() {
    try {
      if (typeof socket === "undefined" || !socket?.on || socket.__ptbAdminShopBound) return;
      socket.__ptbAdminShopBound = true;
      socket.on("shop:update", () => {
        if (document.querySelector("[data-admin-extra-shop].active")) renderAdminShop();
      });
    } catch {}
  }

  function enhance() {
    enhanceGiveItem();
    enhancePlayerInventoryReset();
    bindInventoryResetSync();
    enhanceShopTab();
    bindShopAdminSocket();
  }

  let scheduled = false;
  function scheduleEnhance() {
    if (scheduled) return;
    scheduled = true;
    requestAnimationFrame(() => {
      scheduled = false;
      enhance();
    });
  }

  const observer = new MutationObserver(scheduleEnhance);

  function start() {
    enhance();
    observer.observe(document.documentElement, {
      childList:true,
      subtree:true
    });
  }

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", start, { once:true });
  } else {
    start();
  }
})();
