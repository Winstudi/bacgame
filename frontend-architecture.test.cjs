"use strict";

const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const test = require("node:test");

const root = __dirname;
const PARTIE_SOURCES = new Set(["category-selection-v2.js", "letter-wheel-v1.js", "answer-screen-v1.js", "round-intro-v1.js", "waiting-screen-v1.js", "validation-screen-v1.js", "scoreboard-screen-v1.js", "final-screen-v1.js", "category-selection-v2.css", "category-chooser-card-v1.css", "letter-wheel-fx-v1.css", "letter-wheel-v1.css", "round-intro-v1.css", "answer-screen-v1.css", "waiting-screen-v1.css", "validation-screen-v1.css", "scoreboard-screen-v1.css", "final-screen-v1.css", "gameplay-flow.css", "category-prototype.css"]);
const read = name => {
  if (PARTIE_SOURCES.has(name)) {
    const merged = name.endsWith(".js") ? "partie.js" : "partie.css";
    const content = fs.readFileSync(path.join(root, merged), "utf8");
    return content.split(`/* ==== ${name} ==== */`)[1]?.split(/\n\n\/\* ==== [^\n]+\.(?:js|css) ==== \*\//)[0] || "";
  }
  return fs.readFileSync(path.join(root, name), "utf8");
};
const exists = name => fs.existsSync(path.join(root, name));

test("le runtime mobile est chargé avant le noyau client", () => {
  const html = read("index.html");
  const runtime = html.indexOf('/mobile-runtime.js');
  const app = html.indexOf('/app.js');

  assert.ok(runtime >= 0, "mobile-runtime.js absent de index.html");
  assert.ok(app >= 0, "app.js absent de index.html");
  assert.ok(runtime < app, "mobile-runtime.js doit être chargé avant app.js");
});

test("le profil n'utilise plus deux scripts concurrents", () => {
  const html = read("index.html");

  assert.match(html, /\/profile-module-v1\.js/);
  assert.doesNotMatch(html, /\/profile-screen-v2\.js/);
  assert.doesNotMatch(html, /\/profile-redesign-v1\.js/);

  const publicFiles = JSON.parse(read("public-files.json"));
  assert.ok(publicFiles.includes("/profile-module-v1.js"));
  assert.ok(!publicFiles.includes("/profile-screen-v2.js"));
  assert.ok(!publicFiles.includes("/profile-redesign-v1.js"));

  assert.equal(exists("profile-screen-v2.js"), false);
  assert.equal(exists("profile-redesign-v1.js"), false);
});

test("le bundle cœur référence uniquement le profil canonique", () => {
  const { BUNDLES } = require("./frontend-assets.cjs");
  const jsFiles = BUNDLES
    .filter(bundle => bundle.type === "js")
    .flatMap(bundle => bundle.files);

  assert.equal(
    jsFiles.filter(file => file === "profile-module-v1.js").length,
    1
  );
  assert.ok(!jsFiles.includes("profile-screen-v2.js"));
  assert.ok(!jsFiles.includes("profile-redesign-v1.js"));
});

test("le module profil expose les points d'entrée attendus", () => {
  const source = read("profile-module-v1.js");

  assert.match(source, /window\.renderProfile\s*=\s*renderProfileModule/);
  assert.match(source, /window\.renderProfileEdit\s*=\s*openProfileAvatarPicker/);
  assert.match(source, /window\.openProfileAvatarPicker\s*=\s*openProfileAvatarPicker/);
  assert.doesNotMatch(source, /new MutationObserver\s*\(/);
});

test("les anciens patchs lobby, UI et avatar ont disparu du dépôt", () => {
  const html = read("index.html");
  const publicFiles = JSON.parse(read("public-files.json"));
  const { BUNDLES } = require("./frontend-assets.cjs");
  const assets = BUNDLES.flatMap(bundle => bundle.files);

  for (const legacy of [
    "ui-fixes-v3.js",
    "ui-fixes-v3.css",
    "lobby-polish-v1.js",
    "lobby-polish-v1.css",
    "avatar-fix-v2.css",
    "avatar-system-v1.css"
  ]) {
    assert.doesNotMatch(html, new RegExp(legacy.replace(".", "\\.")));
    assert.ok(!publicFiles.includes(`/${legacy}`));
    assert.ok(!assets.includes(legacy));
    assert.equal(exists(legacy), false, `${legacy} doit être supprimé du dépôt`);
  }
});

test("les anciens scripts de transformation ont disparu du dépôt", () => {
  for (const legacy of [
    "apply-e1-source-cleanup.cjs",
    "e2-shared-db-build.cjs",
    "e3-functional-fixes-build.cjs",
    "e4-render-events-build.cjs",
    "e5-socket-security-build.cjs"
  ]) {
    assert.equal(exists(legacy), false, `${legacy} doit être supprimé du dépôt`);
  }
});


test("le correctif de position des catégories est absorbé dans le CSS canonique", () => {
  const html = read("index.html");
  const publicFiles = JSON.parse(read("public-files.json"));
  const { BUNDLES } = require("./frontend-assets.cjs");
  const assets = BUNDLES.flatMap(bundle => bundle.files);
  const css = read("category-selection-v2.css");

  assert.equal(exists("category-position-fix-v1.css"), false);
  assert.doesNotMatch(html, /category-position-fix-v1\.css/);
  assert.ok(!publicFiles.includes("/category-position-fix-v1.css"));
  assert.ok(!assets.includes("category-position-fix-v1.css"));
  assert.match(css, /Sélection catégories V7/);
  assert.match(css, /Ancien correctif de position absorbé dans ce fichier canonique/);
});



test("les relances Quick ne dépendent plus de avatar-pages-fix-v1.js", () => {
  const html = read("index.html");
  const publicFiles = JSON.parse(read("public-files.json"));
  const { BUNDLES } = require("./frontend-assets.cjs");
  const jsFiles = BUNDLES.filter(bundle => bundle.type === "js").flatMap(bundle => bundle.files);
  const quick = read("salons.js");

  assert.equal(exists("avatar-pages-fix-v1.js"), false);
  assert.doesNotMatch(html, /avatar-pages-fix-v1\.js/);
  assert.ok(!publicFiles.includes("/avatar-pages-fix-v1.js"));
  assert.ok(!jsFiles.includes("avatar-pages-fix-v1.js"));

  assert.match(quick, /QUICK_REROLL_FALLBACK_COST = 20/);
  assert.match(quick, /game:rerollLetter/);
  assert.match(quick, /game:rerollCategories/);
  assert.match(quick, /game:confirmCategories/);
});


test("le salon Quick utilise les événements partagés au lieu d'un MutationObserver", () => {
  const source = read("salons.js");

  assert.doesNotMatch(source, /new MutationObserver\s*\(/);
  assert.match(source, /ptitbac:screen-rendered/);
  assert.match(source, /ptitbac:dom-updated/);
  assert.match(source, /socket\?\.on\?\.\("room:state", scheduleEnhance\)/);
});

test("les assets canoniques restants sont chargés une seule fois", () => {
  const html = read("index.html");
  const { BUNDLES } = require("./frontend-assets.cjs");
  const assets = BUNDLES.flatMap(bundle => bundle.files);

  for (const canonical of [
    "salons.js",
    "ui-runtime-v1.css",
    "avatar-system-v2.css"
  ]) {
    assert.equal(
      assets.filter(file => file === canonical).length,
      1,
      `${canonical} doit apparaître exactement une fois dans les bundles`
    );
    assert.match(html, new RegExp(`/${canonical.replace(".", "\\.")}`));
  }
});

test("le lobby possède directement le mode public et le compte à rebours", () => {
  const html = read("index.html");
  const publicFiles = JSON.parse(read("public-files.json"));
  const { BUNDLES } = require("./frontend-assets.cjs");
  const assets = BUNDLES.flatMap(bundle => bundle.files);
  const source = read("salons.js");
  const css = read("salons.css");

  for (const legacy of ["lobby-runtime-v1.js", "lobby-runtime-v1.css"]) {
    assert.equal(exists(legacy), false, `${legacy} doit être supprimé du dépôt`);
    assert.doesNotMatch(html, new RegExp(legacy.replace(".", "\\.")));
    assert.ok(!publicFiles.includes(`/${legacy}`));
    assert.ok(!assets.includes(legacy));
  }

  assert.match(source, /typeof serverNowMs === "function"/);
  assert.match(source, /const remaining = deadline - lobbyNow\(\)/);
  assert.match(source, /"room:setMode"/);
  assert.match(source, /"lobby:startCountdown"/);
  assert.match(source, /id="plModeToggle"/);
  assert.doesNotMatch(source.split("/* ==== quick-lobby-v1.js ==== */")[0], /stopImmediatePropagation/);
  assert.match(css, /Salon privé\/public configurable/);
});

test("le runtime UI tolère une socket absente ou déconnectée", () => {
  const source = read("salons.js");

  assert.match(source, /typeof socket === "undefined"/);
  assert.match(source, /!socket\?\.connected/);
  assert.match(source, /window\.PtitBacUiRuntime/);
});

test("le salon Quick référence une icône de difficulté réellement publiée", () => {
  const source = read("salons.js");
  const publicFiles = JSON.parse(read("public-files.json"));

  assert.doesNotMatch(source, /\/difficulty-normal\.png/);
  assert.match(source, /\/difficulty\.png/);
  assert.ok(
    publicFiles.includes("/difficulty.png"),
    "difficulty.png doit rester publié dans public-files.json"
  );
  assert.equal(
    exists("difficulty.png"),
    true,
    "difficulty.png doit exister dans le dépôt"
  );
});

test("tous les fichiers frontend déclarés existent réellement", () => {
  const publicFiles = JSON.parse(read("public-files.json"));
  const { BUNDLES, REQUIRED_SOURCE_ASSETS } = require("./frontend-assets.cjs");

  for (const route of publicFiles) {
    assert.equal(
      typeof route === "string" && route.startsWith("/"),
      true,
      `route publique invalide: ${String(route)}`
    );

    const file = route.slice(1);
    if (!file) continue;

    assert.equal(
      exists(file),
      true,
      `${file} est déclaré dans public-files.json mais absent du dépôt`
    );
  }

  const bundleSources = BUNDLES.flatMap(bundle => bundle.files);
  const required = new Set([
    ...bundleSources,
    ...(Array.isArray(REQUIRED_SOURCE_ASSETS) ? REQUIRED_SOURCE_ASSETS : [])
  ]);

  for (const file of required) {
    assert.equal(
      exists(file),
      true,
      `${file} est requis par le build frontend mais absent du dépôt`
    );
  }

  assert.equal(
    exists("profile-module-v1.js"),
    true,
    "profile-module-v1.js doit rester présent sur main"
  );
});


test("un navigateur neuf ne crée pas de portefeuille avant le choix du joueur", () => {
  const app = read("app.js");
  const account = read("account-v1.js");

  assert.match(app, /const explicitGuest = localStorage\.getItem\("ptitbac_guest_mode"\) === "1"/);
  assert.match(app, /if \(!session\.walletToken && !explicitGuest\)/);
  assert.match(app, /ptitbac:wallet-ready/);
  assert.match(account, /initWallet\(finishGuest\)/);
  assert.match(account, /if \(socket\?\.connected\)/);
});

test("les données joueur sont isolées lors d'un changement de compte", () => {
  const account = read("account-v1.js");
  const inventory = read("inventory-client.js");
  const friends = read("amis.js");
  const profile = read("profile-module-v1.js");

  assert.match(account, /ptitbac:identity-changed/);
  assert.match(inventory, /ptitbac:identity-changed/);
  assert.match(inventory, /serverStateWalletToken/);
  assert.match(friends, /ptitbac:identity-changed/);
  assert.match(friends, /identityPayload\(\)\.walletToken !== token/);
  assert.match(profile, /auth:profileStats/);
  assert.match(profile, /inventory:equip/);
});


test("la sélection des catégories possède directement sa carte de joueur", () => {
  const html = read("index.html");
  const publicFiles = JSON.parse(read("public-files.json"));
  const { BUNDLES } = require("./frontend-assets.cjs");
  const jsFiles = BUNDLES.filter(bundle => bundle.type === "js").flatMap(bundle => bundle.files);
  const source = read("category-selection-v2.js");

  assert.doesNotMatch(html, /category-chooser-card-v1\.js/);
  assert.ok(!publicFiles.includes("/category-chooser-card-v1.js"));
  assert.ok(!jsFiles.includes("category-chooser-card-v1.js"));

  assert.match(source, /cat-existing-chooser/);
  assert.match(source, /PtitBacAvatars\?\.normalize/);
  assert.doesNotMatch(source, /originalRenderCategorySelection/);
  assert.doesNotMatch(source, /window\.avatarMarkup\s*=/);
  assert.doesNotMatch(source, /new MutationObserver\s*\(/);
});

test("le thème d'icônes ne patche plus le DOM après rendu", () => {
  const source = read("icon-theme-v1.js");
  const publicFiles = JSON.parse(read("public-files.json"));

  assert.doesNotMatch(source, /new MutationObserver\s*\(/);
  assert.doesNotMatch(source, /difficulty-easy\.png|difficulty-normal\.png|difficulty-hard\.png/);
  assert.match(source, /window\.PtitBacDifficultyIcon = DIFFICULTY_ICON/);
  assert.ok(publicFiles.includes("/difficulty.png"));

  for (const missing of ["home.png", "crown.png", "arrow-right.png"]) {
    assert.doesNotMatch(source, new RegExp(`\\"${missing.replace(".", "\\.")}\\"`));
  }
});

test("aucun nouveau script fix ou patch n'est chargé en production", () => {
  const { BUNDLES } = require("./frontend-assets.cjs");
  const jsFiles = BUNDLES.filter(bundle => bundle.type === "js").flatMap(bundle => bundle.files);
  const patchScripts = jsFiles.filter(file => /(?:^|[-_.])(fix|patch)(?:[-_.]|$)/i.test(file));

  assert.deepEqual(
    patchScripts,
    [],
    `les correctifs doivent être absorbés dans leur fichier propriétaire: ${patchScripts.join(", ")}`
  );
});

test("le runtime UI est le seul runtime frontend dédié restant", () => {
  const { BUNDLES } = require("./frontend-assets.cjs");
  const jsFiles = BUNDLES.filter(bundle => bundle.type === "js").flatMap(bundle => bundle.files);
  const runtimes = jsFiles.filter(file => /runtime/i.test(file)).sort();

  assert.deepEqual(runtimes, []);
});


test("le mode Quick n'est plus injecté par wallet-client", () => {
  const wallet = read("wallet-client.js");
  const quick = read("salons.js");
  const css = read("wallet.css");

  assert.doesNotMatch(wallet, /const originalScreen\s*=\s*setScreen/);
  assert.doesNotMatch(wallet, /setScreen\s*=\s*function/);
  assert.doesNotMatch(wallet, /quickStatus/);
  assert.doesNotMatch(wallet, /socket\.on\("economy:update"/);
  assert.doesNotMatch(wallet, /socket\.on\("wallet:update"/);
  assert.doesNotMatch(wallet, /socket\.on\("quick:error"/);

  assert.match(quick, /function syncQuickModeClass\(\)/);
  assert.match(quick, /classList\.toggle\("ptb-quick-game", quick\)/);

  assert.doesNotMatch(css, /#rerollCategoriesBtn/);
  assert.doesNotMatch(css, /#rerollLetterBtn/);
  assert.doesNotMatch(css, /#pbw1Reroll/);
  assert.doesNotMatch(css, /#quickStatus/);
});



test("les choix du lobby privé restent limités à 6, 8, 10 catégories et 120 secondes", () => {
  const source = read("salons.js");

  assert.match(source, /const categoryCounts = \[6, 8, 10\]/);
  assert.match(source, /const durations = \[30, 60, 90, 120\]/);
  assert.doesNotMatch(source, /Math\.max\(6,\s*Math\.min\(10,\s*nextCategoryCount \+ dir\)\)/);
});


test("la phase round a un seul propriétaire et l'écran réponses n'écrase plus le renderer", () => {
  const html = read("index.html");
  const answer = read("answer-screen-v1.js");
  const intro = read("round-intro-v1.js");

  const merged = fs.readFileSync(path.join(root, "partie.js"), "utf8");
  const answerOrder = merged.indexOf("/* ==== answer-screen-v1.js ==== */");
  const introOrder = merged.indexOf("/* ==== round-intro-v1.js ==== */");
  assert.ok(answerOrder >= 0 && introOrder >= 0 && answerOrder < introOrder,
    "answer-screen-v1.js doit charger avant round-intro-v1.js");

  assert.match(answer, /window\.PtitBacAnswerScreen\s*=\s*Object\.freeze/);
  assert.doesNotMatch(answer, /originalRenderRound/);
  assert.doesNotMatch(answer, /window\.renderRound\s*=/);
  assert.doesNotMatch(answer, /renderRound\s*=\s*renderAnswerScreenV1/);

  assert.match(intro, /window\.PtitBacAnswerScreen\?\.render/);
  assert.match(intro, /window\.renderRound\s*=\s*renderRoundPhase/);
  assert.doesNotMatch(intro, /originalRenderRound/);
});


test("validation et scoreboard ne rappellent plus un ancien renderer de secours", () => {
  const validation = read("validation-screen-v1.js");
  const scoreboard = read("scoreboard-screen-v1.js");

  assert.doesNotMatch(validation, /originalRenderValidation/);
  assert.doesNotMatch(validation, /return\s+originalRenderValidation/);
  assert.match(validation, /window\.renderValidation\s*=/);

  assert.doesNotMatch(scoreboard, /const\s+fallback\s*=\s*window\.renderScoreboard/);
  assert.doesNotMatch(scoreboard, /return\s+fallback\?\.\(\)/);
  assert.match(scoreboard, /window\.renderScoreboard\s*=\s*render/);
});

test("le CSS du lobby privé ne repose plus sur une seconde couche d'override", () => {
  const css = read("salons.css");
  const lobby = read("salons.js");

  assert.equal((css.match(/html main\.lobby-v5\.pl-private\s*\{/g) || []).length, 2,
    "une règle principale + une adaptation max-height sont attendues");
  assert.equal((css.match(/\.pl-private \.pl-setting-grid \.lobby-v5-setting-card\s*\{/g) || []).length, 2,
    "une règle principale + une adaptation max-height sont attendues");
  assert.equal((css.match(/\.pl-private \.pl-avatar\s*\{/g) || []).length, 1);
  assert.doesNotMatch(css, /\/\* Format compact, identique au fond des écrans de préparation\. \*\//);
  assert.doesNotMatch(css, /\.pl-code\b/);

  for (const className of [
    "pl-header-code", "pl-social", "pl-share", "pl-mode-toggle",
    "pl-setting-grid", "pl-player", "pl-empty", "pl-launch"
  ]) {
    assert.match(lobby, new RegExp(className));
    assert.match(css, new RegExp(`\\.${className}\\b`));
  }
});

test("le patch CSS avatar-pages a été absorbé par ses propriétaires", () => {
  const html = read("index.html");
  const publicFiles = JSON.parse(read("public-files.json"));
  const { BUNDLES } = require("./frontend-assets.cjs");
  const cssFiles = BUNDLES
    .filter(bundle => bundle.type === "css")
    .flatMap(bundle => bundle.files);
  const cosmetics = read("avatar-system-v2.css");
  const quick = read("salons.css");

  assert.doesNotMatch(html, /avatar-pages-fix-v1\.css/);
  assert.ok(!publicFiles.includes("/avatar-pages-fix-v1.css"));
  assert.ok(!cssFiles.includes("avatar-pages-fix-v1.css"));
  assert.equal(exists("avatar-pages-fix-v1.css"), false,
    "avatar-pages-fix-v1.css doit être supprimé du dépôt après migration");

  for (const selector of [
    "ptb-base-avatar",
    "inventory-v2-page",
    "inventory-v2-avatar-grid",
    "inventory-v2-frame-grid",
    "ptb-equipped-frame-overlay"
  ]) {
    assert.match(cosmetics, new RegExp(selector));
  }

  assert.match(quick, /\.quick-lobby-v1 \.lobby-v5-avatar\.ptb-has-equipped-frame/);
  assert.match(quick, /\.ptb-quick-reroll-restored/);
  assert.match(quick, /min-width:clamp\(82px,22vw,92px\)/);
});

test("aucun CSS de correctif tardif nommé fix ou patch n'est chargé en production", () => {
  const { BUNDLES } = require("./frontend-assets.cjs");
  const cssFiles = BUNDLES
    .filter(bundle => bundle.type === "css")
    .flatMap(bundle => bundle.files);
  const lateFixes = cssFiles.filter(file =>
    /(?:^|[-_.])(fix|patch)(?:[-_.]|$)/i.test(file)
  );

  assert.deepEqual(lateFixes, [],
    `les styles correctifs doivent être absorbés: ${lateFixes.join(", ")}`);
});
