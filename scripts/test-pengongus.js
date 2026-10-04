const test = require('node:test');
const assert = require('node:assert/strict');
const { Collection, PermissionFlagsBits } = require('discord.js');
const engine = require('../src/games/pengongus/engine');
const taskSystem = require('../src/games/pengongus/tasks');
const manager = require('../src/games/pengongus/manager');
const command = require('../src/commands/pengongus');
const { discoverCommands } = require('../src/list-all-commands');

function lobby(size = 4) {
  const game = engine.createLobby({ guildId: 'guild-a', lobbyChannelId: 'lobby', hostId: 'p0', now: 10 });
  for (let i = 1; i < size; i++) engine.join(game, `p${i}`);
  return game;
}
function started(size = 4) {
  const game = lobby(size);
  engine.assignRoles(game, max => max - 1); // deterministic identity shuffle
  game.phase = engine.Phase.ACTION;
  game.round = 1;
  game.channelId = 'private-channel';
  return game;
}
function openDiscussion(game) { game.phase = engine.Phase.DISCUSSION; }

test('lobby creation, join, leave, duplicate prevention, and ten-player limit', () => {
  const game = lobby(1);
  assert.equal(game.phase, engine.Phase.LOBBY);
  engine.join(game, 'p1');
  assert.throws(() => engine.join(game, 'p1'), /duplicate/);
  for (let i = 2; i < engine.MAX_PLAYERS; i++) engine.join(game, `p${i}`);
  assert.equal(game.players.length, 10);
  assert.throws(() => engine.join(game, 'p10'), /full/);
  assert.equal(engine.leave(game, 'p1').cancelled, false);
  assert.equal(game.players.some(p => p.id === 'p1'), false);
});

test('minimum player count and Pengostor count follow lobby size', () => {
  assert.throws(() => engine.assignRoles(lobby(3)), /players/);
  for (const [count, expected] of [[4, 1], [6, 1], [7, 2], [10, 2]]) {
    const game = lobby(count);
    engine.assignRoles(game, max => max - 1);
    assert.equal(game.players.filter(p => p.role === 'PENGOSTOR').length, expected);
    assert.equal(game.players.every(p => ['PENGOSTOR', 'WADDLER'].includes(p.role)), true);
    assert.equal(game.phase, engine.Phase.STARTING);
  }
});

test('private game-channel overwrites hide it from @everyone and grant players access', () => {
  const guild = { roles: { everyone: { id: 'everyone' } } };
  const overwrites = manager.createChannelPermissions(guild, ['p1', 'p2'], 'bot');
  assert.ok(overwrites[0].deny.includes(PermissionFlagsBits.ViewChannel));
  assert.ok(overwrites[1].allow.includes(PermissionFlagsBits.ManageChannels));
  assert.ok(overwrites[2].allow.includes(PermissionFlagsBits.ViewChannel));
  assert.ok(overwrites[3].allow.includes(PermissionFlagsBits.SendMessages));
});

test('roles and game-channel validation are scoped to the correct players, guild, and channel', () => {
  const game = started();
  assert.equal(engine.getPlayer(game, 'p0').role, 'PENGOSTOR');
  assert.equal(manager.isInGameChannel({ guildId: 'guild-a', channelId: 'private-channel' }, game), true);
  assert.equal(manager.isInGameChannel({ guildId: 'guild-b', channelId: 'private-channel' }, game), false);
  assert.equal(manager.isInGameChannel({ guildId: 'guild-a', channelId: 'other' }, game), false);
});

test('heater rejects impostors, self-targets, inactive targets, invalid phases, and repeat use', () => {
  const game = started();
  assert.throws(() => engine.heatPlayer(game, 'p0', 'p0'), /target/);
  const twoImpostors = started(7);
  assert.throws(() => engine.heatPlayer(twoImpostors, 'p0', 'p1'), /target/);
  engine.heatPlayer(game, 'p0', 'p2');
  assert.equal(engine.getPlayer(game, 'p2').status, 'HEATED');
  assert.throws(() => engine.heatPlayer(game, 'p0', 'p3'), /used/);
  game.phase = engine.Phase.DISCUSSION;
  assert.throws(() => engine.heatPlayer(game, 'p0', 'p3'), /phase/);
});

