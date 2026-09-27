"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const { calculateRewards } = require("./game-economy.js");

function room(overrides = {}) {
  return {
    mode:"public",
    phase:"finished",
    rounds:1,
    roundIndex:0,
    players:[
      { id:"p1", score:12 },
      { id:"p2", score:8 },
      { id:"p3", score:5 }
    ],
    ...overrides
  };
}

test("une fin de partie ne distribue plus aucune pièce", () => {
  assert.deepEqual(calculateRewards(room()), { p1:0, p2:0, p3:0 });
});

test("Quick ne distribue plus de pièces non plus", () => {
  assert.deepEqual(calculateRewards(room({ mode:"quick" })), { p1:0, p2:0, p3:0 });
});

test("Privé reste sans gain de pièces", () => {
  assert.deepEqual(calculateRewards(room({ mode:"private" })), { p1:0, p2:0, p3:0 });
});
