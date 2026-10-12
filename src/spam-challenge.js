const fs = require('node:fs/promises');
const path = require('node:path');
const { EmbedBuilder } = require('discord.js');
const economy = require('./economy');
const config = require('./config');
const logger = require('./utils/logger');

const INTERVAL_MS = Number.isSafeInteger(Number(process.env.SPAM_CHALLENGE_INTERVAL_MS)) && Number(process.env.SPAM_CHALLENGE_INTERVAL_MS) >= 1000 ? Number(process.env.SPAM_CHALLENGE_INTERVAL_MS) : 10 * 60 * 1000;
const DURATION_MS = 10 * 1000;
const REWARD = 100;
const storePath = path.join(__dirname, 'data', 'spam-challenge.json');
let state = { nextAt: null, active: null, rewarded: [] };
let loaded = false;
let queue = Promise.resolve();
let timer = null;
let running = false;
let clientRef = null;

async function load() {
  if (loaded) return;
  try {
    const saved = JSON.parse(await fs.readFile(storePath, 'utf8'));
    state = { ...state, ...saved, rewarded: Array.isArray(saved.rewarded) ? saved.rewarded : [] };
  } catch (error) { if (error.code !== 'ENOENT') logger.error('Spam Challenge state load failed', error); }
  loaded = true;
}
function save() {
  queue = queue.then(async () => {
    await fs.mkdir(path.dirname(storePath), { recursive: true });
    const tmp = `${storePath}.tmp`;
    await fs.writeFile(tmp, `${JSON.stringify(state, null, 2)}\n`, 'utf8');
    await fs.rename(tmp, storePath);
  });
  return queue;
}
function scheduleAt(client, at) {
  if (timer) clearTimeout(timer);
  const delay = Math.max(0, Math.min(at - Date.now(), 2147483647));
  timer = setTimeout(async () => {
    timer = null;
    try { await runDue(client); } catch (error) { logger.error('Spam Challenge scheduler failed', error); }
  }, delay);
  timer.unref?.();
}
async function fetchChannel(client) {
  const id = config.fishDropChannelId();
  if (!id) return null;
  const channel = await client.channels.fetch(id).catch((error) => { logger.error(`Spam Challenge channel fetch failed for ${id}`, error); return null; });
  return channel?.isTextBased() && typeof channel.send === 'function' ? channel : null;
}
async function finish(client, challenge) {
  if (state.active?.id !== challenge.id || challenge.ended) return false;
  challenge.ended = true;
  const results = Object.entries(challenge.scores).sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]));
  let winner = null;
  if (results.length && !state.rewarded.includes(challenge.id)) {
    // Persist the reward claim before touching the shared Fish wallet. If persistence fails,
    // no reward is issued; if the process restarts afterward, this challenge cannot pay twice.
    state.rewarded.push(challenge.id);
    state.rewarded = state.rewarded.slice(-500);
    winner = { userId: results[0][0], count: results[0][1] };
    // A pending journal entry allows a restart to complete a reward interrupted between
    // marking it and updating the shared economy store.
    state.rewarded.push({ id: challenge.id, userId: winner.userId, status: 'pending' });
    await save();
    await economy.addFish(winner.userId, REWARD);
    state.rewarded[state.rewarded.length - 1].status = 'paid';
  }
  state.active = null;
  state.nextAt = Date.now() + INTERVAL_MS;
  await save();
  const channel = await client.channels.fetch(challenge.channelId).catch(() => null);
  if (channel?.isTextBased()) {
    const leaderboard = results.slice(0, 3).map(([id, count], index) => `${index + 1}. <@${id}> — **${count}** ${count === 1 ? 'message' : 'messages'}`).join('\n');
    const description = winner
      ? `Winner: <@${winner.userId}> with **${winner.count}** ${winner.count === 1 ? 'message' : 'messages'}! They earned **${REWARD} Fish**.\n\n**Top participants**\n${leaderboard}`
      : 'Nobody participated this round. No winner this time.';
    await channel.send({ embeds: [new EmbedBuilder().setColor(0x6bd6e8).setTitle(`${config.pengEmoji()} SPAM CHALLENGE COMPLETE`).setDescription(description).setFooter({ text: 'IglooBot · Spam Challenge' })], allowedMentions: { parse: [] } }).catch((error) => logger.error('Spam Challenge result announcement failed', error));
  }
  logger.info(`Spam Challenge ${challenge.id} ended${winner ? `; winner=${winner.userId} messages=${winner.count}` : '; no participants'}`);
  if (running) scheduleAt(client, state.nextAt);
  return true;
}
async function begin(client) {
  if (state.active) return false;
  const channel = await fetchChannel(client);
  if (!channel) {
    state.nextAt = Date.now() + INTERVAL_MS;
    await save();
    logger.error('Spam Challenge skipped: configured channel is missing or not text-capable.');
    if (running) scheduleAt(client, state.nextAt);
    return false;
  }
  const id = `${channel.id}:${Date.now()}`;
  const active = { id, channelId: channel.id, startedAt: Date.now(), endsAt: Date.now() + DURATION_MS, scores: {}, lastCountedAt: {} };
  state.active = active;
  await save();
  try {
    await channel.send({ embeds: [new EmbedBuilder().setColor(0x6bd6e8).setTitle(`${config.pengEmoji()} SPAM CHALLENGE!`).setDescription('Send as many messages as you can in the next **10 seconds**!\n\nOnly one message per person per second counts. Top 3 will be shown, and the winner earns **100 Fish**.').setFooter({ text: 'IglooBot · Spam Challenge' })], allowedMentions: { parse: [] } });
  } catch (error) {
    state.active = null;
    state.nextAt = Date.now() + INTERVAL_MS;
    await save();
    logger.error('Spam Challenge announcement failed', error);
    if (running) scheduleAt(client, state.nextAt);
    return false;
  }
  logger.info(`Spam Challenge ${id} started`);
  scheduleAt(client, active.endsAt);
  return true;
}
async function runDue(client) {
  await load();
  for (const reward of state.rewarded) {
    if (typeof reward === 'object' && reward.status === 'pending') {
      await economy.addFish(reward.userId, REWARD);
      reward.status = 'paid';
      await save();
    }
  }
  if (state.active) {
    if (Date.now() >= state.active.endsAt) await finish(client, state.active);
    else scheduleAt(client, state.active.endsAt);
    return;
  }
  if (state.nextAt == null) {
    state.nextAt = Date.now() + INTERVAL_MS;
    await save();
  }
  if (Date.now() >= state.nextAt) await begin(client);
  else scheduleAt(client, state.nextAt);
}
async function start(client) {
  if (running) return false;
  running = true;
  clientRef = client;
  await load();
  if (state.active && !Number.isFinite(state.active.endsAt)) state.active = null;
  if (!Number.isFinite(state.nextAt) && !state.active) state.nextAt = Date.now() + INTERVAL_MS;
  await save();
  logger.info(`Spam Challenge scheduler started (interval ${INTERVAL_MS}ms)`);
  await runDue(client);
  return true;
}
function recordActivity(message, now = Date.now()) {
  const active = state.active;
  if (!active || now < active.startedAt || now >= active.endsAt || message?.channelId !== active.channelId || message.author?.bot || message.webhookId || !message.author?.id) return false;
  const id = message.author.id;
  if (now - (active.lastCountedAt[id] ?? -Infinity) < 1000) return false;
  active.lastCountedAt[id] = now;
  active.scores[id] = (active.scores[id] || 0) + 1;
  save().catch((error) => logger.error('Spam Challenge score save failed', error));
  return true;
}
async function stop() { if (timer) clearTimeout(timer); timer = null; running = false; clientRef = null; }
function getState() { return state; }
module.exports = { start, stop, recordActivity, getState, INTERVAL_MS, DURATION_MS, REWARD, _resetForTests: async () => { await stop(); state = { nextAt: null, active: null, rewarded: [] }; loaded = true; queue = Promise.resolve(); } };
