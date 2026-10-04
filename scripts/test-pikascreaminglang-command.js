const test = require('node:test');
const assert = require('node:assert/strict');
const command = require('../src/commands/pikascreaminglang');

test('PikaScreamingLang slash command exposes encode and decode options', () => {
  const json = command.data.toJSON();
  assert.equal(json.name, 'pikascreaminglang');
  assert.deepEqual(json.options.map(option => option.name), ['encode', 'decode']);
  assert.equal(command.MAX_INPUT_LENGTH, 1000);
});

test('command response keeps mentions inert and attaches oversized output', () => {
  const normal = command.response('decode', '@everyone');
  assert.deepEqual(normal.allowedMentions, { parse: [] });
  assert.match(normal.content, /@everyone/);
  const large = command.response('encode', 'a'.repeat(2000));
  assert.equal(large.files[0].name, 'pikascreaminglang-encode.txt');
  assert.equal(large.files[0].attachment.length, 2000);
  assert.deepEqual(large.allowedMentions, { parse: [] });
});
