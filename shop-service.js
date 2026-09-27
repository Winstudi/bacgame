"use strict";

const crypto = require("crypto");
const { getPool, ensureDatabaseSchema } = require("./db.js");
const {
  catalogEntries,
  parseCatalogKey,
  createInventoryService
} = require("./inventory-service.js");
const { createWalletAtomicService } = require("./wallet-atomic-service.js");

const BLOCK_SLOTS = Object.freeze({ 1:3, 2:3, 3:4 });
const DISCOUNTS = Object.freeze([0,10,20,30,40,50,60,70,80,90]);
const OFFER_MODES = Object.freeze(["single","pack","choice"]);
const MAX_OFFER_ITEMS = 8;
const RARITY_ORDER = Object.freeze({ commun:0, rare:1, epique:2, ultra:3, exclusif:4 });
const RARITY_LABELS = Object.freeze({
  commun:"Commun",
  rare:"Rare",
  epique:"Épique",
  ultra:"Ultra",
  exclusif:"Exclusif"
});

const RESERVED_SHOP_SLOTS = Object.freeze(new Set(["3:3","3:4"]));
const SHOP_CHEST_ITEMS = Object.freeze([
  Object.freeze({
    key:"chest:bag",
    type:"chest",
    id:"bag",
    label:"Sac de Ressource",
    asset:"/reward-bag.png",
    defaultOwned:false,
    defaultRarity:"commun"
  }),
  Object.freeze({
    key:"chest:star",
    type:"chest",
    id:"star",
    label:"Coffre",
    asset:"/reward-star-simple-closed.png",
    defaultOwned:false,
    defaultRarity:"rare"
  }),
  Object.freeze({
    key:"chest:legendary",
    type:"chest",
    id:"legendary",
    label:"Coffre légendaire",
    asset:"/reward-legendary-simple-closed.png",
    defaultOwned:false,
    defaultRarity:"ultra"
  })
]);
const DAILY_REWARD_POOL = Object.freeze([
  Object.freeze({ kind:"coins", amount:80 }),
  Object.freeze({ kind:"coins", amount:150 }),
  Object.freeze({ kind:"gems", amount:5 }),
  Object.freeze({ kind:"chest", chestType:"bag" }),
  Object.freeze({ kind:"rare_item" })
]);

function isReservedShopSlot(block, position) {
  return RESERVED_SHOP_SLOTS.has(`${Number(block)}:${Number(position)}`);
}

function isChestItem(item) {
  return item?.type === "chest" && ["bag","star","legendary"].includes(String(item.id || ""));
}

function chestTypesForItems(items = []) {
  return (items || []).filter(isChestItem).map(item => String(item.id));
}

const PARIS_DTF = new Intl.DateTimeFormat("en-CA", {
  timeZone:"Europe/Paris",
  year:"numeric",
  month:"2-digit",
  day:"2-digit",
  hour:"2-digit",
  minute:"2-digit",
  second:"2-digit",
  hourCycle:"h23"
});

function parisParts(ms = Date.now()) {
  const values = {};
  for (const part of PARIS_DTF.formatToParts(new Date(ms))) {
    if (part.type !== "literal") values[part.type] = Number(part.value);
  }
  return {
    year:values.year,
    month:values.month,
    day:values.day,
    hour:values.hour,
    minute:values.minute,
    second:values.second
  };
}

function addCalendarDays(parts, amount) {
  const d = new Date(Date.UTC(parts.year, parts.month - 1, parts.day + amount, 12, 0, 0));
  return {
    year:d.getUTCFullYear(),
    month:d.getUTCMonth() + 1,
    day:d.getUTCDate()
  };
}

function parisOffsetMs(utcMs) {
  const p = parisParts(utcMs);
  const representedAsUtc = Date.UTC(p.year, p.month - 1, p.day, p.hour, p.minute, p.second);
  return representedAsUtc - Math.floor(utcMs / 1000) * 1000;
}

function parisLocalToUtcMs(parts, hour = 11) {
  const base = Date.UTC(parts.year, parts.month - 1, parts.day, hour, 0, 0);
  let guess = base;
  for (let i = 0; i < 3; i += 1) {
    guess = base - parisOffsetMs(guess);
  }
  return guess;
}

function dailyWindow(now = Date.now()) {
  const local = parisParts(now);
  const activeDate = local.hour < 11 ? addCalendarDays(local, -1) : {
    year:local.year, month:local.month, day:local.day
  };
  const nextDate = local.hour < 11 ? {
    year:local.year, month:local.month, day:local.day
  } : addCalendarDays(local, 1);
  const key = `${activeDate.year}-${String(activeDate.month).padStart(2,"0")}-${String(activeDate.day).padStart(2,"0")}`;
  return {
    key,
    nextChangeAt:parisLocalToUtcMs(nextDate, 11)
  };
}

