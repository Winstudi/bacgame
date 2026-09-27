"use strict";

module.exports = function installQuickMatch({
  io,
  eligible,
  match,
  admit = () => {},
  leave = () => {},
  startDelayMs = 700
}) {
  const entries = new Map();
  const tokenOwners = new Map();
  const groups = new Set();

  function remove(entry) {
    entries.delete(entry.socket.id);

    if (tokenOwners.get(entry.token) === entry.socket.id) {
      tokenOwners.delete(entry.token);
    }

    entry.group?.entries.delete(entry);
  }

  function readySnapshot(group) {
    const players = [...group.entries]
      .filter(entry => entry.playerId)
      .map(entry => ({
        playerId: entry.playerId,
        ready: !!entry.ready
      }));

    const count = group.entries.size;
    const readyCount = [...group.entries].filter(entry => entry.ready).length;

    return {
      count,
      readyCount,
      allReady: count >= 2 && readyCount === count,
      starting: !!group.starting,
      deadline: group.starting ? group.deadline : null,
      players
    };
  }

  function broadcast(group) {
    const snapshot = readySnapshot(group);

    for (const entry of group.entries) {
      entry.socket.emit("quick:queued", {
        count: snapshot.count,
        readyCount: snapshot.readyCount,
        deadline: snapshot.deadline
      });

      entry.socket.emit("quick:ready-state", snapshot);
    }
  }

  function canStart(group) {
    return (
      !group.matching &&
      group.entries.size >= 2 &&
      [...group.entries].every(entry =>
        entry.ready &&
        entry.playerId &&
        entry.socket.connected
      )
    );
  }

  function cancelPendingStart(group) {
    if (group.timer) clearTimeout(group.timer);
    group.timer = null;
    group.deadline = null;
    group.starting = false;
  }

  function update(group) {
    const count = group.entries.size;

    if (!count) {
      cancelPendingStart(group);
      groups.delete(group);
      return;
    }

    const shouldStart = canStart(group);

    if (!shouldStart && group.starting) {
      cancelPendingStart(group);
    }

    if (shouldStart && !group.starting && !group.matching) {
      group.starting = true;
      group.deadline = Date.now() + startDelayMs;

      group.timer = setTimeout(() => {
        flush(group);
      }, startDelayMs);

      group.timer.unref?.();
    }

    broadcast(group);
  }

  async function flush(group) {
    group.timer = null;

    // Un joueur peut retirer son état "prêt" pendant le petit délai
    // précédant le lancement. Dans ce cas, on annule proprement.
    if (!canStart(group)) {
      group.starting = false;
      group.deadline = null;
      update(group);
      return;
    }

    group.starting = false;
    group.deadline = null;
    group.matching = true;

    const selected = [...group.entries];

    // Fige visuellement le groupe pendant que le serveur consomme les vies
    // et prépare la partie.
    broadcast(group);

    try {
      await match(selected);
    } catch (err) {
      for (const entry of selected) {
        entry.socket.emit("quick:error", {
          error: err.message || "Recherche interrompue."
        });
      }
    } finally {
      for (const entry of selected) remove(entry);
      groups.delete(group);
    }
  }

  function cancel(socket) {
    const entry = entries.get(socket.id);
    if (!entry) return true;

    // Une fois match() réellement commencé, on évite un départ concurrent
    // pendant le prélèvement des vies.
    if (entry.group?.matching) return false;

    const group = entry.group;

    if (group?.starting) {
      cancelPendingStart(group);
    }

    remove(entry);

    if (group) {
      leave(entry);
      update(group);
    }

    return true;
  }

  function setReady(socket, value, cb = () => {}) {
    const entry = entries.get(socket.id);

    if (!entry || !entry.group) {
      return cb({
        ok: false,
        error: "Tu n’es plus dans la recherche rapide."
      });
    }

    if (entry.group.matching) {
      return cb({
        ok: false,
        error: "La partie est déjà en cours de lancement."
      });
    }

    entry.ready = value === true;
    update(entry.group);

    cb({
      ok: true,
      ready: entry.ready,
      ...readySnapshot(entry.group)
    });
  }

  io.on("connection", socket => {
    socket.on("quick:join", async (profile = {}, cb = () => {}) => {
      if (entries.has(socket.id)) {
        const entry = entries.get(socket.id);
        return cb({
          ok: true,
          queued: true,
          ready: !!entry.ready
        });
      }

      const token = String(
        profile.walletToken || socket.data.walletToken || ""
      );

      if (!/^[a-f0-9]{48}$/i.test(token)) {
        return cb({
          ok: false,
          error: "Attends le chargement du profil puis réessaie."
        });
      }

      if (tokenOwners.has(token)) {
        return cb({
          ok: false,
          error: "Ce profil recherche déjà une partie sur une autre connexion."
        });
      }

      const entry = {
        socket,
        profile,
        token,
        ready: false,
        playerId: "",
        code: ""
      };

      entries.set(socket.id, entry);
      tokenOwners.set(token, socket.id);

      try {
        entry.profile = await eligible(socket, profile);

        if (entries.get(socket.id) !== entry || !socket.connected) {
          return cb({ ok: false, cancelled: true });
        }

        // Un groupe qui a déjà tous ses joueurs prêts est verrouillé pendant
        // le très court délai de lancement : un nouveau joueur rejoint alors
        // un autre groupe au lieu d'annuler ce départ.
        const group =
          [...groups].find(candidate =>
            !candidate.matching &&
            !candidate.starting &&
            candidate.entries.size < 6
          ) || {
            entries: new Set(),
            timer: null,
            deadline: null,
            starting: false,
            matching: false
          };

        const result = admit(entry, [...group.entries]);

        // Le serveur peut admettre directement le joueur dans un salon public
        // déjà existant. Dans ce cas la recherche est terminée immédiatement :
        // aucune file rapide parallèle ne doit rester attachée à la socket.
        if (result?.completed === true) {
          cb({
            ok: true,
            queued: false,
            matched: true,
            ready: false
          });

          socket.emit("quick:matched", result);
          remove(entry);
          return;
        }

        entry.group = group;
        group.entries.add(entry);
        groups.add(group);

        cb({
          ok: true,
          queued: true,
          ready: false
        });

        if (result) {
          socket.emit("quick:matched", result);
        }

        update(group);
      } catch (err) {
        remove(entry);

        cb({
          ok: false,
          error: err.message || "Recherche indisponible."
        });
      }
    });

    socket.on("quick:ready", ({ ready } = {}, cb = () => {}) => {
      setReady(socket, ready === true, cb);
    });

    socket.on("quick:cancel", (_payload, cb = () => {}) => {
      cb({ ok: cancel(socket) });
    });

    socket.on("disconnect", () => {
      cancel(socket);
    });
  });

  return {
    cancel,
    setReady,
    close() {
      for (const group of groups) {
        if (group.timer) clearTimeout(group.timer);
      }

      groups.clear();
      entries.clear();
      tokenOwners.clear();
    }
  };
};
