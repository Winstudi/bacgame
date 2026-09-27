"use strict";

const LEVEL_REWARDS = Object.freeze({
  1: Object.freeze({ type:"tag", itemType:"tag", itemId:"tag_debutant", label:"Tag débutant" }),
  2: Object.freeze({ type:"coins", amount:200, label:"200 pièces" }),
  3: Object.freeze({ type:"gems", amount:5, label:"5 gemmes" }),
  4: Object.freeze({ type:"bag", chestType:"bag", label:"Sac (coffre)" }),
  5: Object.freeze({ type:"lives", minutes:30, label:"Vie illimitée 30 min" }),
  6: Object.freeze({ type:"coins", amount:200, label:"200 pièces" }),
  7: Object.freeze({ type:"gems", amount:5, label:"5 gemmes" }),
  8: Object.freeze({ type:"bag", chestType:"bag", label:"Sac (coffre)" }),
  9: Object.freeze({ type:"coins", amount:200, label:"200 pièces" }),
  10: Object.freeze({ type:"chest", chestType:"star", label:"Coffre" }),
  11: Object.freeze({ type:"gems", amount:5, label:"5 gemmes" }),
  12: Object.freeze({ type:"coins", amount:200, label:"200 pièces" }),
  13: Object.freeze({ type:"bag", chestType:"bag", label:"Sac (coffre)" }),
  14: Object.freeze({ type:"coins", amount:200, label:"200 pièces" }),
  15: Object.freeze({ type:"lives", minutes:30, label:"Vie illimitée 30 min" }),
  16: Object.freeze({ type:"coins", amount:200, label:"200 pièces" }),
  17: Object.freeze({ type:"bag", chestType:"bag", label:"Sac (coffre)" }),
  18: Object.freeze({ type:"gems", amount:5, label:"5 gemmes" }),
  19: Object.freeze({ type:"coins", amount:200, label:"200 pièces" }),
  20: Object.freeze({ type:"legendary", chestType:"legendary", label:"Coffre légendaire" }),
  21: Object.freeze({ type:"coins", amount:200, label:"200 pièces" }),
  22: Object.freeze({ type:"gems", amount:5, label:"5 gemmes" }),
  23: Object.freeze({ type:"coins", amount:200, label:"200 pièces" }),
  24: Object.freeze({ type:"bag", chestType:"bag", label:"Sac (coffre)" }),
  25: Object.freeze({ type:"frame", itemType:"frame", itemId:"frame_gold_stars", label:"Cadre étoile dorée" }),
  26: Object.freeze({ type:"coins", amount:200, label:"200 pièces" }),
  27: Object.freeze({ type:"gems", amount:5, label:"5 gemmes" }),
  28: Object.freeze({ type:"bag", chestType:"bag", label:"Sac (coffre)" }),
  29: Object.freeze({ type:"coins", amount:200, label:"200 pièces" }),
  30: Object.freeze({ type:"chest", chestType:"star", label:"Coffre" }),
  31: Object.freeze({ type:"gems", amount:10, label:"10 gemmes" }),
  32: Object.freeze({ type:"coins", amount:200, label:"200 pièces" }),
  33: Object.freeze({ type:"bag", chestType:"bag", label:"Sac (coffre)" }),
  34: Object.freeze({ type:"coins", amount:200, label:"200 pièces" }),
  35: Object.freeze({ type:"lives", minutes:30, label:"Vie illimitée 30 min" }),
  36: Object.freeze({ type:"coins", amount:200, label:"200 pièces" }),
  37: Object.freeze({ type:"bag", chestType:"bag", label:"Sac (coffre)" }),
  38: Object.freeze({ type:"gems", amount:10, label:"10 gemmes" }),
  39: Object.freeze({ type:"coins", amount:200, label:"200 pièces" }),
  40: Object.freeze({ type:"legendary", chestType:"legendary", label:"Coffre légendaire" }),
  41: Object.freeze({ type:"gems", amount:15, label:"15 gemmes" }),
  42: Object.freeze({ type:"coins", amount:500, label:"500 pièces" }),
  43: Object.freeze({ type:"bag", chestType:"bag", label:"Sac (coffre)" }),
  44: Object.freeze({ type:"gems", amount:20, label:"20 gemmes" }),
  45: Object.freeze({ type:"avatar", itemType:"avatar", itemId:"/avatar-prestige.png", label:"Icon prestige" }),
  46: Object.freeze({ type:"coins", amount:500, label:"500 pièces" }),
  47: Object.freeze({ type:"gems", amount:50, label:"50 gemmes" }),
  48: Object.freeze({ type:"chest", chestType:"star", label:"Coffre" }),
  49: Object.freeze({ type:"legendary", chestType:"legendary", label:"Coffre légendaire" }),
  50: Object.freeze({ type:"frame", itemType:"frame", itemId:"frame-prestige", label:"Cadre prestige" })
});

