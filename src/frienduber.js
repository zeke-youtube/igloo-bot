const fs = require('node:fs/promises');
const path = require('node:path');
const crypto = require('node:crypto');
const { PermissionFlagsBits, ChannelType } = require('discord.js');
const economy = require('./economy');
const config = require('./config');

const file = path.join(__dirname, 'data', 'frienduber.json');
const MAX_PRICE = 1000000;
const MAX_DURATION_MINUTES = 1440;
const RESPONSE_MS = 10 * 60 * 1000;
const CLOSE_GRACE_MS = 60 * 1000;
let state = { users: {}, sessions: {}, transactions: {} };
let loaded = false;
let queue = Promise.resolve();
const locks = new Map();
const timers = new Map();

async function load() {
  if (loaded) return;
  try { state = JSON.parse(await fs.readFile(file, 'utf8')); } catch { /* first run */ }
  state.users ||= {}; state.sessions ||= {}; state.transactions ||= {};
  loaded = true;
}
async function save() {
  await fs.mkdir(path.dirname(file), { recursive: true });
  await fs.writeFile(`${file}.tmp`, `${JSON.stringify(state, null, 2)}\n`);
  await fs.rename(`${file}.tmp`, file);
}
function mutate(fn) {
  const next = queue.then(async () => { await load(); return fn(); });
  queue = next.catch(() => {});
  return next;
}
function lock(key, fn) {
  const previous = locks.get(key) || Promise.resolve();
  const current = previous.then(fn, fn);
  locks.set(key, current);
  current.finally(() => { if (locks.get(key) === current) locks.delete(key); }).catch(() => {});
  return current;
}
function record(id, guildId) { return state.users[`${guildId}:${id}`] ||= { userId: id, guildId, listed: false, price: 0, durationMinutes: 0, blocked: [] }; }
function owned(id) { return mutate(() => Boolean(state.users[`ownership:${id}`]?.owned)); }
async function grantOwnership(id) { return mutate(async () => { const key = `ownership:${id}`; if (state.users[key]?.owned) return true; state.users[key] = { owned: true, purchasedAt: Date.now() }; await save(); return true; }); }
function activeForFriend(guildId, friendId) { return Object.values(state.sessions).find(s => s.guildId === guildId && s.friendId === friendId && ['WAITING', 'ACTIVE'].includes(s.status)); }

