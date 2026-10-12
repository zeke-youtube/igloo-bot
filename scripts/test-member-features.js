const test = require('node:test');
const assert = require('node:assert/strict');
const httpcat = require('../src/commands/httpcat');
const timezone = require('../src/commands/timezone');
const monitor = require('../src/rentmonitor');
const { SlashCommandBuilder } = require('discord.js');

test('timezone validation accepts IANA zones and rejects unknown zones', () => {
  assert.equal(timezone.valid('Asia/Taipei'), true);
  assert.equal(timezone.valid('Not/AZone'), false);
});
test('HTTP cat exposes known names, explanations and image endpoint format', () => {
  assert.equal(httpcat.codes.includes(404), true);
  assert.equal(httpcat.descriptions[404], 'The server could not find the requested resource.');
  assert.equal(`https://cathttpweb.pikastudio.org/image/${404}`, 'https://cathttpweb.pikastudio.org/image/404');
});
test('monitor rejects non-HTTP, localhost and private IP targets before network access', async () => {
  for (const value of ['file:///etc/passwd', 'ftp://example.com', 'http://localhost/', 'http://127.0.0.1/', 'http://192.168.1.1/', 'http://[::1]/']) {
    await assert.rejects(monitor.safe(value));
  }
});
test('all new slash command definitions serialize for Discord registration', () => {
  for (const name of ['timezone', 'time', 'wikipengia', 'pepy', 'httpcat', 'pengwater', 'chess', 'rentmonitor']) {
    const command = require(`../src/commands/${name}`);
    assert.doesNotThrow(() => command.data.toJSON(), name);
  }
});
