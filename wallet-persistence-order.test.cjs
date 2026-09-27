"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const { createKeyedWriteQueue } = require("./db-wallet-write-queue.js");

const wait = ms => new Promise(resolve => setTimeout(resolve, ms));

test("les écritures d'un même portefeuille restent strictement ordonnées", async () => {
  const queue = createKeyedWriteQueue();
  const events = [];

  const first = queue.enqueue("wallet-a", async () => {
    events.push("a1:start");
    await wait(30);
    events.push("a1:end");
  });

  const second = queue.enqueue("wallet-a", async () => {
    events.push("a2:start");
    events.push("a2:end");
  });

  await Promise.all([first, second]);

  assert.deepEqual(events, [
    "a1:start",
    "a1:end",
    "a2:start",
    "a2:end"
  ]);
});

test("deux portefeuilles différents gardent leur parallélisme", async () => {
  const queue = createKeyedWriteQueue();
  const events = [];

  let releaseA;
  const gateA = new Promise(resolve => {
    releaseA = resolve;
  });

  const a = queue.enqueue("wallet-a", async () => {
    events.push("a:start");
    await gateA;
    events.push("a:end");
  });

  const b = queue.enqueue("wallet-b", async () => {
    events.push("b:start");
    events.push("b:end");
  });

  await wait(5);

  assert.deepEqual(events, [
    "a:start",
    "b:start",
    "b:end"
  ]);

  releaseA();
  await Promise.all([a, b]);

  assert.deepEqual(events, [
    "a:start",
    "b:start",
    "b:end",
    "a:end"
  ]);
});

test("une écriture en erreur ne bloque pas les suivantes du même portefeuille", async () => {
  const queue = createKeyedWriteQueue();
  const events = [];

  const first = queue.enqueue("wallet-a", async () => {
    events.push("first");
    throw new Error("db down");
  });

  const second = queue.enqueue("wallet-a", async () => {
    events.push("second");
    return "ok";
  });

  await assert.rejects(first, /db down/);
  assert.equal(await second, "ok");
  assert.deepEqual(events, ["first", "second"]);
});

test("db.js ne sérialise que les UPSERT du portefeuille principal", () => {
  const source = fs.readFileSync(
    path.join(__dirname, "db.js"),
    "utf8"
  );

  assert.equal(source.includes("ptitbac_wallets"), true);
  assert.match(source, /installWalletWriteOrdering\(shared\)/);
  assert.match(source, /walletWrites\.enqueue/);
});
