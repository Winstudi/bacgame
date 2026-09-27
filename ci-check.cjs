"use strict";

const fs = require("fs");
const path = require("path");
const { execFileSync } = require("child_process");

const root = __dirname;
const production = process.argv.includes("--production");

const BUILD_GENERATED_PUBLIC_FILES = Object.freeze({
  "/ptb-category-avatar-patches.css": "cleanup-frontend-build.cjs",
  "/ptb-ui-wheel-patches.css": "cleanup-frontend-build.cjs",
  "/ptb-late-patches.css": "cleanup-frontend-build.cjs",
  "/ptb-core-client.js": "cleanup-frontend-build.cjs",
  "/ptb-ui-patches.js": "cleanup-frontend-build.cjs",
  "/ptb-late-client.js": "cleanup-frontend-build.cjs"
});

const DYNAMIC_INDEX_PREFIXES = ["/socket.io/"];

const OBSOLETE_BUILD_SCRIPTS = Object.freeze([
  "apply-e1-source-cleanup.cjs",
  "e2-shared-db-build.cjs",
  "e3-functional-fixes-build.cjs",
  "e4-render-events-build.cjs",
  "e5-socket-security-build.cjs"
]);

const LEGACY_FILES = Object.freeze([
  ...OBSOLETE_BUILD_SCRIPTS,
  "profile-screen-v2.js",
  "profile-redesign-v1.js",
  "avatar-fix-v2.css",
  "avatar-system-v1.css",
  "lobby-polish-v1.css",
  "lobby-polish-v1.js",
  "ui-fixes-v3.css",
  "ui-fixes-v3.js",
  "category-position-fix-v1.css",
  "avatar-pages-fix-v1.js"
]);

function fail(message) {
  throw new Error(`[CI] ${message}`);
}

function read(name) {
  return fs.readFileSync(path.join(root, name), "utf8");
}

function exists(name) {
  return fs.existsSync(path.join(root, name));
}

function syntaxCheckAll() {
  const files = fs.readdirSync(root)
    .filter(name => /\.(?:js|cjs)$/i.test(name))
    .sort();

  for (const name of files) {
    try {
      execFileSync(process.execPath, ["--check", path.join(root, name)], {
        stdio: "pipe"
      });
    } catch (error) {
      const stderr = String(error?.stderr || "").trim();
      fail(`syntaxe invalide dans ${name}${stderr ? `\n${stderr}` : ""}`);
    }
  }

  return files.length;
}

function checkPackage() {
  const pkg = JSON.parse(read("package.json"));

  if (pkg?.engines?.node !== "22.x") {
    fail("package.json doit rester sur Node 22.x.");
  }

  for (const script of ["test", "check", "check:production"]) {
    if (!pkg?.scripts?.[script]) fail(`script npm manquant: ${script}`);
  }

  if (pkg?.scripts?.prestart || pkg?.scripts?.predev || pkg?.scripts?.pretest) {
    fail("les patchers runtime ne doivent plus être exécutés en 1.48.0.");
  }
  if (pkg?.scripts?.start !== "node server.js") {
    fail("npm start doit lancer directement server.js.");
  }
}

function checkRenderChain() {
  const render = read("render.yaml");

  for (const required of [
    "npm ci",
    "npm test",
    "npm run check",
    "node cleanup-frontend-build.cjs",
    "npm run check:production"
  ]) {
    if (!render.includes(required)) {
      fail(`render.yaml doit contenir: ${required}`);
    }
  }

  for (const obsolete of OBSOLETE_BUILD_SCRIPTS) {
    if (render.includes(`node ${obsolete}`)) {
      fail(`render.yaml exécute encore l'ancien patch ${obsolete}.`);
    }
  }

  if (!render.includes("healthCheckPath: /health")) {
    fail("Render doit conserver /health comme health check.");
  }
}

function checkLegacyFilesRemoved() {
  const present = LEGACY_FILES.filter(exists);
  if (present.length) {
    fail(
      "fichiers legacy encore présents dans le dépôt: " +
      present.join(", ")
    );
  }
}

function localRoutesFromIndex(html) {
  const routes = new Set();
  const regex = /(?:src|href)=["'](\/[^"'?#]+)(?:\?[^"']*)?["']/gi;
  let match;

  while ((match = regex.exec(html))) {
    const route = String(match[1] || "").trim();
    if (!route) continue;
    if (DYNAMIC_INDEX_PREFIXES.some(prefix => route.startsWith(prefix))) continue;
    routes.add(route);
  }

  return [...routes].sort();
}

