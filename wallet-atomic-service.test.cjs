"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const {
  createWalletAtomicService,
  normalizeRequestKey
} = require("./wallet-atomic-service.js");

const token = "a".repeat(48);
const read = name => fs.readFileSync(path.join(__dirname, name), "utf8");

function fakeDatabase({ coins = 50, gems = 3, duplicate = null, failOnUpdate = false } = {}) {
  const state = {
    coins,
    gems,
    history:[],
    audit:duplicate ? new Map([[duplicate.key, duplicate.row]]) : new Map(),
    committed:false,
    rolledBack:false,
    released:false,
    calls:[]
  };

  const client = {
    async query(sql, params = []) {
      const text = String(sql).replace(/\s+/g, " ").trim();
      state.calls.push({ text, params });

      if (text === "BEGIN") return { rowCount:null, rows:[] };
      if (text === "COMMIT") { state.committed = true; return { rowCount:null, rows:[] }; }
      if (text === "ROLLBACK") { state.rolledBack = true; return { rowCount:null, rows:[] }; }

      if (text.includes("FROM public.ptitbac_wallets") && text.includes("FOR UPDATE")) {
        return { rowCount:1, rows:[{
          token,
          coins:state.coins,
          gems:state.gems,
          created_at:1,
          updated_at:1,
          history:state.history
        }] };
      }

      if (text.includes("FROM public.economy_transactions") && text.includes("idempotency_key")) {
        const row = state.audit.get(params[0]);
        return row ? { rowCount:1, rows:[row] } : { rowCount:0, rows:[] };
      }

      if (text.startsWith("UPDATE public.ptitbac_wallets")) {
        if (failOnUpdate) throw new Error("db write failed");
        if (text.includes("SET gems=$2")) state.gems = params[1];
        else state.coins = params[1];
        state.history = JSON.parse(params[3]);
        return { rowCount:1, rows:[{
          token,
          coins:state.coins,
          gems:state.gems,
          created_at:1,
          updated_at:params[2],
          history:state.history
        }] };
      }

      if (text.startsWith("INSERT INTO public.economy_transactions")) {
        const gemAudit = text.includes("gems_delta");
        const noChangeAudit = params.length === 5;
        const key = noChangeAudit ? params[4] : params[5];
        const row = {
          id:"tx-db",
          coins_delta:gemAudit ? 0 : (noChangeAudit ? 0 : params[2]),
          gems_delta:gemAudit ? (noChangeAudit ? 0 : params[2]) : 0,
          kind:params[1],
          created_at:new Date()
        };
        if (key) state.audit.set(key, row);
        return { rowCount:1, rows:[row] };
      }

      throw new Error(`SQL inattendu: ${text}`);
    },
    release() { state.released = true; }
  };

  return {
    state,
    client,
    pool:{ async connect() { return client; } }
  };
}

function serviceFor(db) {
  return createWalletAtomicService({
    getPool:() => db.pool,
    ensureSchema:async () => {}
  });
}

test("une dépense est verrouillée, auditée et commitée dans la même transaction", async () => {
  const db = fakeDatabase({ coins:50 });
  const result = await serviceFor(db).changeCoins({
    walletToken:token,
    delta:-20,
    kind:"LETTER_REROLL",
    details:{ roomCode:"ABC123", note:"Relance" },
    idempotencyKey:"request-1"
  });

  assert.equal(result.ok, true);
  assert.equal(result.before, 50);
  assert.equal(result.appliedDelta, -20);
  assert.equal(result.balance, 30);
  assert.equal(db.state.coins, 30);
  assert.equal(db.state.committed, true);
  assert.equal(db.state.rolledBack, false);
  assert.equal(db.state.released, true);
  assert.equal(db.state.history.at(-1).after, 30);
  assert.ok(db.state.calls.some(call => call.text.includes("FOR UPDATE")));
  assert.ok(db.state.calls.some(call => call.text.startsWith("INSERT INTO public.economy_transactions")));
});

