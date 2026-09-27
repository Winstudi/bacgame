"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const source = name =>
  fs.readFileSync(path.join(__dirname, name), "utf8");

test("quitter pendant catégories ou lettre ne rembourse pas la vie", () => {
  const server = source("server.js");

  const block = server.match(
    /room\.phase === "category_selection" \|\|([\s\S]*?)\n  \}\n\n  const phaseBeforeLeave/
  )?.[1] || "";

  assert.match(block, /room\.phase === "letter_selection"/);
  assert.doesNotMatch(block, /refundPreGameEntry\(room\)/);
  assert.match(block, /La vie consommée n’est pas remboursée/);
});

test("le duel interrompu rembourse uniquement le joueur restant", () => {
  const server = source("server.js");
  assert.match(server, /ptitBacRefundSelectedLives\(room, \[winner\]\)/);
  assert.match(server, /lifeRefunded:true/);
});

test("un hôte déconnecté possède un délai de reconnexion avant transfert", () => {
  const server = source("server.js");
  assert.match(server, /HOST_RECONNECT_GRACE_MS = 15 \* 1000/);
  assert.match(server, /ptitBacScheduleHostTransfer\(room, player\)/);
  assert.match(server, /nextHostCandidate/);
});

test("le Quick ne dépend plus de l'hôte pour quitter le scoreboard", () => {
  const server = source("server.js");
  const screen = source("scoreboard-screen-v1.js");

  assert.match(server, /canAdvanceScoreboard\(room, player\)/);
  assert.match(screen, /user\?\.isHost\|\|state\.mode==="quick"/);
});

