const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const fsSync = require('node:fs');
const path = require('node:path');
const os = require('node:os');
const crypto = require('node:crypto');
const testDataDir = path.join(os.tmpdir(), `igloobot-birthday-tests-${process.pid}`);
fsSync.mkdirSync(testDataDir, { recursive: true });
process.env.IGLOOBOT_DATA_DIR = testDataDir;
const birthday = require('../src/birthday');
const command = require('../src/commands/birthday');

test.after(async () => fs.rm(testDataDir, { recursive: true, force: true }));

test('birthday date validation supports leap day but rejects impossible dates', () => {
  assert.equal(birthday.isValidBirthday(2, 29), true);
  assert.equal(birthday.isValidBirthday(2, 30), false);
  assert.equal(birthday.isValidBirthday(4, 31), false);
  assert.equal(birthday.isValidBirthday(13, 1), false);
});

test('February 29 celebrates on leap day and February 28 in common years', () => {
  assert.equal(birthday.celebrationDate(2, 29, 2024), '2024-02-29');
  assert.equal(birthday.celebrationDate(2, 29, 2025), '2025-02-28');
});

test('Taipei calendar and next celebration handle timezone boundaries and today', () => {
  assert.equal(birthday.taipeiDate(new Date('2026-10-08T16:00:00.000Z')), '2026-10-09');
  assert.equal(birthday.nextCelebration(10, 9, new Date('2026-10-08T16:00:00.000Z')), '2026-10-09');
  assert.equal(birthday.nextCelebration(10, 9, new Date('2026-10-09T16:00:00.000Z')), '2027-10-09');
});

test('birthday slash command exposes set, view, remove, upcoming, and config subcommands', () => {
  const schema = command.data.toJSON();
  assert.equal(schema.name, 'birthday');
  assert.deepEqual(schema.options.map((option) => option.name), ['set', 'view', 'remove', 'upcoming', 'config']);
  assert.equal(command.monthDay(2, 29), 'February 29');
});

test('initial registration is immediate and date changes observe the 30-day cooldown', async () => {
  const guildId = `guild-${crypto.randomUUID()}`; const userId = `user-${crypto.randomUUID()}`;
  const now = Date.now(); const today = birthday.taipeiDate(new Date(now)); const [, month, day] = today.split('-').map(Number);
  const registered = await birthday.setBirthday(guildId, userId, month, day, now);
  assert.equal(registered.changed, true);
  assert.equal(birthday.celebrationDate(month, day, Number(today.slice(0, 4))), today);
  const changed = await birthday.setBirthday(guildId, userId, month === 12 ? 1 : month + 1, day, now + 1000);
  assert.equal(changed.error, 'cooldown');
  assert.equal((await birthday.setBirthday(guildId, userId, month, day, now + 1000)).changed, false);
});

test('birthday Fish ledger is atomic, concurrent-safe, persistent, and scoped by server and year', async () => {
  const store = path.join(testDataDir, 'fish-balances.json');
  const economy = require('../src/economy');
  const guild = `guild-${crypto.randomUUID()}`;
  const otherGuild = `guild-${crypto.randomUUID()}`;
  const user = `user-${crypto.randomUUID()}`;
  const results = await Promise.all(Array.from({ length: 8 }, () => economy.awardBirthdayFish(guild, user, 2026, 1000)));
  assert.equal(results.filter((result) => result.awarded).length, 1);
  assert.equal(await economy.getFishBalance(user), 1000);
  assert.equal((await economy.awardBirthdayFish(guild, user, 2026, 1000)).awarded, false);
  assert.equal((await economy.awardBirthdayFish(otherGuild, user, 2026, 1000)).awarded, true);
  assert.equal((await economy.awardBirthdayFish(guild, user, 2027, 1000)).awarded, true);
  const disk = JSON.parse(await fs.readFile(store, 'utf8'));
  assert.equal(disk.__birthdayRewardLedger[`${guild}:${user}:2026`].amount, 1000);
  assert.equal(disk[user], 3000);
});