function validWalletToken(value) {
  const token = String(value || "").trim();
  return /^[a-f0-9]{48}$/i.test(token) ? token : "";
}

function normalizeCurrency(value) {
  return value === "gems" ? "gems" : "coins";
}

function normalizeOfferMode(value) {
  const mode = String(value || "single").trim().toLowerCase();
  return OFFER_MODES.includes(mode) ? mode : "single";
}

function normalizeItemKeys(value, fallback = "") {
  const source = Array.isArray(value)
    ? value
    : typeof value === "string" && value.trim()
      ? value.split(",")
      : [];
  const keys = [];
  for (const entry of [...source, fallback]) {
    const key = String(entry || "").trim().slice(0,180);
    if (!key || keys.includes(key)) continue;
    keys.push(key);
    if (keys.length >= MAX_OFFER_ITEMS) break;
  }
  return keys;
}

function rowItemKeys(row = {}) {
  let raw = row.item_keys;
  if (typeof raw === "string") {
    try { raw = JSON.parse(raw); } catch { raw = []; }
  }
  return normalizeItemKeys(Array.isArray(raw) ? raw : [], row.item_key);
}

function highestRarity(items = []) {
  let rarity = "commun";
  let rank = -1;
  for (const item of items) {
    const candidate = String(item?.rarity || "commun");
    const candidateRank = Number(RARITY_ORDER[candidate] ?? 0);
    if (candidateRank > rank) {
      rarity = candidate;
      rank = candidateRank;
    }
  }
  return rarity;
}

function normalizeDiscount(value) {
  const amount = Math.floor(Number(value) || 0);
  return DISCOUNTS.includes(amount) ? amount : 0;
}

function normalizePrice(value) {
  return Math.max(1, Math.min(999999, Math.floor(Number(value) || 0)));
}

function normalizeBlock(value) {
  const block = Math.floor(Number(value) || 0);
  return BLOCK_SLOTS[block] ? block : 0;
}

function normalizePosition(block, value) {
  const position = Math.floor(Number(value) || 0);
  return position >= 1 && position <= (BLOCK_SLOTS[block] || 0) ? position : 0;
}

function normalizeDurationMinutes(value) {
  return Math.max(5, Math.min(60 * 24 * 30, Math.floor(Number(value) || 0)));
}

function normalizeRequestId(value) {
  return String(value || "")
    .trim()
    .replace(/[^a-zA-Z0-9:_-]/g, "")
    .slice(0, 80);
}

function finalPrice(basePrice, discountPercent) {
  const base = normalizePrice(basePrice);
  const discount = normalizeDiscount(discountPercent);
  return Math.max(1, Math.floor(base * (100 - discount) / 100));
}

function safeText(value, max) {
  return String(value || "").trim().replace(/\s+/g, " ").slice(0, max);
}

