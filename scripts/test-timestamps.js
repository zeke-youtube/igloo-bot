const test = require('node:test');
const assert = require('node:assert/strict');
const { discordTimestamp } = require('../src/utils/time');
const work = require('../src/work');
const theft = require('../src/fish-theft');

test('Discord timestamps convert milliseconds to UNIX seconds exactly once', () => {
  const now = Date.UTC(2026, 8, 26, 12, 0, 0, 123);
  assert.equal(discordTimestamp(now), `<t:${Math.floor(now / 1000)}:R>`);
  assert.equal(discordTimestamp(now, 'D'), `<t:${Math.floor(now / 1000)}:D>`);
  assert.ok(Number(discordTimestamp(now).match(/<t:(\d+):/)[1]) > 1_000_000_000);
});

test('work cooldown is calculated in milliseconds and rendered in seconds', () => {
  const now = Date.UTC(2026, 8, 26, 12, 0, 0);
  const nextWorkAtMs = now + work.WORK_COOLDOWN_MS;
  assert.equal(nextWorkAtMs - now, 30 * 60 * 1000);
  assert.equal(discordTimestamp(nextWorkAtMs), `<t:${Math.floor(nextWorkAtMs / 1000)}:R>`);
});

test('fish theft deadline remains milliseconds internally and seconds only for Discord', () => {
  const now = Date.UTC(2026, 8, 26, 12, 0, 0);
  const deadlineAtMs = now + theft.STEAL_DURATION_MS;
  assert.equal(deadlineAtMs - now, theft.STEAL_DURATION_MS);
  assert.equal(discordTimestamp(deadlineAtMs), `<t:${Math.floor(deadlineAtMs / 1000)}:R>`);
  assert.equal(now < deadlineAtMs, true);
  assert.equal(deadlineAtMs >= deadlineAtMs, true);
});

test('timestamp calculations are timezone independent', () => {
  const epoch = Date.parse('2026-09-26T12:00:00.000Z');
  assert.equal(discordTimestamp(epoch), '<t:1790424000:R>');
});
