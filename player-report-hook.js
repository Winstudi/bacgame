"use strict";

const crypto = require("crypto");
const { getPool, ensureDatabaseSchema } = require("./db.js");

const DATABASE_URL = String(process.env.DATABASE_URL || "").trim();
const pool = getPool();

function ensureSchema() {
  return ensureDatabaseSchema();
}

function validWalletToken(value) {
  const token = String(value || "").trim();
  return /^[a-f0-9]{48}$/i.test(token) ? token : "";
}

function installPlayerReports(io) {
  if (!pool) {
    console.warn("Signalements joueurs désactivés: DATABASE_URL absent.");
    return;
  }

  ensureSchema().catch(err =>
    console.error("Initialisation signalements joueurs:", err.message)
  );

  io.on("connection", socket => {
    socket.on("players:report", async (payload = {}, callback = () => {}) => {
      try {
        const walletToken = validWalletToken(payload.walletToken);
        let friendCode = String(payload.targetFriendCode || "").trim();
        let targetName = String(payload.targetName || "Joueur").trim().slice(0, 24);
        const roomCode = String(payload.roomCode || "").trim().toUpperCase().slice(0, 8);
        const playerId = String(payload.targetPlayerId || "").trim().slice(0, 80);

        if (!walletToken) return callback({ ok: false, error: "Session invalide." });
        await ensureSchema();
        if (payload.targetFriendId) {
          const target = await pool.query(
            `SELECT target.friend_code, target.username FROM public.users reporter
             JOIN public.friendships f ON f.user_id=reporter.id
             JOIN public.users target ON target.id=f.friend_id
             WHERE reporter.wallet_token=$1 AND target.id=$2`,
            [walletToken, String(payload.targetFriendId)]
          );
          if (!target.rowCount) return callback({ok:false,error:"Ce joueur n’est pas dans tes amis."});
          friendCode = target.rows[0].friend_code;
          targetName = target.rows[0].username;
        }
        if (!/^\d{5}$/.test(friendCode)) {
          return callback({ ok: false, error: "Ce joueur n’a pas de code ami valide." });
        }

        // Evite les doubles signalements accidentels rapprochés.
        const duplicate = await pool.query(
          `SELECT 1 FROM ptitbac_player_reports
            WHERE reporter_wallet_token=$1
              AND reported_friend_code=$2
              AND created_at > now() - interval '10 minutes'
            LIMIT 1`,
          [walletToken, friendCode]
        );

        if (duplicate.rowCount) {
          return callback({ ok: true, duplicate: true });
        }

        await pool.query(
          `INSERT INTO ptitbac_player_reports(
             id, reporter_wallet_token, reported_friend_code,
             reported_name, room_code, reported_player_id, reason
           ) VALUES($1,$2,$3,$4,$5,$6,$7)`,
          [
            crypto.randomBytes(12).toString("hex"),
            walletToken,
            friendCode,
            targetName,
            roomCode,
            playerId,
            payload.targetFriendId
              ? "Depuis les amis : " + String(payload.reason || "Comportement inapproprié").trim().slice(0, 500)
              : "lobby_profile"
          ]
        );

        callback({ ok: true });
      } catch (err) {
        console.error("players:report:", err.message);
        callback({ ok: false, error: "Impossible d’envoyer le signalement." });
      }
    });
  });
}

module.exports = installPlayerReports;

process.on("SIGTERM", () => {
  pool?.end().catch(() => {});
});
