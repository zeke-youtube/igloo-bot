const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const fsp = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');
const { spawnSync } = require('node:child_process');
const { SlashCommandBuilder } = require('discord.js');

const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'igloobot-fish-'));
process.env.IGLOOBOT_DATA_DIR = dataDir;
const economy = require('../src/economy');
const fish = require('../src/commands/fish');
const freshCatch = () => ({ id: 'sardine', name: '🐟 Sardine', rarity: 'Common', weight: 35, reward: 10 });
const operation = (interactionId, userId, now, catchResult = freshCatch()) => ({ interactionId, userId, guildId: 'guild-1', now, selectCatch: () => catchResult });

test.after(async () => { await fsp.rm(dataDir, { recursive: true, force: true }); });

test('weighted table totals 100 and cumulative selection covers all six catches exactly', () => {
  assert.equal(fish.TOTAL_WEIGHT, 100);
  assert.deepEqual(fish.CATCHES.map(({ id }) => id), ['old-boot', 'sardine', 'salmon', 'pufferfish', 'shark', 'golden-fish']);
  let start = 0;
  for (const item of fish.CATCHES) {
    assert.equal(fish.selectCatch(start).id, item.id);
    assert.equal(fish.selectCatch(start + item.weight - 1).id, item.id);
    start += item.weight;
  }
  assert.throws(() => fish.selectCatch(100), RangeError);
});

test('catch rewards match the requested table and Old Boot awards exactly zero', () => {
  assert.deepEqual(fish.CATCHES.map(({ reward }) => reward), [0, 10, 30, 60, 150, 1000]);
  const boot = fish.CATCHES.find(({ id }) => id === 'old-boot');
  return economy.processFishing({ ...operation('boot-id', 'boot-user', 1000, boot) }).then(async (result) => {
    assert.equal(result.fishAwarded, 0);
    assert.equal(await economy.getFishBalance('boot-user'), 0);
  });
});

test('30 second cooldown boundary is exact and rejected fishing does not reset it', async () => {
  const first = await economy.processFishing(operation('cooldown-first', 'cooldown-user', 10_000));
  assert.equal(first.status, 'caught');
  const blocked = await economy.processFishing(operation('cooldown-blocked', 'cooldown-user', 39_999));
  assert.equal(blocked.status, 'cooldown');
  assert.equal(blocked.remainingMs, 1);
  const allowed = await economy.processFishing(operation('cooldown-boundary', 'cooldown-user', 40_000));
  assert.equal(allowed.status, 'caught');
});

test('interaction ID returns the original result without calling catch selection again', async () => {
  const first = await economy.processFishing(operation('duplicate-id', 'duplicate-user', 100_000));
  let selected = false;
  const duplicate = await economy.processFishing({ ...operation('duplicate-id', 'duplicate-user', 100_001), selectCatch: () => { selected = true; return fish.CATCHES[5]; } });
  assert.equal(duplicate.duplicate, true);
  assert.equal(duplicate.catch.id, first.catch.id);
  assert.equal(duplicate.balance, first.balance);
  assert.equal(selected, false);
  assert.equal(await economy.getFishBalance('duplicate-user'), first.fishAwarded);
});

test('concurrent requests from one user allow only one catch', async () => {
  const results = await Promise.all(Array.from({ length: 12 }, (_, i) => economy.processFishing(operation(`parallel-${i}`, 'parallel-user', 200_000))));
  assert.equal(results.filter(({ status }) => status === 'caught').length, 1);
  assert.equal(results.filter(({ status }) => status === 'cooldown').length, 11);
  assert.equal(await economy.getFishBalance('parallel-user'), 10);
});

test('cooldown and duplicate operation persist across a fresh process', async () => {
  await economy.processFishing(operation('restart-id', 'restart-user', 300_000));
  const child = spawnSync(process.execPath, ['-e', `const e=require('./src/economy'); (async()=>{ const r=await e.processFishing({interactionId:'restart-id',userId:'restart-user',guildId:'guild-1',now:300001,selectCatch:()=>{throw Error('must not reroll')}}); const c=await e.processFishing({interactionId:'restart-next',userId:'restart-user',guildId:'guild-1',now:300001,selectCatch:()=>{throw Error('cooldown must reject before selecting')}}); if(!r.duplicate||r.catch.id!=='sardine'||c.status!=='cooldown'||c.remainingMs!==29999)process.exit(1) })().catch(()=>process.exit(2))`], { cwd: path.join(__dirname, '..'), env: { ...process.env, IGLOOBOT_DATA_DIR: dataDir }, encoding: 'utf8' });
  assert.equal(child.status, 0, child.stderr);
});

