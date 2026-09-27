"use strict";

const ITEM_TYPES = Object.freeze(["avatar", "frame", "tag"]);
const ITEM_TYPE_SET = new Set(ITEM_TYPES);

const CATALOG = Object.freeze({
  avatar: Object.freeze({
    "/a1.webp": Object.freeze({ id: "/a1.webp", name: "Avatar 1", defaultOwned: true }),
    "/a2.webp": Object.freeze({ id: "/a2.webp", name: "Avatar 2", defaultOwned: true }),
    "/a3.webp": Object.freeze({ id: "/a3.webp", name: "Avatar 3", defaultOwned: true }),
    "/a4.webp": Object.freeze({ id: "/a4.webp", name: "Avatar 4", defaultOwned: true }),
    "/a5.webp": Object.freeze({ id: "/a5.webp", name: "Avatar 5", defaultOwned: true }),
    "/avatar-prestige.png": Object.freeze({
      id: "/avatar-prestige.png",
      name: "Avatar Prestige",
      defaultOwned: false,
      defaultRarity: "exclusif",
      levelOnly: true
    }),
    "/avatar-main-quantique.webp": Object.freeze({
      id: "/avatar-main-quantique.webp",
      name: "Main Quantique",
      defaultOwned: false,
      defaultRarity: "exclusif"
    }),
    "/avatar-chevalier.webp": Object.freeze({
      id: "/avatar-chevalier.webp",
      name: "Chevalier",
      defaultOwned: false,
      defaultRarity: "exclusif"
    }),
    "/avatar-renard.webp": Object.freeze({
      id: "/avatar-renard.webp",
      name: "Renard",
      defaultOwned: false,
      defaultRarity: "exclusif"
    }),
    "/avatar-spectre.webp": Object.freeze({
      id: "/avatar-spectre.webp",
      name: "Spectre",
      defaultOwned: false,
      defaultRarity: "exclusif"
    }),
    "/avatar-minto.webp": Object.freeze({
      id: "/avatar-minto.webp",
      name: "Minto",
      defaultOwned: false,
      defaultRarity: "exclusif"
    }),
    "/avatar-bot.webp": Object.freeze({
      id: "/avatar-bot.webp",
      name: "Bot",
      defaultOwned: false,
      defaultRarity: "exclusif"
    }),
    "/avatar-game.webp": Object.freeze({
      id: "/avatar-game.webp",
      name: "Game",
      defaultOwned: false,
      defaultRarity: "exclusif"
    }),
    "/avatar-sanctuaire.webp": Object.freeze({
      id: "/avatar-sanctuaire.webp",
      name: "Sanctuaire",
      defaultOwned: false,
      defaultRarity: "exclusif"
    }),
    "/avatar-ramen.webp": Object.freeze({
      id: "/avatar-ramen.webp",
      name: "Ramen",
      defaultOwned: false,
      defaultRarity: "exclusif"
    }),
    "/avatar-volcan.webp": Object.freeze({
      id: "/avatar-volcan.webp",
      name: "Volcan",
      defaultOwned: false,
      defaultRarity: "exclusif"
    }),
    "/avatar-orage.webp": Object.freeze({
      id: "/avatar-orage.webp",
      name: "Orage",
      defaultOwned: false,
      defaultRarity: "exclusif"
    }),
    "/avatar-potion.webp": Object.freeze({
      id: "/avatar-potion.webp",
      name: "Potion",
      defaultOwned: false,
      defaultRarity: "exclusif"
    }),
    "/avatar-arcade.webp": Object.freeze({
      id: "/avatar-arcade.webp",
      name: "Arcade",
      defaultOwned: false,
      defaultRarity: "exclusif"
    }),
    "/avatar-tresor.webp": Object.freeze({
      id: "/avatar-tresor.webp",
      name: "Trésor",
      defaultOwned: false,
      defaultRarity: "exclusif"
    }),
    "/avatar-portail-cristal.webp": Object.freeze({
      id: "/avatar-portail-cristal.webp",
      name: "Portail Cristal",
      defaultOwned: false,
      defaultRarity: "exclusif"
    })
  }),
  frame: Object.freeze({
    frame_nature: Object.freeze({
      id: "frame_nature",
      name: "Nature",
      asset: "/frame-nature.png",
      defaultOwned: false
    }),
    frame_gaming: Object.freeze({
      id: "frame_gaming",
      name: "Gaming",
      asset: "/frame-gaming.png",
      defaultOwned: false
    }),
    frame_purple_flame: Object.freeze({
      id: "frame_purple_flame",
      name: "Flamme violette",
      asset: "/frame-purple-flame.png",
      defaultOwned: false
    }),
    frame_ice: Object.freeze({
      id: "frame_ice",
      name: "Glace",
      asset: "/frame-ice.png",
      defaultOwned: false
    }),
    frame_gold_stars: Object.freeze({
      id: "frame_gold_stars",
      name: "Étoiles dorées",
      asset: "/frame-gold-stars.png",
      defaultOwned: false
    }),
    "frame-prestige": Object.freeze({
      id: "frame-prestige",
      name: "Prestige",
      asset: "/frame-prestige.png",
      defaultOwned: false,
      defaultRarity: "exclusif",
      levelOnly: true
    }),
    frame_quantique: Object.freeze({
      id: "frame_quantique",
      name: "Cadre Quantique",
      asset: "/frame-quantique.png",
      defaultOwned: false,
      defaultRarity: "exclusif"
    }),
    frame_ruines: Object.freeze({
      id: "frame_ruines",
      name: "Ruines",
      asset: "/frame-ruines.png",
      defaultOwned: false,
      defaultRarity: "exclusif"
    }),
    frame_lave: Object.freeze({
      id: "frame_lave",
      name: "Lave",
      asset: "/frame-lave.png",
      defaultOwned: false,
      defaultRarity: "exclusif"
    }),
    frame_flamme_cristal: Object.freeze({
      id: "frame_flamme_cristal",
      name: "Flamme Cristal",
      asset: "/frame-flamme-cristal.png",
      defaultOwned: false,
      defaultRarity: "exclusif"
    })
  }),
  tag: Object.freeze({
    tag_debutant: Object.freeze({ id: "tag_debutant", name: "Débutant", defaultOwned: true }),
    tag_quantique: Object.freeze({
      id: "tag_quantique",
      name: "Tag Quantique",
      asset: "/tag-quantique.png",
      defaultOwned: false,
      defaultRarity: "exclusif"
    }),
    tag_game_over: Object.freeze({
      id: "tag_game_over",
      name: "Game Over",
      asset: "/tag-game-over.png",
      defaultOwned: false,
      defaultRarity: "exclusif"
    })
  })
});

