"use strict";

const REASON_CODES = Object.freeze([
  "recognized",
  "recognizable_typo",
  "subjective_reasonable",
  "category_mismatch",
  "unknown_or_invented",
  "too_vague",
  "factual_unverified",
  "other"
]);

function decisionThresholds(type) {
  if (type === "subjective") return { valid: 76, invalid: 78 };
  if (type === "lexical") return { valid: 88, invalid: 82 };
  return { valid: 82, invalid: 80 };
}

function validationSchema(name) {
  return {
    type: "json_schema",
    name,
    strict: true,
    schema: {
      type: "object",
      additionalProperties: false,
      properties: {
        results: {
          type: "array",
          items: {
            type: "object",
            additionalProperties: false,
            properties: {
              id: { type: "string" },
              verdict: { type: "string", enum: ["valid", "invalid", "uncertain"] },
              confidence: { type: "integer", minimum: 0, maximum: 100 },
              reason_code: { type: "string", enum: [...REASON_CODES] },
              canonical_answer: { type: "string" },
              correction: { type: "string" }
            },
            required: [
              "id",
              "verdict",
              "confidence",
              "reason_code",
              "canonical_answer",
              "correction"
            ]
          }
        }
      },
      required: ["results"]
    }
  };
}

// Le budget Responses inclut aussi le raisonnement du modèle. La v2.4 était
// trop serrée (360 min / ~72 tokens par item), ce qui pouvait tronquer le JSON.
function outputTokenBudget(itemCount, review = false) {
  const count = Math.max(1, Math.floor(Number(itemCount) || 1));
  const perItem = review ? 140 : 120;
  return Math.max(900, Math.min(5200, 320 + count * perItem));
}

async function mapWithConcurrency(values, concurrency, worker) {
  const items = Array.from(values || []);
  if (!items.length) return [];

  const limit = Math.max(
    1,
    Math.min(items.length, Math.floor(Number(concurrency) || 1))
  );
  const results = new Array(items.length);
  let cursor = 0;

  async function runner() {
    while (true) {
      const index = cursor++;
      if (index >= items.length) return;
      results[index] = await worker(items[index], index);
    }
  }

  await Promise.all(Array.from({ length: limit }, () => runner()));
  return results;
}

// Important : seules les réponses encore pending sont touchées. Une réponse
// déjà validée ou refusée par l'IA ne doit jamais devenir « non vérifiée »
// simplement parce qu'une autre réponse de la même catégorie est ambiguë.
function markPendingUnverified(
  items,
  {
    code = "validation_unresolved",
    source = "fallback",
    resetConfidence = false
  } = {}
) {
  let changed = 0;

  for (const item of items || []) {
    if (!item || item.status !== "pending") continue;

    item.status = "unverified";
    item.reason = String(code || "validation_unresolved").slice(0, 80);
    item.validationSource = String(source || "fallback").slice(0, 40);
    if (resetConfidence) item.aiConfidence = 0;
    else item.aiConfidence = Math.max(0, Number(item.aiConfidence) || 0);
    item.correction = "";
    delete item.primaryDecision;
    changed += 1;
  }

  return changed;
}

module.exports = Object.freeze({
  REASON_CODES,
  decisionThresholds,
  validationSchema,
  outputTokenBudget,
  mapWithConcurrency,
  markPendingUnverified
});
