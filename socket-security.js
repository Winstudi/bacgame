"use strict";

const GLOBAL_POLICY = Object.freeze({
  limit: 150,
  windowMs: 10_000,
  scope: "socket",
  message: "Trop de requêtes. Réessaie dans quelques secondes."
});

const ADMIN_DEFAULT_POLICY = Object.freeze({
  limit: 60,
  windowMs: 60_000,
  scope: "identity",
  message: "Trop de requêtes administrateur."
});

const DEFAULT_ADMIN_ACCOUNT_EMAIL = ""; // Compatibilité : les rôles ne dépendent plus des e-mails.

const EVENT_POLICIES = Object.freeze({
  "party:get": Object.freeze({ limit:30, windowMs:60_000, scope:"identity" }),
  "party:create": Object.freeze({ limit:6, windowMs:60_000, scope:"identity" }),
  "party:invite": Object.freeze({ limit:10, windowMs:60_000, scope:"identity" }),
  "party:accept": Object.freeze({ limit:10, windowMs:60_000, scope:"identity" }),
  "party:decline": Object.freeze({ limit:10, windowMs:60_000, scope:"identity" }),
  "party:leave": Object.freeze({ limit:10, windowMs:60_000, scope:"identity" }),
  "party:shareRoom": Object.freeze({ limit:12, windowMs:60_000, scope:"identity" }),

  "game:rematchReady": Object.freeze({ limit:20, windowMs:10_000, scope:"socket" }),
  "game:restart": Object.freeze({ limit:10, windowMs:10_000, scope:"socket" }),
  "shop:purchase": Object.freeze({ limit:12, windowMs:60_000, scope:"identity" }),
  "shop:claimAdBag": Object.freeze({ limit:4, windowMs:60_000, scope:"identity" }),
  "shop:claimDaily": Object.freeze({ limit:8, windowMs:60_000, scope:"identity" }),
  "quests:get": Object.freeze({ limit:30, windowMs:60_000, scope:"identity" }),
  "quests:sync": Object.freeze({ limit:20, windowMs:60_000, scope:"identity" }),
  "quests:claim": Object.freeze({ limit:20, windowMs:60_000, scope:"identity" }),
  "quests:claimChest": Object.freeze({ limit:8, windowMs:60_000, scope:"identity" }),
  "level-rewards:claim": Object.freeze({ limit:12, windowMs:60_000, scope:"identity" }),
  "admin:claim": Object.freeze({
    limit: 5,
    windowMs: 10 * 60_000,
    scope: "network",
    message: "Trop de tentatives admin. Réessaie plus tard."
  }),

  "admin:status": Object.freeze({
    limit: 30,
    windowMs: 60_000,
    scope: "socket",
    message: "Trop de requêtes admin."
  }),

  "auth:register": Object.freeze({
    limit: 5,
    windowMs: 15 * 60_000,
    scope: "network",
    message: "Trop de créations de compte. Réessaie plus tard."
  }),

  "auth:login": Object.freeze({
    limit: 10,
    windowMs: 10 * 60_000,
    scope: "network",
    message: "Trop de tentatives de connexion. Réessaie plus tard."
  }),

  "auth:resume": Object.freeze({
    limit: 30,
    windowMs: 60_000,
    scope: "socket",
    message: "Trop de restaurations de session."
  }),

  "auth:logout": Object.freeze({
    limit: 10,
    windowMs: 60_000,
    scope: "socket",
    message: "Trop de demandes de déconnexion."
  }),

  "auth:completeProfile": Object.freeze({
    limit: 8,
    windowMs: 60_000,
    scope: "identity",
    message: "Le profil est modifié trop rapidement."
  }),

  "auth:profileStats": Object.freeze({
    limit: 30,
    windowMs: 60_000,
    scope: "socket",
    message: "Les statistiques du profil sont actualisées trop rapidement."
  }),

  "chat:send": Object.freeze({
    limit: 15,
    windowMs: 10_000,
    scope: "identity",
    message: "Tu envoies des messages trop rapidement."
  }),

  "chat:report": Object.freeze({
    limit: 4,
    windowMs: 10 * 60_000,
    scope: "identity",
    message: "Trop de signalements rapprochés."
  }),

  "chat:bootstrap": Object.freeze({
    limit: 20,
    windowMs: 60_000,
    scope: "socket",
    message: "Le chat est actualisé trop rapidement."
  }),

  "chat:list": Object.freeze({
    limit: 30,
    windowMs: 60_000,
    scope: "socket",
    message: "Le chat est actualisé trop rapidement."
  }),

  "chat:history": Object.freeze({
    limit: 60,
    windowMs: 60_000,
    scope: "socket",
    message: "Cette conversation est actualisée trop rapidement."
  }),

  "friends:send": Object.freeze({
    limit: 8,
    windowMs: 60_000,
    scope: "identity",
    message: "Trop de demandes d’amis envoyées."
  }),

  "friends:bootstrap": Object.freeze({
    limit: 20,
    windowMs: 60_000,
    scope: "socket",
    message: "La liste d’amis est actualisée trop rapidement."
  }),

  "friends:list": Object.freeze({
    limit: 30,
    windowMs: 60_000,
    scope: "socket",
    message: "La liste d’amis est actualisée trop rapidement."
  }),

  "players:report": Object.freeze({
    limit: 4,
    windowMs: 10 * 60_000,
    scope: "identity",
    message: "Trop de signalements rapprochés."
  }),

  "profile:update": Object.freeze({
    limit: 6,
    windowMs: 60_000,
    scope: "identity",
    message: "Le profil est modifié trop rapidement."
  }),

  "room:create": Object.freeze({
    limit: 12,
    windowMs: 60_000,
    scope: "network",
    message: "Trop de salons créés. Réessaie dans un instant."
  }),

  "room:join": Object.freeze({
    limit: 40,
    windowMs: 60_000,
    scope: "network",
    message: "Trop de tentatives pour rejoindre un salon."
  }),

  "room:reconnect": Object.freeze({
    limit: 30,
    windowMs: 60_000,
    scope: "socket",
    message: "Trop de reconnexions."
  }),

  "lobby:startCountdown": Object.freeze({
    limit: 6,
    windowMs: 30_000,
    scope: "socket",
    message: "Le lancement est demandé trop rapidement."
  }),

  "wallet:init": Object.freeze({
    limit: 20,
    windowMs: 60_000,
    scope: "socket",
    message: "Initialisation du portefeuille trop fréquente."
  }),

  "economy:get": Object.freeze({
    limit: 30,
    windowMs: 60_000,
    scope: "socket",
    message: "Actualisation de l’économie trop fréquente."
  }),

  "economy:rewardedAdDev": Object.freeze({
    limit: 6,
    windowMs: 60_000,
    scope: "identity",
    message: "Récompense publicitaire demandée trop rapidement."
  }),

  "progression:get": Object.freeze({
    limit: 30,
    windowMs: 60_000,
    scope: "socket",
    message: "Actualisation de la progression trop fréquente."
  })
});

