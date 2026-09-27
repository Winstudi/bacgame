"use strict";

const { createAccountAuthService } = require("./account-auth.js");

const DEFAULT_ADMIN_ACCOUNT_EMAIL = ""; // Compatibilité : les rôles ne dépendent plus des e-mails.

function normalizeAccountEmail(value) {
  return String(value || "").trim().toLowerCase().slice(0, 254);
}

function validWalletToken(value) {
  const token = String(value || "").trim().toLowerCase();
  return /^[a-f0-9]{48}$/i.test(token) ? token : "";
}

function installAccountAuth(io, options = {}) {
  if (!io || typeof io.on !== "function") return null;
  if (io.__ptitBacAccountAuthInstalled) return io.__ptitBacAccountAuthInstalled;

  const service = options.service || createAccountAuthService(options);
  const database = options.getPool || (() => require("./db.js").getPool());
  const adminAccountEmail = normalizeAccountEmail(
    options.adminEmail ||
    process.env.PTITBAC_ADMIN_EMAIL ||
    DEFAULT_ADMIN_ACCOUNT_EMAIL
  );

  function reply(ack, payload) {
    if (typeof ack === "function") ack(payload);
  }

  async function run(ack, action) {
    try {
      reply(ack, await action());
    } catch (error) {
      console.error("Compte joueur:", error?.message || error);
      reply(ack, {
        ok:false,
        error:"Le service de compte est momentanément indisponible."
      });
    }
  }

  async function syncAdminOwner() {
    const db = database?.();
    const ownerUserId = String(process.env.PTITBAC_ADMIN_USER_ID || "").trim();
    if (!db || !ownerUserId) return;
    if (!/^[a-f0-9-]{36}$/i.test(ownerUserId)) throw new Error("PTITBAC_ADMIN_USER_ID invalide");
    await service.ensureSchema?.();
    await db.query(`INSERT INTO public.ptitbac_admin_owner(singleton,wallet_token)
      SELECT true,u.wallet_token FROM public.users u
      JOIN public.ptitbac_accounts a ON a.user_id=u.id WHERE u.id=$1
      ON CONFLICT(singleton) DO UPDATE SET wallet_token=EXCLUDED.wallet_token`, [ownerUserId]);
  }

  async function bindAccountToSocket(socket, account) {
    socket.data.authInvalidated = false;
    socket.data.accountUserId = account.userId;
    socket.data.accountWalletToken = account.walletToken;
    socket.data.walletToken = account.walletToken;
    socket.data.accountEmail = normalizeAccountEmail(account.email);
    socket.data.accountSessionToken = account.sessionToken || "";
    socket.data.isAccountAdmin = false;
    const db = database?.();
    if (db) {
      const result = await db.query(
        "SELECT wallet_token FROM public.ptitbac_admin_owner WHERE singleton=true LIMIT 1"
      );
      socket.data.isAccountAdmin = result.rows[0]?.wallet_token === account.walletToken;
    }
  }

  Promise.resolve()
    .then(() => syncAdminOwner())
    .catch(error => {
      console.error("Initialisation admin:", error?.message || error);
    });

  const connectionHandler = socket => {
    socket.on("auth:register", (payload = {}, ack) => {
      run(ack, async () => {
        const result = await service.register(payload);
        if (result?.ok && result.account) {
          await bindAccountToSocket(socket, result.account);
        }
        return result;
      });
    });

    socket.on("auth:login", (payload = {}, ack) => {
      run(ack, async () => {
        const result = await service.login(payload);
        if (result?.ok && result.account) {
          await bindAccountToSocket(socket, result.account);
        }
        return result;
      });
    });

    socket.on("auth:resume", (payload = {}, ack) => {
      run(ack, async () => {
        const result = await service.resume(payload);
        if (result?.ok && result.account) {
          await bindAccountToSocket(socket, result.account);
        }
        return result;
      });
    });

    socket.on("auth:completeProfile", (payload = {}, ack) => {
      run(ack, async () => {
        const userId = String(socket.data.accountUserId || "").trim();
        const walletToken = String(socket.data.accountWalletToken || "").trim();
        if (!userId || !/^[a-f0-9]{48}$/i.test(walletToken)) {
          return { ok:false, error:"Compte non connecté." };
        }

        const result = await service.completeProfile({
          userId,
          walletToken,
          username:payload.username,
          avatar:payload.avatar
        });

        if (result?.ok && result.account) {
          socket.data.accountUserId = result.account.userId || userId;
          socket.data.accountWalletToken = result.account.walletToken || walletToken;
        }
        return result;
      });
    });

    socket.on("auth:logout", (payload = {}, ack) => {
      run(ack, async () => {
        const result = await service.logout(payload);
        socket.data.authInvalidated = true;
        socket.data.accountUserId = "";
        socket.data.accountWalletToken = "";
        socket.data.accountEmail = "";
        socket.data.accountSessionToken = "";
        socket.data.isAccountAdmin = false;
        socket.data.walletToken = "";
        socket.data.ptitWalletToken = "";
        socket.data.ptitChatWalletToken = "";
        return result;
      });
    });

    socket.on("auth:profileStats", (_payload = {}, ack) => {
      run(ack, async () => {
        const userId = String(socket.data.accountUserId || "").trim();
        const walletToken = String(socket.data.accountWalletToken || "").trim();
        if (!userId || !/^[a-f0-9]{48}$/i.test(walletToken)) {
          return { ok:false, error:"Compte non connecté." };
        }

        const db = database?.();
        if (!db) return { ok:false, error:"Statistiques indisponibles." };

        const result = await db.query(
          `SELECT a.created_at,
                  COALESCE(p.completed_games,0) AS completed_games,
                  COALESCE(p.wins,0) AS wins,
                  COALESCE((
                    SELECT SUM(e.valid_answers)
                      FROM public.ptitbac_progression_events e
                     WHERE e.wallet_token=$2
                  ),0) AS correct_answers,
                  COALESCE((
                    SELECT COUNT(*)
                      FROM public.friendships f
                     WHERE f.user_id=$1
                  ),0) AS friends
             FROM public.ptitbac_accounts a
             JOIN public.users u
               ON u.id=a.user_id AND u.wallet_token=$2
        LEFT JOIN public.ptitbac_progression p
               ON p.wallet_token=$2
            WHERE a.user_id=$1
            LIMIT 1`,
          [userId, walletToken]
        );

        if (!result.rowCount) {
          return { ok:false, error:"Compte introuvable." };
        }

        const row = result.rows[0];
        return {
          ok:true,
          stats:{
            games:Math.max(0, Number(row.completed_games) || 0),
            wins:Math.max(0, Number(row.wins) || 0),
            correct:Math.max(0, Number(row.correct_answers) || 0),
            friends:Math.max(0, Number(row.friends) || 0),
            memberSince:row.created_at ? new Date(row.created_at).toISOString() : ""
          }
        };
      });
    });
  };

  io.on("connection", connectionHandler);

  const installed = {
    service,
    connectionHandler,
    adminAccountEmail
  };
  io.__ptitBacAccountAuthInstalled = installed;
  return installed;
}

module.exports = installAccountAuth;
module.exports.DEFAULT_ADMIN_ACCOUNT_EMAIL = DEFAULT_ADMIN_ACCOUNT_EMAIL;
module.exports.normalizeAccountEmail = normalizeAccountEmail;
