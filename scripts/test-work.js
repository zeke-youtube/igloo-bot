const test = require('node:test');
const assert = require('node:assert/strict');
const { SlashCommandBuilder } = require('discord.js');
const command = require('../src/commands/work');
const work = require('../src/work');
const fishDrop = require('../src/fish-drop');
const addFish = require('../src/commands/addfish');

test('/work is a no-argument slash command', () => {
  assert.equal(command.data instanceof SlashCommandBuilder, true);
  assert.equal(command.data.name, 'work');
  assert.equal(command.data.options.length, 0);
});

test('work has varied jobs and avoids malformed definitions', () => {
  assert.equal(work.jobs.length, 20);
  assert.equal(new Set(work.jobs.map((job) => job.id)).size, work.jobs.length);
  for (const job of work.jobs) {
    assert.ok(job.title);
    assert.ok(Array.isArray(job.messages) && job.messages.length > 0);
  }
});

test('outcome probabilities are centralized and total 100%', () => {
  assert.deepEqual(work.OUTCOME_WEIGHTS, { normal: 70, great: 20, failure: 8, rare: 2 });
  assert.equal(Object.values(work.OUTCOME_WEIGHTS).reduce((sum, value) => sum + value, 0), 100);
});

test('all reward ranges are non-negative whole-fish ranges', () => {
  for (const [outcome, [min, max]] of Object.entries(work.REWARDS)) {
    assert.equal(Number.isSafeInteger(min), true, outcome);
    assert.equal(Number.isSafeInteger(max), true, outcome);
    assert.ok(min >= 0 && max >= min, outcome);
    for (let index = 0; index < 25; index += 1) {
      const reward = work.rewardFor(outcome);
      assert.ok(reward >= min && reward <= max, `${outcome} reward out of range`);
    }
  }
});

test('outcome selection only returns configured outcomes', () => {
  const valid = new Set(Object.keys(work.OUTCOME_WEIGHTS));
  for (let index = 0; index < 500; index += 1) assert.ok(valid.has(work.chooseOutcome()));
});

test('cooldown is 30 minutes and relative timestamps use seconds', () => {
  assert.equal(work.WORK_COOLDOWN_MS, 30 * 60 * 1000);
  const nextWorkAt = Date.now() + work.WORK_COOLDOWN_MS;
  const timestamp = Math.ceil(nextWorkAt / 1000);
  assert.match(`<t:${timestamp}:R>`, /^<t:\d+:R>$/);
});

test('existing users without work fields receive safe defaults', async () => {
  const stats = await work.getWorkStats('user-with-no-work-record');
  assert.deepEqual(stats, { totalWorkShifts: 0 });
});

test('fish drop uses the requested production defaults', () => {
  assert.equal(fishDrop.FISH_DROP_INTERVAL_MS, 10 * 60 * 1000);
  assert.equal(fishDrop.FISH_DROP_REWARD, 10);
});

test('fish drop scheduler starts once and tolerates a missing channel', async () => {
  const client = { channels: { fetch: async () => null } };
  assert.equal(fishDrop.isStarted(), false);
  assert.equal(await fishDrop.start(client), true);
  assert.equal(fishDrop.isStarted(), true);
  assert.equal(await fishDrop.start(client), false);
  await fishDrop.stop();
  assert.equal(fishDrop.isStarted(), false);
});

test('/addfish requires Administrator permission', () => {
  assert.equal(addFish.isAdmin({ member: { permissions: { has: () => true } } }), true);
  assert.equal(addFish.isAdmin({ member: { permissions: { has: () => false } } }), false);
  assert.equal(addFish.isAdmin({ member: null }), false);
});

test('/addfish validates positive safe amounts and the configured maximum', () => {
  assert.equal(addFish.validateAmount(1), null);
  assert.equal(addFish.validateAmount(addFish.MAX_ADMIN_FISH_GRANT), null);
  assert.match(addFish.validateAmount(0), /positive/);
  assert.match(addFish.validateAmount(-1), /positive/);
  assert.match(addFish.validateAmount(1.5), /positive/);
  assert.match(addFish.validateAmount(Number.NaN), /positive/);
  assert.match(addFish.validateAmount(addFish.MAX_ADMIN_FISH_GRANT + 1), /exceed/);
});

test('/addfish exposes an integer option with min and max constraints', () => {
  const amountOption = addFish.data.options.find((option) => option.name === 'amount');
  assert.equal(amountOption.type, 4);
  assert.equal(amountOption.min_value, 1);
  assert.equal(amountOption.max_value, addFish.MAX_ADMIN_FISH_GRANT);
});