test("un solde insuffisant est refusé et rollbacké", async () => {
  const db = fakeDatabase({ coins:10 });
  const result = await serviceFor(db).changeCoins({
    walletToken:token,
    delta:-20,
    kind:"CATEGORY_REROLL",
    idempotencyKey:"request-2"
  });

  assert.equal(result.ok, false);
  assert.equal(result.code, "insufficient");
  assert.equal(result.balance, 10);
  assert.equal(db.state.coins, 10);
  assert.equal(db.state.rolledBack, true);
  assert.equal(db.state.committed, false);
});

test("la même clé idempotente ne modifie jamais deux fois le portefeuille", async () => {
  const key = normalizeRequestKey(token, "same-request");
  const db = fakeDatabase({
    coins:30,
    duplicate:{
      key,
      row:{ id:"old", coins_delta:-20, kind:"LETTER_REROLL", created_at:new Date() }
    }
  });
  const result = await serviceFor(db).changeCoins({
    walletToken:token,
    delta:-20,
    kind:"LETTER_REROLL",
    idempotencyKey:"same-request"
  });

  assert.equal(result.ok, true);
  assert.equal(result.duplicate, true);
  assert.equal(result.balance, 30);
  assert.equal(db.state.coins, 30);
  assert.equal(db.state.committed, true);
  assert.equal(
    db.state.calls.some(call => call.text.startsWith("UPDATE public.ptitbac_wallets")),
    false
  );
});

test("setCoins définit le solde sous verrou et journalise uniquement le delta réel", async () => {
  const db = fakeDatabase({ coins:42 });
  const result = await serviceFor(db).setCoins({
    walletToken:token,
    balance:120,
    kind:"ADMIN_COIN_SET",
    idempotencyKey:"admin-set-1"
  });

  assert.equal(result.ok, true);
  assert.equal(result.before, 42);
  assert.equal(result.appliedDelta, 78);
  assert.equal(result.balance, 120);
  assert.equal(db.state.coins, 120);
  assert.equal(db.state.history.at(-1).delta, 78);
});

test("setCoins vers le même solde ne crée ni historique ni audit inutile", async () => {
  const db = fakeDatabase({ coins:50 });
  const result = await serviceFor(db).setCoins({
    walletToken:token,
    balance:50,
    kind:"ADMIN_COIN_SET"
  });

  assert.equal(result.ok, true);
  assert.equal(result.noChange, true);
  assert.equal(result.balance, 50);
  assert.equal(db.state.history.length, 0);
  assert.equal(
    db.state.calls.some(call => call.text.startsWith("INSERT INTO public.economy_transactions")),
    false
  );
});

test("une consigne SET sans changement reste idempotente après un changement futur", async () => {
  const db = fakeDatabase({ coins:50 });
  const service = serviceFor(db);
  const requestId = "admin-set-stable";

  const first = await service.setCoins({
    walletToken:token,
    balance:50,
    kind:"ADMIN_COIN_SET",
    idempotencyKey:requestId
  });
  assert.equal(first.ok, true);
  assert.equal(first.noChange, true);

  db.state.coins = 70;
  const retry = await service.setCoins({
    walletToken:token,
    balance:50,
    kind:"ADMIN_COIN_SET",
    idempotencyKey:requestId
  });

  assert.equal(retry.ok, true);
  assert.equal(retry.duplicate, true);
  assert.equal(retry.balance, 70);
  assert.equal(db.state.coins, 70);
});

test("changeCoinsWithClient participe à la transaction appelante sans la commit lui-même", async () => {
  const db = fakeDatabase({ coins:25 });
  const result = await serviceFor(db).changeCoinsWithClient(db.client, {
    walletToken:token,
    delta:10,
    kind:"INBOX_COIN_REWARD",
    idempotencyKey:"inbox:abc:coins"
  });

  assert.equal(result.ok, true);
  assert.equal(result.balance, 35);
  assert.equal(db.state.committed, false);
  assert.equal(db.state.rolledBack, false);
  assert.equal(db.state.released, false);
  assert.equal(db.state.calls.some(call => call.text === "BEGIN"), false);
  assert.equal(db.state.calls.some(call => call.text === "COMMIT"), false);
});

