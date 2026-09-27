"use strict";

const crypto = require("crypto");
const { catalogEntries, validWalletToken } = require("./inventory-service.js");

const CHEST_TYPES = Object.freeze(["bag", "star", "legendary"]);
const STAR_STATES = Object.freeze(["blue"]);
const ITEM_RARITIES = Object.freeze(["commun", "rare", "epique", "ultra"]);
const ALL_ITEM_RARITIES = Object.freeze([...ITEM_RARITIES, "exclusif"]);

const DUPLICATE_COMPENSATION = Object.freeze({
  commun:50,
  rare:100,
  epique:250,
  ultra:500
});

const STAR_UPGRADE = Object.freeze({
  blue:Object.freeze({ upgradeChance:0, next:"" })
});

const DROP_TABLES = Object.freeze({
  // Sac — total 100 %
  bag:Object.freeze([
    Object.freeze({ kind:"item", rarity:"commun", weight:5 }),
    Object.freeze({ kind:"gems", amount:10, weight:10 }),
    Object.freeze({ kind:"coins", amount:200, weight:15 }),
    Object.freeze({ kind:"gems", amount:5, weight:15 }),
    Object.freeze({ kind:"coins", amount:100, weight:20 }),
    Object.freeze({ kind:"coins", amount:50, weight:35 })
  ]),

  // Coffre normal — total 100 %
  star:Object.freeze([
    Object.freeze({ kind:"coins", amount:200, weight:10 }),
    Object.freeze({ kind:"coins", amount:500, weight:5 }),
    Object.freeze({ kind:"gems", amount:25, weight:5 }),
    Object.freeze({ kind:"gems", amount:10, weight:10 }),
    Object.freeze({ kind:"coins", amount:100, weight:15 }),
    Object.freeze({ kind:"gems", amount:5, weight:15 }),
    Object.freeze({ kind:"item", rarity:"commun", weight:18 }),
    Object.freeze({ kind:"item", rarity:"rare", weight:10 }),
    Object.freeze({ kind:"item", rarity:"epique", weight:5 }),
    Object.freeze({ kind:"coins", amount:1000, weight:3 }),
    Object.freeze({ kind:"gems", amount:50, weight:3 }),
    Object.freeze({ kind:"item", rarity:"ultra", weight:1 })
  ]),

  // Coffre légendaire — total 100 %
  legendary:Object.freeze([
    Object.freeze({ kind:"coins", amount:500, weight:20 }),
    Object.freeze({ kind:"coins", amount:1000, weight:15 }),
    Object.freeze({ kind:"gems", amount:50, weight:10 }),
    Object.freeze({ kind:"gems", amount:25, weight:15 }),
    Object.freeze({ kind:"item", rarity:"rare", weight:25 }),
    Object.freeze({ kind:"item", rarity:"epique", weight:10 }),
    Object.freeze({ kind:"item", rarity:"ultra", weight:5 })
  ])
});

function clampRandom(value) {
  const n = Number(value);
  if (!Number.isFinite(n)) return 0;
  return Math.max(0, Math.min(0.999999999999, n));
}

function randomIntInclusive(min, max, random = Math.random) {
  const lo = Math.floor(Math.min(Number(min) || 0, Number(max) || 0));
  const hi = Math.floor(Math.max(Number(min) || 0, Number(max) || 0));
  return lo + Math.floor(clampRandom(random()) * (hi - lo + 1));
}

function weightedPick(entries, random = Math.random) {
  const rows = Array.isArray(entries) ? entries.filter(Boolean) : [];
  const total = rows.reduce((sum, row) => sum + Math.max(0, Number(row.weight) || 0), 0);
  if (!rows.length || total <= 0) throw new Error("Table de récompenses invalide.");

  let cursor = clampRandom(random()) * total;
  for (const row of rows) {
    const weight = Math.max(0, Number(row.weight) || 0);
    if (cursor < weight) return row;
    cursor -= weight;
  }
  return rows[rows.length - 1];
}

function normalizeChestType(value) {
  const type = String(value || "").trim().toLowerCase();
  return CHEST_TYPES.includes(type) ? type : "";
}

function normalizeStarState(_value) {
  return "blue";
}

function rollStarTap(state = "blue", _random = Math.random) {
  const current = normalizeStarState(state);
  return {
    opened:true,
    upgraded:false,
    state:current,
    previous:current
  };
}

function tableFor(chestType, starState = "blue") {
  const type = normalizeChestType(chestType);
  if (type === "bag") return DROP_TABLES.bag;
  if (type === "legendary") return DROP_TABLES.legendary;
  if (type === "star") return DROP_TABLES.star;
  throw new Error("Type de coffre invalide.");
}

function rollRewardSpec(chestType, starState = "blue", random = Math.random) {
  const chosen = weightedPick(tableFor(chestType, starState), random);
  if (chosen.kind === "item") {
    return { kind:"item", rarity:String(chosen.rarity || "commun") };
  }

  const fixedAmount = Number(chosen.amount);
  if (Number.isFinite(fixedAmount)) {
    return {
      kind:chosen.kind,
      amount:Math.max(0, Math.floor(fixedAmount))
    };
  }

  // Compatibilité avec d'anciennes tables utilisant min/max.
  return {
    kind:chosen.kind,
    amount:randomIntInclusive(chosen.min, chosen.max, random)
  };
}