async function listing(id, guildId) { return mutate(() => ({ ...record(id, guildId) })); }
async function stock(id, guildId, price, durationMinutes) {
  if (!Number.isSafeInteger(price) || price < 1 || price > MAX_PRICE || !Number.isSafeInteger(durationMinutes) || durationMinutes < 1 || durationMinutes > MAX_DURATION_MINUTES) return { error: 'values' };
  return mutate(async () => {
    if (!state.users[`ownership:${id}`]?.owned) return { error: 'unowned' };
    const u = record(id, guildId);
    if (activeForFriend(guildId, id)) return { error: 'rented' };
    u.price = price; u.durationMinutes = durationMinutes; u.listed = true; u.updatedAt = Date.now();
    await save(); return { listing: { ...u } };
  });
}
async function unstock(id, guildId) { return mutate(async () => { const u = record(id, guildId); u.listed = false; await save(); return { listing: { ...u } }; }); }
async function block(id, guildId, targetId, blocked) {
  return mutate(async () => {
    if (id === targetId) return { error: 'self' };
    const u = record(id, guildId); u.blocked ||= [];
    u.blocked = blocked ? [...new Set([...u.blocked, targetId])] : u.blocked.filter(x => x !== targetId);
    await save(); return { blocked: u.blocked.includes(targetId) };
  });
}
function mutuallyBlocked(a, b) {
  return (state.users[`${a.guildId}:${a.userId}`]?.blocked || []).includes(b.userId) || (state.users[`${b.guildId}:${b.userId}`]?.blocked || []).includes(a.userId);
}
function available(guild, viewerId) {
  const results = [];
  for (const u of Object.values(state.users)) {
    if (!u.guildId || u.guildId !== guild.id || !u.listed || u.userId === viewerId || activeForFriend(guild.id, u.userId)) continue;
    const member = guild.members.cache.get(u.userId);
    if (!member || member.presence?.status !== 'online') continue;
    if (mutuallyBlocked(u, { userId: viewerId, guildId: guild.id })) continue;
    results.push({ userId: u.userId, price: u.price, durationMinutes: u.durationMinutes, displayName: member.displayName });
  }
  return results;
}
async function find(guild, viewerId) { return mutate(() => available(guild, viewerId)); }
async function setTimer(id, client) {
  clearTimeout(timers.get(id));
  const s = await mutate(() => state.sessions[id] && { ...state.sessions[id] });
  if (!s || !['WAITING', 'ACTIVE'].includes(s.status)) return;
  const deadline = s.status === 'WAITING' ? s.responseDeadlineAt : s.expiresAt;
  const timer = setTimeout(() => (s.status === 'WAITING' ? noResponse(id, client) : complete(id, client)).catch(() => {}), Math.max(0, deadline - Date.now()));
  timer.unref?.(); timers.set(id, timer);
}
async function reserveAndCreate({ guild, renterId, friendId, client }) {
  return lock(`${guild.id}:${friendId}`, async () => {
    const member = await guild.members.fetch(friendId).catch(() => null);
    const renter = await guild.members.fetch(renterId).catch(() => null);
    if (!member || !renter) return { error: 'missing' };
    const outcome = await mutate(async () => {
      const l = record(friendId, guild.id);
      if (!l.listed || member.presence?.status !== 'online' || activeForFriend(guild.id, friendId)) return { error: 'raced' };
      if (mutuallyBlocked(l, { userId: renterId, guildId: guild.id })) return { error: 'blocked' };
      if (!state.users[`ownership:${renterId}`]?.owned) return { error: 'unowned' };
      const balance = await economy.getFishBalance(renterId);
      if (balance < l.price) return { error: 'funds', balance, price: l.price };
      const id = crypto.randomUUID();
      const session = { id, shortId: id.slice(0, 8), guildId: guild.id, renterId, friendId, price: l.price, durationMinutes: l.durationMinutes, status: 'CREATING', held: false, createdAt: Date.now(), responseDeadlineAt: Date.now() + RESPONSE_MS, channelId: null, settled: false };
      state.sessions[id] = session; await save();
      return { session: { ...session } };
    });
    if (outcome.error) return outcome;
    const s = outcome.session;
    try {
      const held = await economy.friendUberHold(s.id, renterId, s.price);
      if (!held.held) { await removeReservation(s.id); return { error: 'funds', balance: held.balance, price: s.price }; }
      await mutate(async () => { const current = state.sessions[s.id]; if (current.status !== 'CREATING') throw new Error('Reservation no longer active'); current.held = true; state.transactions[`${s.id}:hold`] = { kind: 'hold', status: 'DONE', at: Date.now() }; await save(); });
      const channel = await guild.channels.create({
        name: `frienduber-${s.shortId}`, type: ChannelType.GuildText,
        permissionOverwrites: [
          { id: guild.roles.everyone.id, deny: [PermissionFlagsBits.ViewChannel] },
          { id: renterId, allow: [PermissionFlagsBits.ViewChannel, PermissionFlagsBits.SendMessages, PermissionFlagsBits.ReadMessageHistory] },
          { id: friendId, allow: [PermissionFlagsBits.ViewChannel, PermissionFlagsBits.SendMessages, PermissionFlagsBits.ReadMessageHistory] },
          { id: client.user.id, allow: [PermissionFlagsBits.ViewChannel, PermissionFlagsBits.SendMessages, PermissionFlagsBits.ReadMessageHistory, PermissionFlagsBits.ManageChannels] }
        ]
      });
      await mutate(async () => { const current = state.sessions[s.id]; current.channelId = channel.id; current.status = 'WAITING'; await save(); });
      const msg = await channel.send({ content: `🚕 **FriendUber Session**\n\nRenter: <@${renterId}>\nFriend: <@${friendId}>\nPrice: ${s.price} 🐟\nDuration: ${s.durationMinutes} minutes\n\nWaiting for <@${friendId}> to respond...\nThey have 10 minutes.`, allowedMentions: { users: [renterId, friendId] } });
      await mutate(async () => { state.sessions[s.id].messageId = msg.id; await save(); });
      await setTimer(s.id, client);
      return { session: { ...s, status: 'WAITING', channelId: channel.id }, channel };
    } catch (error) {
      await refund(s.id, 'CHANNEL_CREATION_FAILED');
      await removeReservation(s.id);
      throw error;
    }
  });
}
async function settle(id, kind, toUserId) {
  return lock(`settlement:${id}`, async () => {
    const token = `${id}:${kind}`;
    const snapshot = await mutate(async () => {
      if (state.transactions[token]?.status === 'DONE') return null;
      const s = state.sessions[id]; if (!s || !s.held || s.settled) return null;
      state.transactions[token] = { kind, status: 'STARTED', at: Date.now() }; await save();
      return { renterId: s.renterId, friendId: s.friendId, price: s.price };
    });
    if (!snapshot) return false;
    // Fish balance persistence and FriendUber transaction marker are not a shared database;
    // idempotent economy ledger entries make retries safe across the boundary.
    const result = kind === 'refund'
      ? await economy.friendUberCredit(id, 'refund', snapshot.renterId, snapshot.price)
      : await economy.friendUberCredit(id, 'payout', toUserId || snapshot.friendId, snapshot.price);
    await mutate(async () => { state.transactions[token] = { kind, status: 'DONE', amount: result.amount, at: Date.now() }; const s = state.sessions[id]; if (s) s.settled = true; await save(); });
    return true;
  });
}
async function refund(id, reason) { const ok = await settle(id, 'refund'); if (ok) await mutate(async () => { const s = state.sessions[id]; if (s) s.cancelReason = reason; await save(); }); return ok; }
async function removeReservation(id) { return mutate(async () => { const s = state.sessions[id]; if (!s) return false; s.status = 'CANCELLED'; s.finishedAt = Date.now(); await save(); return true; }); }
async function editSessionChannel(client, s, content) { const ch = s.channelId && await client.channels.fetch(s.channelId).catch(() => null); if (!ch) return; if (s.messageId) { const msg = await ch.messages.fetch(s.messageId).catch(() => null); if (msg) await msg.edit({ content, components: [] }).catch(() => {}); } }
async function closeChannel(client, channelId) { if (!channelId) return; const timer = setTimeout(async () => { const channel = await client.channels.fetch(channelId).catch(() => null); if (channel) await channel.delete('FriendUber session ended').catch(() => {}); }, CLOSE_GRACE_MS); timer.unref?.(); }
async function notify(client, userId, message) { const user = await client.users.fetch(userId).catch(() => null); if (user) await user.send(message).catch(() => {}); }
async function noResponse(id, client) {
  const s = await mutate(() => state.sessions[id] && { ...state.sessions[id] }); if (!s || s.status !== 'WAITING') return false;
  if (Date.now() < s.responseDeadlineAt) return setTimer(id, client);
  await refund(id, 'NO_RESPONSE'); await removeReservation(id);
  const text = `❌ No response within 10 minutes.\n\n${s.price} 🐟 has been refunded.\n\nFriendUber session cancelled.`;
  await editSessionChannel(client, s, text); await notify(client, s.renterId, text); await notify(client, s.friendId, 'A FriendUber request expired because no response was received.'); await closeChannel(client, s.channelId); return true;
}
async function respond(message) {
  const id = await mutate(() => Object.values(state.sessions).find(s => s.channelId === message.channelId && s.status === 'WAITING')?.id || null);
  if (!id) return false;
  const s = await mutate(() => state.sessions[id] && { ...state.sessions[id] });
  if (!s || message.author.id !== s.friendId) return false;
  const activated = await lock(`${s.guildId}:${s.friendId}`, async () => mutate(async () => {
    const current = state.sessions[id];
    if (!current || current.status !== 'WAITING' || Date.now() >= current.responseDeadlineAt) return false;
    current.status = 'ACTIVE'; current.startedAt = Date.now(); current.expiresAt = current.startedAt + current.durationMinutes * 60 * 1000; await save(); return true;
  }));
  if (!activated) return false;
  await settle(id, 'payout', s.friendId);
  const content = `✓ <@${s.friendId}> responded!\n\nFriendUber session started.\n⏱️ ${s.durationMinutes} minutes remaining.`;
  const ch = await message.client.channels.fetch(s.channelId).catch(() => null);
  if (ch) await ch.send({ content, components: [require('./frienduber-ui').endRow(id)], allowedMentions: { users: [s.renterId, s.friendId] } });
  await setTimer(id, message.client); return true;
}
async function end(id, actorId, client, moderator = false) {
  return lock(`session:${id}`, async () => {
  const result = await mutate(async () => {
    const s = state.sessions[id]; if (!s || !['WAITING', 'ACTIVE'].includes(s.status)) return { error: 'finished' };
    if (!moderator && actorId !== s.renterId && actorId !== s.friendId) return { error: 'participant' };
    return { session: { ...s } };
  });
  if (result.error) return result;
  const s = result.session;
  if (s.status === 'WAITING') await refund(id, 'CANCELLED');
  await terminateSession(id, moderator ? 'MODERATOR' : 'PARTICIPANT');
  clearTimeout(timers.get(id));
  const message = s.status === 'WAITING' ? `FriendUber request cancelled.\n${s.price} 🐟 has been refunded.` : 'FriendUber session ended. The Fish payment is not refundable after the session starts.';
  await editSessionChannel(client, s, message); await notify(client, s.renterId, message); await notify(client, s.friendId, message); await closeChannel(client, s.channelId); return { ok: true };
  });
}
async function complete(id, client) {
  return lock(`session:${id}`, async () => {
  const s = await mutate(() => state.sessions[id] && { ...state.sessions[id] }); if (!s || s.status !== 'ACTIVE') return false;
  if (Date.now() < s.expiresAt) return setTimer(id, client);
  await mutate(async () => { const current = state.sessions[id]; if (current?.status === 'ACTIVE') { current.status = 'COMPLETE'; current.finishedAt = Date.now(); await save(); } });
  clearTimeout(timers.get(id));
  const text = '⏰ FriendUber session complete!\n\nThanks for using FriendUber. 🐧';
  await editSessionChannel(client, s, text); await notify(client, s.renterId, text); await notify(client, s.friendId, text); await closeChannel(client, s.channelId); return true;
  });
}
async function status(id, guildId) {
  return mutate(() => {
    const u = record(id, guildId);
    const active = Object.values(state.sessions).find(s => s.guildId === guildId && (s.renterId === id || s.friendId === id) && ['WAITING', 'ACTIVE'].includes(s.status));
    return { owned: Boolean(state.users[`ownership:${id}`]?.owned), listing: { ...u }, session: active ? { ...active } : null };
  });
}
async function sessionByChannel(channelId) { return mutate(() => { const s = Object.values(state.sessions).find(x => x.channelId === channelId && ['WAITING', 'ACTIVE'].includes(x.status)); return s ? { ...s } : null; }); }
async function terminateSession(id, reason) { return mutate(async () => { const s = state.sessions[id]; if (!s || !['WAITING', 'ACTIVE'].includes(s.status)) return false; s.status = 'CANCELLED'; s.finishedAt = Date.now(); s.endReason = reason; await save(); return true; }); }
function isModerator(member) { return member.permissions.has(PermissionFlagsBits.Administrator) || member.permissions.has(PermissionFlagsBits.ManageGuild) || config.staffRoleIds().some(id => member.roles.cache.has(id)); }
async function reconcile(client) {
  await mutate(async () => {
    // A crash can occur after recording STARTED but before writing the balance ledger.
    // Economy operations are keyed by session, so this may safely be retried below.
    await save();
  });
  const sessions = await mutate(() => Object.values(state.sessions).map(s => ({ ...s })));
  for (const s of sessions) {
    if (s.status === 'CREATING') { if (s.held) await refund(s.id, 'STARTUP_RECOVERY'); await removeReservation(s.id); continue; }
    if (s.status === 'WAITING') { if (Date.now() >= s.responseDeadlineAt) await noResponse(s.id, client); else await setTimer(s.id, client); }
    if (s.status === 'ACTIVE') { if (state.transactions[`${s.id}:payout`]?.status !== 'DONE') await settle(s.id, 'payout', s.friendId); if (Date.now() >= s.expiresAt) await complete(s.id, client); else await setTimer(s.id, client); }
  }
}
module.exports = { MAX_PRICE, MAX_DURATION_MINUTES, RESPONSE_MS, CLOSE_GRACE_MS, owns: owned, grantOwnership, listing, stock, unstock, block, available: find, reserveAndCreate, respond, end, complete, noResponse, status, sessionByChannel, terminateSession, isModerator, reconcile, _resetForTests: async () => { state = { users: {}, sessions: {}, transactions: {} }; loaded = true; queue = Promise.resolve(); locks.clear(); for (const t of timers.values()) clearTimeout(t); timers.clear(); } };