function createShopService({
  pool = getPool,
  ensureSchema = ensureDatabaseSchema,
  inventoryService = null,
  walletAtomicService = null
} = {}) {
  const inventory = inventoryService || createInventoryService({
    getPool:pool,
    ensureSchema
  });
  const wallet = walletAtomicService || createWalletAtomicService({
    getPool:pool,
    ensureSchema
  });

  let schemaPromise = null;

  async function db() {
    await ensureShopSchema();
    const value = pool();
    if (!value) throw new Error("PostgreSQL indisponible.");
    return value;
  }

  async function ensureShopSchema() {
    if (schemaPromise) return schemaPromise;
    schemaPromise = (async () => {
      await ensureSchema();
      const database = pool();
      if (!database) throw new Error("PostgreSQL indisponible.");









      // B3-P3 et B3-P4 sont désormais des cases système.

      return database;
    })().catch(error => {
      schemaPromise = null;
      throw error;
    });
    return schemaPromise;
  }

  async function catalog() {
    const database = await db();
    const q = await database.query(
      `SELECT item_key,rarity,price,currency
         FROM public.ptitbac_item_catalog_settings`
    ).catch(() => ({ rows:[] }));

    const settings = new Map((q.rows || []).map(row => [String(row.item_key || ""), row]));

    return [...catalogEntries(), ...SHOP_CHEST_ITEMS].map(item => {
      const saved = settings.get(item.key) || {};
      const rarity = RARITY_LABELS[String(saved.rarity || item.defaultRarity || "commun")]
        ? String(saved.rarity || item.defaultRarity || "commun")
        : "commun";
      return {
        ...item,
        asset:String(item.asset || (item.type === "avatar" ? item.id : "")),
        rarity,
        rarityLabel:RARITY_LABELS[rarity],
        configuredPrice:Math.max(0, Math.floor(Number(saved.price) || 0)),
        configuredCurrency:normalizeCurrency(saved.currency)
      };
    });
  }

  async function catalogMap() {
    const items = await catalog();
    return new Map(items.map(item => [item.key, item]));
  }

  function mapOffer(row, itemsMap) {
    const discount = normalizeDiscount(row.discount_percent);
    const price = normalizePrice(row.base_price);
    const now = Date.now();
    const startsAt = row.starts_at ? new Date(row.starts_at).getTime() : now;
    const endsAt = row.ends_at ? new Date(row.ends_at).getTime() : now;
    const offerMode = normalizeOfferMode(row.offer_mode);
    let itemKeys = rowItemKeys(row);
    if (offerMode === "single") itemKeys = itemKeys.slice(0,1);
    const resolvedItems = itemKeys.map(key => itemsMap.get(key)).filter(Boolean);
    const primary = resolvedItems[0] || itemsMap.get(String(row.item_key || "")) || null;
    const rarity = highestRarity(resolvedItems.length ? resolvedItems : [primary].filter(Boolean));
    const itemSnapshots = resolvedItems.map(item => ({
      key:String(item.key || ""),
      type:String(item.type || ""),
      id:String(item.id || ""),
      label:String(item.label || "Objet"),
      asset:String(item.asset || ""),
      rarity:String(item.rarity || "commun"),
      rarityLabel:String(item.rarityLabel || RARITY_LABELS[item.rarity] || "Commun")
    }));
    return {
      id:String(row.id || ""),
      offerMode,
      itemKeys:itemSnapshots.map(item => item.key),
      items:itemSnapshots,
      itemKey:String(primary?.key || row.item_key || ""),
      itemType:String(primary?.type || ""),
      itemId:String(primary?.id || ""),
      name:String(row.display_name || primary?.label || "Objet"),
      asset:String(primary?.asset || ""),
      rarity,
      rarityLabel:String(RARITY_LABELS[rarity] || "Commun"),
      currency:normalizeCurrency(row.currency),
      basePrice:price,
      discountPercent:discount,
      finalPrice:finalPrice(price, discount),
      block:normalizeBlock(row.block_no),
      position:normalizePosition(normalizeBlock(row.block_no), row.position_no),
      badge:String(row.badge || ""),
      active:row.active !== false,
      startsAt:Number.isFinite(startsAt) ? startsAt : now,
      endsAt:Number.isFinite(endsAt) ? endsAt : now,
      createdAt:row.created_at ? new Date(row.created_at).getTime() : null,
      updatedAt:row.updated_at ? new Date(row.updated_at).getTime() : null,
      durationMinutes:Math.max(5, Math.round((endsAt - startsAt) / 60000))
    };
  }


  async function ensureDailyRotation() {
    const database = await db();
    const window = dailyWindow();
    const existing = await database.query(
      `SELECT reward FROM public.ptitbac_shop_daily_rotations WHERE rotation_key=$1 LIMIT 1`,
      [window.key]
    );
    if (existing.rowCount) {
      return { rotationKey:window.key, nextChangeAt:window.nextChangeAt, reward:existing.rows[0].reward };
    }

    const reward = DAILY_REWARD_POOL[crypto.randomInt(0, DAILY_REWARD_POOL.length)];
    await database.query(
      `INSERT INTO public.ptitbac_shop_daily_rotations(rotation_key,reward)
       VALUES($1,$2::jsonb)
       ON CONFLICT(rotation_key) DO NOTHING`,
      [window.key, JSON.stringify(reward)]
    );

    const saved = await database.query(
      `SELECT reward FROM public.ptitbac_shop_daily_rotations WHERE rotation_key=$1 LIMIT 1`,
      [window.key]
    );
    return {
      rotationKey:window.key,
      nextChangeAt:window.nextChangeAt,
      reward:saved.rows?.[0]?.reward || reward
    };
  }

  async function dailyStatus(walletToken = "") {
    const token = validWalletToken(walletToken);
    const rotation = await ensureDailyRotation();
    let claimed = false;

    if (token) {
      const database = await db();
      const q = await database.query(
        `SELECT 1 FROM public.ptitbac_shop_daily_claims
          WHERE wallet_token=$1 AND rotation_key=$2 LIMIT 1`,
        [token, rotation.rotationKey]
      );
      claimed = q.rowCount > 0;
    }

    return { ...rotation, claimed };
  }

  function dailyRareItem(rotationKey, itemsMap) {
    const candidates = [...itemsMap.values()].filter(item =>
      item.type === "avatar" &&
      item.rarity === "rare" &&
      !item.defaultOwned &&
      !item.levelOnly
    );
    if (!candidates.length) return null;

    const hash = crypto.createHash("sha256").update(String(rotationKey || "daily")).digest();
    const index = hash.readUInt32BE(0) % candidates.length;
    return candidates[index] || candidates[0];
  }

  async function dailyRewardDisplay(reward = {}, rotationKey = "") {
    if (reward.kind === "coins") {
      return {
        name:`${Math.max(0, Number(reward.amount) || 0)} pièces`,
        asset:"/coin.png",
        rarity:"commun",
        item:{ key:`reward:coins:${reward.amount}`, type:"reward", id:`coins_${reward.amount}`, label:`${reward.amount} pièces`, asset:"/coin.png", rarity:"commun", rarityLabel:"Commun" }
      };
    }
    if (reward.kind === "gems") {
      return {
        name:`${Math.max(0, Number(reward.amount) || 0)} gemmes`,
        asset:"/gem.png",
        rarity:"epique",
        item:{ key:`reward:gems:${reward.amount}`, type:"reward", id:`gems_${reward.amount}`, label:`${reward.amount} gemmes`, asset:"/gem.png", rarity:"epique", rarityLabel:"Épique" }
      };
    }
    if (reward.kind === "chest") {
      return {
        name:"Sac de Ressource",
        asset:"/reward-bag.png",
        rarity:"commun",
        item:{ key:"chest:bag", type:"chest", id:"bag", label:"Sac de Ressource", asset:"/reward-bag.png", rarity:"commun", rarityLabel:"Commun" }
      };
    }
    const items = await catalogMap();
    const rareItem = dailyRareItem(rotationKey, items);
    if (rareItem) {
      return {
        name:String(rareItem.label || "Icône rare"),
        asset:String(rareItem.asset || rareItem.id || "/reward-star.png"),
        rarity:"rare",
        item:{
          key:rareItem.key,
          type:rareItem.type,
          id:rareItem.id,
          label:String(rareItem.label || "Icône rare"),
          asset:String(rareItem.asset || rareItem.id || "/reward-star.png"),
          rarity:"rare",
          rarityLabel:"Rare"
        }
      };
    }

    return {
      name:"Icône rare",
      asset:"/reward-star.png",
      rarity:"rare",
      item:{ key:"reward:rare_item", type:"reward", id:"rare_item", label:"Icône rare", asset:"/reward-star.png", rarity:"rare", rarityLabel:"Rare" }
    };
  }

  async function specialOffers(walletToken = "") {
    const daily = await dailyStatus(walletToken);
    const display = await dailyRewardDisplay(daily.reward, daily.rotationKey);
    const farFuture = Date.now() + 365 * 24 * 60 * 60 * 1000;

    return [
      {
        id:"special_ad_bag",
        specialKind:"ad_bag",
        offerMode:"single",
        itemKeys:["chest:bag"],
        items:[{
          key:"chest:bag", type:"chest", id:"bag", label:"Sac de Ressource",
          asset:"/reward-bag.png", rarity:"commun", rarityLabel:"Commun", owned:false
        }],
        itemKey:"chest:bag",
        itemType:"chest",
        itemId:"bag",
        name:"Sac de Ressource",
        asset:"/reward-bag.png",
        rarity:"commun",
        rarityLabel:"Commun",
        currency:"coins",
        basePrice:0,
        discountPercent:0,
        finalPrice:0,
        block:3,
        position:3,
        badge:"PUB",
        active:true,
        startsAt:Date.now(),
        endsAt:farFuture,
        hideTimer:true,
        owned:false,
        partiallyOwned:false
      },
      {
        id:`special_daily_${daily.rotationKey}`,
        specialKind:"daily",
        offerMode:"single",
        itemKeys:[display.item.key],
        items:[{ ...display.item, owned:daily.claimed }],
        itemKey:display.item.key,
        itemType:display.item.type,
        itemId:display.item.id,
        name:display.name,
        asset:display.asset,
        rarity:display.rarity,
        rarityLabel:RARITY_LABELS[display.rarity] || "Commun",
        currency:"coins",
        basePrice:0,
        discountPercent:0,
        finalPrice:0,
        block:3,
        position:4,
        badge:"QUOTIDIEN",
        active:true,
        startsAt:Date.now(),
        endsAt:daily.nextChangeAt,
        rotationKey:daily.rotationKey,
        dailyReward:daily.reward,
        dailyClaimed:daily.claimed,
        owned:false,
        partiallyOwned:false
      }
    ];
  }

  async function claimDaily(walletToken) {
    const token = validWalletToken(walletToken);
    if (!token) throw new Error("Session boutique invalide.");

    await inventory.getState(token);
    const rotation = await ensureDailyRotation();
    const database = await db();
    const items = await catalogMap();
    const client = await database.connect();
    let finished = false;
    let walletResult = null;
    let result = null;
    let duplicateClaim = false;

    try {
      await client.query("BEGIN");
      await client.query(
        `SELECT pg_advisory_xact_lock(hashtext($1))`,
        [`${token}:daily:${rotation.rotationKey}`]
      );

      const duplicate = await client.query(
        `SELECT result FROM public.ptitbac_shop_daily_claims
          WHERE wallet_token=$1 AND rotation_key=$2 LIMIT 1`,
        [token, rotation.rotationKey]
      );
      if (duplicate.rowCount) {
        duplicateClaim = true;
        result = duplicate.rows[0].result;
        await client.query("COMMIT");
        finished = true;
      } else {
        const reward = rotation.reward || {};

        if (reward.kind === "coins") {
          walletResult = await wallet.changeCoinsWithClient(client, {
            walletToken:token,
            delta:Math.max(0, Math.floor(Number(reward.amount) || 0)),
            kind:"SHOP_DAILY_REWARD",
            details:{ note:`Récompense quotidienne ${rotation.rotationKey}` },
            idempotencyKey:`daily:${rotation.rotationKey}:coins`
          });
          if (!walletResult?.ok) throw new Error(walletResult?.error || "Crédit impossible.");
          result = { kind:"coins", amount:Math.max(0, Math.floor(Number(reward.amount) || 0)) };
        } else if (reward.kind === "gems") {
          walletResult = await wallet.changeGemsWithClient(client, {
            walletToken:token,
            delta:Math.max(0, Math.floor(Number(reward.amount) || 0)),
            kind:"SHOP_DAILY_REWARD",
            details:{ note:`Récompense quotidienne ${rotation.rotationKey}` },
            idempotencyKey:`daily:${rotation.rotationKey}:gems`
          });
          if (!walletResult?.ok) throw new Error(walletResult?.error || "Crédit impossible.");
          result = { kind:"gems", amount:Math.max(0, Math.floor(Number(reward.amount) || 0)) };
        } else if (reward.kind === "chest") {
          result = { kind:"chest", chestType:"bag" };
        } else {
          const item = dailyRareItem(rotation.rotationKey, items);

          const ownedRows = await client.query(
            `SELECT item_type,item_id FROM public.ptitbac_inventory_items WHERE wallet_token=$1`,
            [token]
          );
          const ownedKeys = new Set((ownedRows.rows || []).map(row => `${row.item_type}:${row.item_id}`));

          if (item && !ownedKeys.has(item.key)) {
            await client.query(
              `INSERT INTO public.ptitbac_inventory_items(wallet_token,item_type,item_id,source)
               VALUES($1,$2,$3,'daily_shop')
               ON CONFLICT(wallet_token,item_type,item_id) DO NOTHING`,
              [token,item.type,item.id]
            );
            result = {
              kind:"item",
              rarity:"rare",
              item:{
                key:item.key,
                type:item.type,
                id:item.id,
                label:item.label,
                asset:item.asset || item.id || ""
              }
            };
          } else {
            walletResult = await wallet.changeCoinsWithClient(client, {
              walletToken:token,
              delta:100,
              kind:"SHOP_DAILY_REWARD",
              details:{ note:"Compensation icône rare quotidienne" },
              idempotencyKey:`daily:${rotation.rotationKey}:rare-comp`
            });
            if (!walletResult?.ok) throw new Error(walletResult?.error || "Crédit impossible.");
            result = { kind:"coins", amount:100, compensationFor:"rare_item" };
          }
        }

        await client.query(
          `INSERT INTO public.ptitbac_shop_daily_claims(wallet_token,rotation_key,result)
           VALUES($1,$2,$3::jsonb)`,
          [token,rotation.rotationKey,JSON.stringify(result)]
        );

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

    const inventoryState = result?.kind === "item"
      ? await inventory.getState(token).catch(() => null)
      : null;

    return {
      duplicate:duplicateClaim,
      rotationKey:rotation.rotationKey,
      nextChangeAt:rotation.nextChangeAt,
      reward:result,
      chestType:result?.kind === "chest" ? String(result.chestType || "bag") : "",
      balance:Number.isFinite(Number(walletResult?.balance)) ? Number(walletResult.balance) : null,
      gems:Number.isFinite(Number(walletResult?.gems)) ? Number(walletResult.gems) : null,
      inventory:inventoryState
    };
  }

  async function adminOffers() {
    const database = await db();
    const items = await catalogMap();
    const q = await database.query(
      `SELECT *
         FROM public.ptitbac_shop_offers
        ORDER BY active DESC, block_no ASC, position_no ASC, updated_at DESC
        LIMIT 150`
    );
    return (q.rows || []).map(row => mapOffer(row, items));
  }

  async function activeOffers(walletToken = "") {
    const database = await db();
    const items = await catalogMap();
    const q = await database.query(
      `SELECT *
         FROM public.ptitbac_shop_offers
        WHERE active=true
          AND starts_at <= now()
          AND ends_at > now()
        ORDER BY block_no ASC, position_no ASC, updated_at DESC`
    );

    let owned = null;
    const token = validWalletToken(walletToken);
    if (token) owned = await inventory.getState(token).catch(() => null);

    const ownsItem = item => {
      if (!owned || !item) return false;
      const bucket = item.type === "avatar" ? "avatars" : item.type === "frame" ? "frames" : "tags";
      return Array.isArray(owned.owned?.[bucket]) && owned.owned[bucket].includes(item.id);
    };

    const normalOffers = (q.rows || [])
      .map(row => {
        const offer = mapOffer(row, items);
        if (isReservedShopSlot(offer.block, offer.position)) return null;
        const itemStates = offer.items.map(item => ({
          ...item,
          owned:item.type === "chest" ? false : ownsItem(item)
        }));
        const ownableItems = itemStates.filter(item => item.type !== "chest");
        const ownedCount = ownableItems.filter(item => item.owned).length;
        return {
          ...offer,
          items:itemStates,
          owned:ownableItems.length > 0 && ownedCount === ownableItems.length && itemStates.every(item => item.type !== "chest"),
          partiallyOwned:ownedCount > 0 && ownedCount < ownableItems.length
        };
      })
      .filter(Boolean);

    const specials = await specialOffers(token);
    return [...normalOffers, ...specials]
      .sort((a,b) => Number(a.block) - Number(b.block) || Number(a.position) - Number(b.position));
  }

  async function saveOffer(adminToken, payload = {}) {
    const token = validWalletToken(adminToken);
    if (!token) throw new Error("Session admin invalide.");

    const items = await catalogMap();
    const offerMode = normalizeOfferMode(payload.offerMode);
    let itemKeys = normalizeItemKeys(payload.itemKeys, payload.itemKey);
    if (offerMode === "single") itemKeys = itemKeys.slice(0,1);
    if (!itemKeys.length) throw new Error("Choisis au moins un item boutique.");
    if (offerMode !== "single" && itemKeys.length < 2) {
      throw new Error("Un pack ou un choix doit contenir au moins 2 items.");
    }

    const selectedItems = itemKeys.map(key => items.get(key));
    if (selectedItems.some(item => !item || item.defaultOwned)) {
      throw new Error("Un des items sélectionnés n’est pas disponible dans la boutique.");
    }
    const primary = selectedItems[0];

    const block = normalizeBlock(payload.block);
    const position = normalizePosition(block, payload.position);
    if (!block || !position) throw new Error("Emplacement boutique invalide.");
    if (isReservedShopSlot(block, position)) {
      throw new Error("B3-P3 et B3-P4 sont réservés aux récompenses système.");
    }

    const basePrice = normalizePrice(payload.price);
    const discount = normalizeDiscount(payload.discountPercent);
    const currency = normalizeCurrency(payload.currency);
    const durationMinutes = normalizeDurationMinutes(payload.durationMinutes);
    const fallbackName = offerMode === "pack"
      ? `Pack ${selectedItems.length} objets`
      : offerMode === "choice"
        ? `Choix ${selectedItems.length} objets`
        : String(primary.label || "Objet");
    const displayName = safeText(payload.name, 40) || fallbackName;
    const badge = safeText(payload.badge, 24).toUpperCase();
    const active = payload.active !== false;
    const requestedId = safeText(payload.offerId, 80);
    const offerId = /^[a-zA-Z0-9_-]{8,80}$/.test(requestedId)
      ? requestedId
      : `offer_${crypto.randomBytes(10).toString("hex")}`;

    const database = await db();
    const client = await database.connect();
    let finished = false;
    try {
      await client.query("BEGIN");

      if (active) {
        await client.query(
          `UPDATE public.ptitbac_shop_offers
              SET active=false, updated_at=now()
            WHERE active=true
              AND block_no=$1
              AND position_no=$2
              AND id<>$3`,
          [block, position, offerId]
        );
      }

      const q = await client.query(
        `INSERT INTO public.ptitbac_shop_offers(
           id,item_key,offer_mode,item_keys,display_name,currency,base_price,discount_percent,
           block_no,position_no,badge,active,starts_at,ends_at,
           created_by_wallet_token,created_at,updated_at
         ) VALUES(
           $1,$2,$3,$4::jsonb,$5,$6,$7,$8,$9,$10,$11,$12,now(),
           now() + ($13::integer * interval '1 minute'),$14,now(),now()
         )
         ON CONFLICT(id) DO UPDATE SET
           item_key=EXCLUDED.item_key,
           offer_mode=EXCLUDED.offer_mode,
           item_keys=EXCLUDED.item_keys,
           display_name=EXCLUDED.display_name,
           currency=EXCLUDED.currency,
           base_price=EXCLUDED.base_price,
           discount_percent=EXCLUDED.discount_percent,
           block_no=EXCLUDED.block_no,
           position_no=EXCLUDED.position_no,
           badge=EXCLUDED.badge,
           active=EXCLUDED.active,
           starts_at=now(),
           ends_at=now() + ($13::integer * interval '1 minute'),
           updated_at=now()
         RETURNING *`,
        [
          offerId,primary.key,offerMode,JSON.stringify(itemKeys),displayName,currency,basePrice,discount,
          block,position,badge,active,durationMinutes,token
        ]
      );

      await client.query("COMMIT");
      finished = true;
      return mapOffer(q.rows[0], items);
    } catch (error) {
      if (!finished) {
        try { await client.query("ROLLBACK"); } catch {}
      }
      throw error;
    } finally {
      client.release?.();
    }
  }

  async function deactivateOffer(adminToken, offerId) {
    const token = validWalletToken(adminToken);
    if (!token) throw new Error("Session admin invalide.");
    const id = safeText(offerId, 80);
    if (!id) throw new Error("Offre invalide.");
    const database = await db();
    const q = await database.query(
      `UPDATE public.ptitbac_shop_offers
          SET active=false,updated_at=now()
        WHERE id=$1
        RETURNING id`,
      [id]
    );
    if (!q.rowCount) throw new Error("Offre introuvable.");
    return { id };
  }

  async function purchase(walletToken, offerId, requestId, selectedItemKey = "") {
    const token = validWalletToken(walletToken);
    const id = safeText(offerId, 80);
    const reqId = normalizeRequestId(requestId);
    if (!token || !id || reqId.length < 8) throw new Error("Achat invalide.");

    await inventory.getState(token);
    const database = await db();
    const items = await catalogMap();
    const client = await database.connect();
    let finished = false;
    let walletResult = null;
    let resultOffer = null;
    let purchasedItems = [];
    let selectedKey = "";
    let purchaseId = "";

    try {
      await client.query("BEGIN");
      await client.query(
        `SELECT pg_advisory_xact_lock(hashtext($1))`,
        [`${token}:shop:${id}`]
      );

      const duplicate = await client.query(
        `SELECT id,offer_id,item_key,selected_item_key,purchased_item_keys,currency,price_paid
           FROM public.ptitbac_shop_purchases
          WHERE wallet_token=$1 AND request_id=$2
          LIMIT 1`,
        [token, reqId]
      );
      if (duplicate.rowCount) {
        const row = duplicate.rows[0];
        const duplicateKeys = normalizeItemKeys(row.purchased_item_keys, row.item_key);
        const duplicateItems = duplicateKeys.map(key => items.get(key)).filter(Boolean);
        await client.query("COMMIT");
        finished = true;
        const inventoryState = await inventory.getState(token);
        return {
          duplicate:true,
          purchaseId:String(row.id || ""),
          offerId:String(row.offer_id || id),
          selectedItemKey:String(row.selected_item_key || ""),
          purchasedItemKeys:duplicateKeys,
          rewardChests:chestTypesForItems(duplicateItems),
          inventory:inventoryState
        };
      }

      const q = await client.query(
        `SELECT *
           FROM public.ptitbac_shop_offers
          WHERE id=$1
            AND active=true
            AND starts_at <= now()
            AND ends_at > now()
          LIMIT 1
          FOR UPDATE`,
        [id]
      );
      if (!q.rowCount) throw new Error("Cette offre n’est plus disponible.");

      const row = q.rows[0];
      resultOffer = mapOffer(row, items);
      if (!resultOffer.items.length) throw new Error("Objet boutique invalide.");

      if (resultOffer.offerMode === "choice") {
        selectedKey = safeText(selectedItemKey, 180);
        const chosen = resultOffer.items.find(item => item.key === selectedKey);
        if (!chosen) {
          const err = new Error("Choisis l’objet que tu veux acheter.");
          err.code = "CHOICE_REQUIRED";
          throw err;
        }
        purchasedItems = [chosen];
      } else if (resultOffer.offerMode === "pack") {
        purchasedItems = resultOffer.items.slice();
      } else {
        purchasedItems = [resultOffer.items[0]];
        selectedKey = purchasedItems[0]?.key || "";
      }

      for (const item of [...purchasedItems].sort((a,b) => a.key.localeCompare(b.key))) {
        if (isChestItem(item)) continue;
        await client.query(
          `SELECT pg_advisory_xact_lock(hashtext($1))`,
          [`${token}:item:${item.key}`]
        );
      }

      for (const item of purchasedItems) {
        if (isChestItem(item)) continue;
        const owned = await client.query(
          `SELECT 1
             FROM public.ptitbac_inventory_items
            WHERE wallet_token=$1 AND item_type=$2 AND item_id=$3
            LIMIT 1`,
          [token, item.type, item.id]
        );
        if (owned.rowCount) {
          const err = new Error(resultOffer.offerMode === "pack"
            ? "Tu possèdes déjà un objet de ce pack."
            : "Tu possèdes déjà cet objet.");
          err.code = "OWNED";
          throw err;
        }
      }

      const price = resultOffer.finalPrice;
      const mutation = {
        walletToken:token,
        delta:-price,
        kind:"SHOP_PURCHASE",
        details:{ note:`Boutique: ${resultOffer.name}` },
        idempotencyKey:`shop:${id}:${reqId}`
      };

      walletResult = resultOffer.currency === "gems"
        ? await wallet.changeGemsWithClient(client, mutation)
        : await wallet.changeCoinsWithClient(client, mutation);

      if (!walletResult?.ok) {
        const err = new Error(walletResult?.error || "Solde insuffisant.");
        err.code = walletResult?.code || "PAYMENT";
        throw err;
      }

      for (const item of purchasedItems) {
        if (isChestItem(item)) continue;
        await client.query(
          `INSERT INTO public.ptitbac_inventory_items(wallet_token,item_type,item_id,source)
           VALUES($1,$2,$3,'shop')
           ON CONFLICT(wallet_token,item_type,item_id) DO NOTHING`,
          [token, item.type, item.id]
        );
      }

      purchaseId = `buy_${crypto.randomBytes(10).toString("hex")}`;

      await client.query(
        `INSERT INTO public.ptitbac_shop_purchases(
           id,wallet_token,offer_id,item_key,selected_item_key,purchased_item_keys,currency,price_paid,request_id
         ) VALUES($1,$2,$3,$4,$5,$6::jsonb,$7,$8,$9)`,
        [
          purchaseId,
          token,id,purchasedItems[0]?.key || resultOffer.itemKey,
          resultOffer.offerMode === "choice" ? selectedKey : null,
          JSON.stringify(purchasedItems.map(item => item.key)),
          resultOffer.currency,price,reqId
        ]
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

    const inventoryState = await inventory.getState(token);
    return {
      duplicate:false,
      purchaseId,
      offer:resultOffer,
      selectedItemKey:resultOffer?.offerMode === "choice" ? selectedKey : null,
      purchasedItemKeys:purchasedItems.map(item => item.key),
      rewardChests:chestTypesForItems(purchasedItems),
      balance:Number.isFinite(Number(walletResult?.balance)) ? Number(walletResult.balance) : null,
      gems:Number.isFinite(Number(walletResult?.gems)) ? Number(walletResult.gems) : null,
      inventory:inventoryState
    };
  }

  return {
    ensureSchema:ensureShopSchema,
    catalog,
    adminOffers,
    activeOffers,
    saveOffer,
    deactivateOffer,
    purchase,
    dailyStatus,
    claimDaily,
    specialOffers,
    slots:BLOCK_SLOTS,
    discounts:DISCOUNTS,
    offerModes:OFFER_MODES,
    maxOfferItems:MAX_OFFER_ITEMS
  };
}

module.exports = {
  BLOCK_SLOTS,
  DISCOUNTS,
  OFFER_MODES,
  MAX_OFFER_ITEMS,
  RARITY_LABELS,
  SHOP_CHEST_ITEMS,
  RESERVED_SHOP_SLOTS,
  DAILY_REWARD_POOL,
  validWalletToken,
  normalizeCurrency,
  normalizeOfferMode,
  normalizeItemKeys,
  normalizeDiscount,
  normalizePrice,
  normalizeBlock,
  normalizePosition,
  normalizeDurationMinutes,
  finalPrice,
  createShopService
};
