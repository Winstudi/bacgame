"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const installQuickMatch = require("./quick-match-v2.js");

class FakeIO {
  constructor() { this.connectionHandler = null; }
  on(event, handler) {
    if (event === "connection") this.connectionHandler = handler;
    return this;
  }
  connect(socket) {
    assert.equal(typeof this.connectionHandler, "function");
    this.connectionHandler(socket);
  }
}

class FakeSocket {
  constructor(id) {
    this.id = id;
    this.connected = true;
    this.data = {};
    this.handlers = new Map();
    this.outbound = [];
  }
  on(event, handler) { this.handlers.set(event, handler); return this; }
  emit(event, payload) { this.outbound.push({ event, payload }); return true; }
  trigger(event, payload = {}, callback = () => {}) {
    const handler = this.handlers.get(event);
    assert.equal(typeof handler, "function", `Handler manquant: ${event}`);
    return handler(payload, callback);
  }
  last(event) {
    return [...this.outbound].reverse().find(item => item.event === event)?.payload;
  }
}

const token = char => String(char).repeat(48);
const wait = ms => new Promise(resolve => setTimeout(resolve, ms));

function createHarness({ startDelayMs = 8 } = {}) {
  const io = new FakeIO();
  const matches = [];
  let playerSeq = 0;
  let filler = 0;

  const quick = installQuickMatch({
    io,
    startDelayMs,
    eligible: async (_socket, profile) => profile,
    participantCount(entries) { return entries.length + filler; },
    hasReplaceableFiller() { return filler > 0; },
    admit(entry, peers) {
      if (peers.length > 0 && filler > 0) filler = 0;
      entry.playerId = `p${++playerSeq}`;
      entry.code = "ROOM01";
      return { ok:true, playerId:entry.playerId, code:entry.code };
    },
    leave() {},
    match: async selected => {
      matches.push(selected.map(entry => entry.playerId));
    }
  });

  async function join(id, char) {
    const socket = new FakeSocket(id);
    io.connect(socket);
    const result = await new Promise(resolve => {
      socket.trigger("quick:join", { walletToken:token(char) }, resolve);
    });
    return { socket, result };
  }

  async function ready(socket, value = true) {
    return new Promise(resolve => {
      socket.trigger("quick:ready", { ready:value }, resolve);
    });
  }

  return {
    quick,
    matches,
    join,
    ready,
    setFiller(value) { filler = value ? 1 : 0; },
    filler() { return filler; }
  };
}

test("un joueur prêt peut démarrer avec un filler", async () => {
  const h = createHarness();
  try {
    const a = await h.join("s1", "a");
    await h.ready(a.socket, true);
    await wait(15);
    assert.equal(h.matches.length, 0);

    h.setFiller(true);
    h.quick.refreshByCode("ROOM01");
    await wait(20);

    assert.equal(h.matches.length, 1);
    assert.deepEqual(h.matches[0], ["p1"]);
  } finally { h.quick.close(); }
});

test("un vrai joueur remplace le filler avant le départ", async () => {
  const h = createHarness({ startDelayMs:30 });
  try {
    const a = await h.join("s1", "b");
    await h.ready(a.socket, true);

    h.setFiller(true);
    h.quick.refreshByCode("ROOM01");
    await wait(5);

    const b = await h.join("s2", "c");
    assert.equal(b.result.ok, true);
    assert.equal(h.filler(), 0);

    await wait(40);
    assert.equal(h.matches.length, 0);

    await h.ready(b.socket, true);
    await wait(40);
    assert.equal(h.matches.length, 1);
    assert.equal(h.matches[0].length, 2);
  } finally { h.quick.close(); }
});

test("le snapshot compte le filler sans créer de fausse socket", async () => {
  const h = createHarness();
  try {
    const a = await h.join("s1", "d");
    h.setFiller(true);
    h.quick.refreshByCode("ROOM01");

    const snapshot = a.socket.last("quick:ready-state");
    assert.equal(snapshot.count, 2);
    assert.equal(snapshot.readyCount, 1);
    assert.equal(snapshot.players.length, 1);
  } finally { h.quick.close(); }
});
