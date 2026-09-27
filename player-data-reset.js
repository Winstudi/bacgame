"use strict";

const RESET_ENV = "PTITBAC_RESET_PLAYER_DATA";
const RESET_SIGNAL_PATTERN = /^RESET_ACCOUNTS_[A-Z0-9_-]{1,48}$/;

const PLAYER_DATA_TABLES = Object.freeze([
  "ptitbac_auth_sessions",
  "ptitbac_accounts",
  "ptitbac_inbox_receipts",
  "ptitbac_inbox_messages",
  "ptitbac_player_warnings",
  "ptitbac_admin_logs",
  "ptitbac_feedback_reports",
  "ptitbac_admin_settings",
  "ptitbac_admin_owner",
  "ptitbac_player_reports",
  "ptitbac_chat_reports",
  "ptitbac_chat_hidden",
  "ptitbac_messages",
  "friendships",
  "friend_requests",
  "ptitbac_progression_events",
  "ptitbac_progression",
  "ptitbac_inventory_equipped",
  "ptitbac_inventory_items",
  "economy_transactions",
  "ptitbac_answer_reports",
  "users",
  "ptitbac_wallets"
]);

function normalizeResetSignal(value) {
  const signal = String(value || "").trim().toUpperCase();
  return RESET_SIGNAL_PATTERN.test(signal) ? signal : "";
}

function resetMarkerKey(signal) {
  return `player-data-reset:${normalizeResetSignal(signal)}`;
}

function quotedIdentifier(value) {
  return `"${String(value).replace(/"/g, '""')}"`;
}

async function maybeRunPlayerDataReset(pool, options = {}) {
  if (!pool) return { ran:false, reason:"no_database" };

  const signal = normalizeResetSignal(
    options.signal ?? process.env[RESET_ENV]
  );
  if (!signal) return { ran:false, reason:"disabled" };

  await pool.query(`
    CREATE TABLE IF NOT EXISTS public.ptitbac_system_flags (
      key text PRIMARY KEY,
      value text,
      created_at timestamptz NOT NULL DEFAULT now()
    )
  `);

  const marker = resetMarkerKey(signal);
  const client = await pool.connect();

  try {
    await client.query("BEGIN");
    await client.query("SELECT pg_advisory_xact_lock(hashtext('ptitbac-player-data-reset'))");

    const done = await client.query(
      "SELECT 1 FROM public.ptitbac_system_flags WHERE key=$1 LIMIT 1",
      [marker]
    );
    if (done.rowCount) {
      await client.query("ROLLBACK");
      return { ran:false, reason:"already_done", signal };
    }

    const existingTables = [];
    for (const table of PLAYER_DATA_TABLES) {
      const found = await client.query(
        "SELECT to_regclass($1) AS name",
        [`public.${table}`]
      );
      if (found.rows?.[0]?.name) existingTables.push(table);
    }

    for (const table of existingTables) {
      await client.query(
        `TRUNCATE TABLE public.${quotedIdentifier(table)} RESTART IDENTITY CASCADE`
      );
    }

    await client.query(
      `INSERT INTO public.ptitbac_system_flags(key,value)
       VALUES($1,$2)`,
      [marker, `reset ${existingTables.length} tables`]
    );

    await client.query("COMMIT");
    console.warn(
      `[P'tit Bac] Reset joueur ${signal} terminé (${existingTables.length} tables).`
    );
    return { ran:true, signal, tables:existingTables };
  } catch (error) {
    try { await client.query("ROLLBACK"); } catch {}
    throw error;
  } finally {
    client.release();
  }
}

module.exports = {
  RESET_ENV,
  PLAYER_DATA_TABLES,
  normalizeResetSignal,
  resetMarkerKey,
  maybeRunPlayerDataReset
};
