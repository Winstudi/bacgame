"use strict";

const crypto = require("crypto");

const MAX_COINS = 999999;
const MAX_GEMS = 999999;
const WALLET_TOKEN_RE = /^[a-f0-9]{48}$/i;

function normalizeHistory(value) {
  if (Array.isArray(value)) return value.slice(-100);
  if (typeof value === "string") {
    try {
      const parsed = JSON.parse(value);
      return Array.isArray(parsed) ? parsed.slice(-100) : [];
    } catch {}
  }
  return [];
}

function normalizeDetails(details = {}) {
  return {
    roomCode: details?.roomCode ? String(details.roomCode).slice(0, 8) : "",
    note: details?.note ? String(details.note).slice(0, 100) : ""
  };
}

function normalizeRequestKey(walletToken, value) {
  const raw = String(value || "")
    .trim()
    .replace(/[^a-zA-Z0-9:_-]/g, "")
    .slice(0, 64);
  return raw ? `${walletToken}:${raw}`.slice(0, 120) : "";
}

function normalizeToken(value) {
  const token = String(value || "").trim();
  return WALLET_TOKEN_RE.test(token) ? token : "";
}

function clampCoins(value) {
  return Math.max(0, Math.min(MAX_COINS, Math.floor(Number(value) || 0)));
}

function clampGems(value) {
  return Math.max(0, Math.min(MAX_GEMS, Math.floor(Number(value) || 0)));
}

