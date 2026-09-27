"use strict";

const { getPool, ensureDatabaseSchema } = require("./db.js");
const { createInventoryService } = require("./inventory-service.js");
const { createWalletAtomicService } = require("./wallet-atomic-service.js");
const { createRewardChestService } = require("./reward-chests-service.js");
const { createProgressionService } = require("./progression-service.js");
const { createLevelRewardsService } = require("./level-rewards-service.js");
const installShop = require("./shop-hook.js");
const installQuests = require("./quests-hook.js");

module.exports = function installRewardChests(io) {
  const inventoryService = createInventoryService({
    getPool,
    ensureSchema:ensureDatabaseSchema
  });
  const walletAtomicService = createWalletAtomicService({
    getPool,
    ensureSchema:ensureDatabaseSchema
  });
  const progressionService = createProgressionService({
    getPool,
    ensureSchema:ensureDatabaseSchema
  });

  const service = createRewardChestService({
    getPool,
    ensureSchema:ensureDatabaseSchema,
    inventoryService,
    walletAtomicService,
    syncCoins:(token, value) => global.__ptbAdminSyncCoins?.(token, value),
    syncGems:(token, value) => global.__ptbAdminSyncGems?.(token, value)
  });

  const levelRewards = createLevelRewardsService({
    getPool,
    ensureSchema:ensureDatabaseSchema,
    progressionService,
    inventoryService,
    walletAtomicService,
    chestService:service,
    syncCoins:(token, value) => global.__ptbAdminSyncCoins?.(token, value),
    syncGems:(token, value) => global.__ptbAdminSyncGems?.(token, value)
  });

  const shopService = installShop(io);

  global.__ptbRewardChestService = service;
  global.__ptbLevelRewardService = levelRewards;
  global.__ptbShopService = shopService;

  // Le serveur charge déjà reward-chests-hook.js au démarrage.
  // On y branche les quêtes afin que quests:get / quests:sync / quests:claim
  // soient réellement enregistrés sans modifier le gros server.js.
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

  function emitRewardSideEffects(socket, token, result = {}) {
    if (Number.isFinite(Number(result.balance))) {
      socket.emit("wallet:update", { balance:Number(result.balance) });
    }

    const economy = {};
    if (Number.isFinite(Number(result.balance))) economy.coins = Number(result.balance);
    if (Number.isFinite(Number(result.gems))) economy.gems = Number(result.gems);
    if (Number.isFinite(Number(result.unlimitedLivesUntil))) {
      economy.lives = 5;
      economy.maxLives = 5;
      economy.unlimitedLivesUntil = Number(result.unlimitedLivesUntil);
    }
    if (Object.keys(economy).length) socket.emit("economy:update", economy);

    if (result.inventory) socket.emit("inventory:update", result.inventory);
  }

  let lifeTimerBusy = false;
  const lifeTimer = setInterval(async () => {
    if (lifeTimerBusy) return;
    lifeTimerBusy = true;
    try {
      const active = await levelRewards.refreshUnlimitedLives();
      const byToken = new Map(active.map(item => [item.walletToken, item]));
      if (!byToken.size) return;

      for (const client of io.sockets.sockets.values()) {
        const token = String(client.data?.walletToken || "");
        const item = byToken.get(token);
        if (!item) continue;
        client.emit("economy:update", {
          lives:5,
          maxLives:5,
          unlimitedLivesUntil:item.expiresAt
        });
      }
    } catch {
      // La base peut ne pas être prête pendant les premières secondes du démarrage.
    } finally {
      lifeTimerBusy = false;
    }
  }, 1000);
  lifeTimer.unref?.();

  io.on("connection", socket => {
    socket.on("rewards:config", async (_payload = {}, cb = () => {}) => {
      try {
        const catalog = await service.catalog();
        cb({ ok:true, config:service.config(), catalog });
      } catch (err) {
        console.error("rewards:config:", err.message);
        cb({ ok:false, error:"Configuration des récompenses indisponible." });
      }
    });

    socket.on("level-rewards:get", async (payload = {}, cb = () => {}) => {
      const token = await socketWalletToken(socket, payload);
      if (!token) return cb({ ok:false, error:"Session de récompenses non autorisée." });

      try {
        const status = await levelRewards.status(token);
        cb({ ok:true, ...status });
      } catch (err) {
        console.error("level-rewards:get:", err.message);
        cb({ ok:false, error:"Récompenses de niveaux indisponibles." });
      }
    });

    socket.on("level-rewards:claim", async (payload = {}, cb = () => {}) => {
      const token = await socketWalletToken(socket, payload);
      if (!token) return cb({ ok:false, error:"Session de récompenses non autorisée." });

      try {
        const result = await levelRewards.claim(token, payload.level);
        emitRewardSideEffects(socket, token, result);
        const status = await levelRewards.status(token);
        socket.emit("level-rewards:update", status);
        cb({ ok:true, ...result, status });
      } catch (err) {
        console.error("level-rewards:claim:", err.message);
        cb({ ok:false, error:err?.message || "Impossible de récupérer cette récompense." });
      }
    });
  });

  return service;
};
