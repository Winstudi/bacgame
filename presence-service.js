"use strict";

/**
 * Présence temps réel partagée entre amis et chat.
 * Un même socket ajouté plusieurs fois reste compté une seule fois.
 */

const activeUsers = new Map(); // userId -> Set(socketId)

function add(userId, socketId) {
  const uid = String(userId || "").trim();
  const sid = String(socketId || "").trim();
  if (!uid || !sid) return false;

  if (!activeUsers.has(uid)) activeUsers.set(uid, new Set());
  const sockets = activeUsers.get(uid);
  const wasOnline = sockets.size > 0;
  sockets.add(sid);
  return !wasOnline;
}

function remove(userId, socketId) {
  const uid = String(userId || "").trim();
  const sid = String(socketId || "").trim();
  const sockets = activeUsers.get(uid);
  if (!sockets) return false;

  sockets.delete(sid);
  if (sockets.size) return false;
  activeUsers.delete(uid);
  return true;
}

function isOnline(userId) {
  return Boolean(activeUsers.get(String(userId || "").trim())?.size);
}

function socketIds(userId) {
  return [...(activeUsers.get(String(userId || "").trim()) || [])];
}

function emitToUser(io, userId, event, payload = {}) {
  const ids = socketIds(userId);
  for (const socketId of ids) io.to(socketId).emit(event, payload);
  return ids.length;
}

function clear() {
  activeUsers.clear();
}

module.exports = {
  add,
  remove,
  isOnline,
  socketIds,
  emitToUser,
  clear
};
