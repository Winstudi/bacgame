"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");

const {
  DEFAULT_COINS,
  MAX_LIVES,
  LIFE_RECHARGE_MS,
  REWARDED_AD_COINS,
  LETTER_REROLL_COST,
  CATEGORY_REROLL_COST,
  SHOP_OFFERS
} = require("./economy-config.js");

test("l’économie officielle est figée dans une seule configuration", () => {
  assert.equal(DEFAULT_COINS, 25);
  assert.equal(MAX_LIVES, 5);
  assert.equal(LIFE_RECHARGE_MS, 30 * 60 * 1000);
  assert.equal(REWARDED_AD_COINS, 10);
  assert.equal(LETTER_REROLL_COST, 20);
  assert.equal(CATEGORY_REROLL_COST, 20);
});

test("les offres boutique validées sont centralisées", () => {
  assert.deepEqual(SHOP_OFFERS.coins25, { coins:25, priceEur:0.99 });
  assert.deepEqual(SHOP_OFFERS.coins100, { coins:100, priceEur:2.99 });
  assert.equal(SHOP_OFFERS.noAdsLifetime.bonusCoins, 100);
  assert.equal(SHOP_OFFERS.coins250, undefined);
});
