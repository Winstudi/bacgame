"use strict";

const MATCHMAKING_BOT_KIND = "matchmaking";

const PUBLIC_BOT_NAMES = Object.freeze([
  "Léa","Lucas","Emma","Hugo","Inès","Noah","Lina","Tom","Jade","Louis",
  "Mila","Adam","Zoé","Nolan","Lou","Ethan","Nina","Sacha","Aya","Maël",
  "Louna","Mathis","Chloé","Enzo","Léna","Gabriel","Maya","Nathan","Eva","Théo",
  "Sarah","Axel","Romane","Maxime","Clara","Arthur","Manon","Léo","Yasmine","Tiago"
]);

const PUBLIC_BOT_AVATARS = Object.freeze([
  "/a1.webp",
  "/a2.webp",
  "/a3.webp",
  "/a4.webp",
  "/a5.webp"
]);

const DIFFICULTIES = Object.freeze({
  weak: Object.freeze({
    id: "weak",
    label: "faible",
    weight: 0.28,
    missMultiplier: 2.0,
    riskMultiplier: 1.25,
    paceMultiplier: 1.12
  }),
  normal: Object.freeze({
    id: "normal",
    label: "normal",
    weight: 0.52,
    missMultiplier: 1.0,
    riskMultiplier: 1.0,
    paceMultiplier: 1.0
  }),
  strong: Object.freeze({
    id: "strong",
    label: "fort",
    weight: 0.20,
    missMultiplier: 0.48,
    riskMultiplier: 0.72,
    paceMultiplier: 0.92
  })
});

function clampInteger(value, min, max, fallback) {
  const parsed = Math.floor(Number(value));
  if (!Number.isFinite(parsed)) return fallback;
  return Math.max(min, Math.min(max, parsed));
}

function normalizeIdentity(value) {
  return String(value || "")
    .trim()
    .toLocaleLowerCase("fr")
    .normalize("NFD")
    .replace(/\p{Diacritic}/gu, "");
}

function randomIndex(length, random = Math.random) {
  if (!length) return -1;
  const value = Math.max(0, Math.min(0.999999999, Number(random()) || 0));
  return Math.floor(value * length);
}

function pickDifficulty(random = Math.random) {
  const roll = Math.max(0, Math.min(0.999999999, Number(random()) || 0));
  let cursor = 0;
  for (const difficulty of Object.values(DIFFICULTIES)) {
    cursor += difficulty.weight;
    if (roll < cursor) return difficulty.id;
  }
  return "normal";
}

function difficultyProfile(value) {
  return DIFFICULTIES[value] || DIFFICULTIES.normal;
}

function applyDifficulty(persona = {}, difficultyId = "normal") {
  const difficulty = difficultyProfile(difficultyId);
  return {
    ...persona,
    difficulty: difficulty.id,
    difficultyLabel: difficulty.label,
    missRate: Math.max(
      0,
      Math.min(0.55, Number(persona.missRate || 0) * difficulty.missMultiplier)
    ),
    riskyRate: Math.max(
      0,
      Math.min(0.30, Number(persona.riskyRate || 0) * difficulty.riskMultiplier)
    ),
    pace: Math.max(
      0.65,
      Math.min(1.55, Number(persona.pace || 1) * difficulty.paceMultiplier)
    )
  };
}

function pickIdentity(players = [], random = Math.random) {
  const usedNames = new Set(
    players.map(player => normalizeIdentity(player?.name)).filter(Boolean)
  );
  const usedAvatars = new Set(
    players.map(player => String(player?.avatar || "")).filter(Boolean)
  );

  const names = PUBLIC_BOT_NAMES.filter(
    name => !usedNames.has(normalizeIdentity(name))
  );
  const avatars = PUBLIC_BOT_AVATARS.filter(
    avatar => !usedAvatars.has(avatar)
  );

  const namePool = names.length ? names : PUBLIC_BOT_NAMES;
  const avatarPool = avatars.length ? avatars : PUBLIC_BOT_AVATARS;

  return {
    name: namePool[randomIndex(namePool.length, random)] || "Joueur",
    avatar: avatarPool[randomIndex(avatarPool.length, random)] || "/a1.webp"
  };
}

function isMatchmakingBot(player) {
  return !!player?.isBot && player?.botKind === MATCHMAKING_BOT_KIND;
}

function connectedHumanCount(room) {
  return (room?.players || []).filter(
    player => !player?.isBot && player?.connected !== false
  ).length;
}

function matchmakingBotCount(room) {
  return (room?.players || []).filter(isMatchmakingBot).length;
}

function shouldFillRoom(room, maxPlayers = 6) {
  if (!room || !["quick", "public"].includes(String(room.mode || ""))) return false;
  if (room.phase !== "lobby" || room.economyStartPending) return false;
  if (!Array.isArray(room.players) || room.players.length >= maxPlayers) return false;
  if (connectedHumanCount(room) < 1) return false;
  if (connectedHumanCount(room) >= 2) return false;
  if (matchmakingBotCount(room) >= 1) return false;
  return true;
}

module.exports = Object.freeze({
  MATCHMAKING_BOT_KIND,
  PUBLIC_BOT_NAMES,
  PUBLIC_BOT_AVATARS,
  DIFFICULTIES,
  clampInteger,
  normalizeIdentity,
  pickDifficulty,
  difficultyProfile,
  applyDifficulty,
  pickIdentity,
  isMatchmakingBot,
  connectedHumanCount,
  matchmakingBotCount,
  shouldFillRoom
});
