const test = require('node:test');
const assert = require('node:assert/strict');
const command = require('../src/commands/ping');

test('/ping replies with approximate interaction response latency', async () => {
  const before = Date.now();
  let reply;
  await command.execute({ createdTimestamp: before - 23, reply: async value => { reply = value; } });
  assert.match(reply.content, /^🏓 Pong! \d+ms$/);
  assert.ok(Number(reply.content.match(/(\d+)ms$/)[1]) >= 23);
});

test('/ping is registered as a slash command', () => {
  assert.equal(command.data.toJSON().name, 'ping');
});
