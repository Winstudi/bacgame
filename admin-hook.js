"use strict";

const crypto = require("crypto");
const { getPool, ensureDatabaseSchema } = require("./db.js");
const { createWalletAtomicService } = require("./wallet-atomic-service.js");
const {
  CATALOG: INVENTORY_CATALOG,
  catalogEntries,
  parseCatalogKey,
  createInventoryService
} = require("./inventory-service.js");

const ADMIN_CODE = String(process.env.PTITBAC_ADMIN_CODE || "").trim();
const DATABASE_URL = String(process.env.DATABASE_URL || "").trim();

const pool = getPool();

const infiniteCoins =
  global.__ptbInfiniteCoins ||
  (global.__ptbInfiniteCoins = new Set());

const infiniteLives =
  global.__ptbInfiniteLives ||
  (global.__ptbInfiniteLives = new Set());


const ITEM_CATALOG = Object.freeze(catalogEntries());
const DEFAULT_BASE_AVATARS = Object.freeze([
  "/a1.webp",
  "/a2.webp",
  "/a3.webp",
  "/a4.webp",
  "/a5.webp"
]);

const ITEM_RARITY_RULES = Object.freeze({
  commun:Object.freeze({
    label:"Commun",
    sources:Object.freeze(["Boutique","Coffres (à venir)"]),
    note:"Disponible dans les coffres."
  }),
  rare:Object.freeze({
    label:"Rare",
    sources:Object.freeze(["Boutique","Coffres (à venir)"]),
    note:"Plus rare dans les coffres."
  }),
  epique:Object.freeze({
    label:"Épique",
    sources:Object.freeze(["Boutique","Coffres (à venir)"]),
    note:"Très rare dans les coffres."
  }),
  ultra:Object.freeze({
    label:"Ultra",
    sources:Object.freeze(["Boutique","Coffres (à venir)"]),
    note:"Super rare dans les coffres."
  }),
  exclusif:Object.freeze({
    label:"Exclusif",
    sources:Object.freeze(["Boutique","Niveaux","Voie des trophées"]),
    note:"Jamais disponible dans les coffres."
  })
});

function normalizeItemRarity(value) {
  const rarity = String(value || "").trim().toLowerCase();
  return ITEM_RARITY_RULES[rarity] ? rarity : "commun";
}

function normalizeItemCurrency(value) {
  return value === "gems" ? "gems" : "coins";
}

function normalizeItemPrice(value) {
  return Math.max(0, Math.min(999999, Math.floor(Number(value) || 0)));
}

function itemAcquisition(rarity) {
  const rule = ITEM_RARITY_RULES[normalizeItemRarity(rarity)];
  return {
    sources:[...rule.sources],
    note:rule.note
  };
}

async function loadAdminItemCatalog() {
  await schema();

  const q = await pool.query(
    `SELECT item_key,rarity,price,currency,updated_at
       FROM public.ptitbac_item_catalog_settings`
  ).catch(() => ({ rows:[] }));

  const byKey = new Map(
    (q.rows || []).map(row => [String(row.item_key || ""), row])
  );

  return ITEM_CATALOG.map(item => {
    const saved = byKey.get(item.key) || {};
    const rarity = normalizeItemRarity(saved.rarity || item.defaultRarity);

    return {
      ...item,
      rarity,
      rarityLabel:ITEM_RARITY_RULES[rarity].label,
      price:normalizeItemPrice(saved.price),
      currency:normalizeItemCurrency(saved.currency),
      acquisition:itemAcquisition(rarity),
      updatedAt:saved.updated_at || null
    };
  });
}

async function saveAdminItemConfig(adminToken, payload = {}) {
  await schema();

  const itemKey = String(payload.itemKey || "").trim();
  const item = ITEM_CATALOG.find(entry => entry.key === itemKey);

  if (!item) throw new Error("Objet invalide.");

  const rarity = normalizeItemRarity(payload.rarity);
  const price = normalizeItemPrice(payload.price);
  const currency = normalizeItemCurrency(payload.currency);

  await pool.query(
    `INSERT INTO public.ptitbac_item_catalog_settings
       (item_key,rarity,price,currency,updated_by_wallet_token,updated_at)
     VALUES($1,$2,$3,$4,$5,now())
     ON CONFLICT(item_key) DO UPDATE SET
       rarity=EXCLUDED.rarity,
       price=EXCLUDED.price,
       currency=EXCLUDED.currency,
       updated_by_wallet_token=EXCLUDED.updated_by_wallet_token,
       updated_at=now()`,
    [itemKey,rarity,price,currency,adminToken]
  );

  await audit(adminToken,"item_config_update",null,{
    itemKey,
    rarity,
    price,
    currency
  });

  return {
    ...item,
    rarity,
    rarityLabel:ITEM_RARITY_RULES[rarity].label,
    price,
    currency,
    acquisition:itemAcquisition(rarity)
  };
}
const inventoryService = createInventoryService({
  getPool: () => pool,
  ensureSchema: ensureDatabaseSchema
});
const walletAtomicService = createWalletAtomicService({
  getPool: () => pool,
  ensureSchema: ensureDatabaseSchema
});

function walletToken(value) {
  value = String(value || "").trim();
  return /^[a-f0-9]{48}$/i.test(value) ? value : "";
}

