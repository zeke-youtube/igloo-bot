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
function get(guildId) { return { ...empty(), ...(state[guildId] || {}), users: { ...((state[guildId] || {}).users || {}) } }; }
function withLock(guildId, task) { const previous = locks.get(guildId) || Promise.resolve(); const current = previous.then(task, task); locks.set(guildId, current); current.finally(() => { if (locks.get(guildId) === current) locks.delete(guildId); }).catch(() => {}); return current; }
async function configure(guildId, channelId) { await load(); return withLock(guildId, async () => { const value = get(guildId); value.channelId = channelId; state[guildId] = value; await save(); return value; }); }
async function reset(guildId) { await load(); return withLock(guildId, async () => { const value = get(guildId); value.current = '0'; value.lastUserId = null; value.lastMessageId = null; value.totalResets += 1; value.streakStartedAt = null; state[guildId] = value; await save(); return value; }); }
async function getStats(guildId) { await load(); return get(guildId); }
async function processMessage(message) { if (!message.guild || message.author.bot) return false; await load(); const guildId = message.guild.id; return withLock(guildId, async () => { const value = get(guildId); if (!value.channelId || value.channelId !== message.channel.id) return false; if (value.lastMessageId === message.id) return false; const raw = message.content.trim(); const validInteger = /^\d+$/.test(raw); let number; try { number = validInteger ? BigInt(raw) : null; } catch { number = null; } const expected = BigInt(value.current) + 1n; if (number !== expected || value.lastUserId === message.author.id) { value.current = '0'; value.lastUserId = null; value.lastMessageId = message.id; value.totalResets += 1; value.streakStartedAt = null; state[guildId] = value; await save(); await message.react('❌').catch(() => {}); const reason = value.lastUserId === message.author.id ? `${message.author} cannot count twice in a row.` : `${message.author} broke the count at **${expected - 1n}**!`; await message.channel.send(`${reason} Back to **1** ${message.guild.members.me ? '' : ''}${message.client?.user ? '' : ''}`).catch(() => {}); return true; }
 value.current = number.toString(); value.record = (number > BigInt(value.record) ? number : BigInt(value.record)).toString(); value.lastUserId = message.author.id; value.lastMessageId = message.id; value.totalSuccessful += 1; value.streakStartedAt = value.streakStartedAt || new Date().toISOString(); value.users[message.author.id] = (value.users[message.author.id] || 0) + 1; state[guildId] = value; await save(); await message.react('✅').catch(() => {}); const milestones = [10, 25, 50, 100, 250, 500, 1000]; if (milestones.includes(Number(number)) || (number >= 1000n && number % 1000n === 0n)) await message.channel.send(`🎉 **${number.toString()}!** PikaPeng celebrates this counting milestone!`).catch(() => {}); return true; }); }
module.exports = { configure, reset, getStats, processMessage };
