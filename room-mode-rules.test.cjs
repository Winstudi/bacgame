const test = require("node:test");
const assert = require("node:assert/strict");

const {
  isEconomyMode,
  isPublicRoomDiscoverable
} = require("./room-mode-rules.js");

function room(overrides = {}) {
  return {
    mode: "public",
    phase: "lobby",
    economyStartPending: false,
    ptbCountdownUntil: 0,
    players: [
      { id:"host", isHost:true, isBot:false, connected:true, walletToken:"a", score:5 },
      { id:"guest", isHost:false, isBot:false, connected:true, walletToken:"b", score:3 }
    ],
    ...overrides
  };
}

test("seuls les modes public et quick activent l'économie", () => {
  assert.equal(isEconomyMode("private"), false);
  assert.equal(isEconomyMode("public"), true);
  assert.equal(isEconomyMode("quick"), true);
});

test("un salon public ouvert peut être découvert par la recherche rapide", () => {
  assert.equal(isPublicRoomDiscoverable(room(), Date.now()), true);
});

test("un filler matchmaking reste remplaçable par un vrai joueur", () => {
  assert.equal(isPublicRoomDiscoverable(room({
    players: [
      { id:"host", isHost:true, isBot:false, connected:true },
      { id:"filler", isHost:false, isBot:true, botKind:"matchmaking", connected:true }
    ]
  }), Date.now()), true);
});

test("un bot manuel/test rend toujours le salon public non découvrable", () => {
  assert.equal(isPublicRoomDiscoverable(room({
    players: [
      { id:"host", isHost:true, isBot:false, connected:true },
      { id:"bot", isHost:false, isBot:true, botKind:"test", connected:true }
    ]
  }), Date.now()), false);
});

test("un salon privé, plein de vrais joueurs ou en lancement n'est pas découvrable", () => {
  const now = Date.now();
  assert.equal(isPublicRoomDiscoverable(room({ mode:"private" }), now), false);
  assert.equal(isPublicRoomDiscoverable(room({
    players:Array.from({ length:6 }, (_, i) => ({
      id:String(i), isHost:i === 0, isBot:false, connected:true
    }))
  }), now), false);
  assert.equal(isPublicRoomDiscoverable(room({ ptbCountdownUntil:now + 10000 }), now), false);
});

test("cinq humains plus un filler restent découvrables", () => {
  const players = Array.from({ length:5 }, (_, i) => ({
    id:`h${i}`, isHost:i === 0, isBot:false, connected:true
  }));
  players.push({ id:"filler", isHost:false, isBot:true, botKind:"matchmaking", connected:true });
  assert.equal(isPublicRoomDiscoverable(room({ players }), Date.now()), true);
});
