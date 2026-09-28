const test = require('node:test'); const assert = require('node:assert/strict'); const { encode, normalizeSource, isUsable } = require('../src/pika-screaming');
test('PikaPengScreamingLang alphabet encoding', () => { assert.equal(encode('A'), 'a'); assert.equal(encode('B'), 'aa'); assert.equal(encode('Z'), 'a'.repeat(26)); });
test('words preserve intentional double spaces', () => { assert.equal(encode('CAB'), 'aaa a aa'); assert.equal(encode('CAB BAD'), 'aaa a aa  aa a aaaa'); });
test('case, punctuation, numbers, and attached punctuation', () => { assert.equal(encode('cab! 8?'), 'aaa a aa!  8?'); assert.equal(encode('A,B.'), 'a,aa.'); });
test('source whitespace is normalized without changing encoding separators', () => { assert.equal(normalizeSource('  CAB\n\tBAD  '), 'CAB BAD'); assert.equal(encode('  CAB\n\tBAD  '), 'aaa a aa  aa a aaaa'); });
test('encoded answer size is checked before accepting a prompt', () => { assert.equal(isUsable('This is a usable English sentence.', 1800), true); assert.equal(isUsable('A'.repeat(100), 20), false); });
