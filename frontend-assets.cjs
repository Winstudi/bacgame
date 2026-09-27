"use strict";

/**
 * Source de vérité de l'ordre des assets frontend regroupés en production.
 * L'ordre de chaque tableau doit rester identique à index.html. Chaque
 * comportement frontend doit avoir un seul propriétaire : éviter les scripts
 * de correction tardifs, les monkey-patchs et les observers concurrents.
 */
const BUNDLES = Object.freeze([
  Object.freeze({
    type: "css",
    output: "ptb-category-avatar-patches.css",
    id: "",
    files: Object.freeze([
      "style.css",
      "design-v2.css",
      "amis.css",
      "economy.css",
      "home-mobile.css",
      "account-v1.css",
      "profil.css",
      "shop-screen-v2.css",
      "quests-screen-v1.css",
    ])
  }),
  Object.freeze({
    type: "css",
    output: "ptb-ui-wheel-patches.css",
    id: "pbw1WheelFxStyles",
    files: Object.freeze([
      "shared-footer-v1.css",
      "avatar-system-v2.css",
      "admin-v1.css",
      "admin-extra-v1.css",
      "inbox-v1.css",
      "ui-runtime-v1.css",
    ])
  }),
  Object.freeze({
    type: "css",
    output: "ptb-late-patches.css",
    id: "",
    files: Object.freeze([
      "wallet.css",
      "partie.css",
      "salons.css",
    ])
  }),
  Object.freeze({
    type: "js",
    output: "ptb-core-client.js",
    files: Object.freeze([
      "account-v1.js",
      "avatar-system-v1.js",
      "inventory-client.js",
      "progression-client.js",
      "reward-chests-client.js",
      "icon-theme-v1.js",
      "home-screen-v1.js",
      "quests-client.js",
      "profile-module-v1.js",
      "amis.js",
      "economy-client.js",
      "shop-screen-v2.js"
    ])
  }),
  Object.freeze({
    type: "js",
    output: "ptb-ui-patches.js",
    files: Object.freeze([
      "admin-v1.js",
      "admin-extra-v1.js",
      "inbox-v1.js",
      "salons.js",
      "partie.js",
    ])
  }),
  Object.freeze({
    type: "js",
    output: "ptb-late-client.js",
    files: Object.freeze([
      "wallet-client.js"
    ])
  })
]);

const REQUIRED_SOURCE_ASSETS = Object.freeze([
  "mobile-runtime.js",
  ...BUNDLES.flatMap(bundle => bundle.files)
]);

module.exports = { BUNDLES, REQUIRED_SOURCE_ASSETS };
