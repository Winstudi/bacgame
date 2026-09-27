"use strict";

/**
 * Petite file FIFO par clé.
 * - Une même clé est exécutée strictement dans l'ordre.
 * - Deux clés différentes restent indépendantes et peuvent avancer en parallèle.
 * - Une tâche en erreur ne bloque jamais les suivantes.
 */
function createKeyedWriteQueue() {
  const tails = new Map();

  function enqueue(key, task) {
    const safeKey = String(key || "");
    if (!safeKey) {
      return Promise.resolve().then(task);
    }

    const previous = tails.get(safeKey) || Promise.resolve();

    const run = previous.then(() => task());

    // La queue stocke toujours une promesse résolue, même si la tâche échoue,
    // afin qu'une erreur PostgreSQL ne bloque pas définitivement le wallet.
    const tail = run.then(
      () => undefined,
      () => undefined
    );

    tails.set(safeKey, tail);

    tail.then(() => {
      if (tails.get(safeKey) === tail) {
        tails.delete(safeKey);
      }
    });

    return run;
  }

  function pending(key) {
    return tails.has(String(key || ""));
  }

  return {
    enqueue,
    pending,
    async drain() {
      while (tails.size) await Promise.all([...tails.values()]);
    }
  };
}

module.exports = {
  createKeyedWriteQueue
};
