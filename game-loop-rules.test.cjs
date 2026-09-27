"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const {
  shouldRefundEntryOnLeave,
  isFinalScoreboard,
  nextHostCandidate,
  canAdvanceScoreboard
} = require("./game-loop-rules.js");

test("quitter pendant le choix des catégories ne rembourse pas la vie", () => {
  assert.equal(
    shouldRefundEntryOnLeave({ phase:"category_selection", roundIndex:-1 }),
    false
  );
  assert.equal(
    shouldRefundEntryOnLeave({ phase:"letter_selection", roundIndex:-1 }),
    false
  );
  assert.equal(
    shouldRefundEntryOnLeave({ phase:"lobby", roundIndex:-1 }),
    true
  );
});

test("la dernière page de résultats est reconnue", () => {
  assert.equal(
    isFinalScoreboard({ phase:"scoreboard", roundIndex:0, rounds:1 }),
    true
  );
  assert.equal(
    isFinalScoreboard({ phase:"scoreboard", roundIndex:1, rounds:3 }),
    false
  );
  assert.equal(
    isFinalScoreboard({ phase:"scoreboard", roundIndex:2, rounds:3 }),
    true
  );
});

test("le transfert d'hôte privilégie un humain connecté", () => {
  const players = [
    { id:"old", isBot:false, connected:false },
    { id:"offline", isBot:false, connected:false },
    { id:"bot", isBot:true, connected:true },
    { id:"online", isBot:false, connected:true }
  ];

  assert.equal(nextHostCandidate(players, "old")?.id, "online");
});

test("un humain hors ligne reste préférable à un bot si personne n'est connecté", () => {
  const players = [
    { id:"offline", isBot:false, connected:false },
    { id:"bot", isBot:true, connected:true }
  ];

  assert.equal(nextHostCandidate(players)?.id, "offline");
});

test("en Quick n'importe quel joueur peut continuer les résultats", () => {
  const room = { phase:"scoreboard", mode:"quick" };
  assert.equal(canAdvanceScoreboard(room, { isHost:false }), true);
});

test("hors Quick seul l'hôte peut continuer les résultats", () => {
  const room = { phase:"scoreboard", mode:"public" };
  assert.equal(canAdvanceScoreboard(room, { isHost:false }), false);
  assert.equal(canAdvanceScoreboard(room, { isHost:true }), true);
});

const { rematchState, canRestartRoom } = require('./game-loop-rules.js');

test('revanche : seuls les humains connectés votent, avec annulation possible', () => {
  const host = { id:'h', isHost:true, connected:true, rematchReady:true };
  const friend = { id:'f', connected:true, rematchReady:false };
  const room = { mode:'private', phase:'finished', players:[host, friend,
    { id:'bot', isBot:true, connected:true }, { id:'offline', connected:false }] };
  assert.deepEqual(rematchState(room), { count:2, readyCount:1, allReady:false });
  assert.equal(canRestartRoom(room, host), false);
  friend.rematchReady = true;
  assert.equal(canRestartRoom(room, host), true);
  friend.rematchReady = false;
  assert.equal(canRestartRoom(room, host), false);
  friend.connected = false;
  assert.equal(canRestartRoom(room, host), true);
});

test('revanche : phase, identité, hôte et enregistrement des résultats sont protégés', () => {
  const host = { id:'h', isHost:true, connected:true, rematchReady:true };
  const room = { mode:'public', phase:'finished', players:[host] };
  assert.equal(canRestartRoom(room, host), true);
  assert.equal(canRestartRoom(room, { ...host }), false);
  assert.equal(canRestartRoom({ ...room, phase:'round' }, host), false);
  assert.equal(canRestartRoom({ ...room, mode:'quick' }, host), false);
  assert.equal(canRestartRoom({ ...room, progressionDistributionPending:true }, host), false);
  host.isHost = false;
  assert.equal(canRestartRoom(room, host), false);
  assert.equal(rematchState({ players:[] }).allReady, false);
});