const DEFAULT_OWNED = Object.freeze({
  avatars: Object.freeze(Object.values(CATALOG.avatar).filter(item => item.defaultOwned).map(item => item.id)),
  frames: Object.freeze(Object.values(CATALOG.frame).filter(item => item.defaultOwned).map(item => item.id)),
  tags: Object.freeze(Object.values(CATALOG.tag).filter(item => item.defaultOwned).map(item => item.id))
});

const LEGACY_AVATAR_IDS = Object.freeze({
  "/avatar-base-01.webp": "/a1.webp",
  "/avatar-base-02.webp": "/a2.webp",
  "/avatar-base-03.webp": "/a3.webp",
  "/avatar-base-04.webp": "/a4.webp",
  "/avatar-base-05.webp": "/a5.webp"
});

const ITEM_TYPE_ICONS = Object.freeze({
  avatar: "👤",
  frame: "🖼️",
  tag: "🏷️"
});

function catalogEntries() {
  return ITEM_TYPES.flatMap(type =>
    Object.values(CATALOG[type]).map(item => ({
      key: `${type}:${item.id}`,
      type,
      id: item.id,
      label: item.name,
      icon: ITEM_TYPE_ICONS[type] || "🎁",
      asset: String(item.asset || ""),
      defaultOwned: Boolean(item.defaultOwned),
      defaultRarity: String(item.defaultRarity || "commun"),
      levelOnly: Boolean(item.levelOnly)
    }))
  );
}