function friendCode(value) {
  value = String(value || "").replace(/^#/,"").trim();
  return /^\d{5}$/.test(value) ? value : "";
}

function id() {
  return crypto.randomBytes(12).toString("hex");
}

function clampResource(value) {
  return Math.max(0, Math.min(999999, Math.floor(Number(value) || 0)));
}

function normalizeLearningValue(value) {
  return String(value || "")
    .trim()
    .toLocaleLowerCase("fr")
    .normalize("NFD")
    .replace(/\p{Diacritic}/gu, "")
    .replace(/\s+/g, " ");
}

function learnedAnswerKey(category, answer) {
  return `${normalizeLearningValue(category)}|${normalizeLearningValue(answer)}`;
}


async function ensureUserModerationColumns() {
  return ensureDatabaseSchema();
}

async function ensureReportModerationColumns() {
  return ensureDatabaseSchema();
}

async function schema() {
  return ensureDatabaseSchema();
}

async function ownerToken() {
  await schema();
  const q = await pool.query(
    "SELECT wallet_token FROM ptitbac_admin_owner WHERE singleton=true LIMIT 1"
  );
  return q.rows[0]?.wallet_token || "";
}

async function isAdmin(token) {
  token = walletToken(token);
  return !!token && token === await ownerToken();
}

async function settings(token) {
  await schema();
  const q = await pool.query(
    "SELECT infinite_coins,infinite_lives FROM ptitbac_admin_settings WHERE wallet_token=$1",
    [token]
  );
  return q.rows[0] || {
    infinite_coins:false,
    infinite_lives:false
  };
}

async function audit(adminToken, action, targetCode = null, details = {}) {
  try {
    await pool.query(
      `INSERT INTO ptitbac_admin_logs
       (id,admin_wallet_token,action,target_friend_code,details)
       VALUES($1,$2,$3,$4,$5::jsonb)`,
      [
        id(),
        adminToken,
        String(action || "").slice(0,80),
        targetCode || null,
        JSON.stringify(details || {})
      ]
    );
  } catch {}
}

async function applyFlags(token) {
  const s = await settings(token);

  s.infinite_coins
    ? infiniteCoins.add(token)
    : infiniteCoins.delete(token);

  s.infinite_lives
    ? infiniteLives.add(token)
    : infiniteLives.delete(token);

  if (s.infinite_coins) {
    const result = await walletAtomicService.setCoins({
      walletToken:token,
      balance:999999,
      kind:"ADMIN_INFINITE_COINS",
      details:{ note:"Activation des pièces infinies" }
    });
    if (result?.ok) {
      global.__ptbAdminSyncCoins?.(token, result.balance);
    }
  }

  if (s.infinite_lives && pool) {
    await pool.query(
      `UPDATE public.users
       SET lives=5,life_updated_at=now(),updated_at=now()
       WHERE wallet_token=$1`,
      [token]
    ).catch(()=>{});
  }

  return s;
}

async function findUserByCode(code) {
  code = friendCode(code);
  if (!code) return null;

  await ensureUserModerationColumns();

  const q = await pool.query(
    `SELECT id,friend_code,username,avatar,wallet_token,lives,
            created_at,last_seen,updated_at,
            admin_banned,admin_ban_reason,admin_banned_at
     FROM public.users
     WHERE friend_code=$1
     LIMIT 1`,
    [code]
  ).catch(() => ({ rows:[] }));

  return q.rows[0] || null;
}

async function getWallet(token) {
  const q = await pool.query(
    `SELECT coins,gems,created_at,updated_at
     FROM ptitbac_wallets
     WHERE token=$1
     LIMIT 1`,
    [token]
  ).catch(() => ({ rows:[] }));

  return q.rows[0] || {
    coins:0,
    gems:0,
    created_at:Date.now(),
    updated_at:Date.now()
  };
}

function emitToWallet(io, targetToken, payload = {}) {
  for (const socket of io.sockets.sockets.values()) {
    if (String(socket.data?.walletToken || "") !== targetToken) continue;

    if (Number.isFinite(Number(payload.coins))) {
      socket.emit("wallet:update", {
        balance:Number(payload.coins)
      });
    }

    socket.emit("economy:update", payload);
  }
}

function socketsForWallet(io, targetToken) {
  return [...io.sockets.sockets.values()].filter(
    client =>
      String(client.data?.walletToken || "") ===
      String(targetToken || "")
  );
}

function emitWalletEvent(io, targetToken, eventName, payload = {}) {
  const sockets = socketsForWallet(io, targetToken);

  for (const client of sockets) {
    client.emit(eventName, payload);
  }

  return sockets;
}

async function playerSnapshot(io, code) {
  const safeCode = friendCode(code);
  if (!safeCode) throw new Error("ID joueur invalide.");

  const user = await findUserByCode(safeCode);
  if (!user?.wallet_token) throw new Error("Joueur introuvable.");

  const wallet = await getWallet(user.wallet_token);

  const inventoryState =
    await inventoryService
      .getState(user.wallet_token)
      .catch(() => ({
        owned:{ avatars:[], frames:[], tags:[] },
        equipped:{ avatar:"", frame:"", tag:"" }
      }));

  const inventoryItems = [
    ...(inventoryState.owned?.avatars || []).map(id => ({ type:"avatar", id })),
    ...(inventoryState.owned?.frames || []).map(id => ({ type:"frame", id })),
    ...(inventoryState.owned?.tags || []).map(id => ({ type:"tag", id }))
  ];

  const reportCount = await pool.query(
    `SELECT COUNT(*)::int AS count
     FROM ptitbac_player_reports
     WHERE reported_friend_code=$1`,
    [safeCode]
  ).catch(() => ({ rows:[{count:0}] }));

  const feedbackCount = await pool.query(
    `SELECT COUNT(*)::int AS count
     FROM ptitbac_feedback_reports
     WHERE friend_code=$1`,
    [safeCode]
  ).catch(() => ({ rows:[{count:0}] }));

  const online = socketsForWallet(io, user.wallet_token).length > 0;

  return {
    friendCode:user.friend_code,
    name:user.username || "Joueur",
    avatar:user.avatar || "🧠",
    lives:Number(user.lives ?? 0),
    coins:Number(wallet.coins || 0),
    gems:Number(wallet.gems || 0),
    createdAt:user.created_at,
    lastSeen:user.last_seen,
    online,
    banned:!!user.admin_banned,
    banReason:user.admin_ban_reason || "",
    bannedAt:user.admin_banned_at || null,
    reports:
      Number(reportCount.rows[0]?.count || 0) +
      Number(feedbackCount.rows[0]?.count || 0),
    items:inventoryItems.map(item => {
      const meta = INVENTORY_CATALOG[item.type]?.[item.id];
      return {
        key:`${item.type}:${item.id}`,
        type:item.type,
        id:item.id,
        quantity:1,
        label:meta?.name || item.id
      };
    })
  };
}


function normalizeInboxImage(value) {
  const image = String(value || "").trim();

  if (!image) return "";

  if (
    !/^data:image\/(?:jpeg|png|webp);base64,[a-z0-9+/=]+$/i.test(image) ||
    image.length > 650000
  ) {
    throw new Error("Image jointe invalide ou trop lourde.");
  }

  return image;
}

function normalizeReward(type, key, amount) {
  const safeType =
    ["none","coins","gems","item"].includes(String(type || ""))
      ? String(type)
      : "none";

  if (safeType === "none") {
    return {
      type:"none",
      key:"",
      amount:0
    };
  }

  if (safeType === "item") {
    const item =
      ITEM_CATALOG.find(
        entry => entry.key === String(key || "")
      );

    if (!item) {
      throw new Error("Objet invalide.");
    }

    return {
      type:"item",
      key:item.key,
      amount:1
    };
  }

  return {
    type:safeType,
    key:"",
    amount:Math.max(
      1,
      Math.min(
        999999,
        Math.floor(Number(amount) || 0)
      )
    )
  };
}

async function createInboxMessage(io, {
  senderToken = "",
  recipientToken = "",
  recipientFriendCode = "",
  type = "message",
  title,
  body,
  imageData = "",
  rewardType = "none",
  rewardKey = "",
  rewardAmount = 0
}) {
  await schema();

  const safeTitle =
    String(title || "")
      .trim()
      .slice(0,80);

  const safeBody =
    String(body || "")
      .trim()
      .slice(0,1800);

  if (!safeTitle) {
    throw new Error("Ajoute un titre.");
  }

  if (!safeBody) {
    throw new Error("Écris un message.");
  }

  const safeImage =
    normalizeInboxImage(imageData);

  const reward =
    normalizeReward(
      rewardType,
      rewardKey,
      rewardAmount
    );

  const messageId = id();

  await pool.query(
    `INSERT INTO ptitbac_inbox_messages
     (id,sender_wallet_token,recipient_wallet_token,recipient_friend_code,
      message_type,title,body,image_data,reward_type,reward_key,reward_amount)
     VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11)`,
    [
      messageId,
      walletToken(senderToken) || null,
      walletToken(recipientToken) || null,
      friendCode(recipientFriendCode) || null,
      String(type || "message").slice(0,30),
      safeTitle,
      safeBody,
      safeImage || null,
      reward.type,
      reward.key || null,
      reward.amount
    ]
  );

  const notification = {
    id:messageId,
    type:String(type || "message"),
    title:safeTitle,
    hasReward:reward.type !== "none"
  };

  if (recipientToken) {
    emitWalletEvent(
      io,
      recipientToken,
      "inbox:new",
      notification
    );
  } else {
    io.emit(
      "inbox:new",
      notification
    );
  }

  return {
    id:messageId,
    title:safeTitle,
    reward
  };
}

async function accessibleInboxMessage(messageId, targetToken) {
  const q = await pool.query(
    `SELECT id,sender_wallet_token,recipient_wallet_token,recipient_friend_code,
            message_type,title,body,image_data,reward_type,reward_key,
            reward_amount,created_at
     FROM ptitbac_inbox_messages
     WHERE id=$1
       AND (recipient_wallet_token IS NULL OR recipient_wallet_token=$2)
     LIMIT 1`,
    [String(messageId || ""),targetToken]
  );

  return q.rows[0] || null;
}



async function updateResource(io, {
  adminToken,
  code,
  resource,
  mode,
  amount,
  requestId = ""
}) {
  const user = await findUserByCode(code);

  if (!user?.wallet_token) {
    throw new Error("Joueur introuvable.");
  }

  const targetToken = walletToken(user.wallet_token);
  if (!targetToken) {
    throw new Error("Portefeuille du joueur introuvable.");
  }

  const safeAmount = clampResource(amount);
  let current = 0;
  let next = 0;

  if (resource === "coins") {
    const result = mode === "add"
      ? await walletAtomicService.changeCoins({
          walletToken:targetToken,
          delta:safeAmount,
          kind:"ADMIN_COIN_ADD",
          details:{ note:`Ajout admin (+${safeAmount})` },
          idempotencyKey:requestId ? `admin-resource:${requestId}` : ""
        })
      : await walletAtomicService.setCoins({
          walletToken:targetToken,
          balance:safeAmount,
          kind:"ADMIN_COIN_SET",
          details:{ note:`Solde défini par admin (${safeAmount})` },
          idempotencyKey:requestId ? `admin-resource:${requestId}` : ""
        });

    if (!result?.ok) {
      throw new Error(result?.error || "Modification des pièces impossible.");
    }

    current = Number(result.before ?? result.balance ?? 0);
    next = Number(result.balance ?? current);
    global.__ptbAdminSyncCoins?.(targetToken, next);
  } else {
    const result = mode === "add"
      ? await walletAtomicService.changeGems({
          walletToken:targetToken,
          delta:safeAmount,
          kind:"ADMIN_GEM_ADD",
          details:{ note:`Ajout admin gemmes (+${safeAmount})` },
          idempotencyKey:requestId ? `admin-resource:${requestId}` : ""
        })
      : await walletAtomicService.setGems({
          walletToken:targetToken,
          balance:safeAmount,
          kind:"ADMIN_GEM_SET",
          details:{ note:`Solde gemmes défini par admin (${safeAmount})` },
          idempotencyKey:requestId ? `admin-resource:${requestId}` : ""
        });

    if (!result?.ok) {
      throw new Error(result?.error || "Modification des gemmes impossible.");
    }

    current = Number(result.before ?? result.gems ?? 0);
    next = Number(result.gems ?? current);
    global.__ptbAdminSyncGems?.(targetToken, next);
  }

  const fresh = await getWallet(targetToken);

  emitToWallet(io, targetToken, {
    coins:resource === "coins" ? next : Number(fresh.coins || 0),
    gems:resource === "gems" ? next : Number(fresh.gems || 0)
  });

  await audit(
    adminToken,
    `resource_${mode}_${resource}`,
    friendCode(code),
    {
      before:current,
      amount:safeAmount,
      after:next,
      requestId:String(requestId || "").slice(0,80)
    }
  );

  return {
    name:user.username || "Joueur",
    friendCode:user.friend_code,
    coins:resource === "coins" ? next : Number(fresh.coins || 0),
    gems:resource === "gems" ? next : Number(fresh.gems || 0)
  };
}

function installAdmin(io) {
  const lifeTimer = setInterval(async () => {
    if (!pool || !infiniteLives.size) return;

    for (const token of infiniteLives) {
      await pool.query(
        `UPDATE public.users
         SET lives=5,life_updated_at=now(),updated_at=now()
         WHERE wallet_token=$1`,
        [token]
      ).catch(()=>{});
    }
  }, 1200);

  lifeTimer.unref?.();


  io.on("connection", socket => {
    socket.on("profile:update", async (payload={}, cb=()=>{}) => {
      let client = null;

      try {
        const token =
          walletToken(payload.walletToken);

        const name =
          String(payload.name || "")
            .trim()
            .replace(/\s+/g, " ")
            .slice(0,16);

        if (!token) {
          return cb({
            ok:false,
            error:"Profil indisponible."
          });
        }

        if (!name) {
          return cb({
            ok:false,
            error:"Choisis un pseudo."
          });
        }

        if (!pool) {
          return cb({
            ok:false,
            error:"Synchronisation du profil indisponible."
          });
        }

        client = await pool.connect();
        await client.query("BEGIN");

        const userQuery =
          await client.query(
            `SELECT username,friend_code
             FROM public.users
             WHERE wallet_token=$1
             LIMIT 1
             FOR UPDATE`,
            [token]
          );

        if (!userQuery.rowCount) {
          await client.query("ROLLBACK");

          return cb({
            ok:false,
            error:"Profil joueur introuvable."
          });
        }

        const currentName =
          String(
            userQuery.rows[0].username ||
            ""
          ).trim();

        if (currentName === name) {
          await client.query("ROLLBACK");

          return cb({
            ok:true,
            name:currentName,
            charged:false
          });
        }

        const updated =
          await client.query(
            `UPDATE public.users
             SET username=$2,
                 last_seen=now(),
                 updated_at=now()
             WHERE wallet_token=$1
             RETURNING friend_code,username`,
            [token,name]
          );

        await client.query("COMMIT");

        client.release();
        client = null;

        socket.data.walletToken = token;

        emitWalletEvent(
          io,
          token,
          "admin:profile-sync",
          {
            name:updated.rows[0].username,
            friendCode:
              updated.rows[0].friend_code ||
              ""
          }
        );

        cb({
          ok:true,
          name:updated.rows[0].username,
          charged:false
        });
      } catch (error) {
        if (client) {
          try {
            await client.query("ROLLBACK");
          } catch {}

          client.release();
          client = null;
        }

        cb({
          ok:false,
          error:"Impossible de modifier le pseudo."
        });
      }
    });

    socket.on("admin:status", async (payload={}, cb=()=>{}) => {
      try {
        const token = walletToken(payload.walletToken);

        if (token) {
          socket.data.walletToken = token;
          await ensureUserModerationColumns();

          const userQuery = await pool.query(
            `SELECT friend_code,username,admin_banned,admin_ban_reason
             FROM public.users
             WHERE wallet_token=$1
             LIMIT 1`,
            [token]
          ).catch(() => ({ rows:[] }));

          const user = userQuery.rows[0];

          if (user?.username) {
            socket.emit("admin:profile-sync", {
              name:user.username,
              friendCode:user.friend_code || ""
            });
          }

          const admin = await isAdmin(token);

          if (user?.admin_banned && !admin) {
            const reason =
              String(user.admin_ban_reason || "Compte suspendu.");

            cb({
              ok:true,
              admin:false,
              banned:true,
              reason
            });

            socket.emit("admin:account-banned", {
              reason
            });

            setTimeout(() => {
              if (socket.connected) socket.disconnect(true);
            }, 250);

            return;
          }

          if (admin) {
            const s = await applyFlags(token);

            return cb({
              ok:true,
              admin:true,
              infiniteCoins:!!s.infinite_coins,
              infiniteLives:!!s.infinite_lives
            });
          }
        }

        cb({
          ok:true,
          admin:false
        });
      } catch {
        cb({
          ok:false,
          admin:false
        });
      }
    });

    socket.on("admin:claim", async (payload={}, cb=()=>{}) => {
      try {
        await schema();

        const token = walletToken(payload.walletToken);

        if (
          !token ||
          !ADMIN_CODE ||
          String(payload.code || "").trim() !== ADMIN_CODE
        ) {
          return cb({
            ok:false,
            error:"Code admin incorrect."
          });
        }

        const current = await ownerToken();

        if (current && current !== token) {
          return cb({
            ok:false,
            error:"Un administrateur est déjà enregistré."
          });
        }

        await pool.query(
          `INSERT INTO ptitbac_admin_owner(singleton,wallet_token)
           VALUES(true,$1)
           ON CONFLICT(singleton) DO NOTHING`,
          [token]
        );

        await pool.query(
          `INSERT INTO ptitbac_admin_settings(wallet_token)
           VALUES($1)
           ON CONFLICT(wallet_token) DO NOTHING`,
          [token]
        );

        cb({
          ok:true,
          admin:true
        });
      } catch {
        cb({
          ok:false,
          error:"Activation admin impossible."
        });
      }
    });

    socket.on("admin:selfSettings", async (payload={}, cb=()=>{}) => {
      try {
        const token = walletToken(payload.walletToken);

        if (!await isAdmin(token)) {
          return cb({
            ok:false,
            error:"Accès refusé."
          });
        }

        const coins = !!payload.infiniteCoins;
        const lives = !!payload.infiniteLives;

        await pool.query(
          `INSERT INTO ptitbac_admin_settings
           (wallet_token,infinite_coins,infinite_lives,updated_at)
           VALUES($1,$2,$3,now())
           ON CONFLICT(wallet_token) DO UPDATE SET
             infinite_coins=$2,
             infinite_lives=$3,
             updated_at=now()`,
          [token,coins,lives]
        );

        await applyFlags(token);
        await audit(token, "self_settings", null, {
          infiniteCoins:coins,
          infiniteLives:lives
        });

        const balanceQuery = await pool.query(
          "SELECT coins FROM ptitbac_wallets WHERE token=$1 LIMIT 1",
          [token]
        ).catch(() => ({ rows:[] }));

        const balance = Number(
          balanceQuery.rows[0]?.coins ??
          (coins ? 999999 : 0)
        );

        if (Number.isFinite(Number(balance))) {
          socket.emit("wallet:update", {
            balance:Number(balance)
          });
        }

        cb({
          ok:true,
          infiniteCoins:coins,
          infiniteLives:lives,
          balance
        });
      } catch {
        cb({
          ok:false,
          error:"Modification impossible."
        });
      }
    });

    // Compatibilité avec l'ancien client.
    socket.on("admin:addCoins", async (payload={}, cb=()=>{}) => {
      try {
        const token = walletToken(payload.walletToken);

        if (!await isAdmin(token)) {
          return cb({
            ok:false,
            error:"Accès refusé."
          });
        }

        const result = await updateResource(io, {
          adminToken:token,
          code:payload.friendCode,
          resource:"coins",
          mode:"add",
          amount:payload.amount,
          requestId:payload.requestId
        });

        cb({
          ok:true,
          name:result.name,
          balance:result.coins
        });
      } catch (error) {
        cb({
          ok:false,
          error:error.message || "Ajout de pièces impossible."
        });
      }
    });

    socket.on("admin:resourceAdjust", async (payload={}, cb=()=>{}) => {
      try {
        const token = walletToken(payload.walletToken);

        if (!await isAdmin(token)) {
          return cb({
            ok:false,
            error:"Accès refusé."
          });
        }

        const resource =
          payload.resource === "gems"
            ? "gems"
            : "coins";

        const mode =
          payload.mode === "add"
            ? "add"
            : "set";

        const code = friendCode(payload.friendCode);
        const amount = clampResource(payload.amount);

        if (!code) {
          return cb({
            ok:false,
            error:"ID joueur invalide."
          });
        }

        const result = await updateResource(io, {
          adminToken:token,
          code,
          resource,
          mode,
          amount,
          requestId:payload.requestId
        });

        cb({
          ok:true,
          ...result
        });
      } catch (error) {
        cb({
          ok:false,
          error:error.message || "Modification impossible."
        });
      }
    });

    socket.on("admin:itemCatalog", async (payload={}, cb=()=>{}) => {
      try {
        const token = walletToken(payload.walletToken);

        if (!await isAdmin(token)) {
          return cb({
            ok:false,
            error:"Accès refusé."
          });
        }

        cb({
          ok:true,
          items:await loadAdminItemCatalog()
        });
      } catch {
        cb({
          ok:false,
          error:"Catalogue indisponible."
        });
      }
    });

    socket.on("admin:itemConfigUpdate", async (payload={}, cb=()=>{}) => {
      try {
        const token = walletToken(payload.walletToken);

        if (!await isAdmin(token)) {
          return cb({
            ok:false,
            error:"Accès refusé."
          });
        }

        const item = await saveAdminItemConfig(token,payload);

        cb({
          ok:true,
          item
        });
      } catch (error) {
        cb({
          ok:false,
          error:error.message || "Configuration de l’objet impossible."
        });
      }
    });

    socket.on("admin:grantItem", async (payload={}, cb=()=>{}) => {
      try {
        const token = walletToken(payload.walletToken);

        if (!await isAdmin(token)) {
          return cb({
            ok:false,
            error:"Accès refusé."
          });
        }

        const code = friendCode(payload.friendCode);
        const itemKey = String(payload.itemKey || "").trim();
        const item = ITEM_CATALOG.find(entry => entry.key === itemKey);
        const parsedItem = parseCatalogKey(itemKey);

        if (!code || !item || !parsedItem) {
          return cb({
            ok:false,
            error:"Joueur ou objet invalide."
          });
        }

        const user = await findUserByCode(code);

        if (!user?.wallet_token) {
          return cb({
            ok:false,
            error:"Joueur introuvable."
          });
        }

        const inventoryState = await inventoryService.grant(
          user.wallet_token,
          parsedItem.type,
          parsedItem.id,
          "admin"
        );

        emitWalletEvent(
          io,
          user.wallet_token,
          "inventory:update",
          inventoryState
        );

        await audit(
          token,
          "grant_item",
          code,
          {
            itemKey:item.key,
            itemType:parsedItem.type,
            itemId:parsedItem.id
          }
        );

        cb({
          ok:true,
          name:user.username || "Joueur",
          item:item.label,
          quantity:1
        });
      } catch {
        cb({
          ok:false,
          error:"Envoi de l’objet impossible."
        });
      }
    });

    socket.on("admin:grantChest", async (payload={}, cb=()=>{}) => {
      try {
        const token = walletToken(payload.walletToken);

        if (!await isAdmin(token)) {
          return cb({
            ok:false,
            error:"Accès refusé."
          });
        }

        const code = friendCode(payload.friendCode);
        const chestType = String(payload.chestType || "").trim().toLowerCase();
        const chestLabels = {
          bag:"Sac",
          star:"Étoile",
          legendary:"Étoile légendaire"
        };

        if (!code || !chestLabels[chestType]) {
          return cb({
            ok:false,
            error:"Joueur ou coffre invalide."
          });
        }

        const user = await findUserByCode(code);
        if (!user?.wallet_token) {
          return cb({
            ok:false,
            error:"Joueur introuvable."
          });
        }

        const rewardService = global.__ptbRewardChestService;
        if (!rewardService?.grant) {
          return cb({
            ok:false,
            error:"Service de coffres indisponible."
          });
        }

        const claimKey =
          `admin:${Date.now().toString(36)}:${crypto.randomBytes(10).toString("hex")}`;

        const result = await rewardService.grant({
          walletToken:user.wallet_token,
          chestType,
          starState:"blue",
          claimKey
        });

        if (!result?.ok || !result.reward) {
          return cb({
            ok:false,
            error:"Impossible d’attribuer ce coffre."
          });
        }

        if (result.inventory) {
          emitWalletEvent(
            io,
            user.wallet_token,
            "inventory:update",
            result.inventory
          );
        }

        const targets = emitWalletEvent(
          io,
          user.wallet_token,
          "rewards:admin-granted",
          {
            chestType,
            reward:result.reward,
            source:"admin"
          }
        );

        await audit(
          token,
          "grant_chest",
          code,
          {
            chestType,
            rewardKind:result.reward.kind,
            rewardAmount:Number(result.reward.amount || 0),
            rewardItemKey:result.reward.item?.key || ""
          }
        );

        cb({
          ok:true,
          name:user.username || "Joueur",
          chestType,
          chestLabel:chestLabels[chestType],
          online:targets.length > 0,
          reward:result.reward
        });
      } catch (error) {
        cb({
          ok:false,
          error:error.message || "Envoi du coffre impossible."
        });
      }
    });

    socket.on("admin:inventoryReset", async (payload={}, cb=()=>{}) => {
      try {
        const token = walletToken(payload.walletToken);

        if (!await isAdmin(token)) {
          return cb({
            ok:false,
            error:"Accès refusé."
          });
        }

        const code = friendCode(payload.friendCode);
        const user = await findUserByCode(code);

        if (!code || !user?.wallet_token) {
          return cb({
            ok:false,
            error:"Joueur introuvable."
          });
        }

        if (!inventoryService?.resetToBaseAvatars) {
          return cb({
            ok:false,
            error:"Réinitialisation de l’inventaire indisponible."
          });
        }

        const inventoryState = await inventoryService.resetToBaseAvatars(
          user.wallet_token
        );

        emitWalletEvent(
          io,
          user.wallet_token,
          "inventory:update",
          inventoryState
        );

        emitWalletEvent(
          io,
          user.wallet_token,
          "admin:inventory-reset",
          {
            avatar:inventoryState.equipped?.avatar || "/a1.webp"
          }
        );

        await audit(
          token,
          "inventory_reset",
          code,
          {
            keptAvatars:[...DEFAULT_BASE_AVATARS]
          }
        );

        cb({
          ok:true,
          message:"Inventaire réinitialisé : les 5 avatars de base ont été conservés.",
          player:await playerSnapshot(io, code)
        });
      } catch (error) {
        cb({
          ok:false,
          error:error.message || "Réinitialisation de l’inventaire impossible."
        });
      }
    });

    socket.on("admin:playerLookup", async (payload={}, cb=()=>{}) => {
      try {
        const token = walletToken(payload.walletToken);

        if (!await isAdmin(token)) {
          return cb({
            ok:false,
            error:"Accès refusé."
          });
        }

        const player = await playerSnapshot(
          io,
          payload.friendCode
        );

        cb({
          ok:true,
          player
        });
      } catch (error) {
        cb({
          ok:false,
          error:error.message || "Impossible de charger le joueur."
        });
      }
    });

    socket.on("admin:playerModeration", async (payload={}, cb=()=>{}) => {
      try {
        const token = walletToken(payload.walletToken);

        if (!await isAdmin(token)) {
          return cb({
            ok:false,
            error:"Accès refusé."
          });
        }

        await ensureUserModerationColumns();

        const code = friendCode(payload.friendCode);
        const action = String(payload.action || "").trim();
        const user = await findUserByCode(code);

        if (!code || !user?.wallet_token) {
          return cb({
            ok:false,
            error:"Joueur introuvable."
          });
        }

        if (
          user.wallet_token === token &&
          ["ban","unban"].includes(action)
        ) {
          return cb({
            ok:false,
            error:"Tu ne peux pas te bannir toi-même."
          });
        }

        if (action === "warn") {
          const message =
            String(payload.message || "")
              .trim()
              .slice(0,300);

          if (message.length < 3) {
            return cb({
              ok:false,
              error:"Écris un avertissement."
            });
          }

          await createInboxMessage(io, {
            senderToken:token,
            recipientToken:user.wallet_token,
            recipientFriendCode:code,
            type:"warning",
            title:"Avertissement de la modération",
            body:message
          });

          await audit(token, "player_warn", code, {
            message
          });

          return cb({
            ok:true,
            message:"Avertissement ajouté à la boîte de réception.",
            player:await playerSnapshot(io, code)
          });
        }

        if (action === "rename") {
          const name =
            String(payload.name || "")
              .trim()
              .replace(/\s+/g, " ")
              .slice(0,16);

          if (name.length < 2) {
            return cb({
              ok:false,
              error:"Pseudo invalide."
            });
          }

          await pool.query(
            `UPDATE public.users
             SET username=$2,updated_at=now()
             WHERE wallet_token=$1`,
            [user.wallet_token,name]
          );

          emitWalletEvent(
            io,
            user.wallet_token,
            "admin:profile-sync",
            {
              name,
              friendCode:code,
              moderated:true
            }
          );

          await audit(token, "player_rename", code, {
            previousName:user.username,
            newName:name
          });

          return cb({
            ok:true,
            message:"Pseudo modifié.",
            player:await playerSnapshot(io, code)
          });
        }

        if (action === "ban") {
          const reason =
            String(payload.reason || "Compte suspendu par la modération.")
              .trim()
              .slice(0,240);

          await pool.query(
            `UPDATE public.users
             SET admin_banned=true,
                 admin_ban_reason=$2,
                 admin_banned_at=now(),
                 updated_at=now()
             WHERE wallet_token=$1`,
            [user.wallet_token,reason]
          );

          const targets = emitWalletEvent(
            io,
            user.wallet_token,
            "admin:account-banned",
            { reason }
          );

          setTimeout(() => {
            for (const target of targets) {
              if (target.connected) target.disconnect(true);
            }
          }, 300);

          await audit(token, "player_ban", code, {
            reason
          });

          return cb({
            ok:true,
            message:"Joueur banni.",
            player:await playerSnapshot(io, code)
          });
        }

        if (action === "unban") {
          await pool.query(
            `UPDATE public.users
             SET admin_banned=false,
                 admin_ban_reason=NULL,
                 admin_banned_at=NULL,
                 updated_at=now()
             WHERE wallet_token=$1`,
            [user.wallet_token]
          );

          await audit(token, "player_unban", code);

          return cb({
            ok:true,
            message:"Joueur débanni.",
            player:await playerSnapshot(io, code)
          });
        }

        cb({
          ok:false,
          error:"Action inconnue."
        });
      } catch (error) {
        cb({
          ok:false,
          error:error.message || "Action impossible."
        });
      }
    });

    socket.on("admin:messageSend", async (payload={}, cb=()=>{}) => {
      try {
        const token = walletToken(payload.walletToken);

        if (!await isAdmin(token)) {
          return cb({
            ok:false,
            error:"Accès refusé."
          });
        }

        const target =
          payload.target === "all"
            ? "all"
            : "player";

        let recipientToken = "";
        let recipientCode = "";

        if (target === "player") {
          recipientCode =
            friendCode(payload.friendCode);

          if (!recipientCode) {
            return cb({
              ok:false,
              error:"ID joueur invalide."
            });
          }

          const user =
            await findUserByCode(recipientCode);

          if (!user?.wallet_token) {
            return cb({
              ok:false,
              error:"Joueur introuvable."
            });
          }

          recipientToken =
            walletToken(user.wallet_token);
        }

        const created =
          await createInboxMessage(io, {
            senderToken:token,
            recipientToken,
            recipientFriendCode:recipientCode,
            type:"admin",
            title:payload.title,
            body:payload.message,
            imageData:payload.imageData,
            rewardType:payload.rewardType,
            rewardKey:payload.rewardKey,
            rewardAmount:payload.rewardAmount
          });

        await audit(
          token,
          "inbox_message_send",
          recipientCode || null,
          {
            target,
            title:created.title,
            rewardType:created.reward.type,
            rewardKey:created.reward.key,
            rewardAmount:created.reward.amount
          }
        );

        cb({
          ok:true,
          messageId:created.id
        });
      } catch (error) {
        cb({
          ok:false,
          error:error.message || "Envoi impossible."
        });
      }
    });

    socket.on("inbox:count", async (payload={}, cb=()=>{}) => {
      try {
        const token =
          walletToken(payload.walletToken);

        if (!token) {
          return cb({
            ok:true,
            unread:0
          });
        }

        await schema();

        const q = await pool.query(
          `SELECT COUNT(*)::int AS count
           FROM ptitbac_inbox_messages m
           LEFT JOIN ptitbac_inbox_receipts r
             ON r.message_id=m.id
            AND r.wallet_token=$1
           WHERE (m.recipient_wallet_token IS NULL OR m.recipient_wallet_token=$1)
             AND r.read_at IS NULL`,
          [token]
        );

        cb({
          ok:true,
          unread:Number(q.rows[0]?.count || 0)
        });
      } catch {
        cb({
          ok:false,
          unread:0
        });
      }
    });

    socket.on("inbox:list", async (payload={}, cb=()=>{}) => {
      try {
        const token =
          walletToken(payload.walletToken);

        if (!token) {
          return cb({
            ok:false,
            error:"Profil indisponible."
          });
        }

        await schema();

        const q = await pool.query(
          `SELECT m.id,m.message_type,m.title,m.body,m.reward_type,
                  m.reward_key,m.reward_amount,m.created_at,
                  (m.image_data IS NOT NULL) AS has_image,
                  r.read_at,r.claimed_at
           FROM ptitbac_inbox_messages m
           LEFT JOIN ptitbac_inbox_receipts r
             ON r.message_id=m.id
            AND r.wallet_token=$1
           WHERE (m.recipient_wallet_token IS NULL OR m.recipient_wallet_token=$1)
           ORDER BY m.created_at DESC
           LIMIT 100`,
          [token]
        );

        const messages =
          q.rows.map(row => ({
            id:row.id,
            type:row.message_type,
            title:row.title,
            excerpt:
              String(row.body || "")
                .slice(0,140),
            rewardType:row.reward_type || "none",
            rewardKey:row.reward_key || "",
            rewardAmount:Number(row.reward_amount || 0),
            hasImage:!!row.has_image,
            read:!!row.read_at,
            claimed:!!row.claimed_at,
            createdAt:row.created_at
          }));

        cb({
          ok:true,
          unread:messages.filter(item => !item.read).length,
          messages
        });
      } catch {
        cb({
          ok:false,
          error:"Impossible de charger la boîte de réception."
        });
      }
    });

    socket.on("inbox:get", async (payload={}, cb=()=>{}) => {
      try {
        const token =
          walletToken(payload.walletToken);

        if (!token) {
          return cb({
            ok:false,
            error:"Profil indisponible."
          });
        }

        const message =
          await accessibleInboxMessage(
            payload.messageId,
            token
          );

        if (!message) {
          return cb({
            ok:false,
            error:"Message introuvable."
          });
        }

        await pool.query(
          `INSERT INTO ptitbac_inbox_receipts
           (message_id,wallet_token,read_at)
           VALUES($1,$2,now())
           ON CONFLICT(message_id,wallet_token) DO UPDATE SET
             read_at=COALESCE(ptitbac_inbox_receipts.read_at,now())`,
          [message.id,token]
        );

        const receipt = await pool.query(
          `SELECT read_at,claimed_at
           FROM ptitbac_inbox_receipts
           WHERE message_id=$1 AND wallet_token=$2
           LIMIT 1`,
          [message.id,token]
        );

        const item =
          ITEM_CATALOG.find(
            entry => entry.key === message.reward_key
          );

        cb({
          ok:true,
          message:{
            id:message.id,
            type:message.message_type,
            title:message.title,
            body:message.body,
            imageData:message.image_data || "",
            rewardType:message.reward_type || "none",
            rewardKey:message.reward_key || "",
            rewardLabel:item?.label || "",
            rewardIcon:item?.icon || "",
            rewardAmount:Number(message.reward_amount || 0),
            read:true,
            claimed:!!receipt.rows[0]?.claimed_at,
            createdAt:message.created_at
          }
        });
      } catch {
        cb({
          ok:false,
          error:"Impossible d’ouvrir ce message."
        });
      }
    });

    socket.on("inbox:markAllRead", async (payload={}, cb=()=>{}) => {
      try {
        const token =
          walletToken(payload.walletToken);

        if (!token) {
          return cb({
            ok:false,
            error:"Profil indisponible."
          });
        }

        await schema();

        await pool.query(
          `INSERT INTO ptitbac_inbox_receipts
           (message_id,wallet_token,read_at)
           SELECT m.id,$1,now()
           FROM ptitbac_inbox_messages m
           WHERE m.recipient_wallet_token IS NULL
              OR m.recipient_wallet_token=$1
           ON CONFLICT(message_id,wallet_token) DO UPDATE SET
             read_at=COALESCE(ptitbac_inbox_receipts.read_at,now())`,
          [token]
        );

        cb({ ok:true });
      } catch {
        cb({
          ok:false,
          error:"Action impossible."
        });
      }
    });

    socket.on("inbox:claim", async (payload={}, cb=()=>{}) => {
      const token =
        walletToken(payload.walletToken);

      if (!token || !pool) {
        return cb({
          ok:false,
          error:"Profil indisponible."
        });
      }

      const client =
        await pool.connect();

      try {
        await client.query("BEGIN");

        const q = await client.query(
          `SELECT id,recipient_wallet_token,reward_type,reward_key,reward_amount
           FROM ptitbac_inbox_messages
           WHERE id=$1
             AND (recipient_wallet_token IS NULL OR recipient_wallet_token=$2)
           FOR UPDATE`,
          [String(payload.messageId || ""),token]
        );

        const message = q.rows[0];

        if (!message) {
          await client.query("ROLLBACK");
          return cb({
            ok:false,
            error:"Message introuvable."
          });
        }

        if (
          !message.reward_type ||
          message.reward_type === "none"
        ) {
          await client.query("ROLLBACK");
          return cb({
            ok:false,
            error:"Ce message ne contient aucune récompense."
          });
        }

        await client.query(
          `INSERT INTO ptitbac_inbox_receipts
           (message_id,wallet_token,read_at)
           VALUES($1,$2,now())
           ON CONFLICT(message_id,wallet_token) DO NOTHING`,
          [message.id,token]
        );

        const claim = await client.query(
          `UPDATE ptitbac_inbox_receipts
           SET read_at=COALESCE(read_at,now()),
               claimed_at=now()
           WHERE message_id=$1
             AND wallet_token=$2
             AND claimed_at IS NULL
           RETURNING claimed_at`,
          [message.id,token]
        );

        if (!claim.rowCount) {
          await client.query("ROLLBACK");
          return cb({
            ok:false,
            error:"Récompense déjà récupérée."
          });
        }

        const amount =
          Math.max(
            1,
            Math.floor(
              Number(message.reward_amount) || 1
            )
          );

        let coins = null;
        let gems = null;
        let itemLabel = "";

        if (message.reward_type === "coins") {
          const reward = await walletAtomicService.changeCoinsWithClient(
            client,
            {
              walletToken:token,
              delta:amount,
              kind:"INBOX_COIN_REWARD",
              details:{
                note:`Récompense boîte de réception (+${amount})`
              },
              idempotencyKey:`inbox:${message.id}:coins`
            }
          );

          if (!reward?.ok) {
            await client.query("ROLLBACK");
            return cb({
              ok:false,
              error:reward?.error || "Récompense indisponible."
            });
          }

          coins = Number(reward.balance || 0);
          gems = Number(reward.gems || 0);
        }

        if (message.reward_type === "gems") {
          const reward = await walletAtomicService.changeGemsWithClient(
            client,
            {
              walletToken:token,
              delta:amount,
              kind:"INBOX_GEM_REWARD",
              details:{
                note:`Récompense boîte de réception gemmes (+${amount})`
              },
              idempotencyKey:`inbox:${message.id}:gems`
            }
          );

          if (!reward?.ok) {
            await client.query("ROLLBACK");
            return cb({
              ok:false,
              error:reward?.error || "Récompense indisponible."
            });
          }

          coins = Number(reward.balance || 0);
          gems = Number(reward.gems || 0);
        }

        if (message.reward_type === "item") {
          const item =
            ITEM_CATALOG.find(
              entry =>
                entry.key === message.reward_key
            );
          const parsedItem = parseCatalogKey(message.reward_key);

          if (!item || !parsedItem) {
            await client.query("ROLLBACK");
            return cb({
              ok:false,
              error:"Objet introuvable."
            });
          }

          itemLabel = item.label;

          await client.query(
            `INSERT INTO ptitbac_inventory_items
             (wallet_token,item_type,item_id,source)
             VALUES($1,$2,$3,'inbox')
             ON CONFLICT(wallet_token,item_type,item_id) DO NOTHING`,
            [token,parsedItem.type,parsedItem.id]
          );
        }

        await client.query("COMMIT");

        if (message.reward_type === "item") {
          const inventoryState =
            await inventoryService.getState(token);

          emitWalletEvent(
            io,
            token,
            "inventory:update",
            inventoryState
          );
        }

        if (Number.isFinite(coins)) {
          global.__ptbAdminSyncCoins?.(
            token,
            coins
          );
        }

        if (Number.isFinite(gems)) {
          global.__ptbAdminSyncGems?.(
            token,
            gems
          );
        }

        if (
          Number.isFinite(coins) ||
          Number.isFinite(gems)
        ) {
          emitToWallet(io,token,{
            ...(Number.isFinite(coins) ? { coins } : {}),
            ...(Number.isFinite(gems) ? { gems } : {})
          });
        }

        cb({
          ok:true,
          rewardType:message.reward_type,
          amount,
          itemLabel,
          coins,
          gems
        });
      } catch {
        try {
          await client.query("ROLLBACK");
        } catch {}

        cb({
          ok:false,
          error:"Impossible de récupérer la récompense."
        });
      } finally {
        client.release();
      }
    });

    socket.on("feedback:submit", async (payload={}, cb=()=>{}) => {
      try {
        await schema();

        const type =
          payload.type === "report-bug"
            ? "report-bug"
            : "report-avis";

        const message =
          String(payload.message || "")
            .trim()
            .slice(0,1000);

        if (!message) {
          return cb({
            ok:false,
            error:"Écris un message."
          });
        }

        await pool.query(
          `INSERT INTO ptitbac_feedback_reports
           (id,report_type,wallet_token,friend_code,player_name,message,
            room_code,category,answer)
           VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9)`,
          [
            id(),
            type,
            walletToken(payload.walletToken) || null,
            friendCode(payload.friendCode) || null,
            String(payload.playerName || "Joueur").slice(0,24),
            message,
            String(payload.roomCode || "").slice(0,8) || null,
            String(payload.category || "").slice(0,80) || null,
            String(payload.answer || "").slice(0,100) || null
          ]
        );

        cb({ ok:true });
      } catch {
        cb({
          ok:false,
          error:"Envoi impossible."
        });
      }
    });

    socket.on("admin:reports", async (payload={}, cb=()=>{}) => {
      try {
        const token = walletToken(payload.walletToken);

        if (!await isAdmin(token)) {
          return cb({
            ok:false,
            error:"Accès refusé."
          });
        }

        await schema();
        await ensureReportModerationColumns();

        const feedback = await pool.query(
          `SELECT id,report_type AS type,friend_code,player_name,message,
                  room_code,category,answer,NULL::text AS letter,
                  COALESCE(status,'pending') AS status,
                  treated_at,created_at,'feedback'::text AS source
           FROM ptitbac_feedback_reports
           ORDER BY created_at DESC
           LIMIT 250`
        );

        const players = await pool.query(
          `SELECT id,'report-joueur' AS type,
                  reported_friend_code AS friend_code,
                  reported_name AS player_name,
                  reason AS message,room_code,
                  NULL::text AS category,NULL::text AS answer,
                  NULL::text AS letter,
                  COALESCE(status,'pending') AS status,
                  treated_at,created_at,'player'::text AS source
           FROM ptitbac_player_reports
           ORDER BY created_at DESC
           LIMIT 250`
        ).catch(() => ({ rows:[] }));

        const answers = await pool.query(
          `SELECT id,'report-bug' AS type,NULL::text AS friend_code,
                  'Réponse signalée' AS player_name,
                  COALESCE(original_reason,'Réponse contestée') AS message,
                  room_code,category,answer,letter,status,
                  CASE
                    WHEN reviewed_at IS NULL THEN NULL
                    ELSE to_timestamp(reviewed_at/1000.0)
                  END AS treated_at,
                  to_timestamp(created_at/1000.0) AS created_at,
                  'answer'::text AS source
           FROM ptitbac_answer_reports
           ORDER BY created_at DESC
           LIMIT 250`
        ).catch(() => ({ rows:[] }));

        const reports = [
          ...feedback.rows,
          ...players.rows,
          ...answers.rows
        ]
          .sort(
            (a,b) =>
              new Date(b.created_at) -
              new Date(a.created_at)
          )
          .slice(0,400);

        cb({
          ok:true,
          reports
        });
      } catch {
        cb({
          ok:false,
          error:"Impossible de charger les reports."
        });
      }
    });

    socket.on("admin:reportMarkTreated", async (payload={}, cb=()=>{}) => {
      try {
        const token = walletToken(payload.walletToken);

        if (!await isAdmin(token)) {
          return cb({
            ok:false,
            error:"Accès refusé."
          });
        }

        await ensureReportModerationColumns();

        const reportId =
          String(payload.reportId || "").trim();

        const source =
          String(payload.source || "").trim();

        if (!reportId) {
          return cb({
            ok:false,
            error:"Report invalide."
          });
        }

        if (source === "feedback") {
          await pool.query(
            `UPDATE ptitbac_feedback_reports
             SET status='admin_treated',treated_at=now()
             WHERE id=$1`,
            [reportId]
          );
        } else if (source === "player") {
          await pool.query(
            `UPDATE ptitbac_player_reports
             SET status='admin_treated',treated_at=now()
             WHERE id=$1`,
            [reportId]
          );
        } else {
          return cb({
            ok:false,
            error:"Type de report invalide."
          });
        }

        await audit(token, "report_treated", null, {
          reportId,
          source
        });

        cb({
          ok:true,
          treated:true
        });
      } catch {
        cb({
          ok:false,
          error:"Impossible de traiter ce report."
        });
      }
    });

    socket.on("admin:answerReportAction", async (payload={}, cb=()=>{}) => {
      try {
        const token = walletToken(payload.walletToken);

        if (!await isAdmin(token)) {
          return cb({
            ok:false,
            error:"Accès refusé."
          });
        }

        await schema();

        const reportId =
          String(payload.reportId || "").trim();

        const action =
          String(payload.action || "").trim();

        if (!/^[a-f0-9]{16,64}$/i.test(reportId)) {
          return cb({
            ok:false,
            error:"Report invalide."
          });
        }

        if (!["validate","delete"].includes(action)) {
          return cb({
            ok:false,
            error:"Action invalide."
          });
        }

        const q = await pool.query(
          `SELECT id,category,answer,letter,status
           FROM ptitbac_answer_reports
           WHERE id=$1
           LIMIT 1`,
          [reportId]
        );

        if (!q.rowCount) {
          return cb({
            ok:false,
            error:"Report introuvable."
          });
        }

        const report = q.rows[0];

        if (action === "delete") {
          await pool.query(
            `UPDATE ptitbac_answer_reports
             SET status='admin_deleted',reviewed_at=$2
             WHERE id=$1`,
            [reportId,Date.now()]
          );

          await audit(token, "report_delete", null, {
            reportId
          });

          return cb({
            ok:true,
            deleted:true
          });
        }

        const key =
          learnedAnswerKey(
            report.category,
            report.answer
          );

        const now = Date.now();

        await pool.query(
          `INSERT INTO ptitbac_learned_answers
           (answer_key,category,answer,status,confidence,
            source,support_count,updated_at)
           VALUES($1,$2,$3,'valid',100,'admin_approved',1,$4)
           ON CONFLICT(answer_key) DO UPDATE SET
             category=EXCLUDED.category,
             answer=EXCLUDED.answer,
             status='valid',
             confidence=100,
             source='admin_approved',
             support_count=ptitbac_learned_answers.support_count+1,
             updated_at=EXCLUDED.updated_at`,
          [key,report.category,report.answer,now]
        );

        await pool.query(
          `UPDATE ptitbac_answer_reports SET
             status='admin_validated',
             review_verdict='valid',
             review_confidence=100,
             reviewed_at=$2
           WHERE id=$1`,
          [reportId,now]
        );

        global.__ptbAdminLearningOverlay ||= new Map();

        global.__ptbAdminLearningOverlay.set(key, {
          category:report.category,
          answer:report.answer,
          status:"valid",
          confidence:100,
          source:"admin_approved",
          supportCount:1,
          updatedAt:now
        });

        await audit(token, "report_validate", null, {
          reportId,
          category:report.category,
          answer:report.answer
        });

        cb({
          ok:true,
          validated:true,
          letter:report.letter,
          category:report.category,
          answer:report.answer
        });
      } catch (error) {
        console.error(
          "Action admin report réponse:",
          error.message
        );

        cb({
          ok:false,
          error:"Action impossible."
        });
      }
    });
  });

  return {
    close() {
      clearInterval(lifeTimer);
      clearInterval(gemTimer);
    }
  };
}

module.exports = installAdmin;

schema()
  .then(async () => {
    const owner = await ownerToken();
    if (owner) await applyFlags(owner);
  })
  .catch(error => {
    console.warn("Admin V4:",error.message);
  });

process.on("SIGTERM",() => {
  pool?.end().catch(()=>{});
});
