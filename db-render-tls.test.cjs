'use strict';
const { test } = require('node:test');
const assert = require('node:assert/strict');
const vm = require('node:vm');
const fs = require('node:fs');
const source = fs.readFileSync(require('node:path').join(__dirname, 'db.js'), 'utf8');
function config(url, env = {}) {
  let captured;
  const context = { URL, process: { env: { DATABASE_URL: url, ...env } }, module: { exports: {} }, require(name) {
    if (name === 'pg') return { Pool: class { constructor(options) { captured = options; } query() {} end() {} on() {} } };
    if (name === './db-migrations.js') return { runDatabaseMigrations() {} };
    if (name === './db-wallet-write-queue.js') return { createKeyedWriteQueue: () => ({}) };
    throw new Error(name);
  }};
  vm.runInNewContext(source, context);
  context.module.exports.getPool();
  // Check the effective pg configuration, including URL overrides.
  return new (require('pg').Client)(captured).connectionParameters;
}
test('Render internal endpoint keeps TLS with self-signed certificate support', () => {
  for (const suffix of ['', '?sslmode=require', '?ssl=false']) {
    assert.equal(config('postgres://u:p@dpg-test-a/db' + suffix, { RENDER: 'true' }).ssl.rejectUnauthorized, false);
  }
});
test('External endpoints and non-Render processes keep certificate verification', () => {
  for (const host of ['dpg-test-a.frankfurt-postgres.render.com', 'dpg-test-a.example.com', 'example.com']) {
    assert.equal(config('postgres://u:localhost@' + host + '/db', { RENDER: 'true' }).ssl.rejectUnauthorized, true);
  }
  assert.equal(config('postgres://u:p@dpg-test-a/db').ssl.rejectUnauthorized, true);
  assert.equal(config('postgres://u:p@dpg-test-a/db?host=example.com', { RENDER: 'true' }).ssl.rejectUnauthorized, true);
});
test('Explicit CA and strict URL options are retained', () => {
  const c = config('postgres://u:p@dpg-test-a/db', { RENDER: 'true', PTITBAC_DB_CA: 'line1\\nline2' });
  assert.equal(c.ssl.rejectUnauthorized, true);
  assert.equal(c.ssl.ca, 'line1\nline2');
  assert.notEqual(config('postgres://u:p@dpg-test-a/db?sslmode=verify-full', { RENDER: 'true' }).ssl.rejectUnauthorized, false);
});
test('Only actual loopback hosts use the local default', () => {
  assert.equal(config('postgres://u:p@localhost/db').ssl, false);
  assert.equal(config('postgres://u:p@127.0.0.1/db').ssl, false);
  assert.equal(config('postgres://u:p@localhost.example.com/db').ssl.rejectUnauthorized, true);
});

test('Supabase shared pooler restores encrypted compatibility with no certificate configured', () => {
  for (const suffix of ['', '?sslmode=require', '?ssl=false']) {
    const c = config('postgres://example:dummy@aws-1-eu-west-1.pooler.supabase.com:5432/postgres' + suffix);
    assert.equal(c.ssl.rejectUnauthorized, false);
    assert.equal(c.host, 'aws-1-eu-west-1.pooler.supabase.com');
    assert.equal(c.port, 5432);
  }
});
test('Supabase CA and explicit full verification take priority', () => {
  const url = 'postgres://example:dummy@aws-1-eu-west-1.pooler.supabase.com:5432/postgres';
  const c = config(url, { PTITBAC_DB_CA: 'test-ca' });
  assert.equal(c.ssl.rejectUnauthorized, true);
  assert.equal(c.ssl.ca, 'test-ca');
  assert.notEqual(config(url + '?sslmode=verify-full').ssl.rejectUnauthorized, false);
});
test('Supabase exception does not match unrelated hosts or URL overrides', () => {
  for (const host of ['aws-1-eu-west-1.pooler.supabase.com.example.org', 'example.org']) {
    assert.equal(config('postgres://example:dummy@' + host + '/postgres').ssl.rejectUnauthorized, true);
  }
  assert.equal(config('postgres://example:dummy@aws-1-eu-west-1.pooler.supabase.com/postgres?host=example.org').ssl.rejectUnauthorized, true);
});
