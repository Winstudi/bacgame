const test = require("node:test");
const assert = require("node:assert/strict");

const {
  CATALOG,
  DEFAULT_OWNED,
  normalizeItemId,
  normalizeAvatarId,
  catalogEntries,
  parseCatalogKey,
  normalizeLegacyEquipped,
  canEquipFromState,
  createInventoryService
} = require("./inventory-service.js");

const FRAME_IDS = [
  "frame_nature",
  "frame_gaming",
  "frame_purple_flame",
  "frame_ice",
  "frame_gold_stars",
  "frame-prestige",
  "frame_quantique",
  "frame_ruines",
  "frame_lave",
  "frame_flamme_cristal"
];

const NEW_AVATAR_IDS = [
  "/avatar-main-quantique.webp",
  "/avatar-chevalier.webp",
  "/avatar-renard.webp",
  "/avatar-spectre.webp",
  "/avatar-minto.webp",
  "/avatar-bot.webp",
  "/avatar-game.webp",
  "/avatar-sanctuaire.webp",
  "/avatar-ramen.webp",
  "/avatar-volcan.webp",
  "/avatar-orage.webp",
  "/avatar-potion.webp",
  "/avatar-arcade.webp",
  "/avatar-tresor.webp",
  "/avatar-portail-cristal.webp"
];

test("les cinq avatars et Débutant restent possédés par défaut, aucun cadre ne l'est", () => {
  assert.deepEqual(DEFAULT_OWNED.avatars, ["/a1.webp", "/a2.webp", "/a3.webp", "/a4.webp", "/a5.webp"]);
  assert.deepEqual(DEFAULT_OWNED.frames, []);
  assert.deepEqual(DEFAULT_OWNED.tags, ["tag_debutant"]);
  assert.equal(CATALOG.tag.tag_quantique?.name, "Tag Quantique");
  assert.equal(CATALOG.tag.tag_quantique?.asset, "/tag-quantique.png");
  assert.equal(CATALOG.tag.tag_game_over?.name, "Game Over");
  assert.equal(CATALOG.tag.tag_game_over?.asset, "/tag-game-over.png");
  assert.deepEqual(Object.keys(CATALOG.frame), FRAME_IDS);
});

test("les cadres publiés font partie du catalogue officiel", () => {
  for (const id of FRAME_IDS) {
    assert.equal(normalizeItemId("frame", id), id);
    assert.ok(CATALOG.frame[id]?.asset?.endsWith(".png"));
    assert.equal(CATALOG.frame[id]?.defaultOwned, false);
  }
  assert.equal(normalizeItemId("frame", "frame_inconnu"), "");
  assert.equal(normalizeAvatarId("/avatar-secret.webp"), "/a1.webp");
});

test("les nouveaux avatars sont reconnus sans être possédés par défaut", () => {
  for (const id of NEW_AVATAR_IDS) {
    assert.equal(normalizeAvatarId(id), id);
    assert.equal(CATALOG.avatar[id]?.defaultOwned, false);
  }
});

test("un ancien profil ne reçoit pas automatiquement un cadre premium", () => {
  assert.deepEqual(
    normalizeLegacyEquipped({ avatar:"/a4.webp", frame:"frame_purple_flame", tag:"tag_debutant" }),
    { avatar:"/a4.webp", frame:"", tag:"tag_debutant" }
  );
});

test("un cadre est équipable uniquement lorsqu'il est possédé", () => {
  const state = {
    owned: {
      avatars:["/a1.webp", "/a2.webp"],
      frames:["frame_nature"],
      tags:["tag_debutant"]
    },
    equipped:{avatar:"/a1.webp",frame:"",tag:"tag_debutant"}
  };

  assert.equal(canEquipFromState(state, "frame", ""), true);
  assert.equal(canEquipFromState(state, "frame", "frame_nature"), true);
  assert.equal(canEquipFromState(state, "frame", "frame_ice"), false);
  assert.equal(canEquipFromState(state, "frame", "frame_inconnu"), false);
});