function parseCatalogKey(value) {
  const key = String(value || "").trim();
  const separator = key.indexOf(":");
  if (separator <= 0) return null;

  const type = normalizeItemType(key.slice(0, separator));
  const id = normalizeItemId(type, key.slice(separator + 1));
  if (!type || !id) return null;

  return {
    key: `${type}:${id}`,
    type,
    id,
    item: CATALOG[type][id]
  };
}

function validWalletToken(value) {
  const token = String(value || "").trim();
  return /^[a-f0-9]{48}$/i.test(token) ? token : "";
}

function normalizeItemType(value) {
  const type = String(value || "").trim().toLowerCase();
  return ITEM_TYPE_SET.has(type) ? type : "";
}

function normalizeItemId(type, value, { allowEmpty = false } = {}) {
  const itemType = normalizeItemType(type);
  const id = String(value || "").trim();
  if (!itemType) return "";
  if (allowEmpty && (itemType === "frame" || itemType === "tag") && !id) return "";
  return CATALOG[itemType][id] ? id : "";
}

function normalizeAvatarId(value) {
  const raw = String(value || "").trim();
  const migrated = LEGACY_AVATAR_IDS[raw] || raw;
  return normalizeItemId("avatar", migrated) || DEFAULT_OWNED.avatars[0];
}

function normalizeLegacyEquipped(raw = {}) {
  const avatar = normalizeAvatarId(raw.avatar);
  const rawFrame = String(raw.frame || "").trim();
  const rawTag = String(raw.tag || "").trim();
  const frameCandidate = normalizeItemId("frame", rawFrame, { allowEmpty: true });
  const tagCandidate = normalizeItemId("tag", rawTag, { allowEmpty: true });

  return {
    avatar: DEFAULT_OWNED.avatars.includes(avatar) ? avatar : DEFAULT_OWNED.avatars[0],
    frame: rawFrame && DEFAULT_OWNED.frames.includes(frameCandidate) ? frameCandidate : "",
    tag: rawTag === ""
      ? ""
      : DEFAULT_OWNED.tags.includes(tagCandidate)
        ? tagCandidate
        : DEFAULT_OWNED.tags[0]
  };
}

function cloneState(state) {
  if (!state) return null;
  return {
    owned: {
      avatars: [...(state.owned?.avatars || [])],
      frames: [...(state.owned?.frames || [])],
      tags: [...(state.owned?.tags || [])]
    },
    equipped: {
      avatar: String(state.equipped?.avatar || DEFAULT_OWNED.avatars[0]),
      frame: String(state.equipped?.frame || ""),
      tag: String(state.equipped?.tag || "")
    }
  };
}

function canEquipFromState(state, type, value) {
  const itemType = normalizeItemType(type);
  if (!itemType || !state) return false;

  const allowEmpty = itemType !== "avatar";
  const id = normalizeItemId(itemType, value, { allowEmpty });
  if (allowEmpty && String(value || "").trim() === "") return true;
  if (!id) return false;

  const bucket = itemType === "avatar" ? "avatars" : itemType === "frame" ? "frames" : "tags";
  return Array.isArray(state.owned?.[bucket]) && state.owned[bucket].includes(id);
}

