"use strict";

const fs = require("fs");
const path = require("path");

const ROOT = __dirname;
const OUTPUT_DIR = path.join(ROOT, ".ptb-assets");

// Les icônes du jeu sont affichées petites sur mobile. On conserve une
// résolution largement suffisante pour les écrans Retina, tout en évitant
// d'envoyer des PNG de 0,5 à 1,5 Mo pour des éléments de 30 à 100 px.
const ASSETS = Object.freeze({
  "admin-crown.png": 384,
  "back-arrow.png": 256,
  "coin.png": 256,
  "create.png": 256,
  "difficulty.png": 384,
  "friends.png": 256,
  "gem.png": 256,
  "heart.png": 256,
  "info.png": 256,
  "inventaire.png": 256,
  "join.png": 256,
  "lightning.png": 256,
  "lobby-categories.png": 256,
  "lobby-clock.png": 256,
  "lobby-copy.png": 256,
  "lobby-exit.png": 256,
  "lobby-minus.png": 192,
  "lobby-plus.png": 256,
  "plus.png": 256,
  "profile-icon.png": 256,
  "ptitbac.logo.png": 512,
  "rewards.png": 384,
  "round-flag.png": 256,
  "scoreboard-trophy.png": 384,
  "settings.png": 256,
  "shared-footer-v1.png": 1024,
  "shop.png": 256,
  "task.png": 256
});

function webpName(sourceName) {
  return sourceName.replace(/\.png$/i, ".webp");
}

function formatBytes(value) {
  const bytes = Math.max(0, Number(value) || 0);
  if (bytes < 1024) return `${bytes} o`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} Ko`;
  return `${(bytes / 1024 / 1024).toFixed(2)} Mo`;
}

async function optimizeAssets({ sharpImpl } = {}) {
  const sharp = sharpImpl || require("sharp");
  fs.mkdirSync(OUTPUT_DIR, { recursive: true });

  let inputBytes = 0;
  let outputBytes = 0;
  let converted = 0;
  let skipped = 0;

  for (const [sourceName, maxWidth] of Object.entries(ASSETS)) {
    const source = path.join(ROOT, sourceName);
    if (!fs.existsSync(source)) {
      skipped += 1;
      continue;
    }

    const target = path.join(OUTPUT_DIR, webpName(sourceName));
    const sourceStat = fs.statSync(source);

    // Réutilise le cache local quand la source n'a pas changé.
    if (fs.existsSync(target)) {
      const targetStat = fs.statSync(target);
      if (targetStat.mtimeMs >= sourceStat.mtimeMs && targetStat.size > 0) {
        inputBytes += sourceStat.size;
        outputBytes += targetStat.size;
        converted += 1;
        continue;
      }
    }

    await sharp(source, { failOn: "none", animated: false })
      .rotate()
      .resize({
        width: maxWidth,
        height: maxWidth,
        fit: "inside",
        withoutEnlargement: true
      })
      .webp({
        quality: 90,
        alphaQuality: 100,
        smartSubsample: true,
        effort: 5
      })
      .toFile(target);

    const targetStat = fs.statSync(target);
    inputBytes += sourceStat.size;
    outputBytes += targetStat.size;
    converted += 1;
  }

  const saved = Math.max(0, inputBytes - outputBytes);
  const reduction = inputBytes > 0
    ? Math.round((saved / inputBytes) * 100)
    : 0;

  console.log(
    `[Assets] ${converted} image(s) optimisée(s), ${skipped} absente(s). ` +
    `${formatBytes(inputBytes)} -> ${formatBytes(outputBytes)} (-${reduction}%).`
  );

  return { converted, skipped, inputBytes, outputBytes, reduction };
}

module.exports = {
  ASSETS,
  OUTPUT_DIR,
  webpName,
  optimizeAssets
};

if (require.main === module) {
  optimizeAssets().catch(err => {
    console.error("[Assets] Optimisation impossible:", err?.message || err);
    process.exitCode = 1;
  });
}
