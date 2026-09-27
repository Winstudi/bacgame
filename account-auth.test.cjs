"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const {
  normalizeEmail,
  validEmail,
  normalizeUsername,
  validatePassword,
  hashPassword,
  verifyPassword,
  newWalletToken,
  newSessionToken,
  hashSessionToken,
  validSessionToken,
  PROFILE_AVATARS
} = require("./account-auth.js");

const { EVENT_POLICIES } = require("./socket-security.js");

const {
  PLAYER_DATA_TABLES,
  normalizeResetSignal,
  resetMarkerKey
} = require("./player-data-reset.js");

test("normalisation du compte joueur", () => {
  assert.equal(normalizeEmail(" Test@Example.COM "), "test@example.com");
  assert.equal(validEmail("joueur@example.com"), true);
  assert.equal(validEmail("pas-un-email"), false);
  assert.equal(normalizeUsername("  Petit   Joueur  "), "Petit Joueur");
});

test("les mots de passe sont hashés avec sel et vérifiés sans stockage en clair", async () => {
  assert.match(validatePassword("court"), /8 caractères/);
  assert.equal(validatePassword("MotDePasseSolide123"), "");

  const result = await hashPassword("MotDePasseSolide123");
  assert.match(result.salt, /^[a-f0-9]{32}$/);
  assert.match(result.hash, /^[a-f0-9]{128}$/);
  assert.equal(await verifyPassword("MotDePasseSolide123", result.salt, result.hash), true);
  assert.equal(await verifyPassword("MauvaisMotDePasse", result.salt, result.hash), false);
});

test("les identifiants techniques ont le format attendu", () => {
  const wallet = newWalletToken();
  const session = newSessionToken();
  const sessionHash = hashSessionToken(session);

  assert.match(wallet, /^[a-f0-9]{48}$/);
  assert.equal(validSessionToken(session), true);
  assert.match(sessionHash, /^[a-f0-9]{64}$/);
  assert.notEqual(session, sessionHash);
});

test("le reset joueur est volontaire, versionné et couvre les données d'identité", () => {
  const signal = normalizeResetSignal("RESET_ACCOUNTS_V1");
  assert.equal(signal, "RESET_ACCOUNTS_V1");
  assert.equal(normalizeResetSignal("oui"), "");
  assert.equal(resetMarkerKey(signal), "player-data-reset:RESET_ACCOUNTS_V1");

  for (const table of [
    "users",
    "ptitbac_wallets",
    "ptitbac_progression",
    "ptitbac_inventory_items",
    "friendships",
    "ptitbac_messages",
    "ptitbac_auth_sessions",
    "ptitbac_accounts"
  ]) {
    assert.ok(PLAYER_DATA_TABLES.includes(table), `${table} doit être réinitialisée`);
  }

  assert.equal(
    PLAYER_DATA_TABLES.includes("ptitbac_learned_answers"),
    false,
    "la mémoire générale de validation ne doit pas être effacée avec les joueurs"
  );
});

test("les événements de compte sont limités par la sécurité Socket.IO", () => {
  assert.equal(EVENT_POLICIES["auth:register"]?.scope, "network");
  assert.equal(EVENT_POLICIES["auth:login"]?.scope, "network");
  assert.equal(EVENT_POLICIES["auth:resume"]?.scope, "socket");
  assert.equal(EVENT_POLICIES["auth:logout"]?.scope, "socket");
  assert.equal(EVENT_POLICIES["auth:completeProfile"]?.scope, "identity");
});

test("l’onboarding profil utilise le schéma central et équipe l’avatar atomiquement", () => {
  assert.deepEqual(PROFILE_AVATARS, [
    "/a1.webp",
    "/a2.webp",
    "/a3.webp",
    "/a4.webp",
    "/a5.webp"
  ]);

  const source = require("node:fs").readFileSync(
    require("node:path").join(__dirname, "account-auth.js"),
    "utf8"
  );

  assert.doesNotMatch(source, /CREATE TABLE IF NOT EXISTS public\.ptitbac_accounts/);
  assert.doesNotMatch(source, /CREATE TABLE IF NOT EXISTS public\.ptitbac_auth_sessions/);
  assert.match(source, /async function completeProfile/);
  assert.match(source, /INSERT INTO public\.ptitbac_inventory_equipped/);
  assert.match(source, /ON CONFLICT\(wallet_token\) DO UPDATE/);
  assert.match(source, /SET profile_completed=true/);
});
