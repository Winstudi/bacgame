"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const net = require("node:net");
const os = require("node:os");
const fs = require("node:fs");
const path = require("node:path");
const { spawn } = require("node:child_process");

async function freePort() {
  return await new Promise((resolve, reject) => {
    const probe = net.createServer();

    probe.once("error", reject);
    probe.listen(0, "127.0.0.1", () => {
      const address = probe.address();
      const port = Number(address?.port);

      probe.close(error => {
        if (error) reject(error);
        else resolve(port);
      });
    });
  });
}

async function waitForHealth(url, child, timeoutMs = 12_000) {
  const started = Date.now();
  let lastError = null;

  while (Date.now() - started < timeoutMs) {
    if (child.exitCode !== null) {
      throw new Error(
        `Le serveur s'est arrêté avant /health (code ${child.exitCode}).`
      );
    }

    try {
      const response = await fetch(url, {
        signal: AbortSignal.timeout(1200)
      });

      if (response.ok) {
        return await response.json();
      }

      lastError = new Error(`HTTP ${response.status}`);
    } catch (error) {
      lastError = error;
    }

    await new Promise(resolve => setTimeout(resolve, 180));
  }

  throw lastError || new Error("Timeout /health.");
}

async function stopChild(child) {
  if (!child || child.exitCode !== null || child.signalCode) return;

  child.kill("SIGTERM");

  await Promise.race([
    new Promise(resolve => child.once("exit", resolve)),
    new Promise(resolve => setTimeout(resolve, 2000))
  ]);

  if (child.exitCode === null) {
    child.kill("SIGKILL");
  }
}

