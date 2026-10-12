const test = require('node:test');
const assert = require('node:assert/strict');
const { SlashCommandBuilder } = require('discord.js');
const terminal = require('../src/commands/terminal');

test('/terminal has exactly two string command choices', () => {
  assert.equal(terminal.data instanceof SlashCommandBuilder, true);
  assert.equal(terminal.data.name, 'terminal');
  const option = terminal.data.toJSON().options[0];
  assert.equal(option.type, 3);
  assert.equal(option.required, true);
  assert.deepEqual(option.choices.map(({ value }) => value), ['give-me-fish', 'give-me-admin']);
});

test('/terminal returns the specified safe error text in a terminal embed', async () => {
  for (const [command, response] of Object.entries(terminal.RESPONSES)) {
    let reply;
    await terminal.execute({
      options: { getString: (name) => { assert.equal(name, 'command'); return command; } },
      reply: async (value) => { reply = value; },
    });
    assert.equal(reply.embeds.length, 1);
    const embed = reply.embeds[0].toJSON();
    assert.match(embed.description, new RegExp(`peng@igloo:~\\$ ${command}`));
    assert.ok(embed.description.includes(response));
  }
  assert.deepEqual(terminal.RESPONSES, {
    'give-me-fish': 'ERROR: Fish dispenser is currently on strike.\nTry fishing like a normal penguin. 🐟',
    'give-me-admin': 'ERROR: Permission denied.\nNice try. 💀',
  });
});

test('/terminal refuses values outside the configured choices', async () => {
  await assert.rejects(() => terminal.execute({
    options: { getString: () => 'rm -rf /' },
    reply: async () => assert.fail('Unsupported input must not be replied to.'),
  }), /Unsupported terminal command/);
});