test('heated players cannot vote; each active player votes once for a valid target', () => {
  const game = started();
  engine.heatPlayer(game, 'p0', 'p2');
  engine.beginDiscussion(game);
  engine.beginVoting(game);
  assert.throws(() => engine.castVote(game, 'p2', 'p0'), /voter/);
  assert.equal(engine.castVote(game, 'p1', 'p0'), false);
  assert.throws(() => engine.castVote(game, 'p1', 'p0'), /duplicate/);
  assert.throws(() => engine.castVote(game, 'p3', 'p3'), /target/);
  assert.equal(engine.castVote(game, 'p3', 'p0'), false);
  assert.equal(engine.castVote(game, 'p0', 'skip'), true);
});

test('ties and Skip do not eject; a unique Pengostor vote ejects the Pengostor', () => {
  const tied = started(); openDiscussion(tied); engine.beginVoting(tied);
  engine.castVote(tied, 'p0', 'p1'); engine.castVote(tied, 'p1', 'p0'); engine.castVote(tied, 'p2', 'skip'); engine.castVote(tied, 'p3', 'skip');
  assert.equal(engine.tally(tied).ejectedId, null);

  const skip = started(); openDiscussion(skip); engine.beginVoting(skip);
  for (const id of ['p0', 'p1', 'p2', 'p3']) engine.castVote(skip, id, 'skip');
  assert.equal(engine.tally(skip).ejectedId, null);

  const ejected = started(); openDiscussion(ejected); engine.beginVoting(ejected);
  for (const id of ['p1', 'p2', 'p3']) engine.castVote(ejected, id, 'p0');
  engine.castVote(ejected, 'p0', 'skip');
  assert.equal(engine.tally(ejected).ejectedId, 'p0');
  assert.equal(engine.outcome(ejected), 'WADDLERS');
});

test('task victory and Pengostor parity victory are detected', () => {
  const taskWin = started();
  for (const p of engine.activePlayers(taskWin).filter(p => p.role === 'WADDLER')) p.tasksDone = engine.TASKS_PER_WADDLER;
  assert.equal(engine.outcome(taskWin), 'WADDLERS');

  const parity = started();
  engine.getPlayer(parity, 'p1').status = 'EJECTED';
  engine.getPlayer(parity, 'p2').status = 'HEATED';
  assert.equal(engine.activeRoleCount(parity, 'PENGOSTOR'), 1);
  assert.equal(engine.activeRoleCount(parity, 'WADDLER'), 1);
  assert.equal(engine.outcome(parity), 'PENGOSTORS');
});

test('a player leaving is removed from active voting and empty game becomes cancelled', () => {
  const game = started();
  assert.deepEqual(engine.leave(game, 'p3'), { changed: true });
  assert.equal(engine.getPlayer(game, 'p3').status, 'LEFT');
  for (const p of game.players) p.status = 'LEFT';
  assert.equal(engine.outcome(game), 'CANCELLED');
});

test('task system creates only the three curated task types and checks answers privately', () => {
  for (let i = 0; i < 40; i++) {
    const task = taskSystem.createTask();
    assert.ok(['QUICK MATH', 'MEMORY', 'UNSCRAMBLE'].includes(task.type));
    assert.equal(taskSystem.isCorrect(task, task.answer.toLowerCase()), true);
    assert.equal(taskSystem.isCorrect(task, 'definitely-wrong'), false);
  }
});

test('Pengongus slash command serializes and dynamic command discovery includes it', () => {
  const payload = command.data.toJSON();
  assert.equal(payload.name, 'pengongus');
  assert.equal(payload.options.some(option => option.name === 'start'), true);
  const commands = new Collection([['pengongus', command]]);
  assert.ok(discoverCommands(commands, null).some(entry => entry.name === 'pengongus'));
});
