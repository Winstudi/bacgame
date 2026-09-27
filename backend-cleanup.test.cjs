"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const PARTIE_SOURCES = new Set(["category-selection-v2.js", "letter-wheel-v1.js", "answer-screen-v1.js", "round-intro-v1.js", "waiting-screen-v1.js", "validation-screen-v1.js", "scoreboard-screen-v1.js", "final-screen-v1.js", "category-selection-v2.css", "category-chooser-card-v1.css", "letter-wheel-fx-v1.css", "letter-wheel-v1.css", "round-intro-v1.css", "answer-screen-v1.css", "waiting-screen-v1.css", "validation-screen-v1.css", "scoreboard-screen-v1.css", "final-screen-v1.css", "gameplay-flow.css", "category-prototype.css"]);
const source = name => {
  if (PARTIE_SOURCES.has(name)) {
    const merged = name.endsWith(".js") ? "partie.js" : "partie.css";
    const content = fs.readFileSync(path.join(__dirname, merged), "utf8");
    return content.split(`/* ==== ${name} ==== */`)[1]?.split(/\n\n\/\* ==== [^\n]+\.(?:js|css) ==== \*\//)[0] || "";
  }
  return fs.readFileSync(path.join(__dirname, name), "utf8");
};

test("l’ancien admin pièces a complètement disparu", () => {
  for (const name of ["server.js","app.js"]) {
    const text = source(name);
    assert.doesNotMatch(text, /wallet:adminAdjust/);
    assert.doesNotMatch(text, /openAdminCoinAccess/);
  }
});

test("l’administration utilise l’inventaire cosmétique officiel", () => {
  const admin = source("admin-hook.js");
  assert.match(admin, /ptitbac_inventory_items/);
  assert.match(admin, /createInventoryService/);
  assert.doesNotMatch(admin, /ptitbac_player_items/);
  assert.doesNotMatch(admin, /epic_chest|mystery_box|avatar_token|future_badge/);
});

test("les anciens générateurs de codes amis ont disparu", () => {
  assert.doesNotMatch(source("friends-hook.js"), /uniqueFriendCode|codeStem|PLAYER#/);
  assert.doesNotMatch(source("server.js"), /economyFriendCode|PLAYER#/);
  assert.doesNotMatch(source("admin-hook.js"), /PLAYER#/);
});

test("les chemins d’avatar ne sont plus tronqués à 16 caractères", () => {
  assert.match(source("friends-hook.js"), /slice\(0, 120\)/);
  assert.match(source("server.js"), /avatar \|\| "🐼"\)\.slice\(0,120\)/);
});

test("la liste des conversations n’utilise plus une boucle SQL par ami", () => {
  const chat = source("chat-hook.js");
  const block = chat.match(
    /async function conversationList\(userId\) \{([\s\S]*?)\n\}\n\nasync function history/
  )?.[1] || "";
  assert.match(block, /JOIN LATERAL/);
  assert.doesNotMatch(block, /for \(const friend of friends\)/);
  assert.equal((block.match(/pool\.query\(/g) || []).length, 1);
});

test("les salons configurables utilisent uniquement 6, 8 ou 10 catégories et jusqu’à 120 secondes", () => {
  const server = source("server.js");

  // Le moteur de tirage garde sa protection générale 6–10.
  assert.match(
    server,
    /Math\.max\(6,\s*Math\.min\(10,\s*Number\(count\)\s*\|\|\s*6\)\)/
  );

  // Mais les paramètres de salon exposés/acceptés sont volontairement limités.
  assert.equal(
    (server.match(/\[6,\s*8,\s*10\]\.includes\(Number\(categoryCount\)\)/g) || []).length,
    2
  );
  assert.equal(
    (server.match(/\[30,\s*60,\s*90,\s*120\]\.includes\(Number\(duration\)\)/g) || []).length,
    2
  );
  assert.doesNotMatch(
    server,
    /\[6,\s*7,\s*8,\s*9,\s*10\]\.includes\(Number\(categoryCount\)\)/
  );
});

test("une panne IA ne transforme plus les réponses non vérifiées en réponses fausses", () => {
  const server = source("server.js");
  const fallback = server.match(
    /function completeValidationFallback\([\s\S]*?\n\}\n\nasync function runAutomaticValidation/
  )?.[0] || "";

  assert.match(fallback, /validationEngine\.markPendingUnverified\(validation\.items/);
  assert.match(fallback, /validation\.neutralCategories = \[\]/);
  assert.doesNotMatch(fallback, /item\.status = "invalid"/);

  const finalize = server.match(
    /function finalizeRound\(room\) \{([\s\S]*?)\n\}\n\nfunction endRound/
  )?.[1] || "";
  assert.doesNotMatch(finalize, /neutralCategories\.has\(category\)/);
  assert.match(finalize, /item\?\.status === "valid"/);

  const results = server.match(
    /function buildRoundResults\(room\) \{([\s\S]*?)\n\}\n\nfunction finalizeRound/
  )?.[1] || "";
  assert.match(results, /source\.status === "unverified"/);
  assert.match(results, /reportable: status === "invalid"/);

  const scoreboard = source("scoreboard-screen-v1.js");
  assert.match(scoreboard, /r\.status==="unverified"\?"unverified"/);
  assert.match(scoreboard, /status==="unverified"\?"empty":status/);
  assert.match(scoreboard, /unverified:"\?"/);
  assert.match(scoreboard, /unverified:"Non vérifiée"/);
  assert.match(scoreboard, /\? Non vérifiée/);
});

test("une réponse encore incertaine après seconde vérification reste neutre", () => {
  const server = source("server.js");
  assert.match(server, /let finalVerdict = "uncertain"/);
  assert.match(server, /if \(finalVerdict === "uncertain"\) item\.reason = "review_unresolved"/);

  const automatic = server.match(
    /async function runAutomaticValidation\([\s\S]*?\n\}\n\n\nasync function reviewReportedAnswer/
  )?.[0] || "";
  assert.match(automatic, /validationEngine\.markPendingUnverified\(validation\.items/);
  assert.match(automatic, /code:"review_unresolved"/);
  assert.match(automatic, /validation\.neutralCategories = \[\]/);
  assert.match(automatic, /if \(validation\.status === "complete"\) return;/);
});

test("une nouvelle partie libère automatiquement l’ancien salon du même profil", () => {
  const server = source("server.js");
  const cleanup = server.match(
    /async function ptitBacReleaseRoomsBeforeNewSession\([\s\S]*?\n\}\n\nfunction hasActiveRoom/
  )?.[0] || "";

  assert.match(cleanup, /room\.phase !== "finished"/);
  assert.match(cleanup, /io\.sockets\.sockets\.get\(player\.socketId\)/);
  assert.match(cleanup, /player\.socketId = socket\.id/);
  assert.match(cleanup, /ptitBacHandleExplicitLeave/);
  assert.match(cleanup, /queueRoomPersist\(room, 0\)/);

  const quick = server.match(
    /async eligible\(socket, profile\) \{([\s\S]*?)\n  \},\n  admit/
  )?.[1] || "";
  assert.match(quick, /ptitBacReleaseRoomsBeforeNewSession/);
  assert.match(quick, /if \(!release\.ok\) throw new Error\(release\.error\)/);

  const create = server.match(
    /socket\.on\("room:create", async \(payload = \{\}, cb = \(\) => \{\}\) => \{([\s\S]*?)\n  \}\);/
  )?.[1] || "";
  assert.match(create, /ptitBacReleaseRoomsBeforeNewSession/);
  assert.match(create, /createGameRoom\(socket, payload, cb\)/);

  const join = server.match(
    /socket\.on\("room:join", async \(payload = \{\}, cb = \(\) => \{\}\) => \{([\s\S]*?)\n  \}\);/
  )?.[1] || "";
  assert.match(join, /ptitBacReleaseRoomsBeforeNewSession/);
  assert.match(join, /joinGameRoom\(socket, payload, cb\)/);
});


test("la source 1.48 démarre directement sans patcher runtime", () => {
  const pkg = JSON.parse(source("package.json"));
  const server = source("server.js");

  assert.equal(pkg.version, "1.48.0");
  assert.equal(pkg.scripts.start, "node server.js");
  assert.equal(pkg.scripts.prestart, undefined);
  assert.equal(pkg.scripts.pretest, undefined);
  assert.equal(pkg.scripts.predev, undefined);
  assert.match(server, /SOURCE_RELEASE = "1\.48\.0-stable"/);
  assert.match(server, /VALIDATION_ENGINE_VERSION = "v2\.7\.0"/);
  assert.match(server, /OPENAI_BOT_MODEL = configuredBotModel/);
});
