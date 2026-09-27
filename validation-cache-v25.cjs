"use strict";

function clampInteger(value, min, max, fallback) {
  const parsed = Math.floor(Number(value));
  if (!Number.isFinite(parsed)) return fallback;
  return Math.max(min, Math.min(max, parsed));
}

function normalizePayload(value, engineVersion = "") {
  if (!value || !["valid", "invalid"].includes(value.status)) return null;
  const version = String(value.engineVersion || engineVersion || "").slice(0, 40);
  if (!version) return null;
  return {
    engineVersion: version,
    status: value.status,
    reason: String(value.reason || "").slice(0, 80),
    correction: String(value.correction || "").slice(0, 80),
    canonicalAnswer: String(value.canonicalAnswer || "").slice(0, 80),
    confidence: Math.max(0, Math.min(100, Math.round(Number(value.confidence) || 0))),
    explanation: String(value.explanation || "").replace(/\s+/g, " ").trim().slice(0, 180),
    updatedAt: Math.max(0, Math.floor(Number(value.updatedAt) || Date.now()))
  };
}

function touch(map, key) {
  if (!map.has(key)) return null;
  const value = map.get(key);
  map.delete(key);
  map.set(key, value);
  return value;
}

function trim(map, maxEntries = 25000) {
  const limit = clampInteger(maxEntries, 100, 100000, 25000);
  while (map.size > limit) {
    const oldest = map.keys().next().value;
    if (oldest === undefined) break;
    map.delete(oldest);
  }
  return map.size;
}

function put(map, key, value, maxEntries = 25000) {
  const safeKey = String(key || "");
  if (!safeKey) return null;
  const normalized = normalizePayload(value);
  if (!normalized) return null;

  map.delete(safeKey);
  map.set(safeKey, normalized);

  trim(map, maxEntries);
  return normalized;
}

function newestEntries(map, limit = 120) {
  const safeLimit = clampInteger(limit, 1, 1000, 120);
  return [...map.entries()].slice(-safeLimit);
}

function fromDatabaseRow(row, expectedEngineVersion = "") {
  if (!row) return null;
  const payload = typeof row.payload === "string"
    ? (() => { try { return JSON.parse(row.payload); } catch { return null; } })()
    : row.payload;
  if (!payload) return null;

  const engineVersion = String(row.engine_version || payload.engineVersion || "");
  if (expectedEngineVersion && engineVersion !== expectedEngineVersion) return null;

  return normalizePayload({
    ...payload,
    engineVersion,
    updatedAt: Number(row.updated_at || payload.updatedAt || Date.now())
  }, engineVersion);
}

function buildUpsertQuery(entries) {
  const clean = [];
  for (const [key, value] of entries || []) {
    const normalized = normalizePayload(value);
    if (!key || !normalized) continue;
    clean.push([String(key), normalized]);
  }
  if (!clean.length) return null;

  const values = [];
  const tuples = clean.map(([key, payload], index) => {
    const base = index * 4;
    values.push(
      key,
      payload.engineVersion,
      JSON.stringify(payload),
      payload.updatedAt
    );
    return `($${base + 1},$${base + 2},$${base + 3}::jsonb,$${base + 4})`;
  });

  return {
    text: `INSERT INTO public.ptitbac_validation_cache
      (cache_key, engine_version, payload, updated_at)
      VALUES ${tuples.join(",")}
      ON CONFLICT(cache_key) DO UPDATE SET
        engine_version=EXCLUDED.engine_version,
        payload=EXCLUDED.payload,
        updated_at=EXCLUDED.updated_at`,
    values,
    count: clean.length
  };
}

module.exports = Object.freeze({
  clampInteger,
  normalizePayload,
  touch,
  trim,
  put,
  newestEntries,
  fromDatabaseRow,
  buildUpsertQuery
});