const NON_ADMIN_PAYLOAD_LIMIT = 64 * 1024;
const ADMIN_PAYLOAD_LIMIT = 750 * 1024;
const MAX_BUCKET_AGE = 12 * 60_000;

function safeText(value, max = 120) {
  return String(value || "").trim().slice(0, max);
}

function normalizeAccountEmail(value) {
  return safeText(value, 254).toLowerCase();
}

function walletToken(value) {
  const token = safeText(value, 64);
  return /^[a-f0-9]{48}$/i.test(token) ? token.toLowerCase() : "";
}

function isAuthorizedAdminSocket(socket) {
  return socket?.data?.isAccountAdmin === true && !!walletToken(socket?.data?.accountWalletToken);
}

function clientNetworkKey(socket) {
  const direct = safeText(
    socket?.handshake?.address ||
    socket?.conn?.remoteAddress ||
    "",
    80
  );

  // Ignore untrusted forwarding headers. A trusted edge can be configured explicitly.
  const hops = Math.max(0, Math.min(5, Number(process.env.PTITBAC_TRUST_PROXY_HOPS) || 0));
  const forwarded = String(socket?.handshake?.headers?.["x-forwarded-for"] || "")
    .split(",").map(value => safeText(value, 80)).filter(Boolean);
  const trustedAddress = hops && forwarded.length >= hops ? forwarded[forwarded.length - hops] : "";
  return trustedAddress || direct || safeText(socket?.id, 80) || "unknown";
}

