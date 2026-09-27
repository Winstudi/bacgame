"use strict";

const crypto = require("crypto");
const { progressionFromTotalXp } = require("./progression-service.js");

const QUEST_POOL = Object.freeze([
  Object.freeze({
    id:"wins_3",
    kind:"wins",
    target:3,
    xp:100,
    title:"Gagner 3 parties",
    description:"Remporte 3 parties aujourd’hui.",
    icon:"trophy"
  }),
  Object.freeze({
    id:"wins_5",
    kind:"wins",
    target:5,
    xp:200,
    title:"Gagner 5 parties",
    description:"Remporte 5 parties aujourd’hui.",
    icon:"trophy"
  }),
  Object.freeze({
    id:"answers_5",
    kind:"answers",
    target:5,
    xp:80,
    title:"Valider 5 réponses",
    description:"Fais valider 5 réponses",
    icon:"answers"
  }),
  Object.freeze({
    id:"answers_10",
    kind:"answers",
    target:10,
    xp:200,
    title:"Valider 10 réponses",
    description:"Fais valider 10 réponses",
    icon:"answers"
  }),
  Object.freeze({
    id:"rerolls_3",
    kind:"rerolls",
    target:3,
    xp:100,
    title:"Relancer 3 parties",
    description:"Utilise 3 relances dans tes parties.",
    icon:"reroll"
  })
]);

const QUEST_BY_ID = new Map(QUEST_POOL.map(quest => [quest.id, quest]));

const PARIS_FORMATTER = new Intl.DateTimeFormat("en-CA", {
  timeZone:"Europe/Paris",
  year:"numeric",
  month:"2-digit",
  day:"2-digit",
  hour:"2-digit",
  minute:"2-digit",
  second:"2-digit",
  hourCycle:"h23"
});

function validWalletToken(value) {
  const token = String(value || "").trim();
  return /^[a-f0-9]{48}$/i.test(token) ? token : "";
}

function parisParts(ms = Date.now()) {
  const out = {};
  for (const part of PARIS_FORMATTER.formatToParts(new Date(ms))) {
    if (part.type !== "literal") out[part.type] = Number(part.value);
  }
  return {
    year:out.year,
    month:out.month,
    day:out.day,
    hour:out.hour,
    minute:out.minute,
    second:out.second
  };
}

function addCalendarDays(parts, amount) {
  const date = new Date(Date.UTC(
    parts.year,
    parts.month - 1,
    parts.day + amount,
    12, 0, 0
  ));
  return {
    year:date.getUTCFullYear(),
    month:date.getUTCMonth() + 1,
    day:date.getUTCDate()
  };
}

function parisOffsetMs(utcMs) {
  const p = parisParts(utcMs);
  const represented = Date.UTC(
    p.year, p.month - 1, p.day,
    p.hour, p.minute, p.second
  );
  return represented - Math.floor(utcMs / 1000) * 1000;
}

function parisLocalToUtcMs(parts, hour = 11) {
  const base = Date.UTC(
    parts.year,
    parts.month - 1,
    parts.day,
    hour, 0, 0
  );
  let guess = base;
  for (let i = 0; i < 3; i += 1) {
    guess = base - parisOffsetMs(guess);
  }
  return guess;
}

function questWindow(now = Date.now()) {
  const local = parisParts(now);
  const activeDate = local.hour < 11
    ? addCalendarDays(local, -1)
    : { year:local.year, month:local.month, day:local.day };
  const nextDate = local.hour < 11
    ? { year:local.year, month:local.month, day:local.day }
    : addCalendarDays(local, 1);

  const key = [
    activeDate.year,
    String(activeDate.month).padStart(2, "0"),
    String(activeDate.day).padStart(2, "0")
  ].join("-");

  return {
    key,
    startsAt:parisLocalToUtcMs(activeDate, 11),
    endsAt:parisLocalToUtcMs(nextDate, 11)
  };
}

function dailyQuests(rotationKey) {
  const list = QUEST_POOL.map(item => ({ ...item }));
  const bytes = crypto
    .createHash("sha256")
    .update(`ptitbac-quests:${rotationKey}`)
    .digest();

  for (let i = list.length - 1; i > 0; i -= 1) {
    const j = bytes[list.length - 1 - i] % (i + 1);
    [list[i], list[j]] = [list[j], list[i]];
  }

  return list.slice(0, 3);
}

function publicProgression(row = {}) {
  return {
    ...progressionFromTotalXp(row.total_xp || 0),
    trophies:Math.max(0, Number(row.trophies) || 0),
    completedGames:Math.max(0, Number(row.completed_games) || 0),
    wins:Math.max(0, Number(row.wins) || 0)
  };
}