function validWalletToken(value) {
  const token = String(value || "").trim();
  return /^[a-f0-9]{48}$/i.test(token) ? token : "";
}

function normalizeLevel(value) {
  const level = Math.floor(Number(value) || 0);
  return level >= 1 && level <= 50 ? level : 0;
}

function rewardForLevel(level) {
  return LEVEL_REWARDS[normalizeLevel(level)] || null;
}

function createLevelRewardsService({
  getPool,
  ensureSchema,
  progressionService,
  inventoryService,
  walletAtomicService,
  chestService,
  syncCoins = null,
  syncGems = null
} = {}) {
  if (typeof getPool !== "function") throw new TypeError("getPool requis");
  if (typeof ensureSchema !== "function") throw new TypeError("ensureSchema requis");
  if (!progressionService?.getState) throw new TypeError("progressionService requis");
  if (!inventoryService?.getState) throw new TypeError("inventoryService requis");
  if (!walletAtomicService?.changeCoinsWithClient || !walletAtomicService?.changeGemsWithClient) {
    throw new TypeError("walletAtomicService requis");
  }
  if (!chestService?.grant) throw new TypeError("chestService requis");

  let schemaPromise = null;

  async function ensureLevelSchema() {
    if (schemaPromise) return schemaPromise;
    schemaPromise = (async () => {
      await ensureSchema();
      const pool = getPool();
      if (!pool) throw new Error("PostgreSQL indisponible");




      return pool;
    })().catch(error => {
      schemaPromise = null;
      throw error;
    });
    return schemaPromise;
  }

  async function status(walletToken) {
    const token = validWalletToken(walletToken);
    if (!token) throw new Error("Session joueur invalide.");
    const pool = await ensureLevelSchema();
    const progression = await progressionService.getState(token);

    const [claims, lives] = await Promise.all([
      pool.query(
        `SELECT level, reward_type, reward_result, claimed_at
           FROM public.ptitbac_level_reward_claims
          WHERE wallet_token=$1
          ORDER BY level ASC`,
        [token]
      ),
      pool.query(
        `SELECT expires_at
           FROM public.ptitbac_level_unlimited_lives
          WHERE wallet_token=$1 AND expires_at > now()
          LIMIT 1`,
        [token]
      )
    ]);

    const claimedLevels = (claims.rows || [])
      .map(row => Number(row.level))
      .filter(level => level >= 1 && level <= 50);

    const expiresAt = lives.rows?.[0]?.expires_at
      ? new Date(lives.rows[0].expires_at).getTime()
      : 0;

    return {
      level:Math.max(1, Math.min(50, Number(progression?.level) || 1)),
      claimedLevels,
      unlimitedLivesUntil:Number.isFinite(expiresAt) ? expiresAt : 0
    };
  }

  async function activeUnlimitedLives() {
    const pool = await ensureLevelSchema();
    const q = await pool.query(
      `SELECT wallet_token, expires_at
         FROM public.ptitbac_level_unlimited_lives
        WHERE expires_at > now()`
    );
    return (q.rows || []).map(row => ({
      walletToken:String(row.wallet_token || ""),
      expiresAt:new Date(row.expires_at).getTime()
    })).filter(item => validWalletToken(item.walletToken) && Number.isFinite(item.expiresAt));
  }

  async function refreshUnlimitedLives() {
    const pool = await ensureLevelSchema();
    await pool.query(
      `UPDATE public.users u
          SET lives=5,
              life_updated_at=now(),
              updated_at=now()
         FROM public.ptitbac_level_unlimited_lives l
        WHERE u.wallet_token=l.wallet_token
          AND l.expires_at > now()
          AND u.lives <> 5`
    );
    return activeUnlimitedLives();
  }

  async function claim(walletToken, levelValue) {
    const token = validWalletToken(walletToken);
    const level = normalizeLevel(levelValue);
    const reward = rewardForLevel(level);
    if (!token || !level || !reward) throw new Error("Récompense de niveau invalide.");

    const pool = await ensureLevelSchema();
    const progression = await progressionService.getState(token);
    const currentLevel = Math.max(1, Math.min(50, Number(progression?.level) || 1));
    if (level > currentLevel) throw new Error("Ce niveau n’est pas encore atteint.");

    // Les objets de base doivent exister avant toute récompense d'inventaire.
    if (["avatar", "frame", "tag"].includes(reward.itemType)) {
      await inventoryService.getState(token);
    }

    const client = await pool.connect();
    let finished = false;
    let result = null;
    let walletResult = null;
    let inventoryState = null;

    try {
      await client.query("BEGIN");
      await client.query(
        `SELECT pg_advisory_xact_lock(hashtext($1))`,
        [`${token}:level-reward:${level}`]
      );

      const existing = await client.query(
        `SELECT reward_type,reward_result,claimed_at
           FROM public.ptitbac_level_reward_claims
          WHERE wallet_token=$1 AND level=$2
          LIMIT 1`,
        [token, level]
      );

      if (existing.rowCount) {
        await client.query("COMMIT");
        finished = true;
        const stored = existing.rows[0].reward_result || {};
        return {
          duplicate:true,
          level,
          rewardType:String(existing.rows[0].reward_type || reward.type),
          result:stored,
          unlimitedLivesUntil:Number(stored.unlimitedLivesUntil) || 0
        };
      }

      if (reward.type === "coins") {
        walletResult = await walletAtomicService.changeCoinsWithClient(client, {
          walletToken:token,
          delta:reward.amount,
          kind:"LEVEL_REWARD",
          details:{ note:`Récompense niveau ${level}` },
          idempotencyKey:`level-reward:${level}:coins`
        });
        if (!walletResult?.ok) throw new Error(walletResult?.error || "Crédit de pièces impossible.");
        result = { kind:"coins", amount:reward.amount, balance:Number(walletResult.balance) };
      } else if (reward.type === "gems") {
        walletResult = await walletAtomicService.changeGemsWithClient(client, {
          walletToken:token,
          delta:reward.amount,
          kind:"LEVEL_REWARD",
          details:{ note:`Récompense niveau ${level}` },
          idempotencyKey:`level-reward:${level}:gems`
        });
        if (!walletResult?.ok) throw new Error(walletResult?.error || "Crédit de gemmes impossible.");
        result = { kind:"gems", amount:reward.amount, gems:Number(walletResult.gems) };
      } else if (["avatar", "frame", "tag"].includes(reward.itemType)) {
        const catalogItem = inventoryService.catalog?.[reward.itemType]?.[reward.itemId];
        if (!catalogItem) throw new Error("Objet de niveau introuvable.");
        await client.query(
          `INSERT INTO public.ptitbac_inventory_items(wallet_token,item_type,item_id,source)
           VALUES($1,$2,$3,'level_reward')
           ON CONFLICT(wallet_token,item_type,item_id) DO NOTHING`,
          [token, reward.itemType, reward.itemId]
        );
        result = {
          kind:"item",
          item:{
            type:reward.itemType,
            id:reward.itemId,
            label:String(catalogItem.name || reward.label),
            asset:String(catalogItem.asset || (reward.itemType === "avatar" ? reward.itemId : ""))
          }
        };
      } else if (reward.type === "lives") {
        const lives = await client.query(
          `INSERT INTO public.ptitbac_level_unlimited_lives(wallet_token,expires_at,updated_at)
           VALUES($1, now() + ($2::integer * interval '1 minute'), now())
           ON CONFLICT(wallet_token) DO UPDATE
             SET expires_at=GREATEST(public.ptitbac_level_unlimited_lives.expires_at, now())
                          + ($2::integer * interval '1 minute'),
                 updated_at=now()
           RETURNING expires_at`,
          [token, reward.minutes]
        );
        await client.query(
          `UPDATE public.users
              SET lives=5,life_updated_at=now(),updated_at=now()
            WHERE wallet_token=$1`,
          [token]
        );
        const expiresAt = new Date(lives.rows[0].expires_at).getTime();
        result = {
          kind:"lives",
          minutes:reward.minutes,
          unlimitedLivesUntil:expiresAt
        };
      } else if (reward.chestType) {
        // Le service coffre est lui-même idempotent grâce à claimKey.
        // En cas de coupure après son commit mais avant le claim niveau,
        // le prochain essai retrouve exactement le même résultat de coffre.
        const granted = await chestService.grant({
          walletToken:token,
          chestType:reward.chestType,
          starState:"blue",
          claimKey:`level_reward:${level}`
        });
        if (!granted?.ok || !granted.reward) throw new Error("Ouverture du coffre impossible.");
        result = {
          kind:"chest",
          chestType:reward.chestType,
          reward:granted.reward,
          balance:Number.isFinite(Number(granted.balance)) ? Number(granted.balance) : null,
          gems:Number.isFinite(Number(granted.gems)) ? Number(granted.gems) : null,
          inventory:granted.inventory || null
        };
      } else {
        throw new Error("Type de récompense non pris en charge.");
      }

      await client.query(
        `INSERT INTO public.ptitbac_level_reward_claims(
          wallet_token,level,reward_type,reward_result
        ) VALUES($1,$2,$3,$4::jsonb)`,
        [token, level, reward.type, JSON.stringify(result || {})]
      );

      await client.query("COMMIT");
      finished = true;
    } catch (error) {
      if (!finished) {
        try { await client.query("ROLLBACK"); } catch {}
      }
      throw error;
    } finally {
      client.release?.();
    }

    if (walletResult?.ok) {
      if (Number.isFinite(Number(walletResult.balance))) {
        syncCoins?.(token, Number(walletResult.balance));
      }
      if (Number.isFinite(Number(walletResult.gems))) {
        syncGems?.(token, Number(walletResult.gems));
      }
    }

    if (result?.kind === "chest") {
      if (Number.isFinite(Number(result.balance))) syncCoins?.(token, Number(result.balance));
      if (Number.isFinite(Number(result.gems))) syncGems?.(token, Number(result.gems));
      inventoryState = result.inventory || null;
    }

    if (["avatar", "frame", "tag"].includes(reward.itemType)) {
      inventoryState = await inventoryService.getState(token).catch(() => null);
    }

    return {
      duplicate:false,
      level,
      rewardType:reward.type,
      result,
      balance:Number.isFinite(Number(result?.balance)) ? Number(result.balance) :
        Number.isFinite(Number(walletResult?.balance)) ? Number(walletResult.balance) : null,
      gems:Number.isFinite(Number(result?.gems)) ? Number(result.gems) :
        Number.isFinite(Number(walletResult?.gems)) ? Number(walletResult.gems) : null,
      inventory:inventoryState,
      unlimitedLivesUntil:Number(result?.unlimitedLivesUntil) || 0
    };
  }

  return {
    ensureSchema:ensureLevelSchema,
    status,
    claim,
    activeUnlimitedLives,
    refreshUnlimitedLives,
    rewards:LEVEL_REWARDS
  };
}

module.exports = {
  LEVEL_REWARDS,
  validWalletToken,
  normalizeLevel,
  rewardForLevel,
  createLevelRewardsService
};
