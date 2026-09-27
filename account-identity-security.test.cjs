"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const {
  knownSocketToken,
  installSocketSecurity
} = require("./socket-security.js");

function harness(socketData = {}) {
  let connectionMiddleware = null;
  const io = {
    use(fn) { connectionMiddleware = fn; }
  };

  const socket = {
    id:"socket-1",
    data:{ ...socketData },
    handshake:{ address:"127.0.0.1", headers:{} },
    use(fn) { this.packetMiddleware = fn; }
  };

  const installed = installSocketSecurity(io, {
    installAccountAuth:false,
    globalPolicy:{ limit:999, windowMs:60_000, scope:"socket", message:"limit" }
  });
  connectionMiddleware(socket, () => {});

  return { socket, installed };
}

function dispatchPacket(socket, event, payload) {
  return new Promise(resolve => {
    let dispatched = false;
    const packet = [event, payload, response => resolve({ dispatched, response, payload })];
    socket.packetMiddleware(packet, () => {
      dispatched = true;
      resolve({ dispatched, response:null, payload:packet[1] });
    });
  });
}

test("le wallet du compte authentifié prime sur les anciennes identités socket", () => {
  const account = "a".repeat(48);
  const stale = "b".repeat(48);
  assert.equal(
    knownSocketToken({ data:{ accountWalletToken:account, walletToken:stale } }),
    account
  );
});

test("un compte authentifié ne peut pas substituer son wallet", async () => {
  const account = "a".repeat(48);
  const foreign = "b".repeat(48);
  const { socket, installed } = harness({
    accountWalletToken:account,
    walletToken:foreign
  });

  const rejected = await dispatchPacket(socket, "room:create", { walletToken:foreign });
  assert.equal(rejected.dispatched, false);
  assert.equal(rejected.response?.ok, false);
  assert.match(rejected.response?.error || "", /Session invalide/);

  const accepted = await dispatchPacket(socket, "economy:get", {});
  assert.equal(accepted.dispatched, true);
  assert.equal(accepted.payload.walletToken, account);

  const walletInit = await dispatchPacket(socket, "wallet:init", { token:foreign });
  assert.equal(walletInit.dispatched, false);
  assert.equal(walletInit.response?.ok, false);

  installed.stop();
});