function sleep(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

function emitAck(socket, event, payload = {}, timeoutMs = 5_000) {
  return new Promise((resolve, reject) => {
    socket.timeout(timeoutMs).emit(event, payload, (error, response) => {
      if (error) return reject(error);
      resolve(response || {});
    });
  });
}

function waitForEvent(socket, event, predicate = () => true, timeoutMs = 6_000) {
  return new Promise((resolve, reject) => {
    let timer = null;

    const cleanup = () => {
      if (timer) clearTimeout(timer);
      socket.off(event, handler);
    };

    const handler = payload => {
      let matches = false;
      try {
        matches = !!predicate(payload);
      } catch (error) {
        cleanup();
        reject(error);
        return;
      }
      if (!matches) return;
      cleanup();
      resolve(payload);
    };

    socket.on(event, handler);
    timer = setTimeout(() => {
      cleanup();
      reject(new Error(`Timeout en attente de ${event}.`));
    }, timeoutMs);
  });
}

function trackRoomState(socket) {
  let latest = null;
  const handler = state => {
    latest = state;
  };
  socket.on("room:state", handler);

  return {
    latest: () => latest,
    stop: () => socket.off("room:state", handler)
  };
}

async function connectGameClient(baseUrl) {
  const { io } = require("socket.io-client");

  return await new Promise((resolve, reject) => {
    const socket = io(baseUrl, {
      transports: ["websocket"],
      forceNew: true,
      reconnection: false,
      timeout: 5_000
    });

    const timer = setTimeout(() => {
      socket.close();
      reject(new Error("Timeout de connexion Socket.IO."));
    }, 6_000);

    socket.once("connect", () => {
      clearTimeout(timer);
      resolve(socket);
    });

    socket.once("connect_error", error => {
      clearTimeout(timer);
      socket.close();
      reject(error);
    });
  });
}


test(
  "le serveur démarre et répond sur /health",
  { timeout: 20_000 },
  async () => {
    const port = await freePort();
    const tempDir = fs.mkdtempSync(
      path.join(os.tmpdir(), "ptitbac-smoke-")
    );

    const walletFile = path.join(tempDir, "wallets.json");

    const child = spawn(
      process.execPath,
      ["server.js"],
      {
        cwd: __dirname,
        env: {
          ...process.env,
          PORT: String(port),
          DATABASE_URL: "",
          OPENAI_API_KEY: "",
          OPENAI_BOT_API_KEY: "",
          BOT_AI_ENABLED: "false",
          RENDER: "false",
          PTITBAC_WALLET_FILE: walletFile
        },
        stdio: ["ignore", "pipe", "pipe"]
      }
    );

    let stdout = "";
    let stderr = "";

    child.stdout.on("data", chunk => {
      stdout += chunk.toString();
    });

    child.stderr.on("data", chunk => {
      stderr += chunk.toString();
    });

    try {
      const health = await waitForHealth(
        `http://127.0.0.1:${port}/health`,
        child
      );

      assert.equal(health?.ok, true);
      assert.equal(typeof health?.version, "string");
      assert.match(health.version, /^\d+\.\d+\.\d+$/);
      assert.equal(health?.environment, "local");
      assert.equal(health?.databaseReady, false);
      assert.equal(health?.storage, "json");
      assert.equal(health?.roomStorage, "json");
      assert.equal(health?.activeRooms, 0);
      assert.equal(health?.database, "json");
      assert.equal(health?.commit, null);
      assert.equal(typeof health?.uptimeSeconds, "number");
    } catch (error) {
      throw new Error(
        `${error.message}\n--- stdout ---\n${stdout}\n--- stderr ---\n${stderr}`
      );
    } finally {
      await stopChild(child);
      fs.rmSync(tempDir, {
        recursive: true,
        force: true
      });
    }
  }
);


test(
  "un salon survit à un crash serveur et les joueurs peuvent le reprendre",
  { timeout: 32_000 },
  async () => {
    const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "ptitbac-room-restart-"));
    const walletFile = path.join(tempDir, "wallets.json");
    const roomFile = path.join(tempDir, "rooms.json");
    let first = null;
    let second = null;
    let alice = null;
    let bob = null;
    let alice2 = null;
    let bob2 = null;

    const spawnServer = async () => {
      const port = await freePort();
      const child = spawn(process.execPath, ["server.js"], {
        cwd:__dirname,
        env:{
          ...process.env,
          PORT:String(port),
          DATABASE_URL:"",
          OPENAI_API_KEY:"",
          OPENAI_BOT_API_KEY:"",
          BOT_AI_ENABLED:"false",
          RENDER:"false",
          PTITBAC_WALLET_FILE:walletFile,
          PTITBAC_ROOM_FILE:roomFile
        },
        stdio:["ignore", "pipe", "pipe"]
      });
      let stdout = "";
      let stderr = "";
      child.stdout.on("data", chunk => { stdout += chunk.toString(); });
      child.stderr.on("data", chunk => { stderr += chunk.toString(); });
      await waitForHealth(`http://127.0.0.1:${port}/health`, child);
      return { child, port, baseUrl:`http://127.0.0.1:${port}`, logs:() => ({stdout,stderr}) };
    };

    try {
      first = await spawnServer();
      alice = await connectGameClient(first.baseUrl);
      bob = await connectGameClient(first.baseUrl);

      const aliceWallet = await emitAck(alice, "wallet:init", { token:"" });
      const bobWallet = await emitAck(bob, "wallet:init", { token:"" });
      const created = await emitAck(alice, "room:create", {
        name:"Alice",
        rounds:1,
        duration:30,
        categoryCount:6,
        categoryDifficulty:"beginner",
        avatar:"/a1.webp",
        walletToken:aliceWallet.token
      });
      const joined = await emitAck(bob, "room:join", {
        code:created.code,
        name:"Bob",
        avatar:"/a2.webp",
        walletToken:bobWallet.token
      });

      assert.equal(created.ok, true);
      assert.equal(joined.ok, true);
      await emitAck(alice, "lobby:setReady", {
        code:created.code,
        playerId:created.playerId,
        ready:true
      });
      await emitAck(bob, "lobby:setReady", {
        code:created.code,
        playerId:joined.playerId,
        ready:true
      });

      const categoryPromise = waitForEvent(
        alice,
        "room:state",
        state => state?.code === created.code && state?.phase === "category_selection",
        8_000
      );
      const countdown = await emitAck(alice, "lobby:startCountdown", {
        code:created.code,
        playerId:created.playerId
      });
      assert.equal(countdown.ok, true);
      const beforeCrash = await categoryPromise;
      const categoriesBeforeCrash = [...beforeCrash.categories];

      // La sauvegarde est débouncée de quelques dizaines de ms : on laisse le
      // snapshot atteindre le disque puis on simule un crash brutal (SIGKILL).
      await sleep(220);
      alice.close();
      bob.close();
      const firstExit = new Promise(resolve => first.child.once("exit", resolve));
      first.child.kill("SIGKILL");
      await firstExit;
      assert.equal(fs.existsSync(roomFile), true);

      second = await spawnServer();
      alice2 = await connectGameClient(second.baseUrl);
      bob2 = await connectGameClient(second.baseUrl);

      const reconnectAlice = await emitAck(alice2, "room:reconnect", {
        code:created.code,
        playerId:created.playerId,
        walletToken:aliceWallet.token
      });
      const reconnectBob = await emitAck(bob2, "room:reconnect", {
        code:created.code,
        playerId:joined.playerId,
        walletToken:bobWallet.token
      });

      assert.equal(reconnectAlice.ok, true);
      assert.equal(reconnectBob.ok, true);
      assert.equal(reconnectAlice.state?.phase, "category_selection");
      assert.deepEqual(reconnectAlice.state?.categories, categoriesBeforeCrash);
      assert.equal(reconnectBob.state?.players?.length, 2);
      assert.equal(
        reconnectBob.state.players.filter(player => player.connected).length,
        2
      );
    } catch (error) {
      const logs1 = first?.logs?.() || {stdout:"",stderr:""};
      const logs2 = second?.logs?.() || {stdout:"",stderr:""};
      throw new Error(
        `${error.message}\n--- serveur 1 stdout ---\n${logs1.stdout}\n--- serveur 1 stderr ---\n${logs1.stderr}` +
        `\n--- serveur 2 stdout ---\n${logs2.stdout}\n--- serveur 2 stderr ---\n${logs2.stderr}`
      );
    } finally {
      alice?.close?.();
      bob?.close?.();
      alice2?.close?.();
      bob2?.close?.();
      await stopChild(first?.child);
      await stopChild(second?.child);
      fs.rmSync(tempDir, { recursive:true, force:true });
    }
  }
);