test("les sorties joueur attendent la confirmation serveur", () => {
  assert.match(source("salons.js"), /socket\.timeout\(8000\)\.emit\(/);
  assert.match(source("app.js"), /"game:leave"/);
  assert.match(source("final-screen-v1.js"), /socket\.timeout\(8000\)\.emit\(/);
});

test("les transitions critiques confirment leur réussite par l’état serveur", () => {
  const answers = source("answer-screen-v1.js");
  const validation = source("validation-screen-v1.js");
  const scoreboard = source("scoreboard-screen-v1.js");

  assert.match(answers, /socket\.emit\(\s*"round:submit"/);
  assert.doesNotMatch(answers, /socket\.timeout\([^)]*\)\.emit\(\s*"round:submit"/);
  assert.match(answers, /setTimeout\(\(\) => \{/);
  assert.match(answers, /La validation n’a pas été confirmée\. Réessaie\./);

  assert.match(validation, /socket\.emit\(\s*"validation:retry"/);
  assert.doesNotMatch(validation, /socket\.timeout\([^)]*\)\.emit\(\s*"validation:retry"/);
  assert.match(validation, /setTimeout\(\(\) => \{/);
  assert.match(validation, /La relance n’a pas été confirmée\. Réessaie\./);

  assert.match(scoreboard, /socket\.emit\(\s*"game:nextRound"/);
  assert.doesNotMatch(scoreboard, /socket\.timeout\([^)]*\)\.emit\(\s*"game:nextRound"/);
  assert.match(scoreboard, /setTimeout\(\(\)=>\{/);
  assert.match(scoreboard, /Le passage à la suite n’a pas été confirmé\. Réessaie\./);
});

test("la préparation catégories puis lettre utilise un watchdog d’état serveur", () => {
  const categories = source("category-selection-v2.js");
  const wheel = source("letter-wheel-v1.js");
  const quick = source("salons.js");

  assert.match(categories, /state\.categoryRerollCost \|\| 20/);
  assert.match(categories, /socket\.emit\(\s*"game:rerollCategories"/);
  assert.match(categories, /socket\.emit\(\s*"game:confirmCategories"/);
  assert.match(categories, /socket\.emit\(\s*"game:returnLobby"/);
  assert.doesNotMatch(categories, /socket\.timeout\([^)]*\)\.emit\(\s*"game:(?:rerollCategories|confirmCategories|returnLobby)"/);
  assert.match(categories, /Le passage à la lettre n’a pas été confirmé\. Réessaie\./);

  assert.match(wheel, /state\.letterRerollCost \|\| 20/);
  assert.match(wheel, /socket\.emit\(\s*"game:spinLetter"/);
  assert.match(wheel, /socket\.emit\(\s*"game:rerollLetter"/);
  assert.match(wheel, /socket\.emit\(\s*"game:confirmLetter"/);
  assert.doesNotMatch(wheel, /socket\.timeout\([^)]*\)\.emit\(\s*"game:(?:spinLetter|rerollLetter|confirmLetter)"/);
  assert.match(wheel, /Le lancement de la manche n’a pas été confirmé\. Réessaie\./);

  assert.match(quick, /socket\.emit\(\s*"game:rerollLetter"/);
  assert.match(quick, /socket\.emit\(\s*"game:rerollCategories"/);
  assert.match(quick, /socket\.emit\(\s*"game:confirmCategories"/);
  assert.doesNotMatch(quick, /socket\.timeout\([^)]*\)\.emit\(\s*"game:(?:rerollLetter|rerollCategories|confirmCategories)"/);
  assert.match(quick, /La relance de la lettre n’a pas été confirmée\. Réessaie\./);
});

const {
  createWalletAtomicService,
  normalizeRequestKey
} = require("./wallet-atomic-service.js");

const atomicWalletToken = "a".repeat(48);

function fakeAtomicDatabase({
  coins = 50,
  gems = 3,
  duplicate = null,
  failOnUpdate = false
} = {}) {
  const state = {
    coins,
    gems,
    history:[],
    audit:duplicate ? new Map([[duplicate.key, duplicate.row]]) : new Map(),
    committed:false,
    rolledBack:false,
    released:false,
    calls:[]
  };

  const client = {
    async query(sql, params = []) {
      const text = String(sql).replace(/\s+/g, " ").trim();
      state.calls.push({ text, params });

      if (text === "BEGIN") return { rowCount:null, rows:[] };
      if (text === "COMMIT") {
        state.committed = true;
        return { rowCount:null, rows:[] };
      }
      if (text === "ROLLBACK") {
        state.rolledBack = true;
        return { rowCount:null, rows:[] };
      }

      if (
        text.includes("FROM public.ptitbac_wallets") &&
        text.includes("FOR UPDATE")
      ) {
        return {
          rowCount:1,
          rows:[{
            token:atomicWalletToken,
            coins:state.coins,
            gems:state.gems,
            created_at:1,
            updated_at:1,
            history:state.history
          }]
        };
      }

      if (
        text.includes("FROM public.economy_transactions") &&
        text.includes("idempotency_key")
      ) {
        const row = state.audit.get(params[0]);
        return row
          ? { rowCount:1, rows:[row] }
          : { rowCount:0, rows:[] };
      }

      if (text.startsWith("UPDATE public.ptitbac_wallets")) {
        if (failOnUpdate) throw new Error("db write failed");
        state.coins = params[1];
        state.history = JSON.parse(params[3]);
        return {
          rowCount:1,
          rows:[{
            token:atomicWalletToken,
            coins:state.coins,
            gems:state.gems,
            created_at:1,
            updated_at:params[2],
            history:state.history
          }]
        };
      }

      if (text.startsWith("INSERT INTO public.economy_transactions")) {
        const key = params[5];
        const row = {
          id:"tx-db",
          coins_delta:params[2],
          kind:params[1],
          created_at:new Date()
        };
        if (key) state.audit.set(key, row);
        return { rowCount:1, rows:[row] };
      }

      throw new Error(`SQL inattendu: ${text}`);
    },

    release() {
      state.released = true;
    }
  };

  return {
    state,
    pool:{
      async connect() {
        return client;
      }
    }
  };
}

function atomicServiceFor(db) {
  return createWalletAtomicService({
    getPool:() => db.pool,
    ensureSchema:async () => {}
  });
}

test("le portefeuille atomique verrouille, audite et committe le débit", async () => {
  const db = fakeAtomicDatabase({ coins:50 });

  const result = await atomicServiceFor(db).changeCoins({
    walletToken:atomicWalletToken,
    delta:-20,
    kind:"LETTER_REROLL",
    details:{ roomCode:"ABC123", note:"Relance" },
    idempotencyKey:"request-1"
  });

  assert.equal(result.ok, true);
  assert.equal(result.balance, 30);
  assert.equal(db.state.coins, 30);
  assert.equal(db.state.committed, true);
  assert.equal(db.state.rolledBack, false);
  assert.equal(db.state.released, true);
  assert.equal(db.state.history.at(-1).after, 30);
  assert.ok(db.state.calls.some(call => call.text.includes("FOR UPDATE")));
  assert.ok(
    db.state.calls.some(
      call => call.text.startsWith("INSERT INTO public.economy_transactions")
    )
  );
});

test("le portefeuille atomique refuse un solde insuffisant sans écriture", async () => {
  const db = fakeAtomicDatabase({ coins:10 });

  const result = await atomicServiceFor(db).changeCoins({
    walletToken:atomicWalletToken,
    delta:-20,
    kind:"CATEGORY_REROLL",
    idempotencyKey:"request-2"
  });

  assert.equal(result.ok, false);
  assert.equal(result.code, "insufficient");
  assert.equal(result.balance, 10);
  assert.equal(db.state.coins, 10);
  assert.equal(db.state.rolledBack, true);
  assert.equal(db.state.committed, false);
});

test("le portefeuille atomique ne débite jamais deux fois la même requête", async () => {
  const key = normalizeRequestKey(atomicWalletToken, "same-request");
  const db = fakeAtomicDatabase({
    coins:30,
    duplicate:{
      key,
      row:{
        id:"old",
        coins_delta:-20,
        kind:"LETTER_REROLL",
        created_at:new Date()
      }
    }
  });

  const result = await atomicServiceFor(db).changeCoins({
    walletToken:atomicWalletToken,
    delta:-20,
    kind:"LETTER_REROLL",
    idempotencyKey:"same-request"
  });

  assert.equal(result.ok, true);
  assert.equal(result.duplicate, true);
  assert.equal(result.balance, 30);
  assert.equal(db.state.coins, 30);
  assert.equal(db.state.committed, true);
  assert.equal(
    db.state.calls.some(
      call => call.text.startsWith("UPDATE public.ptitbac_wallets")
    ),
    false
  );
});

test("le portefeuille atomique rollback si PostgreSQL échoue", async () => {
  const db = fakeAtomicDatabase({ coins:50, failOnUpdate:true });

  await assert.rejects(
    atomicServiceFor(db).changeCoins({
      walletToken:atomicWalletToken,
      delta:-20,
      kind:"LETTER_REROLL",
      idempotencyKey:"request-fail"
    }),
    /db write failed/
  );

  assert.equal(db.state.rolledBack, true);
  assert.equal(db.state.committed, false);
  assert.equal(db.state.released, true);
});

test("la clé idempotente du portefeuille est liée au wallet", () => {
  assert.equal(
    normalizeRequestKey(atomicWalletToken, "reroll:123"),
    `${atomicWalletToken}:reroll:123`
  );
});

test("les relances payantes envoient une clé idempotente stable", () => {
  const categories = source("category-selection-v2.js");
  const letters = source("letter-wheel-v1.js");

  assert.match(categories, /pendingCategoryReroll/);
  assert.match(categories, /categoryRequestId\("category-reroll"\)/);
  assert.match(
    categories,
    /"game:rerollCategories"[\s\S]{0,520}requestId/
  );

  assert.match(letters, /pendingLetterReroll/);
  assert.match(letters, /letterRequestId\("letter-reroll"\)/);
  assert.match(
    letters,
    /"game:rerollLetter"[\s\S]{0,520}requestId/
  );
});

test("une relance non confirmée garde la même clé jusqu’au nouvel état", () => {
  const categories = source("category-selection-v2.js");
  const letters = source("letter-wheel-v1.js");

  assert.match(
    categories,
    /pendingCategoryReroll\?\.drawKey === requestedDrawKey/
  );
  assert.match(
    categories,
    /pendingCategoryReroll\?\.drawKey !== drawKey/
  );
  assert.match(
    letters,
    /pendingLetterReroll\?\.contextKey === letterRerollContextKey/
  );
  assert.match(
    letters,
    /pendingLetterReroll\?\.contextKey !== letterRerollContextKey/
  );
});


test("le serveur branche les relances payantes sur le portefeuille atomique", () => {
  const server = source("server.js");

  assert.match(
    server,
    /createWalletAtomicService[^\n]*require\("\.\/wallet-atomic-service\.js"\)/
  );
  assert.match(server, /const walletAtomicService = createWalletAtomicService\(/);
  assert.match(server, /async function changeWalletCoinsDurably\(/);

  const categories = server.match(
    /socket\.on\("game:rerollCategories", async payload => \{([\s\S]*?)\n  \}\);\n\n  socket\.on\("game:confirmCategories"/
  )?.[1] || "";
  assert.match(categories, /payload\?\.requestId/);
  assert.match(categories, /changeWalletCoinsDurably\(\{/);
  assert.match(categories, /kind:"CATEGORY_REROLL"/);
  assert.match(categories, /idempotencyKey:requestId/);
  assert.match(categories, /if \(debit\.duplicate\)/);
  assert.match(categories, /CATEGORY_REROLL_REFUND/);
  assert.doesNotMatch(categories, /walletTransaction\(/);

  const letter = server.match(
    /socket\.on\("game:rerollLetter", async payload => \{([\s\S]*?)\n  \}\);\n\n  socket\.on\("game:confirmLetter"/
  )?.[1] || "";
  assert.match(letter, /payload\?\.requestId/);
  assert.match(letter, /changeWalletCoinsDurably\(\{/);
  assert.match(letter, /kind:"LETTER_REROLL"/);
  assert.match(letter, /idempotencyKey:requestId/);
  assert.match(letter, /if \(debit\.duplicate\)/);
  assert.match(letter, /LETTER_REROLL_REFUND/);
  assert.doesNotMatch(letter, /walletTransaction\(/);
});

test("la validation d'un tirage attend la fin du débit atomique", () => {
  const server = source("server.js");

  const confirmCategories = server.match(
    /socket\.on\("game:confirmCategories", payload => \{([\s\S]*?)\n  \}\);/
  )?.[1] || "";
  assert.match(confirmCategories, /room\.categoryRerollPending/);

  const confirmLetter = server.match(
    /socket\.on\("game:confirmLetter", payload => \{([\s\S]*?)\n  \}\);/
  )?.[1] || "";
  assert.match(confirmLetter, /room\.letterRerollPending/);
});

function finalActionsHarness() {
  const vm = require('node:vm');
  const final = source('final-screen-v1.js');
  const begin = final.indexOf('    const leave =');
  const end = final.indexOf('\n  window.renderFinished', begin);
  const actions = final.slice(begin, end).replace(/\n  \}\s*$/, '');
  const buttons = { finHome:{}, finQuick:{} };
  const calls = [];
  let acknowledge;
  vm.runInNewContext(actions, {
    document:{ getElementById:id => buttons[id] || null },
    socket:{ timeout:() => ({ emit:(event, payload, cb) => {
      calls.push(event); acknowledge = cb;
    } }) },
    state:{ code:'ROOM' }, session:{ playerId:'p' },
    user:{ name:'Alice', avatar:'A' },
    stopFinalSound:() => {}, finalFxRuntime:{ confettiTimer:0 },
    clearTimeout:() => {}, clearSession:() => calls.push('clear'),
    renderHome:() => calls.push('home'), toast:() => calls.push('error'),
    window:{ startQuickPlay:() => calls.push('search') }
  });
  return { buttons, calls, ack:(...args) => acknowledge(...args) };
}

test('Rejouer Quick attend la sortie confirmée avant de rechercher', () => {
  const h = finalActionsHarness();
  h.buttons.finQuick.onclick();
  h.buttons.finQuick.onclick();
  assert.deepEqual(h.calls, ['room:leave']);
  h.ack(null, { ok:true });
  assert.deepEqual(h.calls, ['room:leave', 'clear', 'home', 'search']);
});

test('Rejouer Quick conserve la session et permet de réessayer après un échec', () => {
  for (const result of [[new Error('timeout')], [null, { ok:false }]]) {
    const h = finalActionsHarness();
    h.buttons.finQuick.onclick();
    h.ack(...result);
    assert.deepEqual(h.calls, ['room:leave', 'error']);
    assert.equal(h.buttons.finQuick.disabled, false);
    h.buttons.finQuick.onclick();
    assert.equal(h.calls.at(-1), 'room:leave');
  }
});

test('le serveur conserve le groupe et remet les votes à zéro après la revanche', () => {
  const vm = require('node:vm');
  const { canRestartRoom } = require('./game-loop-rules.js');
  const host = { id:'h', isHost:true, connected:true, score:5 };
  const friend = { id:'f', connected:true, score:3 };
  const room = { code:'ABC', mode:'private', phase:'finished', players:[host, friend],
    categories:[], categoryCount:6, gameSessionId:'previous' };
  let actor = host;
  const handlers = {};
  const server = source('server.js');
  const begin = server.indexOf('  socket.on("game:rematchReady"');
  const end = server.indexOf('  socket.on("disconnect"', begin);
  vm.runInNewContext(server.slice(begin, end), {
    socket:{ on:(name, handler) => { handlers[name] = handler; } },
    requireMember:() => ({ room, player:actor }), canRestartRoom,
    emitRoom:() => {}, resetPrivateReady:r => r.players.forEach(p => { p.lobbyReady = false; }),
    pickCategories:() => ['Animal']
  });
  const call = (name, payload) => {
    let result;
    handlers[name](payload, value => { result = value; });
    return result;
  };
  assert.equal(call('game:restart', {}).ok, false);
  assert.equal(room.phase, 'finished');
  assert.equal(call('game:rematchReady', { ready:true }).ok, true);
  actor = friend;
  assert.equal(call('game:rematchReady', { ready:true }).ok, true);
  assert.equal(call('game:restart', {}).ok, false);
  actor = host;
  assert.equal(call('game:restart', {}).ok, true);
  assert.equal(room.phase, 'lobby');
  assert.equal(room.code, 'ABC');
  assert.equal(room.players.length, 2);
  assert.equal(room.gameSessionId, null);
  assert.ok(room.players.every(p => p.score === 0 && p.rematchReady === false && p.lobbyReady === false));
  assert.equal(call('game:restart', {}).ok, false);
  assert.equal(call('game:rematchReady', { ready:true }).ok, false);
});