function createWalletAtomicService(options = {}) {
  const getPool = options.getPool;
  const ensureSchema = options.ensureSchema;

  async function database() {
    if (typeof ensureSchema === "function") await ensureSchema();
    const pool = typeof getPool === "function" ? getPool() : null;
    if (!pool?.connect) throw new Error("PostgreSQL indisponible.");
    return pool;
  }

  async function mutateCoinsWithClient(client, {
    walletToken,
    delta,
    targetBalance,
    kind = "COIN_CHANGE",
    details = {},
    idempotencyKey = ""
  } = {}) {
    const token = normalizeToken(walletToken);
    if (!token) {
      return { ok:false, code:"invalid_wallet", error:"Portefeuille invalide." };
    }
    if (!client?.query) throw new Error("Client PostgreSQL invalide.");

    const hasTarget = Number.isFinite(Number(targetBalance));
    const requestedDelta = Math.trunc(Number(delta) || 0);
    const target = hasTarget ? clampCoins(targetBalance) : null;
    const safeKind = String(kind || "COIN_CHANGE").slice(0, 40);
    const safeDetails = normalizeDetails(details);
    const requestKey = normalizeRequestKey(token, idempotencyKey);

    const locked = await client.query(
      `SELECT token,coins,gems,created_at,updated_at,history
         FROM public.ptitbac_wallets
        WHERE token=$1
        FOR UPDATE`,
      [token]
    );

    if (!locked.rowCount) {
      return { ok:false, code:"not_found", error:"Portefeuille introuvable." };
    }

    const row = locked.rows[0];
    const before = clampCoins(row.coins);
    const gems = Math.max(0, Math.floor(Number(row.gems) || 0));

    if (requestKey) {
      const duplicate = await client.query(
        `SELECT id,coins_delta,kind,created_at
           FROM public.economy_transactions
          WHERE idempotency_key=$1
          LIMIT 1`,
        [requestKey]
      );
      if (duplicate.rowCount) {
        return {
          ok:true,
          duplicate:true,
          noChange:true,
          before,
          appliedDelta:0,
          balance:before,
          gems,
          transaction:duplicate.rows[0]
        };
      }
    }

    if (!hasTarget && requestedDelta < 0 && before + requestedDelta < 0) {
      return {
        ok:false,
        code:"insufficient",
        error:"Solde de pièces insuffisant.",
        before,
        balance:before,
        gems
      };
    }

    const after = hasTarget
      ? target
      : clampCoins(before + requestedDelta);
    const appliedDelta = after - before;

    // Un SET vers la valeur déjà présente ne modifie pas le portefeuille.
    // Si la requête possède une clé idempotente, on l'enregistre tout de même :
    // un vieux retry ne pourra ainsi pas réappliquer cette consigne plus tard.
    if (appliedDelta === 0) {
      let transaction = null;

      if (requestKey) {
        const audit = await client.query(
          `INSERT INTO public.economy_transactions
            (user_id,wallet_token,kind,coins_delta,lives_delta,room_code,note,idempotency_key)
           VALUES(
             (SELECT id FROM public.users WHERE wallet_token=$1 LIMIT 1),
             $1,$2,0,0,$3,$4,$5
           )
           RETURNING id,coins_delta,kind,created_at`,
          [
            token,
            safeKind,
            safeDetails.roomCode || null,
            safeDetails.note || null,
            requestKey
          ]
        );
        transaction = audit.rows[0] || null;
      }

      return {
        ok:true,
        duplicate:false,
        noChange:true,
        before,
        appliedDelta:0,
        balance:before,
        gems,
        wallet:{
          coins:before,
          gems,
          createdAt:Number(row.created_at) || Date.now(),
          updatedAt:Number(row.updated_at) || Date.now(),
          history:normalizeHistory(row.history)
        },
        transaction
      };
    }

    const at = Date.now();
    const transaction = {
      id:crypto.randomBytes(8).toString("hex"),
      type:safeKind,
      delta:appliedDelta,
      before,
      after,
      at,
      roomCode:safeDetails.roomCode,
      note:safeDetails.note,
      idempotencyKey:requestKey
    };
    const history = [...normalizeHistory(row.history), transaction].slice(-100);

    const updated = await client.query(
      `UPDATE public.ptitbac_wallets
          SET coins=$2,
              updated_at=$3,
              history=$4::jsonb
        WHERE token=$1
        RETURNING token,coins,gems,created_at,updated_at,history`,
      [token, after, at, JSON.stringify(history)]
    );

    const audit = await client.query(
      `INSERT INTO public.economy_transactions
        (user_id,wallet_token,kind,coins_delta,lives_delta,room_code,note,idempotency_key)
       VALUES(
         (SELECT id FROM public.users WHERE wallet_token=$1 LIMIT 1),
         $1,$2,$3,0,$4,$5,$6
       )
       RETURNING id,coins_delta,kind,created_at`,
      [
        token,
        safeKind,
        appliedDelta,
        safeDetails.roomCode || null,
        safeDetails.note || null,
        requestKey || null
      ]
    );

    const wallet = updated.rows[0] || {};
    return {
      ok:true,
      duplicate:false,
      noChange:false,
      before,
      appliedDelta,
      balance:clampCoins(wallet.coins),
      gems:Math.max(0, Math.floor(Number(wallet.gems) || 0)),
      wallet:{
        coins:clampCoins(wallet.coins),
        gems:Math.max(0, Math.floor(Number(wallet.gems) || 0)),
        createdAt:Number(wallet.created_at) || at,
        updatedAt:Number(wallet.updated_at) || at,
        history:normalizeHistory(wallet.history)
      },
      transaction:audit.rows[0] || transaction
    };
  }

  async function mutateGemsWithClient(client, {
    walletToken,
    delta,
    targetBalance,
    kind = "GEM_CHANGE",
    details = {},
    idempotencyKey = ""
  } = {}) {
    const token = normalizeToken(walletToken);
    if (!token) {
      return { ok:false, code:"invalid_wallet", error:"Portefeuille invalide." };
    }
    if (!client?.query) throw new Error("Client PostgreSQL invalide.");

    const hasTarget = Number.isFinite(Number(targetBalance));
    const requestedDelta = Math.trunc(Number(delta) || 0);
    const target = hasTarget ? clampGems(targetBalance) : null;
    const safeKind = String(kind || "GEM_CHANGE").slice(0, 40);
    const safeDetails = normalizeDetails(details);
    const requestKey = normalizeRequestKey(token, idempotencyKey);

    const locked = await client.query(
      `SELECT token,coins,gems,created_at,updated_at,history
         FROM public.ptitbac_wallets
        WHERE token=$1
        FOR UPDATE`,
      [token]
    );

    if (!locked.rowCount) {
      return { ok:false, code:"not_found", error:"Portefeuille introuvable." };
    }

    const row = locked.rows[0];
    const coins = clampCoins(row.coins);
    const before = clampGems(row.gems);

    if (requestKey) {
      const duplicate = await client.query(
        `SELECT id,coins_delta,gems_delta,kind,created_at
           FROM public.economy_transactions
          WHERE idempotency_key=$1
          LIMIT 1`,
        [requestKey]
      );
      if (duplicate.rowCount) {
        return {
          ok:true,
          duplicate:true,
          noChange:true,
          before,
          appliedDelta:0,
          balance:coins,
          gems:before,
          transaction:duplicate.rows[0]
        };
      }
    }

    if (!hasTarget && requestedDelta < 0 && before + requestedDelta < 0) {
      return {
        ok:false,
        code:"insufficient",
        error:"Solde de gemmes insuffisant.",
        before,
        balance:coins,
        gems:before
      };
    }

    const after = hasTarget
      ? target
      : clampGems(before + requestedDelta);
    const appliedDelta = after - before;

    if (appliedDelta === 0) {
      let transaction = null;

      if (requestKey) {
        const audit = await client.query(
          `INSERT INTO public.economy_transactions
            (user_id,wallet_token,kind,coins_delta,gems_delta,lives_delta,room_code,note,idempotency_key)
           VALUES(
             (SELECT id FROM public.users WHERE wallet_token=$1 LIMIT 1),
             $1,$2,0,0,0,$3,$4,$5
           )
           RETURNING id,coins_delta,gems_delta,kind,created_at`,
          [
            token,
            safeKind,
            safeDetails.roomCode || null,
            safeDetails.note || null,
            requestKey
          ]
        );
        transaction = audit.rows[0] || null;
      }

      return {
        ok:true,
        duplicate:false,
        noChange:true,
        before,
        appliedDelta:0,
        balance:coins,
        gems:before,
        wallet:{
          coins,
          gems:before,
          createdAt:Number(row.created_at) || Date.now(),
          updatedAt:Number(row.updated_at) || Date.now(),
          history:normalizeHistory(row.history)
        },
        transaction
      };
    }

    const at = Date.now();
    const transaction = {
      id:crypto.randomBytes(8).toString("hex"),
      type:safeKind,
      resource:"gems",
      delta:appliedDelta,
      before,
      after,
      at,
      roomCode:safeDetails.roomCode,
      note:safeDetails.note,
      idempotencyKey:requestKey
    };
    const history = [...normalizeHistory(row.history), transaction].slice(-100);

    const updated = await client.query(
      `UPDATE public.ptitbac_wallets
          SET gems=$2,
              updated_at=$3,
              history=$4::jsonb
        WHERE token=$1
        RETURNING token,coins,gems,created_at,updated_at,history`,
      [token, after, at, JSON.stringify(history)]
    );

    const audit = await client.query(
      `INSERT INTO public.economy_transactions
        (user_id,wallet_token,kind,coins_delta,gems_delta,lives_delta,room_code,note,idempotency_key)
       VALUES(
         (SELECT id FROM public.users WHERE wallet_token=$1 LIMIT 1),
         $1,$2,0,$3,0,$4,$5,$6
       )
       RETURNING id,coins_delta,gems_delta,kind,created_at`,
      [
        token,
        safeKind,
        appliedDelta,
        safeDetails.roomCode || null,
        safeDetails.note || null,
        requestKey || null
      ]
    );

    const wallet = updated.rows[0] || {};
    return {
      ok:true,
      duplicate:false,
      noChange:false,
      before,
      appliedDelta,
      balance:clampCoins(wallet.coins),
      gems:clampGems(wallet.gems),
      wallet:{
        coins:clampCoins(wallet.coins),
        gems:clampGems(wallet.gems),
        createdAt:Number(wallet.created_at) || at,
        updatedAt:Number(wallet.updated_at) || at,
        history:normalizeHistory(wallet.history)
      },
      transaction:audit.rows[0] || transaction
    };
  }

  async function runOwnTransaction(input) {
    const pool = await database();
    const client = await pool.connect();
    let finished = false;

    try {
      await client.query("BEGIN");
      const result = await mutateCoinsWithClient(client, input);

      if (!result?.ok) {
        await client.query("ROLLBACK");
        finished = true;
        return result;
      }

      await client.query("COMMIT");
      finished = true;
      return result;
    } catch (error) {
      if (!finished) {
        try { await client.query("ROLLBACK"); } catch {}
      }
      throw error;
    } finally {
      client.release?.();
    }
  }

  async function changeCoins(input = {}) {
    return runOwnTransaction({ ...input, targetBalance:undefined });
  }

  async function setCoins({ balance, ...input } = {}) {
    return runOwnTransaction({ ...input, targetBalance:balance });
  }

  async function changeCoinsWithClient(client, input = {}) {
    return mutateCoinsWithClient(client, { ...input, targetBalance:undefined });
  }

  async function setCoinsWithClient(client, { balance, ...input } = {}) {
    return mutateCoinsWithClient(client, { ...input, targetBalance:balance });
  }

  async function changeGems(input = {}) {
    const pool = await database();
    const client = await pool.connect();
    let finished = false;

    try {
      await client.query("BEGIN");
      const result = await mutateGemsWithClient(client, { ...input, targetBalance:undefined });
      if (!result?.ok) {
        await client.query("ROLLBACK");
        finished = true;
        return result;
      }
      await client.query("COMMIT");
      finished = true;
      return result;
    } catch (error) {
      if (!finished) {
        try { await client.query("ROLLBACK"); } catch {}
      }
      throw error;
    } finally {
      client.release?.();
    }
  }

  async function setGems({ balance, ...input } = {}) {
    const pool = await database();
    const client = await pool.connect();
    let finished = false;

    try {
      await client.query("BEGIN");
      const result = await mutateGemsWithClient(client, { ...input, targetBalance:balance });
      if (!result?.ok) {
        await client.query("ROLLBACK");
        finished = true;
        return result;
      }
      await client.query("COMMIT");
      finished = true;
      return result;
    } catch (error) {
      if (!finished) {
        try { await client.query("ROLLBACK"); } catch {}
      }
      throw error;
    } finally {
      client.release?.();
    }
  }

  async function changeGemsWithClient(client, input = {}) {
    return mutateGemsWithClient(client, { ...input, targetBalance:undefined });
  }

  async function setGemsWithClient(client, { balance, ...input } = {}) {
    return mutateGemsWithClient(client, { ...input, targetBalance:balance });
  }

  return {
    changeCoins,
    setCoins,
    changeCoinsWithClient,
    setCoinsWithClient,
    changeGems,
    setGems,
    changeGemsWithClient,
    setGemsWithClient
  };
}

module.exports = {
  MAX_COINS,
  MAX_GEMS,
  normalizeRequestKey,
  createWalletAtomicService
};