test(
  "sur Render le serveur refuse de démarrer sans PostgreSQL",
  { timeout: 12_000 },
  async () => {
    const port = await freePort();

    const child = spawn(
      process.execPath,
      ["server.js"],
      {
        cwd: __dirname,
        env: {
          ...process.env,
          PORT: String(port),
          RENDER: "true",
          RENDER_GIT_COMMIT: "0123456789abcdef0123456789abcdef01234567",
          DATABASE_URL: "",
          OPENAI_API_KEY: "",
          OPENAI_BOT_API_KEY: "",
          BOT_AI_ENABLED: "false"
        },
        stdio: ["ignore", "pipe", "pipe"]
      }
    );

    let stdout = "";
    let stderr = "";

    child.stdout.on("data", chunk => {
      stdout += chunk.toString();
    });

    child.stderr.on("data", chunk => {
      stderr += chunk.toString();
    });

    const exitCode = await Promise.race([
      new Promise(resolve => child.once("exit", resolve)),
      new Promise((_, reject) =>
        setTimeout(
          () => reject(new Error("Le serveur Render n'a pas refusé le démarrage.")),
          7000
        )
      )
    ]);

    if (child.exitCode === null) {
      child.kill("SIGKILL");
    }

    assert.notEqual(exitCode, 0);
    assert.match(
      `${stdout}\n${stderr}`,
      /DATABASE_URL est obligatoire sur Render|Démarrage P'tit Bac refusé/
    );
  }
);


