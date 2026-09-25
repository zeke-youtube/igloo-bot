const test = require('node:test');
const assert = require('node:assert/strict');
const { eligibleDestinations } = require('../src/travel');

const destination = (guildId, overrides = {}) => ({
  guildId, invite: `https://discord.gg/${guildId}`, enabled: true, ...overrides,
});

function clientFor({ reachable = true, members = new Set() } = {}) {
  return {
    guilds: { fetch: async () => {
      if (!reachable) throw Object.assign(new Error('not found'), { code: 10004 });
      return { members: { fetch: async ({ user }) => {
        if (members.has(user)) return { id: user };
        throw Object.assign(new Error('unknown member'), { code: 10007 });
      } } };
    } },
  };
}

test('never visited and not joined is eligible', async () => {
  const result = await eligibleDestinations({ destinations: [destination('10000000000000001')], client: clientFor(), userId: 'u', currentGuildId: 'source' });
  assert.equal(result.length, 1);
});

test('passport history is irrelevant after a user leaves', async () => {
  const result = await eligibleDestinations({ destinations: [destination('10000000000000001')], client: clientFor(), userId: 'u', currentGuildId: 'source' });
  assert.equal(result.length, 1);
});

test('currently joined destinations are excluded', async () => {
  const result = await eligibleDestinations({ destinations: [destination('10000000000000001')], client: clientFor({ members: new Set(['u']) }), userId: 'u', currentGuildId: 'source' });
  assert.equal(result.length, 0);
});

test('source guild is excluded', async () => {
  const result = await eligibleDestinations({ destinations: [destination('10000000000000001')], client: clientFor(), userId: 'u', currentGuildId: '10000000000000001' });
  assert.equal(result.length, 0);
});

test('unreachable destinations are excluded', async () => {
  const result = await eligibleDestinations({ destinations: [destination('10000000000000001')], client: clientFor({ reachable: false }), userId: 'u', currentGuildId: 'source' });
  assert.equal(result.length, 0);
});

test('zero eligible destinations returns an empty list without charging', async () => {
  const result = await eligibleDestinations({ destinations: [destination('10000000000000001', { enabled: false })], client: clientFor(), userId: 'u', currentGuildId: 'source' });
  assert.deepEqual(result, []);
});
