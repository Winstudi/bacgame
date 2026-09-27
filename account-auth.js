"use strict";

const crypto = require("crypto");
const { promisify } = require("util");
const { DEFAULT_COINS } = require("./economy-config.js");

const scryptAsync = promisify(crypto.scrypt);
const SESSION_TTL_MS = 30 * 24 * 60 * 60 * 1000;
const PASSWORD_MIN_LENGTH = 8;
const PASSWORD_MAX_LENGTH = 128;
const USERNAME_MAX_LENGTH = 24;
const PROFILE_USERNAME_MAX_LENGTH = 16;
const PROFILE_AVATARS = Object.freeze([
  "/a1.webp",
  "/a2.webp",
  "/a3.webp",
  "/a4.webp",
  "/a5.webp"
]);

let sharedSchemaPromise = null;

function normalizeEmail(value) {
  return String(value || "").trim().toLowerCase().slice(0, 254);
}

function validEmail(value) {
  const email = normalizeEmail(value);
  return /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/i.test(email);
}

function normalizeUsername(value) {
  return String(value || "").trim().replace(/\s+/g, " ").slice(0, USERNAME_MAX_LENGTH);
}

function validatePassword(value) {
  const password = String(value || "");
  if (password.length < PASSWORD_MIN_LENGTH) {
    return `Le mot de passe doit contenir au moins ${PASSWORD_MIN_LENGTH} caractères.`;
  }
  if (password.length > PASSWORD_MAX_LENGTH) {
    return `Le mot de passe ne peut pas dépasser ${PASSWORD_MAX_LENGTH} caractères.`;
  }
  return "";
}

async function hashPassword(password, saltHex = "") {
  const error = validatePassword(password);
  if (error) throw new Error(error);

  const salt = saltHex || crypto.randomBytes(16).toString("hex");
  const derived = await scryptAsync(String(password), Buffer.from(salt, "hex"), 64);

  return {
    salt,
    hash: Buffer.from(derived).toString("hex"),
    version: 1
  };
}

async function verifyPassword(password, saltHex, expectedHashHex) {
  try {
    const derived = await scryptAsync(
      String(password || ""),
      Buffer.from(String(saltHex || ""), "hex"),
      64
    );
    const actual = Buffer.from(derived);
    const expected = Buffer.from(String(expectedHashHex || ""), "hex");
    return actual.length === expected.length && crypto.timingSafeEqual(actual, expected);
  } catch {
    return false;
  }
}

function newWalletToken() {
  return crypto.randomBytes(24).toString("hex");
}

function newSessionToken() {
  return crypto.randomBytes(32).toString("hex");
}

function hashSessionToken(token) {
  return crypto.createHash("sha256").update(String(token || ""), "utf8").digest("hex");
}

function validSessionToken(token) {
  return /^[a-f0-9]{64}$/i.test(String(token || "").trim());
}

async function ensureAuthSchema(pool, ensureSharedSchema) {
  if (sharedSchemaPromise) return sharedSchemaPromise;

  sharedSchemaPromise = (async () => {
    if (typeof ensureSharedSchema !== "function") {
      throw new Error("Migration PostgreSQL centrale indisponible.");
    }
    await ensureSharedSchema();
    return pool;
  })().catch(error => {
    sharedSchemaPromise = null;
    throw error;
  });

  return sharedSchemaPromise;
}

function accountPayload(row, sessionToken = "") {
  return {
    userId: String(row.user_id || row.userId || ""),
    email: String(row.email_display || row.email || ""),
    username: String(row.username || "Joueur"),
    avatar: String(row.avatar || "/a1.webp"),
    friendCode: String(row.friend_code || row.friendCode || ""),
    walletToken: String(row.wallet_token || row.walletToken || ""),
    balance: Math.max(0, Number(row.coins ?? DEFAULT_COINS) || 0),
    gems: Math.max(0, Number(row.gems || 0) || 0),
    profileCompleted: Boolean(row.profile_completed ?? row.profileCompleted),
    sessionToken
  };
}

