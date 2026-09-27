"use strict";
const test = require("node:test");
const assert = require("node:assert/strict");
const { PGlite } = require("@electric-sql/pglite");
const { pgcrypto } = require("@electric-sql/pglite/contrib/pgcrypto");
const { runDatabaseMigrations } = require("./db-migrations.js");
const { createAccountAuthService } = require("./account-auth.js");
const { createSessionAccess } = require("./session-access.js");
const { createInventoryService } = require("./inventory-service.js");
const { createWalletAtomicService } = require("./wallet-atomic-service.js");
const { createQuestsService } = require("./quests-service.js");
const { createShopService } = require("./shop-service.js");
const { createProgressionService } = require("./progression-service.js");
const { createRewardChestService } = require("./reward-chests-service.js");
const { createLevelRewardsService } = require("./level-rewards-service.js");

// SQL executed by embedded PostgreSQL (WASM). This does not replace a network/TLS
// test or multi-connection concurrency tests against the production PG version.
test("SQL intégré : migration, compte, sessions, achats, gemmes, quêtes et niveaux", async () => {
  const engine = new PGlite({ extensions:{ pgcrypto } });
  const query = async (sql, values) => {
    const result = await engine.query(sql, values);
    return { ...result, rowCount:result.rows.length || result.affectedRows || 0 };
  };
  const pool = { query, connect:async () => ({ query, release() {} }) };
  const getPool = () => pool;
  const ensureSchema = async () => {};
  try {
    await runDatabaseMigrations(pool);
    const auth = createAccountAuthService({ getPool, ensureDatabaseSchema:ensureSchema });
    const registered = await auth.register({ email:"audit@example.test", password:"example-test-password", username:"Audit" });
    assert.equal(registered.ok, true);
    const account = registered.account;
    assert.match(account.userId, /^[a-f0-9-]{36}$/);
    assert.equal(account.balance, 25);
    assert.equal(account.gems, 0);
    const token = account.walletToken;
    const access = createSessionAccess({ getPool });
    const socket = { data:{} };
    assert.equal(await access.authorize(socket, "inventory:get", { walletToken:token }), false);
    assert.equal(await access.authenticate(socket, account.sessionToken), true);
    assert.equal(socket.data.isAccountAdmin, false);
    assert.equal(await access.authorize(socket, "inventory:get", {}), true);
    const login = await auth.login({ email:"audit@example.test", password:"example-test-password" });
    assert.equal(login.ok, true);
    await auth.logout({ sessionToken:account.sessionToken });
    assert.equal(await access.authorize(socket, "inventory:get", {}), false);
    assert.equal(await access.authenticate(socket, login.account.sessionToken), true);

    const inventory = createInventoryService({ getPool, ensureSchema });
    await inventory.getState(token);
    const wallet = createWalletAtomicService({ getPool, ensureSchema });
    assert.equal((await wallet.changeCoins({ walletToken:token, delta:100, idempotencyKey:"audit-credit" })).balance, 125);
    assert.equal((await wallet.changeCoins({ walletToken:token, delta:100, idempotencyKey:"audit-credit" })).duplicate, true);
    assert.equal((await wallet.changeGems({ walletToken:token, delta:7, idempotencyKey:"audit-gems" })).gems, 7);
    assert.equal((await wallet.changeGems({ walletToken:token, delta:-8, idempotencyKey:"audit-too-much" })).ok, false);

    const shop = createShopService({ pool:getPool, ensureSchema, inventoryService:inventory, walletAtomicService:wallet });
    await pool.query(`INSERT INTO public.ptitbac_shop_offers
      (id,item_key,item_keys,display_name,currency,base_price,block_no,position_no,ends_at)
      VALUES('audit-offer','frame:frame_ice','["frame:frame_ice"]'::jsonb,'Glace','gems',3,1,1,now()+interval '1 day')`);
    const bought = await shop.purchase(token, "audit-offer", "audit-purchase-001");
    assert.equal(bought.gems, 4);
    assert.equal((await shop.purchase(token, "audit-offer", "audit-purchase-001")).duplicate, true);
    assert.equal((await pool.query("SELECT gems FROM public.ptitbac_wallets WHERE token=$1", [token])).rows[0].gems, 4);

    const quests = createQuestsService({ getPool, ensureSchema });
    const status = await quests.status(token);
    assert.equal(status.quests.length, 3);
    assert.ok(status.quests.every(item => item.progress === 0));
    assert.equal((await quests.status(token)).quests.length, 3);
    const progression = createProgressionService({ getPool, ensureSchema });
    const chestService = createRewardChestService({ getPool, ensureSchema, inventoryService:inventory, walletAtomicService:wallet });
    const levels = createLevelRewardsService({ getPool, ensureSchema, progressionService:progression, inventoryService:inventory, walletAtomicService:wallet, chestService });
    await levels.claim(token, 1);
    assert.equal((await levels.claim(token, 1)).duplicate, true);
    // Reapplying the schema must not remove wallet balances, purchases or items.
    await runDatabaseMigrations(pool);
    const after = (await pool.query("SELECT coins,gems FROM public.ptitbac_wallets WHERE token=$1", [token])).rows[0];
    assert.deepEqual(after, { coins:125, gems:4 });
    assert.equal((await pool.query("SELECT count(*)::int AS n FROM public.ptitbac_shop_purchases WHERE wallet_token=$1", [token])).rows[0].n, 1);
  } finally { await engine.close(); }
});

