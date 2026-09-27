"use strict";
const { hashSessionToken, validSessionToken } = require("./account-auth.js");

const AUTH_ENTRY_EVENTS = new Set(["auth:register", "auth:login", "auth:resume", "auth:logout"]);
const validWallet = value => /^[a-f0-9]{48}$/i.test(String(value || "")) ? String(value).toLowerCase() : "";

function createSessionAccess({ getPool = () => require("./db.js").getPool() } = {}) {
  async function sessionIdentity(raw) {
    const db = getPool();
    if (!db || !validSessionToken(raw)) return null;
    const result = await db.query(`
      SELECT a.user_id, u.wallet_token, u.admin_banned,
             EXISTS(SELECT 1 FROM public.ptitbac_admin_owner o
                    WHERE o.singleton=true AND o.wallet_token=u.wallet_token) AS is_admin
        FROM public.ptitbac_auth_sessions s
        JOIN public.ptitbac_accounts a ON a.id=s.account_id
        JOIN public.users u ON u.id=a.user_id
       WHERE s.token_hash=$1 AND s.revoked_at IS NULL AND s.expires_at>now()
       LIMIT 1`, [hashSessionToken(raw)]);
    const row = result.rows[0];
    return row && !row.admin_banned ? row : null;
  }

  function bind(socket, row, raw) {
    socket.data.authInvalidated = false;
    socket.data.accountUserId = String(row.user_id);
    socket.data.accountWalletToken = String(row.wallet_token);
    socket.data.accountSessionToken = raw;
    socket.data.isAccountAdmin = row.is_admin === true;
  }

  async function authenticate(socket, raw) {
    const row = await sessionIdentity(raw);
    if (!row) return false;
    bind(socket, row, raw);
    return true;
  }

  async function authorize(socket, eventName, payload) {
    const db = getPool();
    if (AUTH_ENTRY_EVENTS.has(eventName)) return true;
    if (socket.data.authInvalidated) return false;
    if (!db) return true;
    const raw = socket.data.accountSessionToken;
    if (raw) {
      const row = await sessionIdentity(raw);
      if (!row || row.wallet_token !== socket.data.accountWalletToken) return false;
      bind(socket, row, raw);
      if (eventName.startsWith("admin:") && !socket.data.isAccountAdmin) return false;
      return true;
    }
    // A wallet belonging to an account must never be usable as a guest credential.
    const token = validWallet(payload.walletToken || payload.token || socket.data.walletToken ||
      socket.data.ptitWalletToken || socket.data.ptitChatWalletToken);
    if (!token) return !socket.data.accountWalletToken;
    const result = await db.query(`
      SELECT u.admin_banned, EXISTS(SELECT 1 FROM public.ptitbac_accounts a
                                    WHERE a.user_id=u.id) AS has_account
        FROM public.users u WHERE u.wallet_token=$1 LIMIT 1`, [token]);
    const row = result.rows[0];
    return !socket.data.accountWalletToken && !row?.admin_banned && !row?.has_account;
  }
  return { authenticate, authorize };
}
module.exports = { createSessionAccess };
