"use strict";

const { getPool, ensureDatabaseSchema } = require("./db.js");
const {
  RESET_ENV,
  normalizeResetSignal,
  maybeRunPlayerDataReset
} = require("./player-data-reset.js");

(async () => {
  const requested = normalizeResetSignal(
    process.argv[2] || process.env[RESET_ENV]
  );

  if (!requested) {
    console.error(
      `Reset refusé. Utilise par exemple : node reset-player-data.cjs RESET_ACCOUNTS_V1`
    );
    process.exitCode = 2;
    return;
  }

  await ensureDatabaseSchema();
  const result = await maybeRunPlayerDataReset(getPool(), { signal:requested });
  console.log(JSON.stringify(result, null, 2));
  await getPool()?.end?.();
})().catch(error => {
  console.error("Reset joueur impossible:", error?.message || error);
  process.exitCode = 1;
});
