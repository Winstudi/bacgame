"use strict";

const { CATALOG } = require("./inventory-service.js");

// Source de vérité unique : tous les cadres publiés dans l'inventaire sont
// automatiquement autorisés dans les salons et les parties.
const ALLOWED_FRAMES = new Set([
  "",
  ...Object.keys(CATALOG.frame || {})
]);

function normalizeFrameId(value) {
  const id = String(value || "").trim();
  return ALLOWED_FRAMES.has(id) ? id : "";
}

module.exports = {
  normalizeFrameId,
  allowedFrames: ALLOWED_FRAMES
};
