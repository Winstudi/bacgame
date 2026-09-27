"use strict";
const { test } = require("node:test");
const assert = require("node:assert/strict");
const { testEnvironment } = require("./run-tests.cjs");
test("les tests ordinaires ne reçoivent ni base, ni clés, ni paramètres de production", () => {
  const source = { PATH:"/bin", HOME:"/tmp", DATABASE_URL:"postgres://production.invalid/db", OPENAI_API_KEY:"placeholder", NODE_OPTIONS:"--require unexpected.cjs", PGHOST:"production.invalid", RENDER:"true", PTITBAC_ADMIN_USER_ID:"placeholder", PTITBAC_TEST_DATABASE_URL:"postgres://test.invalid/db" };
  const env = testEnvironment(source);
  assert.equal(env.DATABASE_URL, "");
  assert.equal(env.OPENAI_API_KEY, "");
  assert.equal(env.RENDER, "false");
  assert.equal(env.NODE_ENV, "test");
  for (const key of ["NODE_OPTIONS", "PGHOST", "PTITBAC_ADMIN_USER_ID", "PTITBAC_TEST_DATABASE_URL"]) assert.equal(env[key], undefined);
  assert.equal(env.PATH, "/bin");
  assert.equal(source.DATABASE_URL, "postgres://production.invalid/db");
});
test("l’intégration distante exige une base explicite hors Render", () => {
  assert.throws(() => testEnvironment({}, true));
  assert.throws(() => testEnvironment({ RENDER:"true", PTITBAC_TEST_DATABASE_URL:"postgres://test.invalid/db" }, true));
  assert.throws(() => testEnvironment({ DATABASE_URL:"postgres://same.invalid/db", PTITBAC_TEST_DATABASE_URL:"postgres://same.invalid/db" }, true));
  const env = testEnvironment({ DATABASE_URL:"postgres://production.invalid/db", PTITBAC_TEST_DATABASE_URL:"postgres://test.invalid/db" }, true);
  assert.equal(env.DATABASE_URL, "");
  assert.equal(env.PTITBAC_TEST_DATABASE_URL, "postgres://test.invalid/db");
});
