"use strict";

const { getPool, ensureDatabaseSchema } = require("./db.js");
const { createInventoryService } = require("./inventory-service.js");
const { createWalletAtomicService } = require("./wallet-atomic-service.js");
const { createShopService } = require("./shop-service.js");
const installQuests = require("./quests-hook.js");

module.exports = function installShop(io) {
  const inventoryService = createInventoryService({
    getPool,
    ensureSchema:ensureDatabaseSchema
  });
  const walletAtomicService = createWalletAtomicService({
    getPool,
    ensureSchema:ensureDatabaseSchema
  });
  const service = createShopService({
    pool:getPool,
    ensureSchema:ensureDatabaseSchema,
    inventoryService,
    walletAtomicService
  });

  installQuests(io);

  async function socketWalletToken(socket, payload = {}) {
    const token = String(payload.walletToken || "").trim();
    const attached = String(socket.data?.walletToken || "").trim();
    if (!/^[a-f0-9]{48}$/i.test(token)) return "";
    if (attached && attached !== token) return "";
    try {
      const pool = getPool();
      if (!pool) return "";
      const q = await pool.query(
        `SELECT 1 FROM public.ptitbac_wallets WHERE token=$1 LIMIT 1`,
        [token]
      );
      return q.rowCount ? token : "";
    } catch {
      return "";
    }
  }

  async function isAdmin(token) {
    if (!token) return false;
    try {
      const pool = getPool();
      if (!pool) return false;
      const q = await pool.query(
        `SELECT wallet_token
           FROM public.ptitbac_admin_owner
          WHERE singleton=true
          LIMIT 1`
      );
      return String(q.rows?.[0]?.wallet_token || "") === token;
    } catch {
      return false;
    }
  }

  function emitPurchaseSideEffects(socket, result = {}) {
    if (Number.isFinite(Number(result.balance))) {
      const balance = Number(result.balance);
      socket.emit("wallet:update", { balance });
      global.__ptbAdminSyncCoins?.(String(socket.data?.walletToken || ""), balance);
    }

    const economy = {};
    if (Number.isFinite(Number(result.balance))) economy.coins = Number(result.balance);
    if (Number.isFinite(Number(result.gems))) {
      economy.gems = Number(result.gems);
      global.__ptbAdminSyncGems?.(String(socket.data?.walletToken || ""), Number(result.gems));
    }
    if (Object.keys(economy).length) socket.emit("economy:update", economy);
    if (result.inventory) socket.emit("inventory:update", result.inventory);
  }

  function rewardChestService() {
    return global.__ptbRewardChestService || null;
  }

  async function grantChestRewards(socket, token, chestTypes = [], claimPrefix = "shop") {
    const service = rewardChestService();
    if (!service?.grant) throw new Error("Service de coffres indisponible.");
    const granted = [];

    for (let index = 0; index < chestTypes.length; index += 1) {
      const chestType = String(chestTypes[index] || "");
      if (!["bag","star","legendary"].includes(chestType)) continue;
      const result = await service.grant({
        walletToken:token,
        chestType,
        claimKey:`${claimPrefix}:${index}`
      });
      emitPurchaseSideEffects(socket, result);
      granted.push({ chestType, reward:result.reward });
    }

    return granted;
  }

  io.on("connection", socket => {
    socket.on("shop:get", async (payload = {}, cb = () => {}) => {
      const token = await socketWalletToken(socket, payload);
      if (!token) return cb({ ok:false, error:"Session boutique non autorisée." });
      try {
        const offers = await service.activeOffers(token);
        cb({ ok:true, offers, serverNow:Date.now(), slots:service.slots });
      } catch (err) {
        console.error("shop:get:", err.message);
        cb({ ok:false, error:"Boutique indisponible pour le moment." });
      }
    });

    socket.on("shop:purchase", async (payload = {}, cb = () => {}) => {
      const token = await socketWalletToken(socket, payload);
      if (!token) return cb({ ok:false, error:"Session boutique non autorisée." });
      try {
        const result = await service.purchase(token, payload.offerId, payload.requestId, payload.itemKey);
        emitPurchaseSideEffects(socket, result);

        const chestTypes = Array.isArray(result.rewardChests) ? result.rewardChests : [];
        const claimBase = String(result.purchaseId || payload.requestId || "purchase").replace(/[^a-zA-Z0-9:_-]/g, "").slice(0,80);
        const grantedChests = chestTypes.length
          ? await grantChestRewards(socket, token, chestTypes, `shop:${claimBase}`)
          : [];

        cb({ ok:true, ...result, grantedChests });
      } catch (err) {
        console.error("shop:purchase:", err.message);
        cb({
          ok:false,
          code:String(err?.code || ""),
          error:err?.message || "Achat impossible."
        });
      }
    });


    socket.on("shop:claimAdBag", async (payload = {}, cb = () => {}) => {
      const token = await socketWalletToken(socket, payload);
      if (!token) return cb({ ok:false, error:"Session boutique non autorisée." });
      return cb({
        ok:false,
        error:"Les récompenses publicitaires seront disponibles avec le module publicitaire vérifié."
      });
    });


    socket.on("shop:claimDaily", async (payload = {}, cb = () => {}) => {
      const token = await socketWalletToken(socket, payload);
      if (!token) return cb({ ok:false, error:"Session boutique non autorisée." });

      try {
        const result = await service.claimDaily(token);
        emitPurchaseSideEffects(socket, result);

        let grantedChests = [];
        if (result.chestType) {
          grantedChests = await grantChestRewards(
            socket,
            token,
            [result.chestType],
            `daily:${String(result.rotationKey || "daily")}`
          );
        }

        socket.emit("shop:update", { at:Date.now(), daily:true });
        cb({ ok:true, ...result, grantedChests });
      } catch (err) {
        console.error("shop:claimDaily:", err.message);
        cb({ ok:false, error:err?.message || "Récompense quotidienne indisponible." });
      }
    });

    socket.on("admin:shopCatalog", async (payload = {}, cb = () => {}) => {
      const token = await socketWalletToken(socket, payload);
      if (!token || !await isAdmin(token)) return cb({ ok:false, error:"Accès admin refusé." });
      try {
        const items = (await service.catalog()).filter(item => !item.defaultOwned);
        cb({
          ok:true,
          items,
          slots:service.slots,
          discounts:service.discounts,
          offerModes:service.offerModes,
          maxOfferItems:service.maxOfferItems
        });
      } catch (err) {
        console.error("admin:shopCatalog:", err.message);
        cb({ ok:false, error:"Catalogue boutique indisponible." });
      }
    });

    socket.on("admin:shopOffers", async (payload = {}, cb = () => {}) => {
      const token = await socketWalletToken(socket, payload);
      if (!token || !await isAdmin(token)) return cb({ ok:false, error:"Accès admin refusé." });
      try {
        cb({ ok:true, offers:await service.adminOffers(), serverNow:Date.now() });
      } catch (err) {
        console.error("admin:shopOffers:", err.message);
        cb({ ok:false, error:"Offres boutique indisponibles." });
      }
    });

    socket.on("admin:shopSave", async (payload = {}, cb = () => {}) => {
      const token = await socketWalletToken(socket, payload);
      if (!token || !await isAdmin(token)) return cb({ ok:false, error:"Accès admin refusé." });
      try {
        const offer = await service.saveOffer(token, payload);
        io.emit("shop:update", { at:Date.now() });
        cb({ ok:true, offer });
      } catch (err) {
        console.error("admin:shopSave:", err.message);
        cb({ ok:false, error:err?.message || "Impossible d’enregistrer l’offre." });
      }
    });

    socket.on("admin:shopDeactivate", async (payload = {}, cb = () => {}) => {
      const token = await socketWalletToken(socket, payload);
      if (!token || !await isAdmin(token)) return cb({ ok:false, error:"Accès admin refusé." });
      try {
        const result = await service.deactivateOffer(token, payload.offerId);
        io.emit("shop:update", { at:Date.now() });
        cb({ ok:true, ...result });
      } catch (err) {
        console.error("admin:shopDeactivate:", err.message);
        cb({ ok:false, error:err?.message || "Impossible de retirer l’offre." });
      }
    });
  });

  service.ensureSchema().catch(err => {
    console.warn("Boutique: schéma indisponible au démarrage:", err.message);
  });

  return service;
};