function knownSocketToken(socket) {
  return walletToken(
    socket?.data?.accountWalletToken ||
    socket?.data?.walletToken ||
    socket?.data?.ptitWalletToken ||
    socket?.data?.ptitChatWalletToken ||
    ""
  );
}

function identityKey(socket, payload) {
  return (
    knownSocketToken(socket) ||
    walletToken(payload?.walletToken) ||
    safeText(socket?.id, 80) ||
    clientNetworkKey(socket)
  );
}

function scopeKey(socket, payload, scope) {
  if (scope === "network") return `network:${clientNetworkKey(socket)}`;
  if (scope === "identity") return `identity:${identityKey(socket, payload)}`;
  return `socket:${safeText(socket?.id, 80) || clientNetworkKey(socket)}`;
}

function payloadBytes(payload) {
  if (payload == null) return 0;

  try {
    return Buffer.byteLength(JSON.stringify(payload), "utf8");
  } catch {
    return Number.POSITIVE_INFINITY;
  }
}

function packetCallback(packet) {
  const candidate = packet?.[packet.length - 1];
  return typeof candidate === "function" ? candidate : null;
}

function rateLimitResponse(policy, retryAfterMs) {
  return {
    ok: false,
    rateLimited: true,
    error: policy?.message || GLOBAL_POLICY.message,
    retryAfterMs: Math.max(1, Math.ceil(Number(retryAfterMs) || 1))
  };
}

function createRateLimiter({ now = () => Date.now() } = {}) {
  const buckets = new Map();

  function consume(key, policy) {
    const current = now();
    const limit = Math.max(1, Math.floor(Number(policy?.limit) || 1));
    const windowMs = Math.max(1000, Math.floor(Number(policy?.windowMs) || 1000));

    let bucket = buckets.get(key);

    if (!bucket || current - bucket.startedAt >= windowMs) {
      bucket = {
        startedAt: current,
        lastSeenAt: current,
        count: 0
      };
      buckets.set(key, bucket);
    }

    bucket.count += 1;
    bucket.lastSeenAt = current;

    const allowed = bucket.count <= limit;
    const retryAfterMs = allowed
      ? 0
      : Math.max(1, windowMs - (current - bucket.startedAt));

    return {
      allowed,
      count: bucket.count,
      limit,
      retryAfterMs
    };
  }

  function prune() {
    const current = now();

    for (const [key, bucket] of buckets) {
      if (current - bucket.lastSeenAt > MAX_BUCKET_AGE) {
        buckets.delete(key);
      }
    }
  }

  return {
    consume,
    prune,
    size: () => buckets.size
  };
}

