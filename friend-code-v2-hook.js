"use strict";

/**
 * Compatibilité historique : le trigger des codes amis 5 chiffres est
 * désormais installé par db-migrations.js avec le reste du schéma.
 */

const { hasDatabase, ensureDatabaseSchema } = require("./db.js");

if (!hasDatabase()) {
  console.warn("Codes amis V2 désactivés: DATABASE_URL absent.");
} else {
  ensureDatabaseSchema()
    .then(() => console.log("Codes amis V2 actifs: 5 chiffres uniques."))
    .catch(err =>
      console.error("Codes amis V2 initialisation impossible:", err.message)
    );
}
