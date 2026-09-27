"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");

const {
  ADMIN_DEFAULT_POLICY,
  DEFAULT_ADMIN_ACCOUNT_EMAIL,
  EVENT_POLICIES,
  NON_ADMIN_PAYLOAD_LIMIT,
  createRateLimiter,
  installSocketSecurity
} = require("./socket-security.js");

function fakeIo() {
  return {
    connectionMiddleware: null,
    use(fn) {
      this.connectionMiddleware = fn;
    }
  };
}

function fakeSocket({
  id = "socket-1",
  address = "10.0.0.1",
  forwarded = "203.0.113.10"
} = {}) {
  return {
    id,
    data: {},
    handshake: {
      address,
      headers: {
        "x-forwarded-for": forwarded
      }
    },
    packetMiddleware: null,
    use(fn) {
      this.packetMiddleware = fn;
    }
  };
}

function authorizeAdmin(socket, token = "a".repeat(48)) {
  socket.data.accountEmail = DEFAULT_ADMIN_ACCOUNT_EMAIL;
  socket.data.isAccountAdmin = true;
  socket.data.accountWalletToken = token;
  return token;
}

function connect(io, socket) {
  let connected = false;
  io.connectionMiddleware(socket, () => {
    connected = true;
  });
  assert.equal(connected, true);
  assert.equal(typeof socket.packetMiddleware, "function");
}

function send(socket, event, payload = {}, callback = null) {
  let dispatched = false;
  let response = null;

  const packet = [event, payload];

  if (callback !== false) {
    packet.push(value => {
      response = value;
    });
  }

  socket.packetMiddleware(packet, () => {
    dispatched = true;
  });

  return {
    dispatched,
    response
  };
}

test("les événements admin sont refusés aux autres comptes", () => {
  const io = fakeIo();
  const socket = fakeSocket();
  socket.data.accountEmail = "autre@example.com";
  socket.data.accountWalletToken = "a".repeat(48);

  const security = installSocketSecurity(io);
  connect(io, socket);

  const status = send(socket, "admin:status", {
    walletToken: "a".repeat(48)
  });
  assert.equal(status.dispatched, false);
  assert.equal(status.response?.ok, true);
  assert.equal(status.response?.admin, false);

  const blocked = send(socket, "admin:playerLookup", {
    walletToken: "a".repeat(48),
    friendCode: "12345"
  });
  assert.equal(blocked.dispatched, false);
  assert.equal(blocked.response?.error, "Accès refusé.");

  security.stop();
});

test("admin:claim est limité après 5 tentatives pour le compte admin", () => {
  const io = fakeIo();
  const socket = fakeSocket();
  const token = authorizeAdmin(socket, "a".repeat(48));
  const security = installSocketSecurity(io);
  connect(io, socket);

  for (let index = 0; index < 5; index += 1) {
    assert.equal(
      send(socket, "admin:claim", {
        walletToken: token,
        code: "mauvais"
      }).dispatched,
      true
    );
  }

  const blocked = send(socket, "admin:claim", {
    walletToken: token,
    code: "encore"
  });

  assert.equal(blocked.dispatched, false);
  assert.equal(blocked.response?.rateLimited, true);

  security.stop();
});

test("chat:send protège contre le spam rapide", () => {
  const io = fakeIo();
  const socket = fakeSocket();
  const security = installSocketSecurity(io);
  connect(io, socket);

  const limit = EVENT_POLICIES["chat:send"].limit;

  for (let index = 0; index < limit; index += 1) {
    assert.equal(
      send(socket, "chat:send", {
        walletToken: "b".repeat(48),
        friendId: "ami",
        content: "bonjour"
      }).dispatched,
      true
    );
  }

  const blocked = send(socket, "chat:send", {
    walletToken: "b".repeat(48),
    friendId: "ami",
    content: "spam"
  });

  assert.equal(blocked.dispatched, false);
  assert.equal(blocked.response?.rateLimited, true);

  security.stop();
});

test("une connexion déjà liée ne peut pas changer de walletToken", () => {
  const io = fakeIo();
  const socket = fakeSocket();
  socket.data.walletToken = "c".repeat(48);

  const security = installSocketSecurity(io);
  connect(io, socket);

  const blocked = send(socket, "economy:get", {
    walletToken: "d".repeat(48)
  });

  assert.equal(blocked.dispatched, false);
  assert.equal(blocked.response?.error, "Session invalide.");

  const allowed = send(socket, "economy:get", {
    walletToken: "c".repeat(48)
  });

  assert.equal(allowed.dispatched, true);

  security.stop();
});

test("les payloads non-admin trop volumineux sont rejetés", () => {
  const io = fakeIo();
  const socket = fakeSocket();
  const security = installSocketSecurity(io);
  connect(io, socket);

  const blocked = send(socket, "chat:send", {
    walletToken: "e".repeat(48),
    content: "x".repeat(NON_ADMIN_PAYLOAD_LIMIT + 2048)
  });

  assert.equal(blocked.dispatched, false);
  assert.equal(blocked.response?.error, "Requête trop volumineuse.");

  security.stop();
});

test("le rate limiter remet le compteur à zéro après la fenêtre", () => {
  let clock = 1_000;
  const limiter = createRateLimiter({
    now: () => clock
  });

  const policy = {
    limit: 2,
    windowMs: 1_000
  };

  assert.equal(limiter.consume("x", policy).allowed, true);
  assert.equal(limiter.consume("x", policy).allowed, true);
  assert.equal(limiter.consume("x", policy).allowed, false);

  clock += 1_001;

  assert.equal(limiter.consume("x", policy).allowed, true);
});


test("les événements admin non listés ont aussi une limite par défaut", () => {
  const io = fakeIo();
  const socket = fakeSocket();
  const token = authorizeAdmin(socket, "f".repeat(48));
  const security = installSocketSecurity(io);
  connect(io, socket);

  const limit = ADMIN_DEFAULT_POLICY.limit;
  for (let index = 0; index < limit; index += 1) {
    assert.equal(
      send(socket, "admin:playerLookup", {
        walletToken:token,
        friendCode:"12345"
      }).dispatched,
      true
    );
  }

  const blocked = send(socket, "admin:playerLookup", {
    walletToken:token,
    friendCode:"12345"
  });

  assert.equal(blocked.dispatched, false);
  assert.equal(blocked.response?.rateLimited, true);
  security.stop();
});

test("la récompense pub de développement est limitée", () => {
  const io = fakeIo();
  const socket = fakeSocket();
  const security = installSocketSecurity(io);
  connect(io, socket);

  const limit = EVENT_POLICIES["economy:rewardedAdDev"].limit;
  for (let index = 0; index < limit; index += 1) {
    assert.equal(
      send(socket, "economy:rewardedAdDev", {
        walletToken:"1".repeat(48)
      }).dispatched,
      true
    );
  }

  const blocked = send(socket, "economy:rewardedAdDev", {
    walletToken:"1".repeat(48)
  });
  assert.equal(blocked.dispatched, false);
  assert.equal(blocked.response?.rateLimited, true);
  security.stop();
});
