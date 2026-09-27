"use strict";

const VALID_ROOM_MODES = new Set(["private", "public", "quick"]);
const ECONOMY_ROOM_MODES = new Set(["public", "quick"]);

function normalizeRoomMode(value, fallback = "private") {
  const mode = String(value || "").trim().toLowerCase();
  return VALID_ROOM_MODES.has(mode) ? mode : fallback;
}

function isEconomyMode(mode) {
  return ECONOMY_ROOM_MODES.has(normalizeRoomMode(mode));
}

function isPublicRoomDiscoverable(room, now = Date.now()) {
  if (!room || normalizeRoomMode(room.mode) !== "public") return false;
  if (room.phase !== "lobby" || room.economyStartPending) return false;
  if (!Array.isArray(room.players)) return false;
  const humanCount = room.players.filter(player => !player?.isBot).length;
  if (humanCount < 1 || humanCount >= 6) return false;
  if (room.players.some(player => player?.isBot && player?.botKind !== "matchmaking")) return false;
  if (!room.players.some(player => player?.isHost && !player?.isBot && player?.connected)) return false;
  if (Number(room.ptbCountdownUntil || 0) > Number(now || Date.now())) return false;
  return true;
}

module.exports = {
  VALID_ROOM_MODES,
  ECONOMY_ROOM_MODES,
  normalizeRoomMode,
  isEconomyMode,
  isPublicRoomDiscoverable
};
