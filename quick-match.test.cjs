const test = require("node:test");
const assert = require("node:assert/strict");
const installQuickMatch = require("./quick-match.js");

class FakeIO {
  constructor() {
    this.connectionHandler = null;
  }

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

  on(event, handler) {
    this.handlers.set(event, handler);
    return this;
  }

  emit(event, payload) {
    this.outbound.push({ event, payload });
    return true;
  }

  trigger(event, payload = {}, callback = () => {}) {
    const handler = this.handlers.get(event);
    assert.equal(typeof handler, "function", `Handler manquant: ${event}`);
    return handler(payload, callback);
  }

  last(event) {
    return [...this.outbound].reverse().find(item => item.event === event)?.payload;
  }
}

function token(char) {
  return String(char).repeat(48);
}

function setup({ startDelayMs = 5 } = {}) {
  const io = new FakeIO();
  const matches = [];
  let playerSeq = 0;

  const quick = installQuickMatch({
    io,
    startDelayMs,
    eligible: async (_socket, profile) => profile,
    admit: entry => {
      entry.playerId = `p${++playerSeq}`;
      entry.code = "ROOM01";
      return {
        ok: true,
        playerId: entry.playerId,
        code: entry.code,
        state: { mode: "quick", players: [] }
      };
    },
    leave: () => {},
    match: async selected => {
      matches.push(selected.map(entry => entry.playerId));
    }
  });

  return { io, quick, matches };
}

function join(io, id, walletToken) {
  const socket = new FakeSocket(id);
  io.connect(socket);

  return new Promise(resolve => {
    socket.trigger("quick:join", { walletToken }, result => {
      resolve({ socket, result });
    });
  });
}

function ready(socket, value = true) {
  return new Promise(resolve => {
    socket.trigger("quick:ready", { ready: value }, resolve);
  });
}

function wait(ms = 20) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

test("deux joueurs prêts lancent une seule partie rapide", async () => {
  const { io, quick, matches } = setup();

  try {
    const a = await join(io, "s1", token("a"));
    const b = await join(io, "s2", token("b"));

    assert.equal(a.result.ok, true);
    assert.equal(b.result.ok, true);

    await ready(a.socket, true);
    await ready(b.socket, true);
    await wait();

    assert.equal(matches.length, 1);
    assert.equal(matches[0].length, 2);
  } finally {
    quick.close();
  }
});

test("un joueur non prêt empêche le lancement", async () => {
  const { io, quick, matches } = setup();

  try {
    const a = await join(io, "s1", token("c"));
    await join(io, "s2", token("d"));

    await ready(a.socket, true);
    await wait();

    assert.equal(matches.length, 0);
  } finally {
    quick.close();
  }
});

test("annuler la recherche empêche le lancement du joueur", async () => {
  const { io, quick, matches } = setup();

  try {
    const a = await join(io, "s1", token("e"));
    const b = await join(io, "s2", token("f"));

    await ready(a.socket, true);
    await new Promise(resolve => {
      b.socket.trigger("quick:cancel", {}, result => {
        assert.equal(result.ok, true);
        resolve();
      });
    });

    await wait();
    assert.equal(matches.length, 0);
  } finally {
    quick.close();
  }
});

test("un même wallet ne peut pas rechercher sur deux connexions", async () => {
  const { io, quick } = setup();

  try {
    const shared = token("1");
    const first = await join(io, "s1", shared);
    const second = await join(io, "s2", shared);

    assert.equal(first.result.ok, true);
    assert.equal(second.result.ok, false);
    assert.match(second.result.error, /déjà une partie|déjà/i);
  } finally {
    quick.close();
  }
});

test("le matchmaking ne modifie jamais Map.prototype.get", async () => {
  const originalGet = Map.prototype.get;
  const { io, quick } = setup();

  try {
    const a = await join(io, "s1", token("2"));
    const b = await join(io, "s2", token("3"));

    await ready(a.socket, true);
    await ready(b.socket, true);
    await wait();

    assert.equal(Map.prototype.get, originalGet);
  } finally {
    quick.close();
  }
});

test("un groupe rapide ne dépasse pas six joueurs", async () => {
  const { io, quick } = setup();

  try {
    const sockets = [];

    for (let i = 0; i < 7; i++) {
      const char = (i + 4).toString(16);
      const joined = await join(io, `s${i + 1}`, token(char));
      sockets.push(joined.socket);
      assert.equal(joined.result.ok, true);
    }

    const seventhSnapshot = sockets[6].last("quick:queued");
    assert.equal(seventhSnapshot.count, 1);

    const firstSnapshot = sockets[0].last("quick:queued");
    assert.equal(firstSnapshot.count, 6);
  } finally {
    quick.close();
  }
});

test("une admission directe dans un salon public termine la recherche", async () => {
  const io = new FakeIO();
  const matches = [];

  const quick = installQuickMatch({
    io,
    startDelayMs: 5,
    eligible: async (_socket, profile) => profile,
    admit: entry => {
      entry.playerId = "public-player";
      entry.code = "PUB01";
      return {
        ok: true,
        completed: true,
        publicMatch: true,
        playerId: entry.playerId,
        code: entry.code,
        state: { mode: "public", players: [] }
      };
    },
    leave: () => {},
    match: async selected => {
      matches.push(selected);
    }
  });

  try {
    const joined = await join(io, "public-socket", token("9"));

    assert.equal(joined.result.ok, true);
    assert.equal(joined.result.queued, false);
    assert.equal(joined.result.matched, true);
    assert.equal(joined.socket.last("quick:matched")?.state?.mode, "public");

    const cancelResult = await new Promise(resolve => {
      joined.socket.trigger("quick:cancel", {}, resolve);
    });

    assert.equal(cancelResult.ok, true);
    assert.equal(matches.length, 0);
  } finally {
    quick.close();
  }
});

