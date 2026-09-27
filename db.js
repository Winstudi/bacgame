"use strict";

const { runDatabaseMigrations } = require("./db-migrations.js");
const { createKeyedWriteQueue } = require("./db-wallet-write-queue.js");

const DATABASE_URL = String(process.env.DATABASE_URL || "").trim();
const POOL_MAX = Math.max(
  2,
  Math.min(20, Math.floor(Number(process.env.PTITBAC_DB_POOL_MAX) || 8))
);

let pool = null;
let migrationPromise = null;

function hasDatabase() {
  return Boolean(DATABASE_URL);
}

function walletTokenFromUpsert(args) {
  const config = args[0];
  const text = typeof config === "string"
    ? config
    : String(config?.text || "");
  const values = typeof config === "string"
    ? args[1]
    : config?.values;

  // Les appels avec callback conservent le comportement natif de pg.
  if (args.some((value, index) => index > 0 && typeof value === "function")) {
    return "";
  }

  if (
    !/^\s*INSERT\s+INTO\s+(?:public\.)?ptitbac_wallets\s*\(/i.test(text) ||
    !Array.isArray(values)
  ) {
    return "";
  }

  const token = String(values[0] || "").trim();
  return /^[a-f0-9]{48}$/i.test(token) ? token : "";
}

function installWalletWriteOrdering(shared) {
  const originalQuery = shared.query.bind(shared);
  const walletWrites = createKeyedWriteQueue();

  shared.query = function queryWithWalletOrdering(...args) {
    const walletToken = walletTokenFromUpsert(args);

    if (!walletToken) {
      return originalQuery(...args);
    }

    return walletWrites.enqueue(
      walletToken,
      () => originalQuery(...args)
    );
  };

  return shared;
}

function createPool() {
  if (!DATABASE_URL) return null;

  const { Pool } = require("pg");
  const databaseUrl = new URL(DATABASE_URL);
  const host = (databaseUrl.searchParams.get("host") || databaseUrl.hostname).toLowerCase();
  const local = ["localhost", "127.0.0.1", "[::1]", "::1"].includes(host);
  const ca = process.env.PTITBAC_DB_CA?.replace(/\\n/g, "\n");
  // Render's private Postgres endpoint uses a self-signed certificate.
  // Keep TLS required; limit this exception to Render's internal hostname.
  const renderInternal = process.env.RENDER === "true" && /^dpg-[a-z0-9-]+$/.test(host);
  const explicitCertificate = ["sslrootcert", "sslcert", "sslkey"].some(key => databaseUrl.searchParams.has(key));
  const strictMode = ["verify-ca", "verify-full"].includes(databaseUrl.searchParams.get("sslmode"));
  const internalTls = renderInternal && !ca && !explicitCertificate && !strictMode;
  // Recovery: restore the pre-cleanup TLS behaviour for Supabase shared poolers.
  // TLS stays required, but certificate verification needs PTITBAC_DB_CA.
  // Keep explicit certificate/strict-mode settings and all other hosts unchanged.
  const supabasePooler = /^aws-[0-9]+-[a-z0-9-]+\.pooler\.supabase\.com$/.test(host);
  const supabaseCompatibilityTls = supabasePooler && !ca && !explicitCertificate && !strictMode;
  if (internalTls || supabaseCompatibilityTls) {
    // pg URL SSL options otherwise overwrite the ssl object below.
    databaseUrl.searchParams.delete("ssl");
    databaseUrl.searchParams.delete("sslmode");
  }
  const shared = new Pool({
    connectionString: databaseUrl.toString(),
    ssl: local ? false : {
      rejectUnauthorized: !(internalTls || supabaseCompatibilityTls),
      ...(ca ? { ca } : {})
    },
    max: POOL_MAX,
    idleTimeoutMillis: 30000,
    connectionTimeoutMillis: 10000
  });

  /*
   * Plusieurs anciens modules installent encore leur propre gestionnaire
   * SIGTERM. Pendant E2, ils utilisent tous le même Pool : rendre end()
   * idempotent évite qu'une fermeture multiple provoque une erreur.
   */
  const originalEnd = shared.end.bind(shared);
  let endPromise = null;

  shared.end = function endSharedPool() {
    if (!endPromise) {
      endPromise = Promise.resolve().then(() => originalEnd());
    }
    return endPromise;
  };

  /*
   * server.js conserve encore le solde en mémoire avant de déclencher
   * l'UPSERT PostgreSQL. Deux sauvegardes rapprochées d'un même portefeuille
   * ne doivent donc jamais terminer dans l'ordre inverse.
   *
   * On sérialise uniquement les UPSERT de ptitbac_wallets :
   * toutes les autres requêtes du Pool gardent leur parallélisme normal.
   */
  installWalletWriteOrdering(shared);

  shared.on("error", error => {
    console.error(
      "PostgreSQL partagé - connexion inactive en erreur:",
      error?.message || error
    );
  });

  return shared;
}

function getPool() {
  if (!pool && DATABASE_URL) {
    pool = createPool();
  }
  return pool;
}

function ensureDatabaseSchema() {
  const db = getPool();
  if (!db) return Promise.reject(new Error("DATABASE_URL manquant"));
  if (migrationPromise) return migrationPromise;

  migrationPromise = (async () => {
    const client = await db.connect();
    try {
      await client.query("BEGIN");
      await client.query("SELECT pg_advisory_xact_lock(hashtext('ptitbac-schema'))");
      await runDatabaseMigrations(client);
      await client.query("COMMIT");
    } catch (error) {
      try { await client.query("ROLLBACK"); } catch {}
      throw error;
    } finally { client.release(); }
  })()
    .then(() => {
      console.log("PostgreSQL: schéma central prêt.");
      return db;
    })
    .catch(error => {
      migrationPromise = null;
      throw error;
    });

  return migrationPromise;
}

module.exports = {
  DATABASE_URL,
  POOL_MAX,
  hasDatabase,
  getPool,
  ensureDatabaseSchema
};