test("le service métier délègue toujours le schéma aux migrations centrales", async () => {
  let migrationCalls = 0;
  const db = { async query() { return { rows: [] }; } };
  const service = createInventoryService({
    getPool: () => db,
    ensureSchema: async () => { migrationCalls += 1; }
  });

  await service.ensureSchema();
  await service.ensureSchema();
  assert.equal(migrationCalls, 1);
});

test("le catalogue admin expose les nouveaux cosmétiques avec leurs assets", () => {
  const entries = catalogEntries();
  const frames = entries.filter(item => item.type === "frame");
  const tags = entries.filter(item => item.type === "tag");

  assert.equal(frames.length, 10);
  const quantumTag = tags.find(item => item.key === "tag:tag_quantique");
  assert.ok(quantumTag);
  assert.equal(quantumTag.label, "Tag Quantique");
  assert.equal(quantumTag.asset, "/tag-quantique.png");
  assert.equal(quantumTag.defaultOwned, false);
  assert.equal(quantumTag.defaultRarity, "exclusif");
  assert.equal(parseCatalogKey("tag:tag_quantique")?.id, "tag_quantique");

  const gameOverTag = tags.find(item => item.key === "tag:tag_game_over");
  assert.ok(gameOverTag);
  assert.equal(gameOverTag.label, "Game Over");
  assert.equal(gameOverTag.asset, "/tag-game-over.png");
  assert.equal(gameOverTag.defaultOwned, false);
  assert.equal(gameOverTag.defaultRarity, "exclusif");
  assert.equal(parseCatalogKey("tag:tag_game_over")?.id, "tag_game_over");
  for (const id of FRAME_IDS) {
    const item = frames.find(entry => entry.id === id);
    assert.ok(item);
    assert.equal(item.key, `frame:${id}`);
    assert.match(item.asset, /^\/frame-.*\.png$/);
  }

  for (const id of NEW_AVATAR_IDS) {
    const item = entries.find(entry => entry.key === `avatar:${id}`);
    assert.ok(item);
    assert.equal(item.type, "avatar");
    assert.equal(item.id, id);
  }

  const quantumFrame = entries.find(item => item.key === "frame:frame_quantique");
  assert.ok(quantumFrame);
  assert.equal(quantumFrame.label, "Cadre Quantique");
  assert.equal(quantumFrame.asset, "/frame-quantique.png");

  const ruinsFrame = entries.find(item => item.key === "frame:frame_ruines");
  assert.ok(ruinsFrame);
  assert.equal(ruinsFrame.label, "Ruines");
  assert.equal(ruinsFrame.asset, "/frame-ruines.png");

  const lavaFrame = entries.find(item => item.key === "frame:frame_lave");
  assert.ok(lavaFrame);
  assert.equal(lavaFrame.label, "Lave");
  assert.equal(lavaFrame.asset, "/frame-lave.png");

  const crystalFlameFrame = entries.find(item => item.key === "frame:frame_flamme_cristal");
  assert.ok(crystalFlameFrame);
  assert.equal(crystalFlameFrame.label, "Flamme Cristal");
  assert.equal(crystalFlameFrame.asset, "/frame-flamme-cristal.png");

  const prestigeAvatar = entries.find(item => item.key === "avatar:/avatar-prestige.png");
  assert.ok(prestigeAvatar);
  assert.equal(prestigeAvatar.defaultOwned, false);
  assert.equal(prestigeAvatar.defaultRarity, "exclusif");
  assert.equal(prestigeAvatar.levelOnly, true);

  const prestigeFrame = entries.find(item => item.key === "frame:frame-prestige");
  assert.ok(prestigeFrame);
  assert.equal(prestigeFrame.defaultRarity, "exclusif");
  assert.equal(prestigeFrame.levelOnly, true);

  assert.deepEqual(
    parseCatalogKey("frame:frame_ice"),
    {
      key:"frame:frame_ice",
      type:"frame",
      id:"frame_ice",
      item:CATALOG.frame.frame_ice
    }
  );
});