test('same-day processing handles concurrent and multiple birthdays, assigns and expires only its role', async () => {
  const store = path.join(testDataDir, 'birthdays.json');
  const economy = require('../src/economy');
  const originalAward = economy.awardBirthdayFish;
  const awarded = new Set();
  economy.awardBirthdayFish = async (guildId, userId, year) => {
    const id = `${guildId}:${userId}:${year}`;
    if (awarded.has(id)) return { awarded: false };
    awarded.add(id); return { awarded: true };
  };
  try {
    const guildId = `guild-${crypto.randomUUID()}`;
    const users = [`user-${crypto.randomUUID()}`, `user-${crypto.randomUUID()}`, `user-${crypto.randomUUID()}`, `user-${crypto.randomUUID()}`];
    const userWithRetry = users[2];
    const userWithoutRolePermission = users[3];
    const date = birthday.taipeiDate();
    const [year, month, day] = date.split('-').map(Number);
    const records = await Promise.all(users.map((user) => birthday.setBirthday(guildId, user, month, day)));
    assert.equal(records.every((result) => result.changed), true);
    const role = { id: 'birthday-role', name: birthday.ROLE_NAME, position: 1, managed: false };
    let roleCreations = 0;
    let roleExists = false;
    const members = new Map(users.map((user) => {
      const roles = new Set(['unrelated-role']);
      return [user, { roles: { cache: roles, add: async (added) => roles.add(added.id), remove: async (removed) => roles.delete(removed.id) } }];
    }));
    const sent = []; const payloads = []; let failSend = false;
    const channel = {
      isTextBased: () => true,
      messages: { fetch: async () => sent },
      send: async (payload) => { if (failSend) throw new Error('temporary send failure'); payloads.push(payload); const message = { id: `message-${sent.length}`, embeds: payload.embeds.map((embed) => embed.toJSON()) }; sent.push(message); return message; }
    };
    const guild = {
      id: guildId,
      members: { me: { permissions: { has: () => true }, roles: { highest: { position: 10 } } }, fetch: async (id) => members.get(id) || null },
      roles: {
        cache: { find: (predicate) => roleExists && predicate(role) ? role : null },
        fetch: async (id) => roleExists && id === role.id ? role : null,
        create: async () => { roleCreations += 1; roleExists = true; return role; }
      },
      channels: { fetch: async () => channel }
    };
    await birthday.setGuildConfig(guildId, { channelId: 'test-channel' });
    await Promise.all([birthday.processBirthday(guild, records[0].birthday, date), birthday.processBirthday(guild, records[0].birthday, date), birthday.processBirthday(guild, records[1].birthday, date)]);
    assert.equal(awarded.size, 2);
    assert.equal(roleCreations, 1);
    assert.equal(sent.length, 2);
    const mentionedUsers = payloads.map((payload) => {
      assert.deepEqual(payload.allowedMentions.parse, []);
      assert.equal(payload.allowedMentions.users.length, 1);
      return payload.allowedMentions.users[0];
    }).sort();
    assert.deepEqual(mentionedUsers, users.slice(0, 2).sort());
    assert.equal(members.get(users[0]).roles.cache.has(role.id), true);
    assert.equal(members.get(users[0]).roles.cache.has('unrelated-role'), true);

    const retryRecord = records[2].birthday;
    failSend = true;
    await assert.rejects(birthday.processBirthday(guild, retryRecord, date), /temporary send failure/);
    assert.equal(awarded.has(`${guildId}:${userWithRetry}:${year}`), true);
    failSend = false;
    await birthday.processBirthday(guild, retryRecord, date);
    await birthday.processBirthday(guild, retryRecord, date);
    assert.equal(sent.length, 3);

    const noPermissionRecord = records[3].birthday;
    const restrictedGuild = { ...guild, members: { ...guild.members, me: { permissions: { has: () => false }, roles: { highest: { position: 10 } } } } };
    await birthday.processBirthday(restrictedGuild, noPermissionRecord, date);
    assert.equal(awarded.has(`${guildId}:${userWithoutRolePermission}:${year}`), true);
    assert.equal(members.get(userWithoutRolePermission).roles.cache.has(role.id), false);
    assert.equal(sent.length, 4);
    await birthday.processBirthday(guild, noPermissionRecord, date);
    assert.equal(members.get(userWithoutRolePermission).roles.cache.has(role.id), true);
    assert.equal(sent.length, 4);

    await birthday.removeBirthday(guildId, users[0], guild);
    assert.equal(members.get(users[0]).roles.cache.has(role.id), false);
    assert.equal(members.get(users[0]).roles.cache.has('unrelated-role'), true);
    const tomorrow = new Date(Date.UTC(year, month - 1, day + 1)).toISOString().slice(0, 10);
    await birthday.reconcileRoles(guild, tomorrow);
    assert.equal(members.get(users[1]).roles.cache.has(role.id), false);
    assert.equal(sent.length, 4);
  } finally {
    economy.awardBirthdayFish = originalAward;
  }
});