test("une erreur PostgreSQL annule une transaction possédée par le service", async () => {
  const db = fakeDatabase({ coins:50, failOnUpdate:true });
  await assert.rejects(
    serviceFor(db).changeCoins({
      walletToken:token,
      delta:-20,
      kind:"LETTER_REROLL",
      idempotencyKey:"request-fail"
    }),
    /db write failed/
  );
  assert.equal(db.state.rolledBack, true);
  assert.equal(db.state.committed, false);
  assert.equal(db.state.released, true);
});

test("la pub récompensée, l'admin et l'inbox sont branchés sur le service atomique", () => {
  const server = read("server.js");
  const admin = read("admin-hook.js");
  const adminClient = read("admin-v1.js");

  assert.match(server, /economy:rewardedAdDev[\s\S]{0,2400}changeWalletCoinsDurably/);
  assert.match(server, /idempotencyKey:`rewarded-ad:\$\{requestId\}`/);
  assert.doesNotMatch(server, /__ptbAdminSetCoins/);
  assert.match(server, /__ptbAdminSyncCoins/);
  assert.match(server, /INSERT INTO ptitbac_wallets[\s\S]{0,360}ON CONFLICT\(token\) DO NOTHING/);
  assert.doesNotMatch(server, /ON CONFLICT\(token\) DO UPDATE SET[\s\S]{0,180}coins=EXCLUDED\.coins/);

  assert.match(admin, /createWalletAtomicService/);
  assert.match(admin, /ADMIN_COIN_ADD/);
  assert.match(admin, /ADMIN_COIN_SET/);
  assert.match(admin, /changeCoinsWithClient[\s\S]{0,700}INBOX_COIN_REWARD/);
  assert.match(admin, /idempotencyKey:`inbox:\$\{message\.id\}:coins`/);
  assert.doesNotMatch(admin, /__ptbAdminSetCoins/);
  assert.match(adminClient, /requestId:mutationRequestId\("resource"\)/);
});


test("un ajout de gemmes est verrouillé, historisé et commité atomiquement", async () => {
  const db = fakeDatabase({ coins:40, gems:7 });
  const result = await serviceFor(db).changeGems({
    walletToken:token,
    delta:12,
    kind:"ADMIN_GEM_ADD",
    idempotencyKey:"gem-add-1"
  });

  assert.equal(result.ok, true);
  assert.equal(result.before, 7);
  assert.equal(result.appliedDelta, 12);
  assert.equal(result.gems, 19);
  assert.equal(result.balance, 40);
  assert.equal(db.state.gems, 19);
  assert.equal(db.state.committed, true);
  assert.equal(db.state.history.at(-1).resource, "gems");
  assert.equal(db.state.history.at(-1).after, 19);
});

test("une dépense de gemmes insuffisante est refusée sans modifier le solde", async () => {
  const db = fakeDatabase({ gems:4 });
  const result = await serviceFor(db).changeGems({
    walletToken:token,
    delta:-5,
    kind:"GEM_SPEND",
    idempotencyKey:"gem-spend-1"
  });

  assert.equal(result.ok, false);
  assert.equal(result.code, "insufficient");
  assert.equal(result.gems, 4);
  assert.equal(db.state.gems, 4);
  assert.equal(db.state.rolledBack, true);
});

test("setGems reste idempotent même si le solde change après la première requête", async () => {
  const db = fakeDatabase({ gems:15 });
  const service = serviceFor(db);
  const requestId = "admin-gem-set-stable";

  const first = await service.setGems({
    walletToken:token,
    balance:15,
    kind:"ADMIN_GEM_SET",
    idempotencyKey:requestId
  });
  assert.equal(first.ok, true);
  assert.equal(first.noChange, true);

  db.state.gems = 30;
  const retry = await service.setGems({
    walletToken:token,
    balance:15,
    kind:"ADMIN_GEM_SET",
    idempotencyKey:requestId
  });

  assert.equal(retry.ok, true);
  assert.equal(retry.duplicate, true);
  assert.equal(retry.gems, 30);
  assert.equal(db.state.gems, 30);
});

