const test = require('node:test');
const assert = require('node:assert/strict');
const bank = require('../src/bank');

test('bank uses ten fixed compound periods with floor rounding', () => {
  assert.equal(bank.calculatePayout(1000), 1104);
  assert.equal(bank.calculatePayout(1000) - 1000, 104);
});

test('bank UTC day and next reset are timezone-independent', () => {
  const beforeMidnight = Date.parse('2026-09-26T23:55:00.000Z');
  assert.equal(bank.utcDay(beforeMidnight), '2026-09-26');
  assert.equal(bank.nextMidnight(beforeMidnight), Date.parse('2026-09-27T00:00:00.000Z'));
});

test('bank production duration and compounding configuration are fixed', () => {
  assert.equal(bank.BANK_DURATION_MS, 10 * 60 * 1000);
  assert.equal(bank.BANK_COMPOUND_PERIODS, 10);
  assert.equal(bank.BANK_INTEREST_RATE, 0.01);
});