test('groupes persistants : invitations, capacité, permissions, départ et salon privé', async () => {
  const { createPartyService } = require('./friends-hook.js');
  const engine = new PGlite({ extensions:{ pgcrypto } });
  const query = async (sql, values) => {
    const result = await engine.query(sql, values);
    return { ...result, rowCount:result.rows.length || result.affectedRows || 0 };
  };
  const pool = { query, connect:async () => ({ query, release() {} }) };
  let roomLive = false;
  const service = () => createPartyService({ pool,
    roomAvailable:(code, token) => roomLive && code === 'ABC123' && token === '1'.repeat(48),
    online:() => true });
  try {
    await runDatabaseMigrations(pool);
    await runDatabaseMigrations(pool); // Safe on a deployment that runs migrations again.
    const users = [];
    for (let i=1;i<=8;i++) {
      const inserted = await query('INSERT INTO public.users(friend_code,username,wallet_token) VALUES($1,$2,$3) RETURNING id',
        [String(20000+i),`Ami ${i}`,String(i).repeat(48)]);
      users.push(inserted.rows[0].id);
    }
    const [leader, friend, outsider] = users;
    for (const id of users.slice(1)) await query('INSERT INTO public.friendships(user_id,friend_id) VALUES($1,$2)', [leader,id]);
    const party = service();
    await party.mutate(leader,'create');
    const id = (await party.state(leader)).party.id;
    await party.mutate(leader,'create');
    assert.equal((await party.state(leader)).party.id,id);
    await assert.rejects(party.mutate(outsider,'accept',{partyId:id}), /Invitation/);
    await party.mutate(leader,'invite',{friendId:friend});
    assert.equal((await party.state(friend)).invitations.length,1);
    await party.mutate(friend,'accept',{partyId:id});
    await party.mutate(friend,'accept',{partyId:id}); // Retry does not add a duplicate.
    assert.equal((await party.state(leader)).party.members.length,2);
    assert.equal((await service().state(friend)).party.id,id); // New service instance, same saved group.
    await assert.rejects(party.mutate(friend,'invite',{friendId:outsider}), /responsable/);
    await assert.rejects(party.mutate(friend,'shareRoom',{roomCode:'ABC123'}), /responsable/);
    await assert.rejects(party.mutate(leader,'shareRoom',{roomCode:'ABC123'}), /salon privé/);
    roomLive = true;
    await party.mutate(leader,'shareRoom',{roomCode:'ABC123'});
    assert.equal((await party.state(friend)).party.roomCode,'ABC123');
    roomLive = false;
    assert.equal((await party.state(friend)).party.roomCode,'');
    await party.mutate(leader,'invite',{friendId:outsider});
    await query("UPDATE public.ptitbac_party_invites SET expires_at=now()-interval '1 second' WHERE user_id=$1",[outsider]);
    await assert.rejects(party.mutate(outsider,'accept',{partyId:id}), /Invitation/);
    await party.mutate(leader,'invite',{friendId:outsider});
    await party.mutate(outsider,'decline',{partyId:id});
    assert.equal((await party.state(outsider)).invitations.length,0);
    // Five pending invitations can compete for the four remaining seats.
    for (const uid of users.slice(2,7)) await party.mutate(leader,'invite',{friendId:uid});
    for (const uid of users.slice(2,6)) await party.mutate(uid,'accept',{partyId:id});
    assert.equal((await party.state(leader)).party.members.length,6);
    await assert.rejects(party.mutate(users[6],'accept',{partyId:id}), /complet/);
    assert.equal((await party.state(users[6])).party,null);
    await party.mutate(leader,'leave');
    const transferred = (await party.state(friend)).party;
    assert.equal(transferred.leaderId,friend);
    assert.equal(transferred.roomCode,'');
    assert.equal((await party.state(leader)).party,null);
    await party.mutate(leader,'create');
    assert.notEqual((await party.state(leader)).party.id,id);
    for (const uid of users.slice(1,6)) await party.mutate(uid,'leave');
    assert.equal((await query('SELECT 1 FROM public.ptitbac_parties WHERE id=$1',[id])).rowCount,0);
  } finally { await engine.close(); }
});
