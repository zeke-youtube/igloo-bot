const test = require('node:test');
const assert = require('node:assert/strict');
const { ApplicationCommandOptionType, PermissionFlagsBits } = require('discord.js');
const { discoverCommands, paginateCommands, PAGE_DESCRIPTION_LIMIT } = require('../src/list-all-commands');
const listCommand = require('../src/commands/listallcommands');

function fake(name, description, options = [], extra = {}) {
  return { data: { toJSON: () => ({ name, description, options, ...extra }) }, ...('accessLabel' in extra ? { accessLabel: extra.accessLabel } : {}) };
}
function commandMap(items) { return new Map(items.map(command => [command.data.toJSON().name, command])); }

test('command discovery reads command data dynamically from the collection', () => {
  const commands = commandMap([fake('balance', 'Check your Fish balance.')]);
  assert.deepEqual(discoverCommands(commands, null).map(command => command.name), ['balance']);
  commands.set('somethingnew', fake('somethingnew', 'A newly registered command.'));
  assert.deepEqual(discoverCommands(commands, null).map(command => command.name), ['balance', 'somethingnew']);
});

test('descriptions and subcommands come from slash metadata, including groups', () => {
  const commands = commandMap([fake('service', 'Do a service.', [
    { type: ApplicationCommandOptionType.Subcommand, name: 'find', description: 'Find someone.' },
    { type: ApplicationCommandOptionType.SubcommandGroup, name: 'admin', description: 'Admin actions.', options: [{ type: ApplicationCommandOptionType.Subcommand, name: 'reset', description: 'Reset records.' }] }
  ])]);
  const [entry] = discoverCommands(commands, null);
  assert.match(entry.lines[0], /Do a service/);
  assert.ok(entry.lines.includes('  • find — Find someone.'));
  assert.ok(entry.lines.includes('  **admin** — Admin actions.'));
  assert.ok(entry.lines.includes('    • reset — Reset records.'));
});

test('runtime-restricted subcommands receive their definition metadata marker', () => {
  const command = fake('tools', 'Utility actions.', [{ type: ApplicationCommandOptionType.Subcommand, name: 'status', description: 'View status.' }]);
  command.restrictedSubcommands = { status: 'Administrator' };
  const [entry] = discoverCommands(commandMap([command]), null);
  assert.ok(entry.lines.includes('  • status — View status. · 🔒 Administrator'));
});

test('search matches command names and descriptions case-insensitively', () => {
  const commands = commandMap([fake('fish-balance', 'Check your FISH wallet.')]);
  assert.equal(discoverCommands(commands, null, 'FISH').length, 1);
  assert.equal(discoverCommands(commands, null, 'wallet').length, 1);
  assert.equal(discoverCommands(commands, null, 'fishthing').length, 0);
});

test('pagination keeps generated pages under the Discord description limit', () => {
  const entries = Array.from({ length: 40 }, (_, index) => ({ name: `command-${index}`, lines: [`**/command-${index}** — ${'description '.repeat(8)}`] }));
  const pages = paginateCommands(entries);
  assert.ok(pages.length > 1);
  assert.ok(pages.every(page => page.length <= PAGE_DESCRIPTION_LIMIT));
});

test('default Discord permissions hide inaccessible commands; access labels remain visible', () => {
  const commands = commandMap([
    fake('admin-only', 'Administrator action.', [], { default_member_permissions: String(PermissionFlagsBits.Administrator) }),
    { ...fake('staff-tool', 'A staff command.'), accessLabel: 'Staff' }
  ]);
  assert.deepEqual(discoverCommands(commands, 0n).map(command => command.name), ['staff-tool']);
  assert.match(discoverCommands(commands, 0n)[0].lines[0], /🔒 Staff/);
  assert.deepEqual(discoverCommands(commands, PermissionFlagsBits.Administrator).map(command => command.name), ['admin-only', 'staff-tool']);
});

test('pagination controls belong to the original requester', async () => {
  const token = 'testtoken';
  listCommand._sessions.set(token, { ownerId: 'original-user', pages: ['first', 'second'], resultCount: 2, search: '', message: null, timer: null });
  let reply;
  await listCommand.button({ customId: `listallcommands:${token}:1`, user: { id: 'other-user' }, reply: async value => { reply = value; } });
  assert.match(reply.content, /belong to another user/);
  listCommand._sessions.delete(token);
});