function questInstanceId(rotationKey, questId) {
  return `${rotationKey}::${questId}`;
}

function createQuestsService({
  getPool,
  ensureSchema
} = {}) {
  if (typeof getPool !== "function") throw new TypeError("getPool requis");
  if (typeof ensureSchema !== "function") throw new TypeError("ensureSchema requis");

  let schemaPromise = null;

  async function db() {
    await ensureQuestSchema();
    const pool = getPool();
    if (!pool) throw new Error("PostgreSQL indisponible");
    return pool;
  }

  async function ensureQuestSchema() {
    if (schemaPromise) return schemaPromise;

    schemaPromise = (async () => {
      await ensureSchema();
      const pool = getPool();
      if (!pool) throw new Error("PostgreSQL indisponible");



      // Chaque lot quotidien est maintenant mémorisé par joueur. Ainsi, à 11 h,
      // les 3 nouvelles quêtes sont ajoutées à la liste existante au lieu de
      // remplacer celles des jours précédents.



      return pool;
    })().catch(error => {
      schemaPromise = null;
      throw error;
    });

    return schemaPromise;
  }

  async function ensureAssignedForWindow(walletToken, window) {
    const pool = await db();
    const quests = dailyQuests(window.key);

    for (let slot = 0; slot < quests.length; slot += 1) {
      const quest = quests[slot];
      await pool.query(
        `INSERT INTO public.ptitbac_player_quests(
           wallet_token,rotation_key,quest_id,starts_at_ms,slot
         ) VALUES($1,$2,$3,$4,$5)
         ON CONFLICT(wallet_token,rotation_key,quest_id) DO NOTHING`,
        [walletToken, window.key, quest.id, window.startsAt, slot]
      );
    }
  }

  async function assignedRows(walletToken) {
    const pool = await db();
    const q = await pool.query(
      `SELECT rotation_key,quest_id,starts_at_ms,slot
         FROM public.ptitbac_player_quests
        WHERE wallet_token=$1
        ORDER BY starts_at_ms DESC,slot ASC`,
      [walletToken]
    );
    return q.rows || [];
  }

  async function claimedKeys(walletToken) {
    const pool = await db();
    const q = await pool.query(
      `SELECT rotation_key,quest_id
         FROM public.ptitbac_quest_claims
        WHERE wallet_token=$1`,
      [walletToken]
    );
    return new Set(
      (q.rows || []).map(row => questInstanceId(row.rotation_key, row.quest_id))
    );
  }

  async function statsForStarts(walletToken, starts, endsAt = Date.now()) {
    if (!starts.length) return new Map();
    const pool = await db();
    const [games, rerolls] = await Promise.all([
      pool.query(`SELECT s.start_ms,
          COUNT(e.event_key) FILTER (WHERE e.rank=1)::int AS wins,
          COALESCE(SUM(e.valid_answers),0)::int AS answers
        FROM unnest($2::bigint[]) AS s(start_ms)
        LEFT JOIN public.ptitbac_progression_events e
          ON e.wallet_token=$1 AND e.event_key LIKE 'game-xp:%'
          AND e.created_at>=to_timestamp(s.start_ms::double precision/1000.0)
          AND e.created_at<to_timestamp($3::double precision/1000.0)
        GROUP BY s.start_ms`, [walletToken, starts, endsAt]),
      pool.query(`SELECT s.start_ms,COUNT(e.id)::int AS rerolls
        FROM unnest($2::bigint[]) AS s(start_ms)
        LEFT JOIN public.economy_transactions e
          ON e.wallet_token=$1 AND e.kind IN ('CATEGORY_REROLL','LETTER_REROLL')
          AND e.created_at>=to_timestamp(s.start_ms::double precision/1000.0)
          AND e.created_at<to_timestamp($3::double precision/1000.0)
        GROUP BY s.start_ms`, [walletToken, starts, endsAt])
    ]);
    const result = new Map(starts.map(start => [start, { wins:0, answers:0, rerolls:0 }]));
    for (const row of games.rows) Object.assign(result.get(Number(row.start_ms)), {
      wins:Math.max(0, Number(row.wins) || 0), answers:Math.max(0, Number(row.answers) || 0)
    });
    for (const row of rerolls.rows) result.get(Number(row.start_ms)).rerolls = Math.max(0, Number(row.rerolls) || 0);
    return result;
  }

  async function chestStatus(walletToken) {
    const pool = await db();
    const [questClaims, chestClaims] = await Promise.all([
      pool.query(
        `SELECT COUNT(*)::int AS count
           FROM public.ptitbac_quest_claims
          WHERE wallet_token=$1`,
        [walletToken]
      ),
      pool.query(
        `SELECT COUNT(*)::int AS count
           FROM public.ptitbac_quest_chest_claims
          WHERE wallet_token=$1`,
        [walletToken]
      )
    ]);

    const totalClaims = Math.max(0, Number(questClaims.rows?.[0]?.count) || 0);
    const claimedChests = Math.max(0, Number(chestClaims.rows?.[0]?.count) || 0);
    const consumed = claimedChests * 4;
    const pending = Math.max(0, totalClaims - consumed);

    return {
      progress:Math.min(4, pending),
      required:4,
      claimable:pending >= 4,
      claimedChests,
      nextCycle:claimedChests + 1,
      totalValidated:totalClaims
    };
  }

  function progressForQuest(quest, stats) {
    return Math.max(
      0,
      Math.min(
        Number(quest.target) || 1,
        Number(stats?.[quest.kind]) || 0
      )
    );
  }

  async function status(walletToken) {
    const token = validWalletToken(walletToken);
    if (!token) throw new Error("Session joueur invalide.");

    const window = questWindow();
    await ensureAssignedForWindow(token, window);

    const [rows, claimed, chest] = await Promise.all([
      assignedRows(token),
      claimedKeys(token),
      chestStatus(token)
    ]);

    const uniqueStarts = [...new Set(
      rows.map(row => Math.max(0, Number(row.starts_at_ms) || 0)).filter(Boolean)
    )];
    const statsByStart = await statsForStarts(token, uniqueStarts);

    const quests = rows
      .map(row => {
        const template = QUEST_BY_ID.get(String(row.quest_id || ""));
        if (!template) return null;

        const rotationKey = String(row.rotation_key || "");
        const startsAt = Math.max(0, Number(row.starts_at_ms) || 0);
        const instanceId = questInstanceId(rotationKey, template.id);
        const progress = progressForQuest(template, statsByStart.get(startsAt) || {});

        return {
          ...template,
          id:instanceId,
          questId:template.id,
          rotationKey,
          startsAt,
          slot:Math.max(0, Number(row.slot) || 0),
          progress,
          completed:progress >= template.target,
          claimed:claimed.has(instanceId)
        };
      })
      .filter(Boolean);

    return {
      rotationKey:window.key,
      startsAt:window.startsAt,
      refreshAt:window.endsAt,
      serverNow:Date.now(),
      quests,
      chest
    };
  }

  async function awardBonusXp(walletToken, xpValue, eventKey) {
    const token = validWalletToken(walletToken);
    const xp = Math.max(0, Math.floor(Number(xpValue) || 0));
    const key = String(eventKey || "").slice(0, 180);
    if (!token || !xp || !key) throw new Error("Récompense XP invalide.");

    const pool = await db();
    const client = await pool.connect();
    let finished = false;

    try {
      await client.query("BEGIN");

      await client.query(
        `INSERT INTO public.ptitbac_progression(wallet_token)
         VALUES($1)
         ON CONFLICT(wallet_token) DO NOTHING`,
        [token]
      );

      const locked = await client.query(
        `SELECT total_xp,trophies,completed_games,wins
           FROM public.ptitbac_progression
          WHERE wallet_token=$1
          FOR UPDATE`,
        [token]
      );

      const existing = await client.query(
        `SELECT xp_delta
           FROM public.ptitbac_progression_events
          WHERE event_key=$1
          LIMIT 1`,
        [key]
      );

      if (existing.rowCount) {
        await client.query("COMMIT");
        finished = true;
        const row = locked.rows?.[0] || {};
        return {
          duplicate:true,
          gainedXp:Number(existing.rows[0].xp_delta) || xp,
          state:publicProgression(row)
        };
      }

      const beforeRow = locked.rows?.[0] || {
        total_xp:0,
        trophies:0,
        completed_games:0,
        wins:0
      };
      const beforeXp = Math.max(0, Number(beforeRow.total_xp) || 0);
      const beforeTrophies = Math.max(0, Number(beforeRow.trophies) || 0);
      const afterXp = beforeXp + xp;
      const beforeLevel = progressionFromTotalXp(beforeXp).level;
      const afterLevel = progressionFromTotalXp(afterXp).level;

      await client.query(
        `UPDATE public.ptitbac_progression
            SET total_xp=$2,updated_at=now()
          WHERE wallet_token=$1`,
        [token, afterXp]
      );

      await client.query(
        `INSERT INTO public.ptitbac_progression_events(
           event_key,wallet_token,room_code,xp_delta,trophy_delta,
           before_total_xp,after_total_xp,
           before_trophies,after_trophies,
           before_level,after_level,
           rank,valid_answers,rounds
         ) VALUES(
           $1,$2,NULL,$3,0,$4,$5,$6,$6,$7,$8,0,0,0
         )`,
        [
          key,
          token,
          xp,
          beforeXp,
          afterXp,
          beforeTrophies,
          beforeLevel,
          afterLevel
        ]
      );

      await client.query("COMMIT");
      finished = true;

      return {
        duplicate:false,
        gainedXp:xp,
        state:{
          ...progressionFromTotalXp(afterXp),
          trophies:beforeTrophies,
          completedGames:Math.max(0, Number(beforeRow.completed_games) || 0),
          wins:Math.max(0, Number(beforeRow.wins) || 0)
        }
      };
    } catch (error) {
      if (!finished) {
        try { await client.query("ROLLBACK"); } catch {}
      }
      throw error;
    } finally {
      client.release?.();
    }
  }

  async function claimQuest(walletToken, questRef) {
    const token = validWalletToken(walletToken);
    const ref = String(questRef || "").trim();
    if (!token || !ref) throw new Error("Quête invalide.");

    const current = await status(token);
    const quest = current.quests.find(item => item.id === ref) ||
      current.quests.find(item => item.questId === ref && !item.claimed);
    if (!quest) throw new Error("Cette quête n’est plus disponible.");
    if (!quest.completed) throw new Error("Cette quête n’est pas encore terminée.");

    const pool = await db();
    const existing = await pool.query(
      `SELECT xp_reward
         FROM public.ptitbac_quest_claims
        WHERE wallet_token=$1 AND rotation_key=$2 AND quest_id=$3
        LIMIT 1`,
      [token, quest.rotationKey, quest.questId]
    );

    const tokenHash = crypto
      .createHash("sha256")
      .update(token)
      .digest("hex")
      .slice(0, 16);

    const award = await awardBonusXp(
      token,
      quest.xp,
      `quest-xp:${tokenHash}:${quest.rotationKey}:${quest.questId}`
    );

    if (!existing.rowCount) {
      await pool.query(
        `INSERT INTO public.ptitbac_quest_claims(
           wallet_token,rotation_key,quest_id,xp_reward
         ) VALUES($1,$2,$3,$4)
         ON CONFLICT(wallet_token,rotation_key,quest_id) DO NOTHING`,
        [token,quest.rotationKey,quest.questId,quest.xp]
      );
    }

    const nextStatus = await status(token);

    return {
      duplicate:existing.rowCount > 0 || award.duplicate,
      questId:quest.id,
      gainedXp:award.duplicate ? 0 : quest.xp,
      progression:award.state,
      status:nextStatus
    };
  }

  async function claimCompletedQuests(walletToken) {
    const token = validWalletToken(walletToken);
    if (!token) throw new Error("Session joueur invalide.");

    const initial = await status(token);
    const pending = initial.quests.filter(quest => quest.completed && !quest.claimed);

    if (!pending.length) {
      return {
        claimedQuestIds:[],
        gainedXp:0,
        progression:null,
        status:initial
      };
    }

    const claimedQuestIds = [];
    let gainedXp = 0;
    let progression = null;

    for (const quest of pending) {
      const result = await claimQuest(token, quest.id);
      progression = result.progression || progression;

      if (!result.duplicate) {
        claimedQuestIds.push(quest.id);
        gainedXp += Math.max(0, Number(result.gainedXp) || 0);
      }
    }

    return {
      claimedQuestIds,
      gainedXp,
      progression,
      status:await status(token)
    };
  }

  async function chestEligibility(walletToken) {
    const token = validWalletToken(walletToken);
    if (!token) throw new Error("Session joueur invalide.");
    return chestStatus(token);
  }

  async function confirmChestClaim(walletToken, cycleNo, rewardResult = {}) {
    const token = validWalletToken(walletToken);
    const cycle = Math.max(1, Math.floor(Number(cycleNo) || 0));
    if (!token || !cycle) throw new Error("Coffre de quêtes invalide.");

    const pool = await db();
    await pool.query(
      `INSERT INTO public.ptitbac_quest_chest_claims(
         wallet_token,cycle_no,reward_result
       ) VALUES($1,$2,$3::jsonb)
       ON CONFLICT(wallet_token,cycle_no) DO NOTHING`,
      [token,cycle,JSON.stringify(rewardResult || {})]
    );

    return status(token);
  }

  return {
    ensureSchema:ensureQuestSchema,
    status,
    claimQuest,
    claimCompletedQuests,
    chestEligibility,
    confirmChestClaim
  };
}

module.exports = {
  QUEST_POOL,
  questWindow,
  dailyQuests,
  createQuestsService
};
