"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const { runDatabaseMigrations } = require("./db-migrations.js");

function fakePool({ legacyCoins = false, legacyAdminItems = false } = {}) {
  const queries = [];
  return {
    queries,
    async query(sql) {
      const text = String(sql);
      queries.push(text);
      if (text.includes("information_schema.columns")) {
        return { rowCount: legacyCoins ? 1 : 0, rows: legacyCoins ? [{ exists:1 }] : [] };
      }
      if (text.includes("to_regclass('public.ptitbac_player_items')")) {
        return {
          rowCount: 1,
          rows: [{ table_name: legacyAdminItems ? "ptitbac_player_items" : null }]
        };
      }
      return { rowCount:0, rows:[] };
    }
  };
}

test("toutes les tables principales sont créées par le module central", async () => {
  const pool = fakePool();
  await runDatabaseMigrations(pool);
  const sql = pool.queries.join("\n");

  assert.match(sql, /CREATE TABLE IF NOT EXISTS public\.ptitbac_wallets/);
  assert.match(sql, /CREATE TABLE IF NOT EXISTS public\.users/);
  assert.match(sql, /CREATE TABLE IF NOT EXISTS public\.ptitbac_accounts/);
  assert.match(sql, /CREATE TABLE IF NOT EXISTS public\.ptitbac_auth_sessions/);
  assert.match(sql, /CREATE TABLE IF NOT EXISTS public\.friendships/);
  assert.match(sql, /CREATE TABLE IF NOT EXISTS public\.ptitbac_messages/);
  assert.match(sql, /CREATE TABLE IF NOT EXISTS public\.ptitbac_inventory_items/);
  assert.match(sql, /CREATE TABLE IF NOT EXISTS public\.ptitbac_item_catalog_settings/);
  assert.match(sql, /rarity IN \('commun','rare','epique','ultra','exclusif'\)/);
  assert.match(sql, /currency IN \('coins','gems'\)/);
  assert.match(sql, /CREATE TABLE IF NOT EXISTS public\.ptitbac_progression/);
  assert.match(sql, /profile_completed boolean NOT NULL DEFAULT false/);
  assert.match(sql, /ALTER COLUMN profile_completed SET DEFAULT false/);
  assert.match(sql, /ptitbac_accounts_email_idx/);
  assert.match(sql, /ptitbac_auth_sessions_account_idx/);
  assert.match(sql, /ptitbac_auth_sessions_token_idx/);
  assert.match(sql, /trophies integer NOT NULL DEFAULT 0/);
  assert.match(sql, /trophy_delta integer NOT NULL DEFAULT 0/);
  assert.match(sql, /ptitbac_assign_friend_code_5/);
});

test("l'ancien users.coins est copié uniquement vers un portefeuille absent puis supprimé", async () => {
  const pool = fakePool({ legacyCoins:true });
  await runDatabaseMigrations(pool);
  const sql = pool.queries.join("\n");

  assert.match(sql, /INSERT INTO public\.ptitbac_wallets\(token, coins, gems/);
  assert.match(sql, /ON CONFLICT\(token\) DO NOTHING/);
  assert.match(sql, /ALTER TABLE public\.users DROP COLUMN IF EXISTS coins/);
});

test("une base déjà migrée n'essaie plus de supprimer users.coins", async () => {
  const pool = fakePool({ legacyCoins:false });
  await runDatabaseMigrations(pool);
  const sql = pool.queries.join("\n");
  assert.doesNotMatch(sql, /DROP COLUMN IF EXISTS coins/);
});

test("l’ancien inventaire admin est migré si compatible puis supprimé", async () => {
  const pool = fakePool({ legacyAdminItems:true });
  await runDatabaseMigrations(pool);
  const sql = pool.queries.join("\n");

  assert.match(sql, /INSERT INTO public\.ptitbac_inventory_items\(wallet_token,item_type,item_id,source\)/);
  assert.match(sql, /DROP TABLE IF EXISTS public\.ptitbac_player_items/);
  assert.doesNotMatch(sql, /CREATE TABLE IF NOT EXISTS public\.ptitbac_player_items/);
});

test("la migration progression ne déclare pas deux fois event_key", () => {
  const source = require("node:fs").readFileSync(
    require("node:path").join(__dirname, "db-migrations.js"),
    "utf8"
  );
  const block = source.match(
    /CREATE TABLE IF NOT EXISTS public\.ptitbac_progression_events \(([\s\S]*?)\n\s*\)/
  )?.[1] || "";
  assert.equal((block.match(/event_key text PRIMARY KEY/g) || []).length, 1);
});


test("le service inventaire ne fait plus de migration destructive au démarrage", () => {
  const source = require("node:fs").readFileSync(
    require("node:path").join(__dirname, "inventory-service.js"),
    "utf8"
  );
  const block = source.match(
    /async function ensureSchema\(\) \{([\s\S]*?)\n  \}\n\n  async function ensureDefaults/
  )?.[1] || "";

  assert.match(block, /await ensureSharedSchema\(\)/);
  assert.match(block, /Migration PostgreSQL centrale indisponible/);
  assert.doesNotMatch(block, /db\.query\(/);
  assert.doesNotMatch(block, /DELETE FROM|ALTER TABLE|CREATE TABLE|DROP TABLE/);
});
