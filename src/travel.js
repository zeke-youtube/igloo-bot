const fs = require('node:fs/promises');
const path = require('node:path');
const crypto = require('node:crypto');
const logger = require('./utils/logger');
const storePath = path.join(__dirname, 'data', 'travel.json');
const defaultDestinations = require('./travel-defaults.json');
let state; let queue = Promise.resolve();
async function load() { if (state) return state; try { state = JSON.parse(await fs.readFile(storePath, 'utf8')); } catch { state = { destinations: [], passports: {} }; } state.destinations ||= []; state.passports ||= {}; const known = new Set(state.destinations.map((d) => d.guildId)); for (const destination of defaultDestinations) if (!known.has(destination.guildId)) state.destinations.push(destination); return state; }
async function save() { const tmp = `${storePath}.tmp`; await fs.writeFile(tmp, `${JSON.stringify(state, null, 2)}\n`, 'utf8'); await fs.rename(tmp, storePath); }
function mutate(fn) { const next = queue.then(fn, fn); queue = next.catch(() => {}); return next; }
function validGuildId(id) { return /^\d{17,20}$/.test(String(id)); }
function validInvite(url) { try { const parsed = new URL(url); return parsed.protocol === 'https:' && (parsed.hostname === 'discord.gg' || parsed.hostname === 'discord.com' || parsed.hostname === 'discordapp.com'); } catch { return false; } }
async function list(all = true) { await load(); return state.destinations.filter((d) => all || d.enabled); }
async function add(destination) { return mutate(async () => { await load(); if (!validGuildId(destination.guildId)) throw new Error('Invalid guild ID.'); if (state.destinations.some((d) => d.guildId === destination.guildId)) throw new Error('Guild is already registered.'); if (!destination.name?.trim()) throw new Error('Server name is required.'); if (!validInvite(destination.invite)) throw new Error('Invite must be a valid Discord invite URL.'); const item = { id: crypto.randomBytes(8).toString('hex'), name: destination.name.trim().slice(0, 100), guildId: destination.guildId, invite: destination.invite.trim(), description: String(destination.description || '').trim().slice(0, 500), stamp: String(destination.stamp || '').trim().slice(0, 80), region: String(destination.region || '').trim().slice(0, 80), enabled: true, createdAt: new Date().toISOString() }; state.destinations.push(item); await save(); return item; }); }
async function update(guildId, changes) { return mutate(async () => { await load(); const item = state.destinations.find((d) => d.guildId === guildId); if (!item) throw new Error('Destination not found.'); Object.assign(item, changes); if (changes.invite && !validInvite(item.invite)) throw new Error('Invalid invite URL.'); await save(); return item; }); }
async function remove(guildId) { return mutate(async () => { await load(); state.destinations = state.destinations.filter((d) => d.guildId !== guildId); await save(); }); }
function unknownMemberError(error) {
  return error?.code === 10007 || error?.status === 404 || error?.rawError?.code === '10007';
}

async function eligibleDestinations({ destinations, client, userId, currentGuildId, joinedGuildIds = [], log = logger.info }) {
  const joined = new Set(joinedGuildIds.map(String));
  const eligible = [];

  for (const destination of destinations) {
    const prefix = `Travel destination guild=${destination.guildId}`;
    if (!destination.enabled) { log(`${prefix} excluded=disabled`); continue; }
    if (!validGuildId(destination.guildId) || !validInvite(destination.invite)) { log(`${prefix} excluded=invalid-data`); continue; }
    if (String(destination.guildId) === String(currentGuildId)) { log(`${prefix} excluded=source-guild`); continue; }
    if (joined.has(String(destination.guildId))) { log(`${prefix} excluded=oauth-current-member`); continue; }

    let guild;
    try {
      // A user can only be joined by OAuth if the bot is already in the guild.
      // Fetch instead of relying on the gateway cache.
      guild = await client.guilds.fetch(destination.guildId);
    } catch (error) {
      log(`${prefix} excluded=unreachable`);
      continue;
    }
    if (!guild) { log(`${prefix} excluded=unreachable`); continue; }

    try {
      await guild.members.fetch({ user: userId, force: true });
      log(`${prefix} excluded=discord-current-member`);
      continue;
    } catch (error) {
      if (!unknownMemberError(error)) {
        log(`${prefix} excluded=membership-unknown`);
        continue;
      }
    }

    // Passport history is intentionally not consulted: leaving a destination
    // makes it eligible again, while the passport remains historical data.
    log(`${prefix} included=eligible`);
    eligible.push(destination);
  }
  return eligible;
}

async function choose(client, userId, currentGuildId, joinedGuildIds = []) {
  const choices = await eligibleDestinations({
    destinations: await list(false), client, userId, currentGuildId, joinedGuildIds,
  });
  return choices[Math.floor(Math.random() * choices.length)] || null;
}
async function recordVisit(userId, destination) { return mutate(async () => { await load(); state.passports[userId] ||= {}; const old = state.passports[userId][destination.guildId] || { guildId: destination.guildId, firstVisitAt: new Date().toISOString(), visitCount: 0, stamp: destination.stamp, name: destination.name }; old.visitCount += 1; state.passports[userId][destination.guildId] = old; await save(); return old; }); }
module.exports = { list, add, update, remove, choose, eligibleDestinations, recordVisit, validGuildId, validInvite };
