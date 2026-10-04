const test = require('node:test');
const assert = require('node:assert/strict');
const modeModule = require('../src/bot-mode');
const shutdown = require('../src/commands/shutdownbot');
const open = require('../src/commands/openbot');

function fixture(initial = false) {
  const disk = { botClosed: initial };
  const botMode = modeModule.createBotMode({
    read: async fn => fn({ ...disk }),
    mutate: async fn => fn(disk),
    ownerId: () => '1547892939362013224',
    emoji: () => '<:peng:1>'
  });
  return { disk, botMode };
}

function interaction(userId, client = { user: { setPresence: async presence => { client.presence = presence; } } }) {
  const i = { user: { id: userId }, client, replies: [], async reply(payload) { this.replies.push(payload); this.replied = true; return payload; } };
  return i;
}

test('owner can close, receives success before invisible presence, and persists closed state', async () => {
  const { disk, botMode } = fixture();
  const events = [];
  const i = interaction('1547892939362013224', { user: { setPresence: async p => events.push(['presence', p]) } });
  const originalReply = i.reply;
  i.reply = async p => { events.push(['reply', p]); return originalReply.call(i, p); };
  await shutdown.execute(i, botMode);
  assert.equal(disk.botClosed, true);
  assert.match(i.replies[0].content, /now closed/);
  assert.equal(events[0][0], 'reply');
  assert.deepEqual(events[1], ['presence', { status: 'invisible' }]);
  const afterRestart = modeModule.createBotMode({ read: async fn => fn(disk), mutate: async fn => fn(disk), ownerId: () => '1547892939362013224', emoji: () => 'P' });
  assert.equal(await afterRestart.isClosed(), true);
});

test('non-owner cannot close or open bot mode', async () => {
  const { disk, botMode } = fixture();
  const closeInteraction = interaction('someone-else');
  const openInteraction = interaction('someone-else');
  await shutdown.execute(closeInteraction, botMode);
  await open.execute(openInteraction, botMode, async () => {});
  assert.equal(disk.botClosed, false);
  assert.equal(closeInteraction.replies[0].ephemeral, true);
  assert.equal(openInteraction.replies[0].ephemeral, true);
  assert.match(closeInteraction.replies[0].content, /bot owner/);
});

test('closed gate blocks slash commands and acknowledges buttons, selects, and modals', async () => {
  const { botMode } = fixture(true);
  for (const kind of ['slash', 'button', 'select', 'modal']) {
    const i = interaction('member');
    i.commandName = kind === 'slash' ? 'balance' : undefined;
    i.isChatInputCommand = () => kind === 'slash';
    assert.equal(await botMode.gate(i), false);
    assert.equal(i.replies[0].ephemeral, true);
    assert.match(i.replies[0].content, /currently closed/);
  }
});

test('closed gate acknowledges autocomplete with an empty response and allows only maintenance commands', async () => {
  const { botMode } = fixture(true);
  const autocomplete = { isAutocomplete: () => true, respond: async values => { autocomplete.values = values; } };
  assert.equal(await botMode.gate(autocomplete), false);
  assert.deepEqual(autocomplete.values, []);
  for (const commandName of ['openbot', 'shutdownbot']) {
    assert.equal(await botMode.gate({ isChatInputCommand: () => true, commandName }), true);
  }
  const ordinary = interaction('member');
  ordinary.isChatInputCommand = () => true;
  ordinary.commandName = 'fish';
  assert.equal(await botMode.gate(ordinary), false);
});

test('/openbot works while closed, restores normal presence, and resumes jobs', async () => {
  const { disk, botMode } = fixture(true);
  const presences = [];
  const i = interaction('1547892939362013224', { user: { setPresence: async p => presences.push(p) } });
  let resumed = false;
  await open.execute(i, botMode, async () => { resumed = true; });
  assert.equal(disk.botClosed, false);
  assert.deepEqual(presences[0], modeModule.NORMAL_PRESENCE);
  assert.match(i.replies[0].content, /open again/);
  assert.equal(resumed, true);
  assert.equal(await botMode.gate({ isChatInputCommand: () => true, commandName: 'balance' }), true);
});

test('restart presence follows persisted mode and maintenance commands register normally', async () => {
  const { disk, botMode } = fixture(true);
  let presence;
  await botMode.applySavedPresence({ user: { setPresence: async p => { presence = p; } } });
  assert.deepEqual(presence, { status: 'invisible' });
  assert.doesNotThrow(() => shutdown.data.toJSON());
  assert.doesNotThrow(() => open.data.toJSON());
});

test('open state keeps ordinary command interactions enabled', async () => {
  const { botMode } = fixture(false);
  const interaction = { isChatInputCommand: () => true, commandName: 'balance' };
  assert.equal(await botMode.gate(interaction), true);
});
