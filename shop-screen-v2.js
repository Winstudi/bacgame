(() => {
  "use strict";

  let activeShopTab = "featured";
  let featuredOffers = [];
  let featuredLoaded = false;
  let featuredLoading = false;
  let shopSocketBound = false;
  let timerHandle = null;
  let expiryRefreshPending = false;
  let confirmingOfferId = "";
  const selectedChoiceItems = new Map();
  const grantedChestQueue = [];
  let grantedChestObserver = null;

  function shopEconomyState() {
    try {
      const live = window.PtitBacEconomy?.state?.();
      if (live) return live;
    } catch {}

    return {
      coins: typeof getCoins === "function"
        ? getCoins()
        : Number(localStorage.getItem("petitbac_walletBalance") || 0),
      gems: 0,
      lives: 5,
      maxLives: 5,
      unlimitedLivesUntil: 0
    };
  }

  function walletToken() {
    return String(
      window.session?.walletToken ||
      localStorage.getItem("petitbac_walletToken") ||
      ""
    ).trim();
  }

  function esc(value = "") {
    return String(value).replace(/[&<>"']/g, char => ({
      "&":"&amp;",
      "<":"&lt;",
      ">":"&gt;",
      '"':"&quot;",
      "'":"&#039;"
    }[char]));
  }

  function fmtNumber(value) {
    return new Intl.NumberFormat("fr-FR").format(Math.max(0, Math.floor(Number(value) || 0)));
  }

  function requestId() {
    return globalThis.crypto?.randomUUID?.() ||
      `shop-${Date.now().toString(36)}-${Math.random().toString(36).slice(2,12)}`;
  }

  function emitShop(name, payload = {}) {
    return new Promise(resolve => {
      try {
        socket.emit(name, { ...payload, walletToken:walletToken() }, response => resolve(response || {}));
      } catch {
        resolve({ ok:false, error:"Connexion à la boutique indisponible." });
      }
    });
  }

  function moneyButton(label, product) {
    return `<button class="shop2-buy" type="button" data-shop-product="${product}">${label}<span>›</span></button>`;
  }

  function iconCheck(text) {
    return `<li><span class="shop2-check">✓</span><span>${text}</span></li>`;
  }

  function offerAt(block, position) {
    return featuredOffers.find(offer => Number(offer.block) === block && Number(offer.position) === position) || null;
  }

  function itemAssetMarkup(item, label = "") {
    if (!item) return `<div class="shop2-dyn-fallback">✦</div>`;
    if (item.type === "tag") {
      const tagAsset = String(item.asset || "").trim();
      if (tagAsset) return `<img src="${esc(tagAsset)}" alt="">`;
      return `<div class="shop2-dyn-tag"><span>🏷️</span><b>${esc(label || item.label || "Tag")}</b></div>`;
    }
    const asset = String(item.asset || "").trim();
    if (!asset) return `<div class="shop2-dyn-fallback">✦</div>`;
    return `<img src="${esc(asset)}" alt="">`;
  }

  function offerItems(offer) {
    const items = Array.isArray(offer?.items) ? offer.items.filter(Boolean) : [];
    if (items.length) return items;
    return [{
      key:String(offer?.itemKey || ""),
      type:String(offer?.itemType || ""),
      id:String(offer?.itemId || ""),
      label:String(offer?.name || "Objet"),
      asset:String(offer?.asset || ""),
      owned:offer?.owned === true
    }];
  }

  function offerAssetMarkup(offer) {
    const items = offerItems(offer);
    if (items.length <= 1) return itemAssetMarkup(items[0], offer?.name);

    const mode = String(offer?.offerMode || "pack");
    let shown = items.slice(0,4);

    // Pour un pack de 3 : avatar + cadre en haut quand ils existent,
    // puis le troisième item centré juste en dessous.
    if (mode === "pack" && shown.length === 3) {
      const avatar = shown.find(item => item.type === "avatar");
      const frame = shown.find(item => item.type === "frame");
      if (avatar && frame) {
        const rest = shown.find(item => item !== avatar && item !== frame);
        shown = [avatar, frame, rest].filter(Boolean);
      }
    }

    return `<div class="shop2-dyn-multi-art mode-${esc(mode)} count-${Math.min(items.length,4)}">
      ${shown.map(item => `<span class="item-${esc(item.type || "item")}${item.owned ? " is-owned" : ""}">${itemAssetMarkup(item, item.label)}</span>`).join("")}
      ${items.length > shown.length ? `<b class="shop2-dyn-multi-more">+${items.length - shown.length}</b>` : ""}
    </div>`;
  }

  function durationLabel(endsAt) {
    const remaining = Math.max(0, Number(endsAt) - Date.now());
    if (!remaining) return "Terminé";
    const mins = Math.ceil(remaining / 60000);
    if (mins < 60) return `${mins} min`;
    const hours = Math.floor(mins / 60);
    if (hours < 24) return `${hours} h ${mins % 60 ? `${mins % 60} min` : ""}`.trim();
    const days = Math.floor(hours / 24);
    return `${days} j ${hours % 24 ? `${hours % 24} h` : ""}`.trim();
  }


  function specialOfferCardMarkup(offer, size = "tiny") {
    const rarity = String(offer.rarity || "commun").replace(/[^a-z0-9_-]/gi, "");
    const item = offerItems(offer)[0];
    const timer = offer.hideTimer
      ? ""
      : `<small data-offer-ends="${Number(offer.endsAt) || 0}">${esc(durationLabel(offer.endsAt))}</small>`;

    if (offer.specialKind === "ad_bag") {
      return `
        <article class="shop2-dyn-offer size-${size} rarity-${rarity} mode-special special-ad-bag" data-shop-offer-card="${esc(offer.id)}">
          <div class="shop2-dyn-topline">
            <div class="shop2-dyn-meta"><span class="shop2-dyn-badge">PUB</span></div>
            ${timer}
          </div>
          <div class="shop2-dyn-art">${itemAssetMarkup(item, offer.name)}</div>
          <h3>${esc(offer.name)}</h3>
          <div class="shop2-dyn-price-row">
            <div class="shop2-dyn-actions">
              <button class="shop2-dyn-buy shop2-special-buy" type="button" data-shop-ad-bag>
                <b>▶ PUB</b>
              </button>
            </div>
          </div>
        </article>`;
    }

    return `
      <article class="shop2-dyn-offer size-${size} rarity-${rarity} mode-special special-daily${offer.dailyClaimed ? " is-daily-claimed" : ""}" data-shop-offer-card="${esc(offer.id)}">
        <div class="shop2-dyn-topline">
          <div class="shop2-dyn-meta"><span class="shop2-dyn-badge">QUOTIDIEN</span></div>
          ${timer}
        </div>
        <div class="shop2-dyn-art">${itemAssetMarkup(item, offer.name)}</div>
        <h3>${esc(offer.name)}</h3>
        <div class="shop2-dyn-price-row">
          <div class="shop2-dyn-actions">
            <button class="shop2-dyn-buy shop2-special-buy" type="button" data-shop-daily ${offer.dailyClaimed ? "disabled" : ""}>
              <b>${offer.dailyClaimed ? "RÉCUPÉRÉ" : "GRATUIT"}</b>
            </button>
          </div>
        </div>
      </article>`;
  }

  function ensureGrantedChestObserver() {
    if (grantedChestObserver || typeof MutationObserver === "undefined") return;
    grantedChestObserver = new MutationObserver(() => {
      const openReward = document.querySelector(".ptb-reward-open.is-open");
      if (!openReward && grantedChestQueue.length) {
        setTimeout(openNextGrantedChest, 80);
      }
    });
    grantedChestObserver.observe(document.body, {
      subtree:true,
      attributes:true,
      attributeFilter:["class"]
    });
  }

  function openNextGrantedChest() {
    if (!grantedChestQueue.length) return;
    if (document.querySelector(".ptb-reward-open.is-open")) return;
    const next = grantedChestQueue.shift();
    if (!next?.reward || !next?.chestType) return openNextGrantedChest();
    if (!window.PtitBacRewards?.receiveGranted) {
      notify("Ouverture du coffre indisponible.");
      grantedChestQueue.length = 0;
      return;
    }
    window.PtitBacRewards.receiveGranted(next);
  }

  function queueGrantedChests(chests = []) {
    const valid = (Array.isArray(chests) ? chests : [chests])
      .filter(chest => chest?.chestType && chest?.reward);
    if (!valid.length) return;
    grantedChestQueue.push(...valid);
    ensureGrantedChestObserver();
    openNextGrantedChest();
  }

  async function runRewardedAd() {
    const ads = window.PtitBacAds || window.ptitBacAds || null;
    const fn = ads?.showRewarded || ads?.showRewardedAd;
    if (typeof fn !== "function") {
      notify("Les pubs récompensées seront disponibles quand le module publicitaire de l’application sera connecté.");
      return null;
    }

    try {
      const result = await fn.call(ads, { placement:"shop_bag" });
      if (result === true) return { completed:true, proof:"" };
      if (result?.completed === true || result?.rewarded === true) {
        return {
          completed:true,
          proof:String(result.proof || result.receipt || result.token || "").slice(0,500)
        };
      }
    } catch {}
    return null;
  }

  function offerCardMarkup(offer, size = "small") {
    if (!offer) {
      return `
        <article class="shop2-dyn-offer is-empty size-${size}" aria-hidden="true">
          <div class="shop2-empty-star">✦</div>
        </article>`;
    }

    if (offer.specialKind) return specialOfferCardMarkup(offer, size);

    const currencyAsset = offer.currency === "gems" ? "/gem.png" : "/coin.png";
    const rarity = String(offer.rarity || "commun").replace(/[^a-z0-9_-]/gi, "");
    const badge = String(offer.badge || "").trim();
    const promo = Math.max(0, Number(offer.discountPercent) || 0);
    const owned = offer.owned === true;

    return `
      <article class="shop2-dyn-offer size-${size} rarity-${rarity} mode-${esc(offer.offerMode || "single")}${owned ? " is-owned" : ""}" data-shop-offer-card="${esc(offer.id)}">
        <div class="shop2-dyn-topline">
          <div class="shop2-dyn-meta">
            ${badge
              ? `<span class="shop2-dyn-badge">${esc(badge)}</span>`
              : promo
                ? `<span class="shop2-dyn-badge">PROMO</span>`
                : ""}
          </div>
          <small data-offer-ends="${Number(offer.endsAt) || 0}">${esc(durationLabel(offer.endsAt))}</small>
        </div>
        ${promo ? `<span class="shop2-dyn-promo shop2-dyn-promo-price">-${promo}%</span>` : ""}
        ${offerItems(offer).length > 1 ? `<span class="shop2-dyn-mode-label">${offer.offerMode === "choice" ? "CHOIX" : "PACK"} ×${offerItems(offer).length}</span>` : ""}
        <div class="shop2-dyn-art">${offerAssetMarkup(offer)}</div>
        <h3>${esc(offer.name)}</h3>
        <div class="shop2-dyn-price-row">
          <div class="shop2-dyn-actions">
            <button class="shop2-dyn-buy" type="button" data-shop-offer="${esc(offer.id)}" ${owned ? "disabled" : ""}>
              ${owned
                ? `<span>Possédé</span>`
                : promo
                  ? `<img src="${currencyAsset}" alt=""><del class="shop2-price-old">${fmtNumber(offer.basePrice)}</del><b class="shop2-price-promo">${fmtNumber(offer.finalPrice)}</b>`
                  : `<img src="${currencyAsset}" alt=""><b>${fmtNumber(offer.finalPrice)}</b>`}
            </button>
            ${owned ? "" : `<button class="shop2-dyn-cancel" type="button" data-shop-offer-cancel="${esc(offer.id)}" aria-label="Annuler l’achat">✕</button>`}
          </div>
        </div>
      </article>`;
  }

  function featuredMarkup() {
    if (!featuredLoaded && featuredLoading) {
      return `
        <section class="shop2-view shop2-featured shop2-featured-dynamic" data-shop-view="featured">
          <div class="shop2-featured-loading"><span></span><b>Chargement des offres…</b></div>
        </section>`;
    }

    return `
      <section class="shop2-view shop2-featured shop2-featured-dynamic" data-shop-view="featured">
        <div class="shop2-offer-block shop2-block-1">
          ${offerCardMarkup(offerAt(1,1), "large")}
          ${offerCardMarkup(offerAt(1,2), "small")}
          ${offerCardMarkup(offerAt(1,3), "small")}
        </div>
        <div class="shop2-offer-block shop2-block-2">
          ${offerCardMarkup(offerAt(2,1), "small")}
          ${offerCardMarkup(offerAt(2,2), "small")}
          ${offerCardMarkup(offerAt(2,3), "large")}
        </div>
        <div class="shop2-offer-block shop2-block-3">
          ${offerCardMarkup(offerAt(3,1), "tiny")}
          ${offerCardMarkup(offerAt(3,2), "tiny")}
          ${offerCardMarkup(offerAt(3,3), "tiny")}
          ${offerCardMarkup(offerAt(3,4), "tiny")}
        </div>
      </section>`;
  }

  function gemCard(amount, price, product, ribbon = "") {
    return `
      <article class="shop2-resource-card">
        <strong>${fmtNumber(amount)}</strong>
        <small>gemmes</small>
        <div class="shop2-gem-pile">
          <img src="/gem.png" alt="">
          <img src="/gem.png" alt="">
          <img src="/gem.png" alt="">
        </div>
        ${ribbon ? `<span class="shop2-ribbon">${ribbon}</span>` : ""}
        ${moneyButton(price, product)}
      </article>`;
  }

  function coinExchangeCard(coins, gems) {
    return `
      <article class="shop2-resource-card shop2-exchange-card">
        <strong>${fmtNumber(coins)}</strong>
        <small>pièces</small>
        <div class="shop2-coin-pile">
          <img src="/coin.png" alt="">
          <img src="/coin.png" alt="">
          <img src="/coin.png" alt="">
        </div>
        <button class="shop2-buy is-gem-price" type="button" data-gem-exchange="${coins}" data-gem-cost="${gems}">
          <img src="/gem.png" alt="">${fmtNumber(gems)}
        </button>
      </article>`;
  }

  function resourcesMarkup() {
    return `
      <section class="shop2-view shop2-resources-view" data-shop-view="resources">
        <article class="shop2-resource-panel">
          <header class="shop2-panel-title">
            <img src="/gem.png" alt="">
            <div>
              <h2>Acheter des gemmes</h2>
              <p>Des gemmes pour encore plus de fun !</p>
            </div>
          </header>

          <div class="shop2-resource-grid">
            ${gemCard(50, "1,99 €", "gems-50")}
            ${gemCard(150, "4,99 €", "gems-150", "Le plus populaire")}
            ${gemCard(500, "12,99 €", "gems-500", "Meilleur choix")}
            ${gemCard(1200, "24,99 €", "gems-1200", "Super offre")}
          </div>
        </article>

        <article class="shop2-resource-panel shop2-coin-panel">
          <header class="shop2-panel-title">
            <img src="/coin.png" alt="">
            <div>
              <h2>Échanger des gemmes contre des pièces</h2>
              <p>Transforme tes gemmes en pièces et joue encore plus !</p>
            </div>
          </header>

          <div class="shop2-resource-grid">
            ${coinExchangeCard(100, 10)}
            ${coinExchangeCard(500, 50)}
            ${coinExchangeCard(1000, 100)}
            ${coinExchangeCard(5000, 400)}
          </div>
        </article>

      </section>`;
  }

  function usefulMarkup() {
    return `
      <section class="shop2-view shop2-useful" data-shop-view="useful">
        <article class="shop2-useful-card is-starter">
          <div class="shop2-useful-copy">
            <div class="shop2-title-line">
              <h2>Starter Pack</h2>
              <span class="shop2-badge is-pink">MEILLEURE OFFRE</span>
            </div>
            <p>Le départ parfait !</p>
            <ul class="shop2-big-list">
              <li><img src="/coin.png" alt=""><b>1 000 pièces</b></li>
              <li><img src="/gem.png" alt=""><b>200 gemmes</b></li>
              <li><img src="/reward-legendary-simple-closed.png" alt=""><b>3 coffres légendaires</b></li>
            </ul>
          </div>
          <div class="shop2-useful-art starter-art">
            <img src="/reward-legendary-simple-open.png" alt="Starter Pack">
          </div>
          ${moneyButton("9,99 €", "starter-pack")}
        </article>

        <article class="shop2-useful-card is-noads">
          <div class="shop2-noads-icon" aria-hidden="true">AD</div>
          <div class="shop2-useful-copy">
            <h2>Pack sans publicité</h2>
            <p>Profite du jeu en toute tranquillité !</p>
            <ul class="shop2-useful-checks">
              ${iconCheck("Aucune publicité")}
              ${iconCheck("Une expérience plus fluide")}
              ${iconCheck("100% concentré sur le jeu")}
            </ul>
          </div>
          <div class="shop2-noads-sign">SANS<br>PUB</div>
          ${moneyButton("4,99 €", "no-ads")}
        </article>

        <article class="shop2-useful-card is-unlimited">
          <div class="shop2-heart-infinity"><img src="/heart.png" alt=""><span>∞</span></div>
          <div class="shop2-useful-copy">
            <h2>Pack vie illimitée</h2>
            <p>Joue sans limite !</p>
            <ul class="shop2-useful-checks">
              ${iconCheck("Vies illimitées")}
              ${iconCheck("Plus de temps pour jouer")}
              ${iconCheck("Ne rate plus aucune partie")}
            </ul>
          </div>
          ${moneyButton("6,99 €", "unlimited-lives")}
        </article>
      </section>`;
  }

  function tabMarkup(tab, icon, label) {
    return `
      <button class="shop2-tab ${activeShopTab === tab ? "is-active" : ""}" type="button" data-shop-tab="${tab}">
        <span class="shop2-tab-icon">${icon}</span>
        <span>${label}</span>
      </button>`;
  }

  function viewMarkup() {
    if (activeShopTab === "resources") return resourcesMarkup();
    if (activeShopTab === "useful") return usefulMarkup();
    return featuredMarkup();
  }

  function notify(message) {
    if (typeof toast === "function") toast(message);
  }

  function updateFeaturedTimers() {
    let expired = false;
    document.querySelectorAll("[data-offer-ends]").forEach(node => {
      const endsAt = Number(node.dataset.offerEnds) || 0;
      node.textContent = durationLabel(endsAt);
      if (endsAt > 0 && endsAt <= Date.now()) expired = true;
    });

    if (expired && !expiryRefreshPending && activeShopTab === "featured") {
      expiryRefreshPending = true;
      featuredLoaded = false;
      refreshFeaturedOffers({ force:true }).finally(() => {
        expiryRefreshPending = false;
      });
    }
  }

  function closeChoiceModal() {
    document.querySelector(".shop2-choice-layer")?.remove();
  }

  function openChoiceModal(offer) {
    closeChoiceModal();
    const items = offerItems(offer);
    const layer = document.createElement("div");
    layer.className = "shop2-choice-layer";
    layer.innerHTML = `
      <div class="shop2-choice-panel" role="dialog" aria-modal="true" aria-label="Choisir un objet">
        <button class="shop2-choice-close" type="button" aria-label="Fermer">✕</button>
        <small>OFFRE AU CHOIX</small>
        <h2>${esc(offer.name)}</h2>
        <p>Choisis l’objet que tu veux acheter.</p>
        <div class="shop2-choice-grid">
          ${items.map(item => `
            <button type="button" data-shop-choice-item="${esc(item.key)}" ${item.owned ? "disabled" : ""}>
              <span>${itemAssetMarkup(item, item.label)}</span>
              <b>${esc(item.label)}</b>
              ${item.owned ? `<em>Possédé</em>` : ""}
            </button>`).join("")}
        </div>
      </div>`;
    document.querySelector(".shop-v2")?.appendChild(layer);
    layer.addEventListener("click", event => {
      if (event.target === layer || event.target.closest?.(".shop2-choice-close")) closeChoiceModal();
    });
    layer.querySelectorAll("[data-shop-choice-item]").forEach(button => {
      button.addEventListener("click", () => {
        if (button.disabled) return;
        selectedChoiceItems.set(offer.id, String(button.dataset.shopChoiceItem || ""));
        closeChoiceModal();
        setConfirmingOffer(offer.id);
      });
    });
  }

  function syncConfirmingOfferUI() {
    document.querySelectorAll("[data-shop-offer-card]").forEach(card => {
      const offerId = String(card.dataset.shopOfferCard || "");
      card.classList.toggle("is-confirming", !!offerId && offerId === confirmingOfferId);
    });
  }

  function setConfirmingOffer(offerId = "") {
    confirmingOfferId = String(offerId || "");
    syncConfirmingOfferUI();
  }

  function bindFeaturedButtons() {
    syncConfirmingOfferUI();

    document.querySelectorAll("[data-shop-ad-bag]").forEach(button => {
      button.addEventListener("click", async () => {
        if (button.disabled) return;
        const old = button.innerHTML;
        button.disabled = true;
        button.textContent = "…";

        const ad = await runRewardedAd();
        if (!ad?.completed) {
          button.disabled = false;
          button.innerHTML = old;
          return;
        }

        const response = await emitShop("shop:claimAdBag", {
          requestId:requestId(),
          adCompleted:true,
          adProof:ad.proof || ""
        });

        if (!response.ok) {
          button.disabled = false;
          button.innerHTML = old;
          notify(response.error || "Impossible de récupérer le coffre.");
          return;
        }

        queueGrantedChests(response.grantedChests || []);
        featuredLoaded = false;
        await refreshFeaturedOffers({ force:true });
      });
    });

    document.querySelectorAll("[data-shop-daily]").forEach(button => {
      button.addEventListener("click", async () => {
        if (button.disabled) return;
        const old = button.innerHTML;
        button.disabled = true;
        button.textContent = "…";

        const response = await emitShop("shop:claimDaily", {
          requestId:requestId()
        });

        if (!response.ok) {
          button.disabled = false;
          button.innerHTML = old;
          notify(response.error || "Récompense quotidienne indisponible.");
          return;
        }

        if (response.grantedChests?.length) {
          queueGrantedChests(response.grantedChests);
        } else if (response.reward?.kind === "item") {
          notify(`${response.reward.item?.label || "Objet rare"} ajouté à ton inventaire !`);
        } else if (response.reward?.kind === "coins") {
          notify(`+${fmtNumber(response.reward.amount)} pièces`);
        } else if (response.reward?.kind === "gems") {
          notify(`+${fmtNumber(response.reward.amount)} gemmes`);
        }

        featuredLoaded = false;
        await refreshFeaturedOffers({ force:true });
      });
    });

    document.querySelectorAll("[data-shop-offer-card]").forEach(card => {
      card.addEventListener("click", event => {
        if (event.target.closest?.("button")) return;
        const offer = featuredOffers.find(item => item.id === String(card.dataset.shopOfferCard || ""));
        if (offer?.offerMode === "choice" && !offer.owned) openChoiceModal(offer);
      });
    });

    document.querySelectorAll("[data-shop-offer]").forEach(button => {
      button.addEventListener("click", async () => {
        if (button.disabled) return;
        const offerId = String(button.dataset.shopOffer || "");
        const offer = featuredOffers.find(item => item.id === offerId);
        if (!offer) return;

        if (offer.offerMode === "choice" && !selectedChoiceItems.get(offerId)) {
          openChoiceModal(offer);
          return;
        }

        if (confirmingOfferId !== offerId) {
          setConfirmingOffer(offerId);
          return;
        }

        document.querySelectorAll("[data-shop-offer], [data-shop-offer-cancel]").forEach(node => {
          node.disabled = true;
        });

        const old = button.innerHTML;
        button.textContent = "…";

        const response = await emitShop("shop:purchase", {
          offerId,
          itemKey:offer.offerMode === "choice" ? selectedChoiceItems.get(offerId) || "" : "",
          requestId:requestId()
        });

        if (!response.ok) {
          document.querySelectorAll("[data-shop-offer], [data-shop-offer-cancel]").forEach(node => {
            node.disabled = false;
          });
          button.innerHTML = old;
          setConfirmingOffer(offerId);
          notify(response.error || "Achat impossible.");
          return;
        }

        setConfirmingOffer("");
        selectedChoiceItems.delete(offerId);
        const grantedChests = Array.isArray(response.grantedChests) ? response.grantedChests : [];
        if (grantedChests.length) queueGrantedChests(grantedChests);
        notify(grantedChests.length ? "Achat effectué — ouvre ton coffre !" : `${offer.name} ajouté à ton inventaire !`);
        featuredLoaded = false;
        await refreshFeaturedOffers({ force:true });
      });
    });

    document.querySelectorAll("[data-shop-offer-cancel]").forEach(button => {
      button.addEventListener("click", () => {
        if (button.disabled) return;
        const offerId = String(button.dataset.shopOfferCancel || "");
        if (offerId) selectedChoiceItems.delete(offerId);
        setConfirmingOffer("");
      });
    });
  }

  async function refreshFeaturedOffers({ force = false } = {}) {
    if (featuredLoading && !force) return;
    if (force) { setConfirmingOffer(""); selectedChoiceItems.clear(); closeChoiceModal(); }
    featuredLoading = true;
    if (!featuredLoaded && activeShopTab === "featured") {
      const content = document.querySelector(".shop2-content");
      if (content) content.innerHTML = featuredMarkup();
    }

    const response = await emitShop("shop:get");
    featuredLoading = false;

    if (response.ok) {
      featuredOffers = Array.isArray(response.offers) ? response.offers : [];
      featuredLoaded = true;
    } else if (!featuredLoaded) {
      featuredOffers = [];
      featuredLoaded = true;
      notify(response.error || "Offres indisponibles.");
    }

    if (activeShopTab === "featured") {
      const content = document.querySelector(".shop2-content");
      if (content) {
        content.innerHTML = featuredMarkup();
        bindFeaturedButtons();
        updateFeaturedTimers();
      }
    }
  }

  function bindShopSocket() {
    if (shopSocketBound) return;
    shopSocketBound = true;
    try {
      socket.on("shop:update", () => {
        featuredLoaded = false;
        if (activeShopTab === "featured" && document.querySelector(".shop-v2")) {
          refreshFeaturedOffers({ force:true });
        }
      });
    } catch {}
  }

  function bindShopV2() {
    bindShopSocket();

    document.getElementById("shopV2Back")?.addEventListener("click", () => {
      if (typeof renderHome === "function") renderHome();
    });

    document.querySelectorAll("[data-shop-tab]").forEach(button => {
      button.addEventListener("click", () => {
        const next = String(button.dataset.shopTab || "featured");
        if (!["featured", "resources", "useful"].includes(next) || next === activeShopTab) return;
        activeShopTab = next;
        setConfirmingOffer("");
        selectedChoiceItems.clear();
        closeChoiceModal();
        renderShopV2();
      });
    });

    document.querySelectorAll("[data-shop-product]").forEach(button => {
      button.addEventListener("click", () => {
        notify("Les achats seront activés avec les achats intégrés de l’application.");
      });
    });

    document.querySelectorAll("[data-gem-exchange]").forEach(button => {
      button.addEventListener("click", () => {
        const eco = shopEconomyState();
        const cost = Math.max(0, Number(button.dataset.gemCost) || 0);
        const coins = Math.max(0, Number(button.dataset.gemExchange) || 0);
        if ((Number(eco.gems) || 0) < cost) {
          notify(`Il te faut ${fmtNumber(cost)} gemmes pour cet échange.`);
          return;
        }
        notify(`Échange ${fmtNumber(cost)} gemmes → ${fmtNumber(coins)} pièces : connexion serveur à venir.`);
      });
    });

    bindFeaturedButtons();
    clearInterval(timerHandle);
    timerHandle = setInterval(updateFeaturedTimers, 30000);

    if (activeShopTab === "featured" && !featuredLoaded) {
      refreshFeaturedOffers();
    }
  }

  function renderShopV2(tab = null) {
    if (tab && ["featured", "resources", "useful"].includes(tab)) activeShopTab = tab;

    const eco = shopEconomyState();
    const coins = Math.max(0, Number(eco.coins) || 0);
    const gems = Math.max(0, Number(eco.gems) || 0);
    const unlimited = Number(eco.unlimitedLivesUntil) > Date.now();
    const lives = Math.max(0, Number(eco.lives) || 0);
    const maxLives = Math.max(1, Number(eco.maxLives) || 5);

    setScreen(`
      <main class="screen shop-v2 is-compact-shop-header">
        <div class="shop2-sky" aria-hidden="true">
          <span></span><span></span><span></span><span></span><span></span><span></span>
        </div>

        <section class="shop2-brand shop2-brand-featured">
          <div class="shop2-brand-notice">
            <div class="shop2-brand-notice-main">
              <button class="shop2-back shop2-notice-back" id="shopV2Back" type="button" aria-label="Retour">
                <img src="/back-arrow.png" alt="">
              </button>
              <img class="shop2-notice-logo" src="/shop.png" alt="">
              <h1>Boutique</h1>
            </div>
            <div class="shop2-wallet shop2-notice-wallet">
              <div class="shop2-wallet-pill"><img src="/coin.png" alt=""><b>${fmtNumber(coins)}</b></div>
              <div class="shop2-wallet-pill"><img src="/gem.png" alt=""><b>${fmtNumber(gems)}</b></div>
              <div class="shop2-wallet-pill"><img src="/heart.png" alt=""><b>${unlimited ? "∞" : `${lives}/${maxLives}`}</b></div>
            </div>
          </div>
        </section>

        <nav class="shop2-tabs" aria-label="Catégories de la boutique">
          ${tabMarkup("featured", "★", "Offre à l’affiche")}
          ${tabMarkup("resources", "●", "Ressource")}
          ${tabMarkup("useful", "✦", "Utile")}
        </nav>

        <div class="shop2-content">
          ${viewMarkup()}
        </div>

      </main>`);

    bindShopV2();
  }

  window.renderShop = renderShopV2;
  window.PtitBacShop = {
    open: renderShopV2,
    tab: () => activeShopTab,
    refreshFeatured:() => refreshFeaturedOffers({ force:true })
  };
  try { renderShop = renderShopV2; } catch {}
})();
