"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const {
  rollStarTap,
  rollRewardSpec,
  DUPLICATE_COMPENSATION,
  publicConfig,
  buildChestCatalog
} = require("./reward-chests-service.js");

const randomAt = value => () => value;

test("les trois tables de tirage totalisent exactement 100%", () => {
  const tables = publicConfig().dropTables;
  for (const type of ["bag", "star", "legendary"]) {
    assert.equal(
      tables[type].reduce((sum, row) => sum + Number(row.weight || 0), 0),
      100,
      `${type} doit totaliser 100%`
    );
  }
});

test("sac: probabilités et récompenses exactes", () => {
  const rows = publicConfig().dropTables.bag;
  assert.deepEqual(rows, [
    { kind:"item", rarity:"commun", weight:5 },
    { kind:"gems", amount:10, weight:10 },
    { kind:"coins", amount:200, weight:15 },
    { kind:"gems", amount:5, weight:15 },
    { kind:"coins", amount:100, weight:20 },
    { kind:"coins", amount:50, weight:35 }
  ]);

  assert.deepEqual(rollRewardSpec("bag", "blue", randomAt(0.00)), { kind:"item", rarity:"commun" });
  assert.deepEqual(rollRewardSpec("bag", "blue", randomAt(0.05)), { kind:"gems", amount:10 });
  assert.deepEqual(rollRewardSpec("bag", "blue", randomAt(0.15)), { kind:"coins", amount:200 });
  assert.deepEqual(rollRewardSpec("bag", "blue", randomAt(0.30)), { kind:"gems", amount:5 });
  assert.deepEqual(rollRewardSpec("bag", "blue", randomAt(0.45)), { kind:"coins", amount:100 });
  assert.deepEqual(rollRewardSpec("bag", "blue", randomAt(0.65)), { kind:"coins", amount:50 });
});

test("coffre normal: probabilités et récompenses exactes", () => {
  const rows = publicConfig().dropTables.star;
  assert.deepEqual(rows, [
    { kind:"coins", amount:200, weight:10 },
    { kind:"coins", amount:500, weight:5 },
    { kind:"gems", amount:25, weight:5 },
    { kind:"gems", amount:10, weight:10 },
    { kind:"coins", amount:100, weight:15 },
    { kind:"gems", amount:5, weight:15 },
    { kind:"item", rarity:"commun", weight:18 },
    { kind:"item", rarity:"rare", weight:10 },
    { kind:"item", rarity:"epique", weight:5 },
    { kind:"coins", amount:1000, weight:3 },
    { kind:"gems", amount:50, weight:3 },
    { kind:"item", rarity:"ultra", weight:1 }
  ]);

  assert.deepEqual(rollRewardSpec("star", "blue", randomAt(0.00)), { kind:"coins", amount:200 });
  assert.deepEqual(rollRewardSpec("star", "blue", randomAt(0.10)), { kind:"coins", amount:500 });
  assert.deepEqual(rollRewardSpec("star", "blue", randomAt(0.15)), { kind:"gems", amount:25 });
  assert.deepEqual(rollRewardSpec("star", "blue", randomAt(0.20)), { kind:"gems", amount:10 });
  assert.deepEqual(rollRewardSpec("star", "blue", randomAt(0.30)), { kind:"coins", amount:100 });
  assert.deepEqual(rollRewardSpec("star", "blue", randomAt(0.45)), { kind:"gems", amount:5 });
  assert.deepEqual(rollRewardSpec("star", "blue", randomAt(0.60)), { kind:"item", rarity:"commun" });
  assert.deepEqual(rollRewardSpec("star", "blue", randomAt(0.78)), { kind:"item", rarity:"rare" });
  assert.deepEqual(rollRewardSpec("star", "blue", randomAt(0.88)), { kind:"item", rarity:"epique" });
  assert.deepEqual(rollRewardSpec("star", "blue", randomAt(0.93)), { kind:"coins", amount:1000 });
  assert.deepEqual(rollRewardSpec("star", "blue", randomAt(0.96)), { kind:"gems", amount:50 });
  assert.deepEqual(rollRewardSpec("star", "blue", randomAt(0.99)), { kind:"item", rarity:"ultra" });
});

test("coffre légendaire: probabilités et récompenses exactes", () => {
  const rows = publicConfig().dropTables.legendary;
  assert.deepEqual(rows, [
    { kind:"coins", amount:500, weight:20 },
    { kind:"coins", amount:1000, weight:15 },
    { kind:"gems", amount:50, weight:10 },
    { kind:"gems", amount:25, weight:15 },
    { kind:"item", rarity:"rare", weight:25 },
    { kind:"item", rarity:"epique", weight:10 },
    { kind:"item", rarity:"ultra", weight:5 }
  ]);

  assert.deepEqual(rollRewardSpec("legendary", "blue", randomAt(0.00)), { kind:"coins", amount:500 });
  assert.deepEqual(rollRewardSpec("legendary", "blue", randomAt(0.20)), { kind:"coins", amount:1000 });
  assert.deepEqual(rollRewardSpec("legendary", "blue", randomAt(0.35)), { kind:"gems", amount:50 });
  assert.deepEqual(rollRewardSpec("legendary", "blue", randomAt(0.45)), { kind:"gems", amount:25 });
  assert.deepEqual(rollRewardSpec("legendary", "blue", randomAt(0.60)), { kind:"item", rarity:"rare" });
  assert.deepEqual(rollRewardSpec("legendary", "blue", randomAt(0.85)), { kind:"item", rarity:"epique" });
  assert.deepEqual(rollRewardSpec("legendary", "blue", randomAt(0.95)), { kind:"item", rarity:"ultra" });
});

test("étoile: ouverture directe sans amélioration de rareté", () => {
  assert.deepEqual(rollStarTap("blue", () => 0.0), {
    opened:true, upgraded:false, state:"blue", previous:"blue"
  });
  assert.deepEqual(rollStarTap("violet", () => 0.999), {
    opened:true, upgraded:false, state:"blue", previous:"blue"
  });
});

test("compensations finales", () => {
  assert.deepEqual(DUPLICATE_COMPENSATION, {
    commun:50,
    rare:100,
    epique:250,
    ultra:500
  });
});

test("catalogue coffres: reprend la rareté admin et exclut toujours Exclusif", () => {
  const catalog = [
    { key:"frame:a", type:"frame", id:"a", label:"A", defaultOwned:false },
    { key:"frame:b", type:"frame", id:"b", label:"B", defaultOwned:false },
    { key:"frame:c", type:"frame", id:"c", label:"C", defaultOwned:false },
    { key:"frame:level", type:"frame", id:"level", label:"Level", defaultOwned:false, defaultRarity:"exclusif", levelOnly:true },
    { key:"avatar:base", type:"avatar", id:"base", label:"Base", defaultOwned:true }
  ];
  const rows = [
    { item_key:"frame:a", rarity:"rare" },
    { item_key:"frame:b", rarity:"exclusif" },
    { item_key:"frame:c", rarity:"ultra" }
  ];
  const result = buildChestCatalog(catalog, rows);
  assert.deepEqual(result.map(item => [item.key, item.rarity]), [
    ["frame:a", "rare"],
    ["frame:c", "ultra"]
  ]);
  assert.equal(result.some(item => item.rarity === "exclusif"), false);
  assert.equal(result.some(item => item.key === "frame:level"), false);
});
