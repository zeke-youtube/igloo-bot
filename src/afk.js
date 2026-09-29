const fs = require('node:fs/promises');
const path = require('node:path');

const storePath = path.join(__dirname, 'data', 'afk.json');
const DEFAULT_REASON = 'AFK';
const MAX_REASON_LENGTH = 500;
let states = {};
let loaded = false;
let queue = Promise.resolve();
const mutate = (task) => { const next = queue.then(task, task); queue = next.catch(() => {}); return next; };
async function load() { if (loaded) return; try { const parsed = JSON.parse(await fs.readFile(storePath, 'utf8')); states = parsed && typeof parsed === 'object' && !Array.isArray(parsed) ? parsed : {}; } catch (error) { if (error.code !== 'ENOENT') states = {}; } loaded = true; }
async function save() { await fs.writeFile(storePath, `${JSON.stringify(states, null, 2)}\n`, 'utf8'); }
function formatReason(reason) { const trimmed = typeof reason === 'string' ? reason.trim() : ''; return (trimmed || DEFAULT_REASON).slice(0, MAX_REASON_LENGTH); }
function duration(timestamp) { return `<t:${Math.floor(timestamp / 1000)}:R>`; }
async function set(userId, reason) { return mutate(async () => { await load(); const state = { userId, reason: formatReason(reason), since: Date.now() }; states[userId] = state; await save(); return state; }); }
async function handleMessage(message) {
  if (message.author?.bot) return;
  return mutate(async () => {
    await load();
    const returning = states[message.author.id];
    if (returning) { delete states[message.author.id]; await save(); await message.reply(`Welcome back! You were AFK for ${duration(returning.since)}.`).catch(() => {}); return; }
    const mentionedIds = new Set(message.mentions?.users?.keys?.() || []);
    const notices = [...mentionedIds].map((userId) => ({ userId, state: states[userId] })).filter(({ state }) => state);
    if (!notices.length) return;
    await message.reply(notices.map(({ userId, state }) => `<@${userId}> is AFK: ${state.reason} (${duration(state.since)}).`).join('\n')).catch(() => {});
  });
}
module.exports = { set, handleMessage, DEFAULT_REASON, MAX_REASON_LENGTH };