test("changeGemsWithClient reste dans la transaction de la boîte de réception", async () => {
  const db = fakeDatabase({ coins:25, gems:2 });
  const result = await serviceFor(db).changeGemsWithClient(db.client, {
    walletToken:token,
    delta:8,
    kind:"INBOX_GEM_REWARD",
    idempotencyKey:"inbox:abc:gems"
  });

  assert.equal(result.ok, true);
  assert.equal(result.gems, 10);
  assert.equal(result.balance, 25);
  assert.equal(db.state.committed, false);
  assert.equal(db.state.rolledBack, false);
  assert.equal(db.state.released, false);
  assert.equal(db.state.calls.some(call => call.text === "BEGIN"), false);
  assert.equal(db.state.calls.some(call => call.text === "COMMIT"), false);
});

test("admin et inbox n'écrivent plus directement le solde de gemmes", () => {
  const server = read("server.js");
  const admin = read("admin-hook.js");

  assert.match(admin, /ADMIN_GEM_ADD/);
  assert.match(admin, /ADMIN_GEM_SET/);
  assert.match(admin, /changeGemsWithClient[\s\S]{0,700}INBOX_GEM_REWARD/);
  assert.match(admin, /idempotencyKey:`inbox:\$\{message\.id\}:gems`/);
  assert.match(admin, /__ptbAdminSyncGems/);
  assert.doesNotMatch(admin, /gemOverrides/);
  assert.doesNotMatch(admin, /ON CONFLICT\(token\) DO UPDATE SET[\s\S]{0,160}gems=\$3/);
  assert.match(server, /__ptbAdminSyncGems/);
});

test("l'audit SQL possède une colonne gems_delta migrée de façon rétrocompatible", () => {
  const migrations = read("db-migrations.js");
  assert.match(
    migrations,
    /gems_delta integer NOT NULL DEFAULT 0/
  );
  assert.match(
    migrations,
    /ALTER TABLE public\.economy_transactions[\s\S]{0,140}ADD COLUMN IF NOT EXISTS gems_delta/
  );
});

test("les variations de gemmes écrivent leur delta dans economy_transactions", async () => {
  const db = fakeDatabase({ coins:40, gems:7 });
  const result = await serviceFor(db).changeGems({
    walletToken:token,
    delta:12,
    kind:"ADMIN_GEM_ADD",
    idempotencyKey:"gem-audit-1"
  });

  assert.equal(result.ok, true);
  assert.equal(result.transaction?.gems_delta, 12);
  assert.equal(result.transaction?.coins_delta, 0);
  assert.ok(
    db.state.calls.some(call =>
      call.text.startsWith("INSERT INTO public.economy_transactions") &&
      call.text.includes("gems_delta")
    )
  );
});


const postgresIntegrationOptions = process.env.PTITBAC_TEST_DATABASE_URL
  ? { timeout: 20_000 }
  : { skip: "PTITBAC_TEST_DATABASE_URL absente : intégration distante réservée à une base de test dédiée." };

