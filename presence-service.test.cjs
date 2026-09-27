"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const presence = require("./presence-service.js");

test.beforeEach(() => presence.clear());

test("un utilisateur reste en ligne tant qu'il possède au moins un socket", () => {
  assert.equal(presence.add("u1", "s1"), true);
  assert.equal(presence.add("u1", "s2"), false);
  assert.equal(presence.isOnline("u1"), true);
  assert.deepEqual(new Set(presence.socketIds("u1")), new Set(["s1", "s2"]));

  assert.equal(presence.remove("u1", "s1"), false);
  assert.equal(presence.isOnline("u1"), true);

  assert.equal(presence.remove("u1", "s2"), true);
  assert.equal(presence.isOnline("u1"), false);
});

test("ajouter deux fois le même socket ne double pas la présence", () => {
  presence.add("u1", "s1");
  presence.add("u1", "s1");
  assert.deepEqual(presence.socketIds("u1"), ["s1"]);
});

test("emitToUser envoie l'événement à tous les sockets du joueur", () => {
  presence.add("u1", "s1");
  presence.add("u1", "s2");

  const emitted = [];
  const io = {
    to(socketId) {
      return {
        emit(event, payload) {
          emitted.push({ socketId, event, payload });
        }
      };
    }
  };

  const count = presence.emitToUser(io, "u1", "friends:changed", { ok:true });
  assert.equal(count, 2);
  assert.deepEqual(
    new Set(emitted.map(entry => entry.socketId)),
    new Set(["s1", "s2"])
  );
});