function createInventoryService({ getPool, ensureSchema: ensureSharedSchema = null }) {
  if (typeof getPool !== "function") throw new TypeError("getPool requis");

  let schemaPromise = null;
  const cache = new Map();

  function pool() {
    const value = getPool();
    if (!value) throw new Error("PostgreSQL indisponible");
    return value;
  }

  async function ensureSchema() {
    if (schemaPromise) return schemaPromise;

    schemaPromise = (async () => {
      const db = pool();
      if (typeof ensureSharedSchema !== "function") {
        throw new Error("Migration PostgreSQL centrale indisponible.");
      }

      await ensureSharedSchema();
      return db;
    })().catch(err => {
      schemaPromise = null;
      throw err;
    });

    return schemaPromise;
  }

  async function ensureDefaults(walletToken, legacyEquipped = {}) {
    const token = validWalletToken(walletToken);
    if (!token) throw new Error("Session joueur invalide");
    await ensureSchema();
    const db = pool();

    const resetFlag = await db.query(
      `SELECT avatars_only
         FROM public.ptitbac_inventory_reset_flags
        WHERE wallet_token=$1
        LIMIT 1`,
      [token]
    ).catch(() => ({ rows:[] }));

    const avatarsOnly = !!resetFlag.rows?.[0]?.avatars_only;
    const defaults = [
      ...DEFAULT_OWNED.avatars.map(id => ["avatar", id]),
      ...(avatarsOnly ? [] : DEFAULT_OWNED.frames.map(id => ["frame", id])),
      ...(avatarsOnly ? [] : DEFAULT_OWNED.tags.map(id => ["tag", id]))
    ];

    for (const [type, id] of defaults) {
      await db.query(
        `INSERT INTO public.ptitbac_inventory_items(wallet_token,item_type,item_id,source)
         VALUES($1,$2,$3,'default')
         ON CONFLICT(wallet_token,item_type,item_id) DO NOTHING`,
        [token, type, id]
      );
    }

    const legacy = normalizeLegacyEquipped(legacyEquipped);
    await db.query(
      `INSERT INTO public.ptitbac_inventory_equipped(wallet_token,avatar_id,frame_id,tag_id)
       VALUES($1,$2,$3,$4)
       ON CONFLICT(wallet_token) DO NOTHING`,
      [
        token,
        legacy.avatar,
        avatarsOnly ? "" : legacy.frame,
        avatarsOnly ? "" : (legacy.tag || DEFAULT_OWNED.tags[0])
      ]
    );
  }

  async function loadState(walletToken, legacyEquipped = {}) {
    const token = validWalletToken(walletToken);
    if (!token) throw new Error("Session joueur invalide");
    await ensureDefaults(token, legacyEquipped);
    const db = pool();

    const [itemsResult, equippedResult] = await Promise.all([
      db.query(
        `SELECT item_type,item_id
           FROM public.ptitbac_inventory_items
          WHERE wallet_token=$1
          ORDER BY acquired_at,item_type,item_id`,
        [token]
      ),
      db.query(
        `SELECT avatar_id,frame_id,tag_id
           FROM public.ptitbac_inventory_equipped
          WHERE wallet_token=$1
          LIMIT 1`,
        [token]
      )
    ]);

    const owned = { avatars: [], frames: [], tags: [] };
    for (const row of itemsResult.rows || []) {
      const type = normalizeItemType(row.item_type);
      const id = normalizeItemId(type, row.item_id);
      if (!id) continue;
      const bucket = type === "avatar" ? "avatars" : type === "frame" ? "frames" : "tags";
      if (!owned[bucket].includes(id)) owned[bucket].push(id);
    }

    const row = equippedResult.rows?.[0] || {};
    const state = {
      owned,
      equipped: {
        avatar: owned.avatars.includes(row.avatar_id) ? row.avatar_id : (owned.avatars[0] || DEFAULT_OWNED.avatars[0]),
        frame: owned.frames.includes(row.frame_id) ? row.frame_id : "",
        tag: row.tag_id === "" || owned.tags.includes(row.tag_id) ? String(row.tag_id || "") : (owned.tags[0] || "")
      }
    };

    cache.set(token, cloneState(state));
    return cloneState(state);
  }

  async function getState(walletToken, legacyEquipped = {}) {
    return loadState(walletToken, legacyEquipped);
  }

  function peek(walletToken) {
    const token = validWalletToken(walletToken);
    return token ? cloneState(cache.get(token)) : null;
  }

  async function equip(walletToken, type, value) {
    const token = validWalletToken(walletToken);
    const itemType = normalizeItemType(type);
    if (!token || !itemType) throw new Error("Requête d’équipement invalide");

    const state = await loadState(token);
    if (!canEquipFromState(state, itemType, value)) {
      const error = new Error("Cet objet n’est pas dans ton inventaire.");
      error.code = "NOT_OWNED";
      throw error;
    }

    const id = itemType === "avatar"
      ? normalizeItemId("avatar", value)
      : normalizeItemId(itemType, value, { allowEmpty: true });

    const column = itemType === "avatar" ? "avatar_id" : itemType === "frame" ? "frame_id" : "tag_id";
    const db = pool();
    await db.query(
      `UPDATE public.ptitbac_inventory_equipped
          SET ${column}=$2, updated_at=now()
        WHERE wallet_token=$1`,
      [token, id]
    );

    if (itemType === "avatar") {
      await db.query(
        `UPDATE public.users
            SET avatar=$2, updated_at=now()
          WHERE wallet_token=$1`,
        [token, id]
      ).catch(() => {});
    }

    return loadState(token);
  }

  async function grant(walletToken, type, value, source = "system") {
    const token = validWalletToken(walletToken);
    const itemType = normalizeItemType(type);
    const id = normalizeItemId(itemType, value);
    if (!token || !itemType || !id) throw new Error("Objet invalide");
    await ensureDefaults(token);
    const db = pool();
    await db.query(
      `INSERT INTO public.ptitbac_inventory_items(wallet_token,item_type,item_id,source)
       VALUES($1,$2,$3,$4)
       ON CONFLICT(wallet_token,item_type,item_id) DO NOTHING`,
      [token, itemType, id, String(source || "system").slice(0, 40)]
    );
    return loadState(token);
  }

  async function resetToBaseAvatars(walletToken) {
    const token = validWalletToken(walletToken);
    if (!token) throw new Error("Session joueur invalide");
    await ensureSchema();

    const db = pool();
    const client = await db.connect();
    let finished = false;

    try {
      await client.query("BEGIN");

      await client.query(
        `DELETE FROM public.ptitbac_inventory_items
          WHERE wallet_token=$1`,
        [token]
      );

      for (const avatarId of DEFAULT_OWNED.avatars) {
        await client.query(
          `INSERT INTO public.ptitbac_inventory_items(wallet_token,item_type,item_id,source)
           VALUES($1,'avatar',$2,'admin-reset')
           ON CONFLICT(wallet_token,item_type,item_id) DO NOTHING`,
          [token, avatarId]
        );
      }

      await client.query(
        `INSERT INTO public.ptitbac_inventory_equipped(wallet_token,avatar_id,frame_id,tag_id,updated_at)
         VALUES($1,$2,'','',now())
         ON CONFLICT(wallet_token) DO UPDATE
         SET avatar_id=EXCLUDED.avatar_id,
             frame_id='',
             tag_id='',
             updated_at=now()`,
        [token, DEFAULT_OWNED.avatars[0]]
      );

      await client.query(
        `INSERT INTO public.ptitbac_inventory_reset_flags(wallet_token,avatars_only,updated_at)
         VALUES($1,true,now())
         ON CONFLICT(wallet_token) DO UPDATE
         SET avatars_only=true,
             updated_at=now()`,
        [token]
      );

      await client.query(
        `UPDATE public.users
            SET avatar=$2, updated_at=now()
          WHERE wallet_token=$1`,
        [token, DEFAULT_OWNED.avatars[0]]
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

    cache.delete(token);
    return loadState(token);
  }

  return {
    ensureSchema,
    getState,
    equip,
    grant,
    resetToBaseAvatars,
    peek,
    catalog: CATALOG,
    defaults: DEFAULT_OWNED
  };
}

module.exports = {
  ITEM_TYPES,
  CATALOG,
  DEFAULT_OWNED,
  ITEM_TYPE_ICONS,
  catalogEntries,
  parseCatalogKey,
  validWalletToken,
  normalizeItemType,
  normalizeItemId,
  normalizeAvatarId,
  normalizeLegacyEquipped,
  canEquipFromState,
  createInventoryService
};