function createAccountAuthService(options = {}) {
  const shared = options.db || require("./db.js");
  const getPool = options.getPool || shared.getPool;
  const ensureSharedSchema = options.ensureDatabaseSchema || shared.ensureDatabaseSchema;
  const sessionTtlMs = Math.max(60_000, Number(options.sessionTtlMs) || SESSION_TTL_MS);

  function pool() {
    const value = getPool?.();
    if (!value) throw new Error("Base de données indisponible.");
    return value;
  }

  async function schema() {
    const db = pool();
    await ensureAuthSchema(db, ensureSharedSchema);
    return db;
  }

  async function createSession(client, accountId) {
    const raw = newSessionToken();
    const tokenHash = hashSessionToken(raw);
    const expiresAt = new Date(Date.now() + sessionTtlMs);

    await client.query(
      `INSERT INTO public.ptitbac_auth_sessions(account_id,token_hash,expires_at)
       VALUES($1,$2,$3)`,
      [accountId, tokenHash, expiresAt]
    );

    return { raw, expiresAt };
  }

  async function cleanupSessions(db, accountId = null) {
    await db.query(
      `DELETE FROM public.ptitbac_auth_sessions
        WHERE expires_at <= now()
           OR (revoked_at IS NOT NULL AND revoked_at < now() - interval '7 days')`
    );

    if (accountId) {
      await db.query(
        `DELETE FROM public.ptitbac_auth_sessions
          WHERE id IN (
            SELECT id
              FROM public.ptitbac_auth_sessions
             WHERE account_id=$1
               AND revoked_at IS NULL
             ORDER BY created_at DESC
             OFFSET 8
          )`,
        [accountId]
      );
    }
  }

  async function register({ email, password, username }) {
    const emailNormalized = normalizeEmail(email);
    const displayEmail = String(email || "").trim().slice(0, 254);
    const cleanUsername = normalizeUsername(username);

    if (!validEmail(emailNormalized)) {
      return { ok:false, error:"Adresse e-mail invalide." };
    }
    if (cleanUsername.length < 2) {
      return { ok:false, error:"Choisis un pseudo d’au moins 2 caractères." };
    }
    const passwordError = validatePassword(password);
    if (passwordError) return { ok:false, error:passwordError };

    const db = await schema();
    const credentials = await hashPassword(password);
    const walletToken = newWalletToken();
    const nowMs = Date.now();
    const welcomeHistory = [{
      id: crypto.randomBytes(8).toString("hex"),
      type: "WELCOME",
      delta: DEFAULT_COINS,
      before: 0,
      after: DEFAULT_COINS,
      at: nowMs,
      roomCode: "",
      note: "Bienvenue dans P’tit Bac",
      idempotencyKey: `welcome:${walletToken}`
    }];

    const client = await db.connect();
    try {
      await client.query("BEGIN");

      const existing = await client.query(
        "SELECT 1 FROM public.ptitbac_accounts WHERE email_normalized=$1 LIMIT 1",
        [emailNormalized]
      );
      if (existing.rowCount) {
        await client.query("ROLLBACK");
        return { ok:false, error:"Un compte utilise déjà cette adresse e-mail." };
      }

      await client.query(
        `INSERT INTO public.ptitbac_wallets(token,coins,gems,created_at,updated_at,history)
         VALUES($1,$2,0,$3,$3,$4::jsonb)`,
        [walletToken, DEFAULT_COINS, nowMs, JSON.stringify(welcomeHistory)]
      );

      const userResult = await client.query(
        `INSERT INTO public.users(friend_code,username,avatar,wallet_token,lives,life_updated_at,last_seen,updated_at)
         VALUES('AUTO',$1,'/a1.webp',$2,5,now(),now(),now())
         RETURNING id,friend_code,username,avatar,wallet_token`,
        [cleanUsername, walletToken]
      );
      const user = userResult.rows[0];

      const accountResult = await client.query(
        `INSERT INTO public.ptitbac_accounts
          (user_id,email_normalized,email_display,password_hash,password_salt,password_version,profile_completed,last_login_at)
         VALUES($1,$2,$3,$4,$5,$6,false,now())
         RETURNING id`,
        [
          user.id,
          emailNormalized,
          displayEmail || emailNormalized,
          credentials.hash,
          credentials.salt,
          credentials.version
        ]
      );

      const accountId = accountResult.rows[0].id;
      const session = await createSession(client, accountId);

      await client.query("COMMIT");
      await cleanupSessions(db, accountId);

      return {
        ok:true,
        account: accountPayload({
          ...user,
          user_id:user.id,
          email_display: displayEmail || emailNormalized,
          coins: DEFAULT_COINS,
          gems: 0,
          profile_completed: false
        }, session.raw),
        expiresAt: session.expiresAt.getTime()
      };
    } catch (error) {
      try { await client.query("ROLLBACK"); } catch {}
      if (error?.code === "23505") {
        return { ok:false, error:"Un compte utilise déjà cette adresse e-mail." };
      }
      throw error;
    } finally {
      client.release();
    }
  }

  async function login({ email, password }) {
    const emailNormalized = normalizeEmail(email);
    if (!validEmail(emailNormalized) || !String(password || "")) {
      return { ok:false, error:"E-mail ou mot de passe incorrect." };
    }

    const db = await schema();
    const result = await db.query(
      `SELECT a.id AS account_id,
              a.user_id,
              a.email_display,
              a.password_hash,
              a.password_salt,
              a.profile_completed,
              u.username,
              u.avatar,
              u.friend_code,
              u.wallet_token,
              u.admin_banned,
              w.coins,
              w.gems
         FROM public.ptitbac_accounts a
         JOIN public.users u ON u.id=a.user_id
         LEFT JOIN public.ptitbac_wallets w ON w.token=u.wallet_token
        WHERE a.email_normalized=$1
        LIMIT 1`,
      [emailNormalized]
    );

    if (!result.rowCount) {
      return { ok:false, error:"E-mail ou mot de passe incorrect." };
    }

    const row = result.rows[0];
    if (row.admin_banned) {
      return { ok:false, error:"Ce compte est actuellement suspendu." };
    }

    const valid = await verifyPassword(password, row.password_salt, row.password_hash);
    if (!valid) {
      return { ok:false, error:"E-mail ou mot de passe incorrect." };
    }

    const client = await db.connect();
    try {
      await client.query("BEGIN");

      await client.query(
        `INSERT INTO public.ptitbac_wallets(token,coins,gems,created_at,updated_at,history)
         VALUES($1,$2,0,$3,$3,'[]'::jsonb)
         ON CONFLICT(token) DO NOTHING`,
        [row.wallet_token, DEFAULT_COINS, Date.now()]
      );

      const session = await createSession(client, row.account_id);
      await client.query(
        `UPDATE public.ptitbac_accounts
            SET last_login_at=now(), updated_at=now()
          WHERE id=$1`,
        [row.account_id]
      );
      await client.query(
        `UPDATE public.users SET last_seen=now(), updated_at=now() WHERE id=$1`,
        [row.user_id]
      );
      await client.query("COMMIT");

      await cleanupSessions(db, row.account_id);
      const wallet = await db.query(
        "SELECT coins,gems FROM public.ptitbac_wallets WHERE token=$1 LIMIT 1",
        [row.wallet_token]
      );

      return {
        ok:true,
        account: accountPayload({
          ...row,
          ...(wallet.rows[0] || {})
        }, session.raw),
        expiresAt: session.expiresAt.getTime()
      };
    } catch (error) {
      try { await client.query("ROLLBACK"); } catch {}
      throw error;
    } finally {
      client.release();
    }
  }

  async function resume({ sessionToken }) {
    const raw = String(sessionToken || "").trim();
    if (!validSessionToken(raw)) {
      return { ok:false, error:"Session expirée." };
    }

    const db = await schema();
    const tokenHash = hashSessionToken(raw);
    const result = await db.query(
      `SELECT s.id AS session_id,
              s.account_id,
              a.user_id,
              a.email_display,
              a.profile_completed,
              u.username,
              u.avatar,
              u.friend_code,
              u.wallet_token,
              u.admin_banned,
              w.coins,
              w.gems
         FROM public.ptitbac_auth_sessions s
         JOIN public.ptitbac_accounts a ON a.id=s.account_id
         JOIN public.users u ON u.id=a.user_id
         LEFT JOIN public.ptitbac_wallets w ON w.token=u.wallet_token
        WHERE s.token_hash=$1
          AND s.revoked_at IS NULL
          AND s.expires_at > now()
        LIMIT 1`,
      [tokenHash]
    );

    if (!result.rowCount || result.rows[0].admin_banned) {
      return { ok:false, error:"Session expirée." };
    }

    const row = result.rows[0];
    await db.query(
      `UPDATE public.ptitbac_auth_sessions SET last_seen_at=now() WHERE id=$1`,
      [row.session_id]
    );
    await db.query(
      `UPDATE public.users SET last_seen=now() WHERE id=$1`,
      [row.user_id]
    );

    return {
      ok:true,
      account: accountPayload(row, raw)
    };
  }

  async function completeProfile({ userId, walletToken, username, avatar }) {
    const safeUserId = String(userId || "").trim();
    const safeWalletToken = String(walletToken || "").trim().toLowerCase();
    const cleanUsername = normalizeUsername(username).slice(0, PROFILE_USERNAME_MAX_LENGTH);
    const cleanAvatar = String(avatar || "").trim();

    if (!safeUserId || !/^[a-f0-9]{48}$/i.test(safeWalletToken)) {
      return { ok:false, error:"Compte non connecté." };
    }
    if (cleanUsername.length < 2) {
      return { ok:false, error:"Choisis un pseudo d’au moins 2 caractères." };
    }
    if (!PROFILE_AVATARS.includes(cleanAvatar)) {
      return { ok:false, error:"Choisis un avatar valide." };
    }

    const db = await schema();
    const client = await db.connect();
    try {
      await client.query("BEGIN");

      const userResult = await client.query(
        `UPDATE public.users
            SET username=$3, avatar=$4, updated_at=now(), last_seen=now()
          WHERE id=$1 AND wallet_token=$2
          RETURNING id,friend_code,username,avatar,wallet_token`,
        [safeUserId, safeWalletToken, cleanUsername, cleanAvatar]
      );

      if (!userResult.rowCount) {
        await client.query("ROLLBACK");
        return { ok:false, error:"Compte introuvable." };
      }

      for (const profileAvatar of PROFILE_AVATARS) {
        await client.query(
          `INSERT INTO public.ptitbac_inventory_items(wallet_token,item_type,item_id,source)
           VALUES($1,'avatar',$2,'default')
           ON CONFLICT(wallet_token,item_type,item_id) DO NOTHING`,
          [safeWalletToken, profileAvatar]
        );
      }

      await client.query(
        `INSERT INTO public.ptitbac_inventory_items(wallet_token,item_type,item_id,source)
         VALUES($1,'tag','tag_debutant','default')
         ON CONFLICT(wallet_token,item_type,item_id) DO NOTHING`,
        [safeWalletToken]
      );

      await client.query(
        `INSERT INTO public.ptitbac_inventory_equipped(wallet_token,avatar_id,frame_id,tag_id)
         VALUES($1,$2,'','tag_debutant')
         ON CONFLICT(wallet_token) DO UPDATE
           SET avatar_id=EXCLUDED.avatar_id,
               updated_at=now()`,
        [safeWalletToken, cleanAvatar]
      );

      const accountResult = await client.query(
        `UPDATE public.ptitbac_accounts
            SET profile_completed=true, updated_at=now()
          WHERE user_id=$1
          RETURNING profile_completed`,
        [safeUserId]
      );

      if (!accountResult.rowCount) {
        await client.query("ROLLBACK");
        return { ok:false, error:"Compte introuvable." };
      }

      const walletResult = await client.query(
        `SELECT coins,gems
           FROM public.ptitbac_wallets
          WHERE token=$1
          LIMIT 1`,
        [safeWalletToken]
      );

      await client.query("COMMIT");

      return {
        ok:true,
        account: accountPayload({
          ...userResult.rows[0],
          user_id:safeUserId,
          ...(walletResult.rows[0] || {}),
          profile_completed:true
        })
      };
    } catch (error) {
      try { await client.query("ROLLBACK"); } catch {}
      throw error;
    } finally {
      client.release();
    }
  }

  async function logout({ sessionToken }) {
    const raw = String(sessionToken || "").trim();
    if (!validSessionToken(raw)) return { ok:true };

    const db = await schema();
    await db.query(
      `UPDATE public.ptitbac_auth_sessions
          SET revoked_at=COALESCE(revoked_at,now()), last_seen_at=now()
        WHERE token_hash=$1`,
      [hashSessionToken(raw)]
    );
    return { ok:true };
  }

  return {
    ensureSchema:schema,
    register,
    login,
    resume,
    completeProfile,
    logout
  };
}

module.exports = {
  SESSION_TTL_MS,
  PASSWORD_MIN_LENGTH,
  PASSWORD_MAX_LENGTH,
  PROFILE_AVATARS,
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
  createAccountAuthService
};
