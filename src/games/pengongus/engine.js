const crypto = require('node:crypto');

const Phase = Object.freeze({ LOBBY: 'LOBBY', STARTING: 'STARTING', ACTION: 'ACTION', DISCUSSION: 'DISCUSSION', VOTING: 'VOTING', RESULT: 'RESULT', FINISHED: 'FINISHED' });
const MIN_PLAYERS = 4, MAX_PLAYERS = 10, TASKS_PER_WADDLER = 2, MAX_ROUNDS = 8;

function createLobby({ id = crypto.randomUUID(), guildId, lobbyChannelId, hostId, now = Date.now() }) {
  return { id, guildId, lobbyChannelId, lobbyMessageId: null, hostId, phase: Phase.LOBBY, players: [{ id: hostId, role: null, status: 'ACTIVE', tasksDone: 0, task: null, heatedRound: null }], round: 0, votes: {}, earlyVotes: [], heated: [], ejected: [], createdAt: now, deadline: now + 15 * 60_000, channelId: null, taskTotal: 0, cleanupAt: null };
}
function activePlayers(game) { return game.players.filter(p => p.status === 'ACTIVE'); }
function getPlayer(game, userId) { return game.players.find(p => p.id === userId); }
function join(game, userId) {
  if (game.phase !== Phase.LOBBY) throw new Error('phase');
  if (getPlayer(game, userId)) throw new Error('duplicate');
  if (game.players.length >= MAX_PLAYERS) throw new Error('full');
  game.players.push({ id: userId, role: null, status: 'ACTIVE', tasksDone: 0, task: null, heatedRound: null });
  return game;
}
function leave(game, userId) {
  if (game.phase === Phase.LOBBY) {
    if (!getPlayer(game, userId)) throw new Error('player');
    game.players = game.players.filter(p => p.id !== userId);
    return { cancelled: game.players.length === 0 || game.hostId === userId };
  }
  const player = getPlayer(game, userId);
  if (!player || player.status !== 'ACTIVE') return { changed: false };
  player.status = 'LEFT'; player.task = null; delete game.votes[userId];
  game.earlyVotes = game.earlyVotes.filter(id => id !== userId);
  return { changed: true };
}
function assignRoles(game, randomInt = crypto.randomInt) {
  if (game.phase !== Phase.LOBBY || game.players.length < MIN_PLAYERS) throw new Error('players');
  const indices = Array.from({ length: game.players.length }, (_, i) => i);
  for (let i = indices.length - 1; i > 0; i--) { const j = randomInt(i + 1); [indices[i], indices[j]] = [indices[j], indices[i]]; }
  const impostors = game.players.length >= 7 ? 2 : 1;
  game.players.forEach((p, index) => { p.role = indices.slice(0, impostors).includes(index) ? 'PENGOSTOR' : 'WADDLER'; });
  game.phase = Phase.STARTING;
  return game;
}
function activeRoleCount(game, role) { return activePlayers(game).filter(p => p.role === role).length; }
function heatPlayer(game, actorId, targetId) {
  if (game.phase !== Phase.ACTION) throw new Error('phase');
  const actor = getPlayer(game, actorId), target = getPlayer(game, targetId);
  if (!actor || actor.status !== 'ACTIVE' || actor.role !== 'PENGOSTOR') throw new Error('actor');
  if (actor.heatedRound === game.round) throw new Error('used');
  if (!target || targetId === actorId || target.role !== 'WADDLER' || target.status !== 'ACTIVE') throw new Error('target');
  target.status = 'HEATED'; target.task = null; actor.heatedRound = game.round;
  game.heated.push({ playerId: targetId, round: game.round, at: Date.now() });
  return target;
}
function beginDiscussion(game, now = Date.now()) {
  if (game.phase !== Phase.ACTION) throw new Error('phase');
  if (!game.heated.some(h => h.round === game.round)) return false;
  game.phase = Phase.DISCUSSION; game.deadline = now + 60_000; game.votes = {}; game.earlyVotes = [];
  return true;
}
function beginVoting(game, now = Date.now()) {
  if (game.phase !== Phase.DISCUSSION) throw new Error('phase');
  game.phase = Phase.VOTING; game.deadline = now + 45_000; game.votes = {};
}
function castVote(game, voterId, targetId) {
  if (game.phase !== Phase.VOTING) throw new Error('phase');
  const voter = getPlayer(game, voterId), active = activePlayers(game);
  if (!voter || voter.status !== 'ACTIVE' || !active.some(p => p.id === voterId)) throw new Error('voter');
  if (Object.hasOwn(game.votes, voterId)) throw new Error('duplicate');
  if (targetId !== 'skip' && (!active.some(p => p.id === targetId) || targetId === voterId)) throw new Error('target');
  game.votes[voterId] = targetId;
  return active.every(p => Object.hasOwn(game.votes, p.id));
}
function tally(game, now = Date.now()) {
  if (game.phase !== Phase.VOTING) throw new Error('phase');
  const counts = {};
  for (const [voter, target] of Object.entries(game.votes)) if (activePlayers(game).some(p => p.id === voter)) counts[target] = (counts[target] || 0) + 1;
  const max = Math.max(0, ...Object.values(counts));
  const leaders = Object.entries(counts).filter(([, n]) => n === max && max > 0);
  const ejectedId = leaders.length === 1 && leaders[0][0] !== 'skip' ? leaders[0][0] : null;
  if (ejectedId) { getPlayer(game, ejectedId).status = 'EJECTED'; game.ejected.push({ playerId: ejectedId, role: getPlayer(game, ejectedId).role, round: game.round, at: now }); }
  game.lastTally = { counts, ejectedId };
  return game.lastTally;
}
function outcome(game) {
  const alive = activePlayers(game), imps = alive.filter(p => p.role === 'PENGOSTOR').length, waddlers = alive.filter(p => p.role === 'WADDLER').length;
  if (!alive.length) return 'CANCELLED';
  if (!imps) return 'WADDLERS';
  if (imps >= waddlers) return 'PENGOSTORS';
  const livingWaddlers = alive.filter(p => p.role === 'WADDLER');
  if (livingWaddlers.length && livingWaddlers.every(p => p.tasksDone >= TASKS_PER_WADDLER)) return 'WADDLERS';
  if (game.round >= MAX_ROUNDS) return 'PENGOSTORS';
  if (alive.length < 3) return 'CANCELLED';
  return null;
}
function nextRound(game, now = Date.now()) {
  if (game.phase !== Phase.VOTING) throw new Error('phase');
  game.round += 1; game.phase = Phase.ACTION; game.deadline = now + 90_000; game.votes = {}; game.earlyVotes = [];
  return game;
}
module.exports = { Phase, MIN_PLAYERS, MAX_PLAYERS, TASKS_PER_WADDLER, MAX_ROUNDS, createLobby, activePlayers, getPlayer, join, leave, assignRoles, activeRoleCount, heatPlayer, beginDiscussion, beginVoting, castVote, tally, outcome, nextRound };
