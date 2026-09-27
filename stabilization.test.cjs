"use strict";
const test = require("node:test");
const assert = require("node:assert/strict");
const { createSessionAccess } = require("./session-access.js");
const { createKeyedWriteQueue } = require("./db-wallet-write-queue.js");
const { clientNetworkKey, identityKey, isAuthorizedAdminSocket } = require("./socket-security.js");

test("un jeton de portefeuille de compte ne suffit pas pour accéder au compte", async () => {
  const access = createSessionAccess({ getPool:() => ({ query:async () => ({ rows:[{ has_account:true }] }) }) });
  assert.equal(await access.authorize({ data:{} }, "shop:purchase", { walletToken:"a".repeat(48) }), false);
});

test("la session révoquée ou le compte banni sont refusés sans reconnexion", async () => {
  let rows = [{ user_id:"user", wallet_token:"a".repeat(48), is_admin:true }];
  const access = createSessionAccess({ getPool:() => ({ query:async () => ({ rows }) }) });
  const socket = { data:{} };
  assert.equal(await access.authenticate(socket, "b".repeat(64)), true);
  assert.equal(await access.authorize(socket, "shop:purchase", {}), true);
  rows = [];
  assert.equal(await access.authorize(socket, "shop:purchase", {}), false);
  rows = [{ user_id:"user", wallet_token:"a".repeat(48), admin_banned:true }];
  assert.equal(await access.authorize(socket, "room:create", {}), false);
});

test("déclarer l’adresse admin ne confère aucun rôle", () => {
  assert.equal(isAuthorizedAdminSocket({ data:{ accountEmail:"cantetkillian@gmail.com", accountWalletToken:"a".repeat(48) } }), false);
});

test("les en-têtes non fiables ne fragmentent pas la limite réseau", () => {
  const saved = process.env.PTITBAC_TRUST_PROXY_HOPS;
  delete process.env.PTITBAC_TRUST_PROXY_HOPS;
  try {
    const socket = forwarded => ({ handshake:{ address:"10.0.0.1", headers:{ "x-forwarded-for":forwarded } } });
    assert.equal(clientNetworkKey(socket("one")), clientNetworkKey(socket("two")));
    assert.equal(identityKey({ data:{ walletToken:"a".repeat(48) } }, { walletToken:"b".repeat(48) }), "a".repeat(48));
  } finally {
    if (saved === undefined) delete process.env.PTITBAC_TRUST_PROXY_HOPS;
    else process.env.PTITBAC_TRUST_PROXY_HOPS = saved;
  }
});

test("une suppression de salon attend les snapshots en vol et le flush attend tout", async () => {
  const queue = createKeyedWriteQueue();
  const writes = [];
  let release;
  const barrier = new Promise(resolve => { release = resolve; });
  queue.enqueue("ABCD", async () => { await barrier; writes.push("old"); });
  queue.enqueue("ABCD", () => writes.push("new"));
  queue.enqueue("ABCD", () => writes.push("delete"));
  let flushed = false;
  const flush = queue.drain().then(() => { flushed = true; });
  await Promise.resolve();
  assert.equal(flushed, false);
  release();
  await flush;
  assert.deepEqual(writes, ["old", "new", "delete"]);
});