function publicConfig() {
  return JSON.parse(JSON.stringify({
    chestTypes:CHEST_TYPES,
    starStates:STAR_STATES,
    starUpgrade:STAR_UPGRADE,
    dropTables:DROP_TABLES,
    duplicateCompensation:DUPLICATE_COMPENSATION,
    rules:{
      oneRewardPerOpening:true,
      ownedItemsRemoved:true,
      equalChanceWithinRarity:true,
      exclusiveInChests:false,
      starUpgradeEnabled:false
    }
  }));
}

function safeClaimKey(value) {
  const key = String(value || "").trim();
  return /^[a-zA-Z0-9:_-]{8,120}$/.test(key) ? key : "";
}

function itemBucket(type) {
  return type === "avatar" ? "avatars" : type === "frame" ? "frames" : type === "tag" ? "tags" : "";
}

function normalizeCatalogRarity(value) {
  const rarity = String(value || "").trim().toLowerCase();
  return ALL_ITEM_RARITIES.includes(rarity) ? rarity : "commun";
}

function buildChestCatalog(catalog, settingsRows = []) {
  const byKey = new Map((settingsRows || []).map(row => [
    String(row?.item_key || ""),
    normalizeCatalogRarity(row?.rarity)
  ]));

  return (Array.isArray(catalog) ? catalog : [])
    .filter(item => item && !item.defaultOwned && !item.levelOnly)
    .map(item => ({
      ...item,
      rarity:normalizeCatalogRarity(byKey.get(item.key) || item.defaultRarity || "commun")
    }))
    .filter(item => ITEM_RARITIES.includes(item.rarity));
}