function installSocketSecurity(io, options = {}) {
  if (!io?.use) {
    throw new TypeError("Socket.IO requis");
  }

  const limiter = options.limiter || createRateLimiter();
  const access = options.access || require("./session-access.js").createSessionAccess();
  const policies = options.policies || EVENT_POLICIES;
  const globalPolicy = options.globalPolicy || GLOBAL_POLICY;
  const adminAccountEmail = normalizeAccountEmail(
    options.adminEmail ||
    process.env.PTITBAC_ADMIN_EMAIL ||
    DEFAULT_ADMIN_ACCOUNT_EMAIL
  );

  io.use((socket, nextConnection) => {
    let packetTail = Promise.resolve();
    socket.use((packet, dispatch) => {
      const eventName = safeText(packet?.[0], 100);
      const payload =
        packet?.[1] &&
        typeof packet[1] === "object" &&
        !Array.isArray(packet[1])
          ? packet[1]
          : {};

      const callback = packetCallback(packet);

      if (!eventName) {
        callback?.({
          ok: false,
          error: "Requête invalide."
        });
        return;
      }

      if (
        eventName.startsWith("admin:") &&
        !isAuthorizedAdminSocket(socket, adminAccountEmail)
      ) {
        if (eventName === "admin:status") {
          callback?.({
            ok: true,
            admin: false
          });
        } else {
          callback?.({
            ok: false,
            admin: false,
            error: "Accès refusé."
          });
        }
        return;
      }

      // Une connexion authentifiée par compte est l'autorité pour le wallet.
      // Le client ne peut ni substituer walletToken, ni utiliser wallet:init
      // pour basculer silencieusement vers un autre portefeuille.
      const accountBoundToken = walletToken(socket?.data?.accountWalletToken);
      const boundToken = knownSocketToken(socket);
      const suppliedToken = walletToken(payload.walletToken);
      const suppliedDirectToken = eventName.startsWith("wallet:")
        ? walletToken(payload.token)
        : "";

      if (
        (accountBoundToken && suppliedToken && accountBoundToken !== suppliedToken) ||
        (accountBoundToken && suppliedDirectToken && accountBoundToken !== suppliedDirectToken) ||
        (!accountBoundToken && boundToken && suppliedToken && boundToken !== suppliedToken) ||
        (!accountBoundToken && boundToken && suppliedDirectToken && boundToken !== suppliedDirectToken)
      ) {
        callback?.({
          ok: false,
          error: "Session invalide."
        });
        return;
      }

      if (accountBoundToken && !eventName.startsWith("auth:")) {
        payload.walletToken = accountBoundToken;
        if (eventName.startsWith("wallet:")) payload.token = accountBoundToken;
      }

      const maxPayload =
        eventName.startsWith("admin:")
          ? ADMIN_PAYLOAD_LIMIT
          : NON_ADMIN_PAYLOAD_LIMIT;

      if (payloadBytes(payload) > maxPayload) {
        callback?.({
          ok: false,
          error: "Requête trop volumineuse."
        });
        return;
      }

      const globalKey =
        `${scopeKey(socket, payload, globalPolicy.scope)}:__global__`;

      const globalResult =
        limiter.consume(globalKey, globalPolicy);

      if (!globalResult.allowed) {
        callback?.(
          rateLimitResponse(
            globalPolicy,
            globalResult.retryAfterMs
          )
        );
        return;
      }

      const policy =
        policies[eventName] ||
        (eventName.startsWith("admin:") ? ADMIN_DEFAULT_POLICY : null);

      if (policy) {
        const key =
          `${scopeKey(socket, payload, policy.scope)}:${eventName}`;

        const result =
          limiter.consume(key, policy);

        if (!result.allowed) {
          callback?.(
            rateLimitResponse(
              policy,
              result.retryAfterMs
            )
          );
          return;
        }
      }

      // Rate limiting precedes database access; fail closed on storage errors.
      if (!options.access && !require("./db.js").getPool()) return dispatch();
      packetTail = packetTail.then(() => access.authorize(socket, eventName, payload)).then(allowed => {
        if (!allowed) {
          callback?.({ ok:false, code:"session_required", error:"Reconnecte-toi à ton compte." });
          if (socket.data.accountSessionToken) socket.emit?.("auth:expired");
          return;
        }
        dispatch();
      }).catch(() => callback?.({ ok:false, error:"Vérification de session indisponible." }));
    });

    const raw = String(socket.handshake?.auth?.sessionToken || "").trim();
    if (!raw) return nextConnection();
    access.authenticate(socket, raw).then(ok => {
      if (ok) return nextConnection();
      const error = new Error("Session expirée.");
      error.data = { code:"session_expired" };
      nextConnection(error);
    }).catch(() => nextConnection(new Error("Service de compte indisponible.")));
  });

  if (typeof io.on === "function" && options.installAccountAuth !== false) {
    require("./auth-hook.js")(io, {
      adminEmail: adminAccountEmail
    });
  }

  const pruneTimer = setInterval(
    () => limiter.prune(),
    60_000
  );
  pruneTimer.unref?.();

  return {
    limiter,
    stop() {
      clearInterval(pruneTimer);
    }
  };
}

module.exports = {
  GLOBAL_POLICY,
  ADMIN_DEFAULT_POLICY,
  DEFAULT_ADMIN_ACCOUNT_EMAIL,
  EVENT_POLICIES,
  NON_ADMIN_PAYLOAD_LIMIT,
  ADMIN_PAYLOAD_LIMIT,
  normalizeAccountEmail,
  walletToken,
  isAuthorizedAdminSocket,
  clientNetworkKey,
  knownSocketToken,
  identityKey,
  scopeKey,
  payloadBytes,
  createRateLimiter,
  installSocketSecurity
};