test(
  "PostgreSQL réel: pièces, gemmes et idempotence sont vérifiés puis rollbackés sans laisser de données",
  postgresIntegrationOptions,
  async () => {
    const crypto = require("node:crypto");
    const { Pool } = require("pg");
    const databaseUrl = String(process.env.PTITBAC_TEST_DATABASE_URL || "").trim();
    const pool = new Pool({
      connectionString:databaseUrl,
      ssl:["localhost", "127.0.0.1", "[::1]"].includes(new URL(databaseUrl).hostname)
        ? false
        : { rejectUnauthorized:false },
      max:1,
      connectionTimeoutMillis:10_000
    });

    try {
      const client = await pool.connect();
      const walletToken = crypto.randomBytes(24).toString("hex");
      const now = Date.now();
      const coinRequestId = `integration-coin-${crypto.randomBytes(8).toString("hex")}`;
      const gemRequestId = `integration-gem-${crypto.randomBytes(8).toString("hex")}`;
      let transactionOpen = false;

      try {
        await client.query("BEGIN");
        transactionOpen = true;

        await client.query(
          `INSERT INTO public.ptitbac_wallets
            (token,coins,gems,created_at,updated_at,history)
           VALUES($1,100,7,$2,$2,'[]'::jsonb)`,
          [walletToken, now]
        );

        const service = createWalletAtomicService({
          getPool:() => pool,
          ensureSchema:async () => {}
        });

        const coinDebit = await service.changeCoinsWithClient(client, {
          walletToken,
          delta:-20,
          kind:"INTEGRATION_COIN_TEST",
          details:{ roomCode:"PGTEST", note:"Test PostgreSQL rollback" },
          idempotencyKey:coinRequestId
        });
        assert.equal(coinDebit.ok, true);
        assert.equal(coinDebit.balance, 80);
        assert.equal(coinDebit.appliedDelta, -20);

        const duplicateDebit = await service.changeCoinsWithClient(client, {
          walletToken,
          delta:-20,
          kind:"INTEGRATION_COIN_TEST",
          idempotencyKey:coinRequestId
        });
        assert.equal(duplicateDebit.ok, true);
        assert.equal(duplicateDebit.duplicate, true);
        assert.equal(duplicateDebit.balance, 80);

        const gemCredit = await service.changeGemsWithClient(client, {
          walletToken,
          delta:5,
          kind:"INTEGRATION_GEM_TEST",
          details:{ roomCode:"PGTEST", note:"Test PostgreSQL rollback" },
          idempotencyKey:gemRequestId
        });
        assert.equal(gemCredit.ok, true);
        assert.equal(gemCredit.gems, 12);
        assert.equal(gemCredit.appliedDelta, 5);

        const walletRow = await client.query(
          "SELECT coins,gems FROM public.ptitbac_wallets WHERE token=$1",
          [walletToken]
        );
        assert.equal(walletRow.rowCount, 1);
        assert.equal(Number(walletRow.rows[0].coins), 80);
        assert.equal(Number(walletRow.rows[0].gems), 12);

        const auditRows = await client.query(
          `SELECT kind,coins_delta,gems_delta,idempotency_key
             FROM public.economy_transactions
            WHERE wallet_token=$1
            ORDER BY created_at ASC`,
          [walletToken]
        );
        assert.equal(auditRows.rowCount, 2);
        // now() is constant inside a PostgreSQL transaction: identify rows by
        // their unique request key rather than relying on timestamp tie order.
        const byKey = new Map(auditRows.rows.map(row => [row.idempotency_key, row]));
        const coinRow = byKey.get(normalizeRequestKey(walletToken, coinRequestId));
        const gemRow = byKey.get(normalizeRequestKey(walletToken, gemRequestId));
        assert.ok(coinRow);
        assert.ok(gemRow);
        assert.equal(coinRow.kind, "INTEGRATION_COIN_TEST");
        assert.equal(Number(coinRow.coins_delta), -20);
        assert.equal(Number(coinRow.gems_delta), 0);
        assert.equal(gemRow.kind, "INTEGRATION_GEM_TEST");
        assert.equal(Number(gemRow.coins_delta), 0);
        assert.equal(Number(gemRow.gems_delta), 5);

        await client.query("ROLLBACK");
        transactionOpen = false;
      } finally {
        if (transactionOpen) {
          try { await client.query("ROLLBACK"); } catch {}
        }
        client.release();
      }

      const walletAfterRollback = await pool.query(
        "SELECT 1 FROM public.ptitbac_wallets WHERE token=$1",
        [walletToken]
      );
      const auditAfterRollback = await pool.query(
        "SELECT 1 FROM public.economy_transactions WHERE wallet_token=$1",
        [walletToken]
      );
      assert.equal(walletAfterRollback.rowCount, 0);
      assert.equal(auditAfterRollback.rowCount, 0);
    } finally {
      await pool.end();
    }
  }
);