function checkGeneratedPublicFiles() {
  const cleanupSource = read("cleanup-frontend-build.cjs");

  for (const [route, generator] of Object.entries(BUILD_GENERATED_PUBLIC_FILES)) {
    if (!exists(generator)) fail(`générateur absent pour ${route}: ${generator}`);
    const fileName = route.slice(1);
    if (!cleanupSource.includes(fileName)) {
      fail(`${route} est déclaré comme généré, mais ${generator} ne contient pas ${fileName}.`);
    }
  }
}

function checkPublicFiles() {
  const list = JSON.parse(read("public-files.json"));
  if (!Array.isArray(list)) fail("public-files.json doit contenir un tableau.");

  const duplicates = list.filter((item, index) => list.indexOf(item) !== index);
  if (duplicates.length) {
    fail(`doublons dans public-files.json: ${[...new Set(duplicates)].join(", ")}`);
  }

  const publicSet = new Set(list);
  const missingOnDisk = [];

  for (const route of list) {
    if (typeof route !== "string" || !route.startsWith("/")) {
      fail(`route publique invalide: ${String(route)}`);
    }

    const file = route.slice(1);
    if (!file) continue;
    const generated = Boolean(BUILD_GENERATED_PUBLIC_FILES[route]);
    if (!exists(file) && !generated) missingOnDisk.push(route);
  }

  if (missingOnDisk.length) {
    fail(`fichiers publics absents: ${missingOnDisk.join(", ")}`);
  }

  const indexRoutes = localRoutesFromIndex(read("index.html"));
  const missingFromAllowlist = indexRoutes.filter(route => !publicSet.has(route));
  if (missingFromAllowlist.length) {
    fail(`assets de index.html absents de public-files.json: ${missingFromAllowlist.join(", ")}`);
  }

  return { publicCount:list.length, indexCount:indexRoutes.length };
}

function checkGitignore() {
  if (!exists(".gitignore")) {
    console.warn(
      "[CI] Info: .gitignore absent. Le déploiement continue, " +
      "mais il est recommandé pour éviter de versionner les fichiers générés."
    );
  }
}

function checkCoreFiles() {
  const required = [
    "server.js",
    "app.js",
    "style.css",
    "index.html",
    "public-files.json",
    "db.js",
    "db-migrations.js",
    "presence-service.js",
    "economy-config.js",
    "socket-security.js",
    "letter-wheel-spin.wav",
    "room-mode-rules.js",
    "game-loop-rules.js",
    "inventory-service.js",
    "progression-service.js"
  ];

  const missing = required.filter(name => !exists(name));
  if (missing.length) fail(`fichiers cœur manquants: ${missing.join(", ")}`);
}

function checkVersionConsistency() {
  const pkg = JSON.parse(read("package.json"));
  const lock = JSON.parse(read("package-lock.json"));
  const version = String(pkg.version || "");

  if (!version) fail("version package.json absente.");

  if (String(lock.version || "") !== version) {
    fail("package-lock.json n'a pas la même version que package.json.");
  }

  if (String(lock.packages?.[""]?.version || "") !== version) {
    fail("package-lock.json packages[''].version incohérent.");
  }

  if (!read("app.js").includes(`const CLIENT_BUILD = "${version}";`)) {
    fail("CLIENT_BUILD dans app.js n'est pas aligné avec package.json.");
  }

  const index = read("index.html");
  const versions = [
    ...index.matchAll(/[?&]v=(\d+\.\d+\.\d+)/g)
  ].map(match => match[1]);

  if (versions.some(value => value !== version)) {
    fail("index.html contient une version d'asset différente de package.json.");
  }
}

