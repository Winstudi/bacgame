"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const installAccountAuth = require("./auth-hook.js");

function fakeIo() {
  return {
    handlers: {},
    on(event, handler) { this.handlers[event] = handler; }
  };
}

function fakeSocket() {
  return {
    data: {},
    handlers: {},
    on(event, handler) { this.handlers[event] = handler; }
  };
}

function invoke(socket, event, payload) {
  return new Promise(resolve => socket.handlers[event](payload, resolve));
}

test("auth-hook branche inscription, connexion, reprise et déconnexion", async () => {
  const calls = [];
  const service = {
    register: async payload => { calls.push(["register", payload]); return { ok:true, account:{ userId:"u1", walletToken:"a".repeat(48) } }; },
    login: async payload => { calls.push(["login", payload]); return { ok:true, account:{ userId:"u1", walletToken:"a".repeat(48) } }; },
    resume: async payload => { calls.push(["resume", payload]); return { ok:true, account:{ userId:"u1", walletToken:"a".repeat(48) } }; },
    completeProfile: async payload => { calls.push(["completeProfile", payload]); return { ok:true, account:{ userId:"u1", walletToken:"a".repeat(48), profileCompleted:true } }; },
    logout: async payload => { calls.push(["logout", payload]); return { ok:true }; }
  };

  const db = {
    async query() {
      return {
        rowCount: 1,
        rows: [{
          created_at: new Date("2026-09-16T00:00:00Z"),
          completed_games: 12,
          wins: 5,
          correct_answers: 73,
          friends: 4
        }]
      };
    }
  };

  const io = fakeIo();
  installAccountAuth(io, { service, getPool: () => db });
  const socket = fakeSocket();
  io.handlers.connection(socket);

  assert.equal((await invoke(socket, "auth:register", { email:"a@b.fr" })).ok, true);
  assert.equal((await invoke(socket, "auth:login", { email:"a@b.fr" })).ok, true);
  assert.equal((await invoke(socket, "auth:resume", { sessionToken:"x" })).ok, true);
  assert.equal((await invoke(socket, "auth:completeProfile", { username:"Nova", avatar:"/a2.webp" })).ok, true);

  const stats = await invoke(socket, "auth:profileStats", {});
  assert.deepEqual(stats, {
    ok:true,
    stats:{
      games:12,
      wins:5,
      correct:73,
      friends:4,
      memberSince:"2026-09-16T00:00:00.000Z"
    }
  });

  assert.equal((await invoke(socket, "auth:logout", { sessionToken:"x" })).ok, true);
  assert.equal((await invoke(socket, "auth:profileStats", {})).ok, false);
  assert.deepEqual(calls.map(item => item[0]), ["register", "login", "resume", "completeProfile", "logout"]);
  assert.deepEqual(calls.find(item => item[0] === "completeProfile")[1], {
    userId:"u1",
    walletToken:"a".repeat(48),
    username:"Nova",
    avatar:"/a2.webp"
  });
});
