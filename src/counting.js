const fs = require('node:fs/promises');
const path = require('node:path');
const logger = require('./utils/logger');

const storePath = path.join(__dirname, 'data', 'counting.json');
let state = {};
let loaded = false;
const locks = new Map();

async function load() { if (loaded) return; try { state = JSON.parse(await fs.readFile(storePath, 'utf8')); } catch { state = {}; } loaded = true; }
async function save() { await fs.writeFile(storePath, `${JSON.stringify(state, null, 2)}\n`, 'utf8'); }
function empty() { return { channelId: null, current: '0', record: '0', lastUserId: null, lastMessageId: null, totalSuccessful: 0, totalResets: 0, streakStartedAt: null, users: {} }; }
function get(guildId) { const old = state[guildId] || {}; return { ...empty(), ...old, current: String(old.current ?? old.currentCount ?? '0'), record: String(old.record ?? old.highestCount ?? '0'), lastUserId: old.lastUserId ?? old.lastCounterUserId ?? null, users: { ...(old.users || {}) } }; }
function withLock(guildId, task) { const previous = locks.get(guildId) || Promise.resolve(); const current = previous.then(task, task); locks.set(guildId, current); current.finally(() => { if (locks.get(guildId) === current) locks.delete(guildId); }).catch(() => {}); return current; }
async function configure(guildId, channelId) { await load(); return withLock(guildId, async () => { const value = get(guildId); value.channelId = channelId; state[guildId] = value; await save(); return value; }); }
async function reset(guildId) { await load(); return withLock(guildId, async () => { const value = get(guildId); value.current = '0'; value.lastUserId = null; value.lastMessageId = null; value.totalResets += 1; value.streakStartedAt = null; state[guildId] = value; await save(); return value; }); }
async function getStats(guildId) { await load(); return get(guildId); }
async function processMessage(message) {
  if (!message.guild || message.author.bot) return false;
  await load();
  return withLock(message.guild.id, async () => {
    const value = get(message.guild.id);
    if (!value.channelId || value.channelId !== message.channel.id || value.lastMessageId === message.id) return false;
    const raw = message.content.trim();
    const parsedNumber = /^\d+$/.test(raw) ? BigInt(raw) : null;
    const currentCount = BigInt(value.current);
    const expectedNumber = currentCount + 1n;
    const sameUser = value.lastUserId === message.author.id;
    logger.info(`Counting check guild=${message.guild.id} currentCount=${currentCount} expectedNumber=${expectedNumber} parsedNumber=${parsedNumber === null ? 'null' : parsedNumber} lastCounterUserId=${value.lastUserId} messageAuthorId=${message.author.id}`);
    if (parsedNumber === null || parsedNumber !== expectedNumber || sameUser) {
      const brokenAt = currentCount;
      value.current = '0'; value.lastUserId = null; value.lastMessageId = message.id; value.totalResets += 1; value.streakStartedAt = null;
      state[message.guild.id] = value; await save(); await message.react('❌').catch(() => {});
      const reason = sameUser ? `${message.author} cannot count twice in a row.` : `${message.author} broke the count at **${brokenAt}**!`;
      await message.channel.send(`${reason} The next number is **1**.`).catch(() => {});
      return true;
    }
    value.current = parsedNumber.toString();
    if (parsedNumber > BigInt(value.record)) value.record = parsedNumber.toString();
    value.lastUserId = message.author.id; value.lastMessageId = message.id; value.totalSuccessful += 1; value.streakStartedAt ||= new Date().toISOString(); value.users[message.author.id] = (value.users[message.author.id] || 0) + 1;
    state[message.guild.id] = value; await save(); await message.react('✅').catch(() => {});
    const n = Number(parsedNumber); if ([10, 25, 50, 100, 250, 500, 1000].includes(n) || (parsedNumber >= 1000n && parsedNumber % 1000n === 0n)) await message.channel.send(`🎉 **${parsedNumber}!** PikaPeng celebrates this counting milestone!`).catch(() => {});
    return true;
  });
}
module.exports = { configure, reset, getStats, processMessage };
