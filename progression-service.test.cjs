"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const {
  xpForNextLevel,
  totalXpForLevel,
  progressionFromTotalXp,
  calculateRoomXp,
  rankingForPlayers,
  TROPHY_REWARDS,
  createProgressionService
} = require("./progression-service.js");

const token = suffix => (String(suffix).padStart(48, "a")).slice(-48);

function room(overrides = {}) {
  return {
    code:"ABCDE", mode:"quick", phase:"finished", rounds:1, roundIndex:0,
    entryDebited:true, gameSessionId:"session-1", paidPlayerIds:["p1","p2"],
    players:[
      { id:"p1", score:6, walletToken:token("1"), isBot:false },
      { id:"p2", score:4, walletToken:token("2"), isBot:false }
    ],
    ...overrides
  };
}

test("XP nécessaire augmente de 25 par niveau", () => {
  assert.equal(xpForNextLevel(1), 100);
  assert.equal(xpForNextLevel(2), 125);
  assert.equal(xpForNextLevel(10), 325);
  assert.equal(xpForNextLevel(49), 1300);
  assert.equal(xpForNextLevel(50), 0);
});

test("seuils cumulés et niveaux sont cohérents", () => {
  assert.equal(totalXpForLevel(1), 0);
  assert.equal(totalXpForLevel(2), 100);
  assert.equal(totalXpForLevel(3), 225);
  assert.equal(progressionFromTotalXp(99).level, 1);
  assert.equal(progressionFromTotalXp(100).level, 2);
  assert.equal(progressionFromTotalXp(224).level, 2);
  assert.equal(progressionFromTotalXp(225).level, 3);
});

test("une partie rapide gagnée avec 6 réponses valides rapporte 42 XP", () => {
  const xp = calculateRoomXp(room());
  assert.equal(xp.p1.xp, 42);
  assert.equal(xp.p1.rank, 1);
  assert.equal(xp.p1.validAnswers, 6);
  assert.equal(xp.p1.trophies, 10);
});

test("5 manches, 25 réponses valides et deuxième place rapportent 112 XP", () => {
  const xp = calculateRoomXp(room({
    rounds:5, roundIndex:4, paidPlayerIds:["p1","p2","p3"],
    players:[
      { id:"p1", score:30, walletToken:token("1"), isBot:false },
      { id:"p2", score:25, walletToken:token("2"), isBot:false },
      { id:"p3", score:20, walletToken:token("3"), isBot:false }
    ]
  }));
  assert.equal(xp.p2.xp, 112);
  assert.equal(xp.p2.trophies, 6);
});

test("les trophées suivent le classement 10 / 6 / 3 / 1", () => {
  assert.deepEqual({
    first:TROPHY_REWARDS[1], second:TROPHY_REWARDS[2],
    third:TROPHY_REWARDS[3], other:TROPHY_REWARDS.default
  }, { first:10, second:6, third:3, other:1 });
});

test("le salon privé ne donne jamais d'XP", () => {
  const xp = calculateRoomXp(room({ mode:"private" }));
  assert.equal(xp.p1.xp, 0);
  assert.equal(xp.p2.xp, 0);
});

test("un humain contre un bot matchmaking garde seulement le XP de jeu", () => {
  const xp = calculateRoomXp(room({
    paidPlayerIds:["p1"],
    players:[
      { id:"p1", score:6, validAnswerCount:6, walletToken:token("1"), isBot:false },
      { id:"bot", score:8, walletToken:null, isBot:true, botKind:"matchmaking" }
    ]
  }));
  assert.equal(xp.p1.xp, 22);
  assert.equal(xp.p1.rank, 0);
  assert.equal(xp.p1.trophies, 0);
  assert.equal(xp.p1.eligible, true);
});

test("un bot de test classique ne débloque pas la progression solo", () => {
  const xp = calculateRoomXp(room({
    paidPlayerIds:["p1"],
    players:[
      { id:"p1", score:6, walletToken:token("1"), isBot:false },
      { id:"bot", score:3, walletToken:null, isBot:true, botKind:"test" }
    ]
  }));
  assert.equal(xp.p1.xp, 0);
});

test("un vrai joueur complètement seul ne donne jamais d'XP", () => {
  const xp = calculateRoomXp(room({
    paidPlayerIds:["p1"],
    players:[{ id:"p1", score:6, walletToken:token("1"), isBot:false }]
  }));
  assert.equal(xp.p1.xp, 0);
});

test("avec plusieurs humains le bot compte dans le classement mais ne reçoit rien", () => {
  const xp = calculateRoomXp(room({
    paidPlayerIds:["p1","p2"],
    players:[
      { id:"bot", score:9, walletToken:null, isBot:true, botKind:"matchmaking" },
      { id:"p1", score:6, validAnswerCount:6, walletToken:token("1"), isBot:false },
      { id:"p2", score:4, validAnswerCount:4, walletToken:token("2"), isBot:false }
    ]
  }));
  assert.equal(xp.p1.rank, 2);
  assert.equal(xp.p1.trophies, 6);
  assert.equal(xp.p1.xp, 34);
  assert.equal(xp.p2.rank, 3);
  assert.equal(xp.p2.trophies, 3);
  assert.equal(xp.bot.xp, 0);
  assert.equal(xp.bot.eligible, false);
});

test("les égalités humaines utilisent toujours un classement de compétition", () => {
  const ranks = rankingForPlayers([
    { id:"a", score:10, walletToken:token("1") },
    { id:"b", score:10, walletToken:token("2") },
    { id:"c", score:8, walletToken:token("3") }
  ]);
  assert.deepEqual(ranks, { a:1, b:1, c:3 });
});

test("un salon privé ne touche pas PostgreSQL pour distribuer l’XP", async () => {
  let poolTouched = false;
  const service = createProgressionService({ getPool() { poolTouched = true; return null; } });
  const result = await service.awardRoom(room({ mode:"private" }));
  assert.deepEqual(result, {});
  assert.equal(poolTouched, false);
});
