const test = require('node:test'); const assert = require('node:assert/strict'); const { encode } = require('../src/pika-screaming');
test('WaddleRace canonical answers', () => {
  assert.equal(encode('CAB'), 'aaa a aa');
  assert.equal(encode('CAB BAD'), 'aaa a aa  aa a aaaa');
  assert.equal(encode('HI!'), 'aaaaaaaa aaaaaaaaa!');
  assert.equal(encode('WHAT?'), `${'a'.repeat(23)} ${'a'.repeat(8)} a ${'a'.repeat(20)}?`);
  assert.equal(encode('PikaPeng.exe'), `${'a'.repeat(16)} ${'a'.repeat(9)} ${'a'.repeat(11)} ${'a'} ${'a'.repeat(16)} ${'a'.repeat(5)} ${'a'.repeat(14)} ${'a'.repeat(7)}.${'a'.repeat(5)} ${'a'.repeat(24)} ${'a'.repeat(5)}`);
  assert.equal(encode('8 fish'), `8  ${'a'.repeat(6)} ${'a'.repeat(9)} ${'a'.repeat(19)} ${'a'.repeat(8)}`);
  assert.ok(encode('Main-Spessart is a Landkreis (district) in the northwest of Bavaria, Germany.').length > 0);
});
test('one character, spacing, and punctuation changes are rejected by exact comparison', () => { const expected = encode('CAB BAD'); assert.notEqual('aaa a a  aa a aaaa', expected); assert.notEqual('aaa a aa aa a aaaa', expected); assert.notEqual('aaa a aa  aa a aaaa!', expected); });