test('failed file commit rolls back Fish and cooldown before retry', async () => {
  const failureDir = await fsp.mkdtemp(path.join(os.tmpdir(), 'igloobot-fish-fail-'));
  const store = path.join(failureDir, 'fish-balances.json');
  await fsp.mkdir(store);
  const child = spawnSync(process.execPath, ['-e', `const e=require('./src/economy'); (async()=>{let failed=false;try{await e.processFishing({interactionId:'failed-write',userId:'rollback-user',guildId:'g',now:7000,selectCatch:()=>({id:'salmon',reward:30})})}catch{failed=true} if(!failed||await e.getFishBalance('rollback-user')!==0)process.exit(1); require('node:fs').rmSync(process.env.IGLOOBOT_DATA_DIR+'/fish-balances.json',{recursive:true}); const r=await e.processFishing({interactionId:'retry-write',userId:'rollback-user',guildId:'g',now:7000,selectCatch:()=>({id:'salmon',reward:30})});if(r.status!=='caught'||r.balance!==30)process.exit(2)})().catch(()=>process.exit(3))`], { cwd: path.join(__dirname, '..'), env: { ...process.env, IGLOOBOT_DATA_DIR: failureDir }, encoding: 'utf8' });
  await fsp.rm(failureDir, { recursive: true, force: true });
  assert.equal(child.status, 0, child.stderr);
});

test('fishing credits the shared Fish balance used by existing economy commands', async () => {
  await economy.addFish('shared-wallet-user', 75);
  const result = await economy.processFishing(operation('shared-wallet-id', 'shared-wallet-user', 800_000, fish.CATCHES.find(({ id }) => id === 'pufferfish')));
  assert.equal(result.balance, 135);
  assert.equal(await economy.getFishBalance('shared-wallet-user'), 135);
});

test('/fish is a registered slash command and handles success, cooldown, and database errors', async () => {
  assert.equal(fish.data instanceof SlashCommandBuilder, true);
  const original = economy.processFishing;
  const calls = [];
  try {
    economy.processFishing = async (input) => { calls.push(input); return { status: 'caught', interactionId: input.interactionId, userId: input.userId, guildId: input.guildId, catch: fish.CATCHES[3], fishAwarded: 60, timestamp: 1, balance: 1560 }; };
    let deferred = 0; let reply;
    await fish.execute({ id: 'discord-i', user: { id: 'discord-u', bot: false }, guildId: 'discord-g', deferReply: async () => { deferred += 1; }, editReply: async (value) => { reply = value; } });
    assert.equal(deferred, 1);
    assert.equal(calls[0].interactionId, 'discord-i');
    assert.equal(reply.embeds[0].toJSON().title, '🎣 Fishing Results');
    assert.match(reply.embeds[0].toJSON().description, /🐡 Pufferfish[\s\S]*\+60 Fish[\s\S]*1,560 Fish/);

    economy.processFishing = async () => ({ status: 'cooldown', remainingMs: 18_000 });
    await fish.execute({ id: 'discord-cooldown', user: { id: 'discord-u', bot: false }, guildId: 'discord-g', deferReply: async () => {}, editReply: async (value) => { reply = value; } });
    assert.match(reply.embeds[0].toJSON().description, /Try again in 18 seconds\./);

    economy.processFishing = async () => { throw new Error('disk unavailable'); };
    await fish.execute({ id: 'discord-error', user: { id: 'discord-u', bot: false }, guildId: 'discord-g', deferReply: async () => {}, editReply: async (value) => { reply = value; } });
    assert.match(reply.content, /No Fish or cooldown were recorded/);
    assert.equal(reply.content.includes('disk unavailable'), false);
  } finally { economy.processFishing = original; }
});