test(
  "deux joueurs terminent une partie avec relance idempotente et reconnexion",
  { timeout: 38_000 },
  async () => {
    const port = await freePort();
    const tempDir = fs.mkdtempSync(
      path.join(os.tmpdir(), "ptitbac-e2e-")
    );
    const walletFile = path.join(tempDir, "wallets.json");

    const child = spawn(
      process.execPath,
      ["server.js"],
      {
        cwd: __dirname,
        env: {
          ...process.env,
          PORT: String(port),
          DATABASE_URL: "",
          OPENAI_API_KEY: "",
          OPENAI_BOT_API_KEY: "",
          BOT_AI_ENABLED: "false",
          RENDER: "false",
          PTITBAC_WALLET_FILE: walletFile
        },
        stdio: ["ignore", "pipe", "pipe"]
      }
    );

    let stdout = "";
    let stderr = "";
    let alice = null;
    let bob = null;
    let bobReconnect = null;
    let aliceTracker = null;
    let bobTracker = null;
    let bobReconnectTracker = null;

    child.stdout.on("data", chunk => {
      stdout += chunk.toString();
    });
    child.stderr.on("data", chunk => {
      stderr += chunk.toString();
    });

    const baseUrl = `http://127.0.0.1:${port}`;

    try {
      await waitForHealth(`${baseUrl}/health`, child);

      alice = await connectGameClient(baseUrl);
      bob = await connectGameClient(baseUrl);
      aliceTracker = trackRoomState(alice);
      bobTracker = trackRoomState(bob);

      const aliceWallet = await emitAck(alice, "wallet:init", { token:"" });
      const bobWallet = await emitAck(bob, "wallet:init", { token:"" });

      assert.equal(aliceWallet.ok, true);
      assert.equal(bobWallet.ok, true);
      assert.match(aliceWallet.token, /^[a-f0-9]{48}$/i);
      assert.match(bobWallet.token, /^[a-f0-9]{48}$/i);
      assert.equal(aliceWallet.balance, 25);
      assert.equal(bobWallet.balance, 25);
      assert.notEqual(aliceWallet.token, bobWallet.token);

      const created = await emitAck(alice, "room:create", {
        name:"Alice",
        rounds:1,
        duration:30,
        categoryCount:6,
        categoryDifficulty:"beginner",
        avatar:"/a1.webp",
        walletToken:aliceWallet.token
      });

      assert.equal(created.ok, true);
      assert.match(created.code, /^[A-Z0-9]+$/);
      assert.ok(created.playerId);
      assert.equal(created.state?.phase, "lobby");

      const joined = await emitAck(bob, "room:join", {
        code:created.code,
        name:"Bob",
        avatar:"/a2.webp",
        walletToken:bobWallet.token
      });

      assert.equal(joined.ok, true);
      assert.ok(joined.playerId);
      assert.equal(joined.state?.players?.length, 2);

      const readyAlice = await emitAck(alice, "lobby:setReady", {
        code:created.code,
        playerId:created.playerId,
        ready:true
      });
      const readyBob = await emitAck(bob, "lobby:setReady", {
        code:created.code,
        playerId:joined.playerId,
        ready:true
      });

      assert.equal(readyAlice.ok, true);
      assert.equal(readyBob.ok, true);

      const categorySelectionPromise = waitForEvent(
        alice,
        "room:state",
        state => state?.code === created.code && state?.phase === "category_selection",
        8_000
      );

      const countdown = await emitAck(alice, "lobby:startCountdown", {
        code:created.code,
        playerId:created.playerId
      });
      assert.equal(countdown.ok, true);

      const categoryState = await categorySelectionPromise;
      assert.ok(categoryState.categoryChooserPlayerId);
      assert.equal(categoryState.categories?.length, 6);

      const chooserIsAlice =
        categoryState.categoryChooserPlayerId === created.playerId;
      const categoryChooser = chooserIsAlice ? alice : bob;
      const categoryChooserToken = chooserIsAlice
        ? aliceWallet.token
        : bobWallet.token;
      const categoryChooserPlayerId = categoryState.categoryChooserPlayerId;

      const beforeReroll = await emitAck(categoryChooser, "economy:get", {
        walletToken:categoryChooserToken
      });
      assert.equal(beforeReroll.ok, true);
      assert.equal(beforeReroll.coins, 25);

      const requestId = "e2e-category-reroll-0001";
      const paidUpdatePromise = waitForEvent(
        categoryChooser,
        "wallet:update",
        payload => Number(payload?.balance) === 5,
        5_000
      );
      const rerolledStatePromise = waitForEvent(
        alice,
        "room:state",
        state => state?.code === created.code &&
          state?.phase === "category_selection" &&
          state?.categoryChooserPlayerId === categoryChooserPlayerId,
        5_000
      );

      categoryChooser.emit("game:rerollCategories", {
        code:created.code,
        playerId:categoryChooserPlayerId,
        requestId
      });

      await paidUpdatePromise;
      const rerolledState = await rerolledStatePromise;
      const categoriesAfterFirstReroll = [...(rerolledState.categories || [])];

      // Même identifiant réseau : ni second débit ni second tirage.
      categoryChooser.emit("game:rerollCategories", {
        code:created.code,
        playerId:categoryChooserPlayerId,
        requestId
      });
      await sleep(250);

      const afterDuplicate = await emitAck(categoryChooser, "economy:get", {
        walletToken:categoryChooserToken
      });
      assert.equal(afterDuplicate.ok, true);
      assert.equal(afterDuplicate.coins, 5);
      assert.deepEqual(
        aliceTracker.latest()?.categories,
        categoriesAfterFirstReroll
      );

      const letterSelectionPromise = waitForEvent(
        alice,
        "room:state",
        state => state?.code === created.code && state?.phase === "letter_selection",
        5_000
      );
      categoryChooser.emit("game:confirmCategories", {
        code:created.code,
        playerId:categoryChooserPlayerId
      });
      const letterState = await letterSelectionPromise;

      assert.ok(letterState.letterChooserPlayerId);
      const letterChooser =
        letterState.letterChooserPlayerId === created.playerId
          ? alice
          : bob;

      const spunPromise = waitForEvent(
        alice,
        "room:state",
        state => state?.code === created.code &&
          state?.phase === "letter_selection" &&
          /^[A-Z]$/.test(String(state?.pendingLetter || "")),
        5_000
      );
      letterChooser.emit("game:spinLetter", {
        code:created.code,
        playerId:letterState.letterChooserPlayerId
      });
      const spunState = await spunPromise;
      assert.match(spunState.pendingLetter, /^[A-Z]$/);

      const roundPromise = waitForEvent(
        alice,
        "room:state",
        state => state?.code === created.code && state?.phase === "round",
        5_000
      );
      letterChooser.emit("game:confirmLetter", {
        code:created.code,
        playerId:letterState.letterChooserPlayerId
      });
      const roundState = await roundPromise;

      assert.equal(roundState.roundIndex, 0);
      assert.ok(Number(roundState.roundStartsAt) > 0);
      assert.equal(roundState.currentLetter, spunState.pendingLetter);

      const waitUntilRound = Math.max(
        0,
        Number(roundState.roundStartsAt) - Date.now() + 120
      );
      if (waitUntilRound) await sleep(waitUntilRound);

      const scoreboardPromise = waitForEvent(
        alice,
        "room:state",
        state => state?.code === created.code && state?.phase === "scoreboard",
        5_000
      );
      alice.emit("round:submit", {
        code:created.code,
        playerId:created.playerId
      });
      bob.emit("round:submit", {
        code:created.code,
        playerId:joined.playerId
      });
      const scoreboard = await scoreboardPromise;

      assert.equal(scoreboard.roundIndex, 0);
      assert.equal(scoreboard.players.length, 2);
      assert.ok(scoreboard.lastRoundResults);

      // Bob perd sa socket puis reprend exactement le même joueur/wallet.
      bobTracker.stop();
      bob.close();
      bob = null;
      await sleep(120);

      bobReconnect = await connectGameClient(baseUrl);
      bobReconnectTracker = trackRoomState(bobReconnect);

      const restoredWallet = await emitAck(bobReconnect, "wallet:init", {
        token:bobWallet.token
      });
      assert.equal(restoredWallet.ok, true);
      assert.equal(restoredWallet.token, bobWallet.token);

      const reconnected = await emitAck(bobReconnect, "room:reconnect", {
        code:created.code,
        playerId:joined.playerId,
        walletToken:bobWallet.token,
        frameId:"",
        tagId:""
      });

      assert.equal(reconnected.ok, true);
      assert.equal(reconnected.state?.phase, "scoreboard");
      assert.equal(
        reconnected.state?.players?.find(p => p.id === joined.playerId)?.connected,
        true
      );

      const aliceFinishedPromise = waitForEvent(
        alice,
        "room:state",
        state => state?.code === created.code && state?.phase === "finished",
        5_000
      );
      const bobFinishedPromise = waitForEvent(
        bobReconnect,
        "room:state",
        state => state?.code === created.code && state?.phase === "finished",
        5_000
      );

      alice.emit("game:nextRound", {
        code:created.code,
        playerId:created.playerId
      });

      const [aliceFinished, bobFinished] = await Promise.all([
        aliceFinishedPromise,
        bobFinishedPromise
      ]);

      assert.equal(aliceFinished.phase, "finished");
      assert.equal(bobFinished.phase, "finished");
      assert.equal(bobReconnectTracker.latest()?.phase, "finished");

      const aliceLeave = await emitAck(alice, "room:leave", {
        code:created.code,
        playerId:created.playerId
      });
      assert.equal(aliceLeave.ok, true);

      const bobLeave = await emitAck(bobReconnect, "room:leave", {
        code:created.code,
        playerId:joined.playerId
      });
      assert.equal(bobLeave.ok, true);
    } catch (error) {
      throw new Error(
        `${error.message}\n--- stdout ---\n${stdout}\n--- stderr ---\n${stderr}`
      );
    } finally {
      aliceTracker?.stop();
      bobTracker?.stop();
      bobReconnectTracker?.stop();
      alice?.close();
      bob?.close();
      bobReconnect?.close();
      await stopChild(child);
      fs.rmSync(tempDir, {
        recursive:true,
        force:true
      });
    }
  }
);

test("la reprise des salons est aussi configurée pour PostgreSQL", () => {
  const serverSource = fs.readFileSync(path.join(__dirname, "server.js"), "utf8");
  const migrationSource = fs.readFileSync(path.join(__dirname, "db-migrations.js"), "utf8");

  assert.match(migrationSource, /CREATE TABLE IF NOT EXISTS public\.ptitbac_active_rooms/);
  assert.match(serverSource, /INSERT INTO public\.ptitbac_active_rooms/);
  assert.match(serverSource, /SELECT code,snapshot,[\s\S]*FROM public\.ptitbac_active_rooms/);
  assert.match(serverSource, /resumeRestoredRoomRuntime/);
  assert.match(serverSource, /queueRoomPersist\(room, 120\)/);
  assert.equal(
    (serverSource.match(/rooms\.delete\(/g) || []).length,
    1,
    "les suppressions de salons doivent passer par removeRoom()"
  );
});