function createRewardChestService({
  getPool,
  ensureSchema,
  inventoryService,
  walletAtomicService,
  syncCoins = null,
  syncGems = null
} = {}) {
  if (typeof getPool !== "function") throw new TypeError("getPool requis");
  if (typeof ensureSchema !== "function") throw new TypeError("ensureSchema requis");
  if (!inventoryService?.getState) throw new TypeError("inventoryService requis");
  if (!walletAtomicService?.changeCoinsWithClient || !walletAtomicService?.changeGemsWithClient) {
    throw new TypeError("walletAtomicService requis");
  }

  let schemaPromise = null;
  const catalog = Object.freeze(catalogEntries());

  async function ensureRewardSchema() {
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

  async function loadRarityMap(client) {
    const q = await client.query(
      `SELECT item_key,rarity FROM public.ptitbac_item_catalog_settings`
    );
    return new Map((q.rows || []).map(row => [
      String(row.item_key || ""),
      normalizeCatalogRarity(row.rarity)
    ]));
  }

  async function loadOwnedKeys(client, walletToken) {
    const q = await client.query(
      `SELECT item_type,item_id
         FROM public.ptitbac_inventory_items
        WHERE wallet_token=$1`,
      [walletToken]
    );
    return new Set((q.rows || []).map(row => `${row.item_type}:${row.item_id}`));
  }

  async function chooseUnownedItem(client, walletToken, rarity, random = Math.random) {
    const safeRarity = ITEM_RARITIES.includes(rarity) ? rarity : "commun";
    const [rarityMap, owned] = await Promise.all([
      loadRarityMap(client),
      loadOwnedKeys(client, walletToken)
    ]);

    const candidates = catalog.filter(item => {
      if (item.defaultOwned || item.levelOnly) return false;
      if (owned.has(item.key)) return false;
      const itemRarity = normalizeCatalogRarity(
        rarityMap.get(item.key) || item.defaultRarity || "commun"
      );
      if (itemRarity === "exclusif") return false;
      return itemRarity === safeRarity;
    });

    if (!candidates.length) return null;
    const index = Math.floor(clampRandom(random()) * candidates.length);
    return candidates[Math.min(index, candidates.length - 1)];
  }

  async function getChestCatalog() {
    const pool = await ensureRewardSchema();
    const q = await pool.query(
      `SELECT item_key,rarity FROM public.ptitbac_item_catalog_settings`
    );
    return buildChestCatalog(catalog, q.rows || []);
  }

  async function grant({
    walletToken,
    chestType,
    starState = "blue",
    claimKey,
    random = Math.random
  } = {}) {
    const token = validWalletToken(walletToken);
    const type = normalizeChestType(chestType);
    const state = type === "star" ? normalizeStarState(starState) : "";
    const key = safeClaimKey(claimKey);
    if (!token || !type || !key) throw new Error("Récompense de coffre invalide.");

    const pool = await ensureRewardSchema();
    // Garantit les objets de base avant le verrou de récompense.
    await inventoryService.getState(token);

    const client = await pool.connect();
    let finished = false;
    let reward = null;
    let walletResult = null;
    let duplicate = false;

    try {
      await client.query("BEGIN");
      await client.query(
        `SELECT token FROM ptitbac_wallets WHERE token=$1 FOR UPDATE`,
        [token]
      );

      const existing = await client.query(
        `SELECT result
           FROM public.ptitbac_reward_claims
          WHERE wallet_token=$1 AND claim_key=$2
          LIMIT 1`,
        [token, key]
      );

      if (existing.rowCount) {
        duplicate = true;
        reward = existing.rows[0].result;
        await client.query("COMMIT");
        finished = true;
      } else {
        let spec = rollRewardSpec(type, state || "blue", random);

        if (spec.kind === "item") {
          const item = await chooseUnownedItem(client, token, spec.rarity, random);
          if (!item) {
            spec = {
              kind:"coins",
              amount:DUPLICATE_COMPENSATION[spec.rarity] || 50,
              compensationFor:spec.rarity
            };
          } else {
            await client.query(
              `INSERT INTO public.ptitbac_inventory_items(wallet_token,item_type,item_id,source)
               VALUES($1,$2,$3,'reward_chest')
               ON CONFLICT(wallet_token,item_type,item_id) DO NOTHING`,
              [token, item.type, item.id]
            );
            reward = {
              kind:"item",
              rarity:spec.rarity,
              item:{
                key:item.key,
                type:item.type,
                id:item.id,
                label:item.label,
                asset:item.asset || ""
              }
            };
          }
        }

        if (!reward && spec.kind === "coins") {
          walletResult = await walletAtomicService.changeCoinsWithClient(client, {
            walletToken:token,
            delta:spec.amount,
            kind:"CHEST_REWARD",
            details:{ note:`Coffre ${type}${spec.compensationFor ? ` - compensation ${spec.compensationFor}` : ""}` },
            idempotencyKey:`chest:${key}:coins`
          });
          if (!walletResult?.ok) throw new Error(walletResult?.error || "Crédit de pièces impossible.");
          reward = {
            kind:"coins",
            amount:spec.amount,
            ...(spec.compensationFor ? { compensationFor:spec.compensationFor } : {})
          };
        }

        if (!reward && spec.kind === "gems") {
          walletResult = await walletAtomicService.changeGemsWithClient(client, {
            walletToken:token,
            delta:spec.amount,
            kind:"CHEST_REWARD",
            details:{ note:`Coffre ${type}` },
            idempotencyKey:`chest:${key}:gems`
          });
          if (!walletResult?.ok) throw new Error(walletResult?.error || "Crédit de gemmes impossible.");
          reward = { kind:"gems", amount:spec.amount };
        }

        const stored = {
          ...reward,
          chestType:type,
          starState:state || null,
          claimId:crypto.createHash("sha256").update(`${token}:${key}`).digest("hex").slice(0, 20)
        };

        await client.query(
          `INSERT INTO public.ptitbac_reward_claims(wallet_token,claim_key,chest_type,star_state,result)
           VALUES($1,$2,$3,$4,$5::jsonb)`,
          [token, key, type, state, JSON.stringify(stored)]
        );
        reward = stored;

        await client.query("COMMIT");
        finished = true;
      }
    } catch (error) {
      if (!finished) {
        try { await client.query("ROLLBACK"); } catch {}
      }
      throw error;
    } finally {
      client.release?.();
    }

    if (walletResult?.wallet) {
      const coins = Number(walletResult.wallet.coins);
      const gems = Number(walletResult.wallet.gems);
      if (Number.isFinite(coins) && typeof syncCoins === "function") syncCoins(token, coins);
      if (Number.isFinite(gems) && typeof syncGems === "function") syncGems(token, gems);
    } else {
      if (Number.isFinite(Number(walletResult?.balance)) && typeof syncCoins === "function") {
        syncCoins(token, Number(walletResult.balance));
      }
      if (Number.isFinite(Number(walletResult?.gems)) && typeof syncGems === "function") {
        syncGems(token, Number(walletResult.gems));
      }
    }

    const inventoryState = reward?.kind === "item"
      ? await inventoryService.getState(token).catch(() => null)
      : null;

    return {
      ok:true,
      duplicate,
      reward,
      wallet:walletResult?.wallet || null,
      balance:Number.isFinite(Number(walletResult?.balance)) ? Number(walletResult.balance) : null,
      gems:Number.isFinite(Number(walletResult?.gems)) ? Number(walletResult.gems) : null,
      inventory:inventoryState
    };
  }

  return {
    ensureSchema:ensureRewardSchema,
    config:publicConfig,
    catalog:getChestCatalog,
    rollStarTap,
    rollRewardSpec,
    grant
  };
}

module.exports = {
  CHEST_TYPES,
  STAR_STATES,
  ITEM_RARITIES,
  ALL_ITEM_RARITIES,
  STAR_UPGRADE,
  DROP_TABLES,
  DUPLICATE_COMPENSATION,
  randomIntInclusive,
  weightedPick,
  normalizeChestType,
  normalizeStarState,
  rollStarTap,
  rollRewardSpec,
  publicConfig,
  normalizeCatalogRarity,
  buildChestCatalog,
  createRewardChestService
};