function checkDeploymentReliability() {
  const server = read("server.js");
  const smoke = read("server-smoke.test.cjs");

  for (const marker of [
    "RENDER_GIT_COMMIT",
    "databaseReady",
    "checkDatabaseHealth",
    "DATABASE_URL est obligatoire sur Render",
    "Démarrage P'tit Bac refusé",
    "startApplication()",
    'VALIDATION_ENGINE_VERSION = "v2.7.0"',
    'SOURCE_RELEASE = "1.48.0-stable"'
  ]) {
    if (!server.includes(marker)) {
      fail(`fiabilité déploiement absente de server.js: ${marker}`);
    }
  }

  if (/\.finally\(\(\) => \{\s*server\.listen/.test(server)) {
    fail("server.js démarre encore dans finally() après une erreur de stockage.");
  }

  if (!smoke.includes("sur Render le serveur refuse de démarrer sans PostgreSQL")) {
    fail("test fail-closed Render manquant.");
  }
}

function checkIntegratedBackend() {
  const server = read("server.js");

  for (const marker of [
    'require("./db.js")',
    'require("./socket-security.js")',
    "installSocketSecurity(io);",
    "validAnswerCount",
    "countdownRoomCode"
  ]) {
    if (!server.includes(marker)) fail(`server.js n'intègre pas encore: ${marker}`);
  }

  if (server.includes('require("pg")') || server.includes("new Pool(")) {
    fail("server.js crée encore son propre Pool PostgreSQL.");
  }

  const sharedDbFiles = [
    "friends-hook.js",
    "chat-hook.js",
    "admin-hook.js",
    "player-report-hook.js",
    "friend-code-v2-hook.js"
  ];

  for (const name of sharedDbFiles) {
    const source = read(name);
    if (!source.includes('require("./db.js")')) fail(`${name} n'utilise pas db.js.`);
    if (source.includes('require("pg")') || source.includes("new Pool(")) {
      fail(`${name} crée encore son propre Pool PostgreSQL.`);
    }
  }
}

function checkIntegratedFrontend() {
  const app = read("app.js");
  const wheel = read("partie.js");
  const style = read("style.css");

  for (const marker of [
    "ptitbac:screen-rendered",
    "ptitbac:dom-updated",
    "ptbSharedDomObserver"
  ]) {
    if (!app.includes(marker)) fail(`app.js n'intègre pas E4: ${marker}`);
  }

  const observerModules = [
    "avatar-system-v1.js",
    "progression-client.js",
    "salons.js"
  ];

  for (const name of observerModules) {
    if (read(name).includes("new MutationObserver(")) {
      fail(`${name} possède encore un MutationObserver individuel.`);
    }
  }

  if (wheel.includes("data:audio/wav;base64")) {
    fail("letter-wheel-v1.js contient encore l'audio base64.");
  }
  if (wheel.includes("function ensureWheelFxStyles()")) {
    fail("letter-wheel-v1.js contient encore l'ancien injecteur CSS.");
  }
  if (!wheel.includes('"/letter-wheel-spin.wav"')) {
    fail("letter-wheel-v1.js n'utilise pas letter-wheel-spin.wav.");
  }

  const wav = fs.readFileSync(path.join(root, "letter-wheel-spin.wav"));
  if (
    wav.length <= 44 ||
    wav.subarray(0,4).toString("ascii") !== "RIFF" ||
    wav.subarray(8,12).toString("ascii") !== "WAVE"
  ) {
    fail("letter-wheel-spin.wav est invalide.");
  }

  if (!app.includes("Chargement de la partie")) {
    fail("app.js ne contient pas les fallbacks modernes attendus.");
  }

  if (Buffer.byteLength(app) > 70 * 1024) {
    fail("app.js contient encore trop de rendu legacy (>70 Ko). ");
  }
  if (Buffer.byteLength(style) > 170 * 1024) {
    fail("style.css contient encore trop de CSS legacy (>170 Ko). ");
  }
}

function checkBackendArchitecture() {
  const migrations = read("db-migrations.js");

  for (const marker of [
    "CREATE TABLE IF NOT EXISTS public.ptitbac_wallets",
    "CREATE TABLE IF NOT EXISTS public.users",
    "DROP COLUMN IF EXISTS coins",
    "ptitbac_assign_friend_code_5",
    "ptitbac_inventory_items",
    "ptitbac_progression_events"
  ]) {
    if (!migrations.includes(marker)) {
      fail(`db-migrations.js incomplet: ${marker}`);
    }
  }

  const schemaOwners = [
    "server.js",
    "friends-hook.js",
    "chat-hook.js",
    "admin-hook.js",
    "player-report-hook.js",
    "inventory-service.js",
    "progression-service.js",
    "friend-code-v2-hook.js",
    "quests-service.js",
    "shop-service.js",
    "reward-chests-service.js",
    "level-rewards-service.js"
  ];

  const schemaPattern = /CREATE\s+(?:TABLE|INDEX|EXTENSION|TRIGGER|OR\s+REPLACE\s+FUNCTION)|ALTER\s+TABLE|DROP\s+TRIGGER/i;
  for (const name of schemaOwners) {
    if (schemaPattern.test(read(name))) {
      fail(`${name} contient encore une migration PostgreSQL hors db-migrations.js.`);
    }
  }

  const coinDupPattern = /public\.users[\s\S]{0,120}\bcoins\b|\bcoins\b[\s\S]{0,120}public\.users/i;
  for (const name of ["server.js", "friends-hook.js", "admin-hook.js"]) {
    if (coinDupPattern.test(read(name))) {
      fail(`${name} utilise encore public.users.coins.`);
    }
  }

  const friends = read("friends-hook.js");
  const chat = read("chat-hook.js");
  if (!friends.includes('require("./presence-service.js")')) {
    fail("friends-hook.js n'utilise pas presence-service.js.");
  }
  if (!chat.includes('require("./presence-service.js")')) {
    fail("chat-hook.js n'utilise pas presence-service.js.");
  }
  if (friends.includes("new Map(); // userId -> Set(socketId)")) {
    fail("friends-hook.js possède encore sa propre map de présence.");
  }
  if (chat.includes("new Map(); // userId -> Set(socketId)")) {
    fail("chat-hook.js possède encore sa propre map de présence.");
  }

  const admin = read("admin-hook.js");
  const server = read("server.js");
  const app = read("app.js");

  if (admin.includes("ptitbac_player_items")) {
    fail("admin-hook.js utilise encore l’ancien inventaire admin.");
  }
  if (server.includes("wallet:adminAdjust") || app.includes("wallet:adminAdjust")) {
    fail("l’ancien endpoint wallet:adminAdjust est encore présent.");
  }
  if (
    read("friends-hook.js").includes("uniqueFriendCode") ||
    read("friends-hook.js").includes("codeStem") ||
    server.includes("economyFriendCode")
  ) {
    fail("un ancien générateur de code ami est encore présent.");
  }

  const chatList = chat.match(
    /async function conversationList\(userId\) \{([\s\S]*?)\n\}\n\nasync function history/
  )?.[1] || "";
  if (!chatList.includes("JOIN LATERAL")) {
    fail("conversationList n’utilise pas encore la requête SQL groupée.");
  }
  if ((chatList.match(/pool\.query\(/g) || []).length !== 1) {
    fail("conversationList doit effectuer un seul aller-retour PostgreSQL.");
  }
}

function checkEconomyConfiguration() {
  const config = require(path.join(root, "economy-config.js"));

  const expected = {
    DEFAULT_COINS:25,
    MAX_LIVES:5,
    LIFE_RECHARGE_MS:30 * 60 * 1000,
    REWARDED_AD_COINS:10,
    LETTER_REROLL_COST:20,
    CATEGORY_REROLL_COST:20
  };

  for (const [key, value] of Object.entries(expected)) {
    if (config[key] !== value) {
      fail(`economy-config.js: ${key} doit valoir ${value}.`);
    }
  }

  if ("RANK_REWARDS" in config) {
    fail("economy-config.js ne doit plus contenir de gains de pièces de fin de partie.");
  }

  const server = read("server.js");
  if (/GAME_REWARD|distributeRewards\(|calculateRewards/.test(server)) {
    fail("server.js contient encore un gain de pièces de fin de partie.");
  }

  const shop = read("shop-screen-v2.js");
  if (/80 pièces|\+80|500 pièces|250 pièces|coins250/.test(shop)) {
    fail("shop-screen-v2.js contient encore une ancienne offre économique.");
  }
}

function checkGameplayProgression() {
  const progression = require(path.join(root, "progression-service.js"));

  if (
    progression.TROPHY_REWARDS?.[1] !== 10 ||
    progression.TROPHY_REWARDS?.[2] !== 6 ||
    progression.TROPHY_REWARDS?.[3] !== 3 ||
    progression.TROPHY_REWARDS?.default !== 1
  ) {
    fail("barème trophées incorrect.");
  }

  const server = read("server.js");
  for (const marker of [
    "AUTO_VALIDATION_HARD_LIMIT_MS",
    "completeValidationFallback",
    "serverNow: Date.now()",
    "myAnswers: viewerRoundAnswers"
  ]) {
    if (!server.includes(marker)) {
      fail(`stabilité de partie absente: ${marker}`);
    }
  }
}

function checkProductionBundles() {
  if (!production) return;

  for (const route of Object.keys(BUILD_GENERATED_PUBLIC_FILES)) {
    if (!exists(route.slice(1))) fail(`bundle de production absent: ${route}`);
  }
}

function main() {
  checkGitignore();
  checkCoreFiles();
  checkPackage();
  checkVersionConsistency();
  checkDeploymentReliability();
  checkGeneratedPublicFiles();
  checkRenderChain();
  checkLegacyFilesRemoved();
  checkIntegratedBackend();
  checkIntegratedFrontend();
  checkBackendArchitecture();
  checkEconomyConfiguration();
  checkGameplayProgression();

  const syntaxCount = syntaxCheckAll();
  const publicInfo = checkPublicFiles();
  checkProductionBundles();

  console.log(
    `[CI] OK — ${syntaxCount} fichiers JS/CJS validés, ` +
    `${publicInfo.publicCount} fichiers publics, ` +
    `${publicInfo.indexCount} assets locaux dans index.html` +
    `${production ? ", bundles production validés" : ""}.`
  );
}

try {
  main();
} catch (error) {
  console.error(error?.stack || error?.message || error);
  process.exitCode = 1;
}
