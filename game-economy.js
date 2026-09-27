"use strict";

/**
 * Depuis la 1.46.1, une fin de partie ne crédite plus de pièces.
 * Les pièces restent réservées à la boutique, aux pubs récompensées,
 * aux relances et aux futurs systèmes économiques.
 *
 * Cette fonction est conservée temporairement pour compatibilité avec
 * d'anciens appels/tests, mais renvoie toujours 0.
 */
function calculateRewards(room) {
  return Object.fromEntries(
    (room?.players || []).map(player => [player.id, 0])
  );
}

module.exports = { calculateRewards };
