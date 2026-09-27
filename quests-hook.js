"use strict";

const crypto = require("crypto");
const { getPool, ensureDatabaseSchema } = require("./db.js");
const { createQuestsService } = require("./quests-service.js");

module.exports = function installQuests(io) {
  if (io.__ptitBacQuestsInstalled) return io.__ptitBacQuestsService || null;
  io.__ptitBacQuestsInstalled = true;

  const service = createQuestsService({
    getPool,
    ensureSchema:ensureDatabaseSchema
  });
  io.__ptitBacQuestsService = service;

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
      const balance = Number(result.balance);
      socket.emit("wallet:update", { balance });
      global.__ptbAdminSyncCoins?.(token, balance);
    }

    const economy = {};
    if (Number.isFinite(Number(result.balance))) economy.coins = Number(result.balance);
    if (Number.isFinite(Number(result.gems))) {
      economy.gems = Number(result.gems);
      global.__ptbAdminSyncGems?.(token, Number(result.gems));
    }
    if (Object.keys(economy).length) socket.emit("economy:update", economy);
    if (result.inventory) socket.emit("inventory:update", result.inventory);
  }

  function emitProgressionUpdate(socket, result = {}, eventKey = "quest:sync") {
    const gainedXp = Math.max(0, Number(result.gainedXp) || 0);
    if (!result.progression || gainedXp <= 0) return;

    socket.emit("progression:update", {
      state:result.progression,
      result:{
        eventKey,
        gainedXp,
        gainedTrophies:0,
        rank:0,
        validAnswers:0,
        rounds:0,
        before:null,
        after:result.progression,
        levelUp:false,
        source:"quest"
      }
    });
  }

  io.on("connection", socket => {
    socket.on("quests:get", async (payload = {}, cb = () => {}) => {
      const token = await socketWalletToken(socket, payload);
      if (!token) return cb({ ok:false, error:"Session quêtes non autorisée." });

      try {
        let synced = null;
        try {
          synced = await service.claimCompletedQuests(token);
        } catch (syncErr) {
          console.error("quests:get auto XP:", syncErr.message);
        }

        const status = synced?.status || await service.status(token);
        if (synced?.gainedXp > 0) {
          emitProgressionUpdate(socket, synced, `quest:auto:${status.rotationKey}`);
        }

        cb({
          ok:true,
          status,
          gainedXp:Math.max(0, Number(synced?.gainedXp) || 0),
          autoClaimed:synced?.claimedQuestIds || []
        });
      } catch (err) {
        console.error("quests:get:", err.message);
        cb({ ok:false, error:"Quêtes indisponibles pour le moment." });
      }
    });

    socket.on("quests:claim", async (payload = {}, cb = () => {}) => {
      const token = await socketWalletToken(socket, payload);
      if (!token) return cb({ ok:false, error:"Session quêtes non autorisée." });

      try {
        const result = await service.claimQuest(token, payload.questId);

        emitProgressionUpdate(socket, result, `quest:${result.questId}`);
        socket.emit("quests:update", result.status);
        cb({ ok:true, ...result });
      } catch (err) {
        console.error("quests:claim:", err.message);
        cb({ ok:false, error:err?.message || "Impossible de récupérer cette quête." });
      }
    });

    socket.on("quests:sync", async (payload = {}, cb = () => {}) => {
      const token = await socketWalletToken(socket, payload);
      if (!token) return cb({ ok:false, error:"Session quêtes non autorisée." });

      try {
        const result = await service.claimCompletedQuests(token);
        emitProgressionUpdate(
          socket,
          result,
          `quest:sync:${result.status?.rotationKey || "daily"}`
        );
        socket.emit("quests:update", result.status);
        cb({ ok:true, ...result });
      } catch (err) {
        console.error("quests:sync:", err.message);
        cb({ ok:false, error:err?.message || "Impossible de synchroniser les quêtes." });
      }
    });

    socket.on("quests:claimChest", async (payload = {}, cb = () => {}) => {
      const token = await socketWalletToken(socket, payload);
      if (!token) return cb({ ok:false, error:"Session quêtes non autorisée." });

      try {
        const chest = await service.chestEligibility(token);
        if (!chest.claimable) {
          return cb({ ok:false, error:"Valide 4 quêtes pour débloquer ce coffre." });
        }

        const chestService = global.__ptbRewardChestService;
        if (!chestService?.grant) {
          return cb({ ok:false, error:"Service de coffre indisponible." });
        }

        const tokenHash = crypto
          .createHash("sha256")
          .update(token)
          .digest("hex")
          .slice(0,16);

        const granted = await chestService.grant({
          walletToken:token,
          chestType:"star",
          starState:"blue",
          claimKey:`quest_chest:${tokenHash}:${chest.nextCycle}`
        });

        emitRewardSideEffects(socket, token, granted);

        const status = await service.confirmChestClaim(
          token,
          chest.nextCycle,
          granted.reward || {}
        );

        socket.emit("quests:update", status);
        cb({
          ok:true,
          cycle:chest.nextCycle,
          status,
          grantedChest:{
            chestType:"star",
            reward:granted.reward
          }
        });
      } catch (err) {
        console.error("quests:claimChest:", err.message);
        cb({ ok:false, error:err?.message || "Impossible d’ouvrir le coffre de quêtes." });
      }
    });
  });

  return service;
};
