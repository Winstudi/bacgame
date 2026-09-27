"use strict";
const { spawnSync } = require("node:child_process");
const { readdirSync } = require("node:fs");

function testEnvironment(source, postgres = false) {
  const env = {};
  // Carry only OS settings needed to execute Node and create temporary files.
  const allowed = /^(PATH|HOME|USERPROFILE|SYSTEMROOT|WINDIR|COMSPEC|PATHEXT|TEMP|TMP|TMPDIR|LANG|LC_ALL|TZ)$/i;
  for (const [key, value] of Object.entries(source)) {
    if (allowed.test(key) && value !== undefined) env[key] = value;
  }
  Object.assign(env, { NODE_ENV:"test", RENDER:"false", DATABASE_URL:"", OPENAI_API_KEY:"", OPENAI_BOT_API_KEY:"", BOT_AI_ENABLED:"false" });
  if (postgres) {
    const testUrl = String(source.PTITBAC_TEST_DATABASE_URL || "").trim();
    if (!testUrl || source.RENDER === "true" || testUrl === String(source.DATABASE_URL || "").trim()) {
      throw new Error("Utiliser une base dédiée via PTITBAC_TEST_DATABASE_URL, hors Render et différente de DATABASE_URL.");
    }
    env.PTITBAC_TEST_DATABASE_URL = testUrl;
  }
  return env;
}

if (require.main === module) {
  try {
    const postgres = process.argv.includes("--postgres");
    const files = postgres ? ["wallet-atomic-service.test.cjs"] : readdirSync(__dirname).filter(name => name.endsWith(".test.cjs")).sort();
    const result = spawnSync(process.execPath, ["--test", ...files], {
      cwd:__dirname, env:testEnvironment(process.env, postgres), stdio:"inherit"
    });
    if (result.error) throw result.error;
    process.exitCode = result.status ?? 1;
  } catch (error) {
    console.error(error.message);
    process.exitCode = 1;
  }
}
module.exports = { testEnvironment };
