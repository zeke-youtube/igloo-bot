const fs = require('node:fs/promises');
const path = require('node:path');
const { ChannelType, PermissionFlagsBits } = require('discord.js');
const config = require('./config');
const logger = require('./utils/logger');

const storePath = path.join(__dirname, 'data', 'ktv-rooms.json');
let records = {};
let loaded = false;
const userLocks = new Map();

async function load() {
  if (loaded) return;
  try { records = JSON.parse(await fs.readFile(storePath, 'utf8')); } catch { records = {}; }
  loaded = true;
}

async function save() {
  await fs.writeFile(storePath, `${JSON.stringify(records, null, 2)}\n`, 'utf8');
}

function withUserLock(userId, task) {
  const previous = userLocks.get(userId) || Promise.resolve();
  const current = previous.then(task, task);
  userLocks.set(userId, current);
  current.finally(() => { if (userLocks.get(userId) === current) userLocks.delete(userId); }).catch(() => {});
  return current;
}

async function getCategory(guild) {
  const category = await guild.channels.fetch(config.ktvCategoryId()).catch(() => null);
  if (!category) throw new Error('The configured PikaPeng KTV category could not be found.');
  if (category.type !== ChannelType.GuildCategory) throw new Error('The configured PikaPeng KTV channel is not a category.');
  return category;
}

async function createRoom(interaction, options = {}) {
  await load();
  const task = async () => {
    const existingId = records[interaction.user.id]?.channelId;
    if (existingId) {
      const existing = await interaction.guild.channels.fetch(existingId).catch(() => null);
      if (existing && existing.parentId === config.ktvCategoryId() && existing.type === ChannelType.GuildVoice) return { existing };
      delete records[interaction.user.id]; await save();
    }
    const category = await getCategory(interaction.guild);
    const safeName = `${interaction.member.displayName}'s PikaPeng Rented KTV`.slice(0, 100);
    const channel = await interaction.guild.channels.create({ name: safeName, type: ChannelType.GuildVoice, parent: category.id, permissionOverwrites: [{ id: interaction.guild.roles.everyone.id, deny: [PermissionFlagsBits.ViewChannel, PermissionFlagsBits.Connect, PermissionFlagsBits.Speak, PermissionFlagsBits.Stream, PermissionFlagsBits.UseVAD] }, { id: interaction.user.id, allow: [PermissionFlagsBits.ViewChannel, PermissionFlagsBits.Connect, PermissionFlagsBits.Speak, PermissionFlagsBits.Stream, PermissionFlagsBits.UseVAD] }] });
    records[interaction.user.id] = { channelId: channel.id, ownerId: interaction.user.id, guildId: interaction.guild.id, createdAt: Date.now(), locked: true, approvedGuestIds: [] };
    try { await save(); } catch (error) { await channel.delete('KTV ownership persistence failed').catch((cleanupError) => logger.error(`Could not clean up untracked KTV ${channel.id}`, cleanupError)); throw error; }
    logger.info(`Created KTV ${channel.id} for ${interaction.user.tag}`);
    return { channel };
  };
  return options.skipLock ? task() : withUserLock(interaction.user.id, task);
}

async function getOwnedRoom(guild, ownerId) {
  await load();
  const record = records[ownerId];
  if (!record) return null;
  const channel = await guild.channels.fetch(record.channelId).catch(() => null);
  if (!channel || channel.parentId !== config.ktvCategoryId() || channel.type !== ChannelType.GuildVoice) { delete records[ownerId]; await save(); return null; }
  record.approvedGuestIds ||= []; record.locked ??= true; record.createdAt ||= channel.createdTimestamp; record.guildId ||= guild.id; await save(); return { channel, ownerId, channelId: record.channelId, record };
}

async function getKtvByChannel(guild, channelId) { await load(); const entry = Object.entries(records).find(([, value]) => value.channelId === channelId); if (!entry) return null; const room = await getOwnedRoom(guild, entry[0]); return room && room.channelId === channelId ? room : null; }
async function updateKtv(ownerId, changes) { await load(); if (!records[ownerId]) return null; records[ownerId] = { ...records[ownerId], ...changes }; await save(); return records[ownerId]; }
async function addApprovedGuest(ownerId, userId) { const record = records[ownerId]; if (!record) return null; record.approvedGuestIds ||= []; if (!record.approvedGuestIds.includes(userId)) record.approvedGuestIds.push(userId); await save(); return record; }
async function removeApprovedGuest(ownerId, userId) { const record = records[ownerId]; if (!record) return null; record.approvedGuestIds = (record.approvedGuestIds || []).filter((id) => id !== userId); await save(); return record; }
async function deleteKtv(guild, ownerId, reason) { await load(); const record = records[ownerId]; if (!record) return { deleted: false }; const channel = await guild.channels.fetch(record.channelId).catch(() => null); if (!channel || channel.parentId !== config.ktvCategoryId() || channel.type !== ChannelType.GuildVoice) { delete records[ownerId]; await save(); return { deleted: true, channel: null }; } try { await channel.delete(reason); } catch (error) { logger.error(`Could not delete KTV ${record.channelId}`, error); return { deleted: false, error }; } delete records[ownerId]; await save(); return { deleted: true, channel }; }

async function getTrackedOwner(channelId) {
  await load();
  const entry = Object.entries(records).find(([, value]) => value.channelId === channelId);
  return entry ? entry[0] : null;
}

async function removeMemberAccess(client, channelId, userId) {
  const ownerId = await getTrackedOwner(channelId);
  if (!ownerId || ownerId === userId) return;
  const channel = await client.channels.fetch(channelId).catch(() => null);
  if (channel && channel.type === ChannelType.GuildVoice) await channel.permissionOverwrites.delete(userId, 'KTV guest left; remove temporary access').catch((error) => logger.error(`Could not remove KTV access from ${userId}`, error));
}

async function deleteTracked(client, reason) {
  await load();
  const entries = Object.entries(records); let deleted = 0;
  for (const [ownerId, record] of entries) {
    const channel = await client.channels.fetch(record.channelId).catch(() => null);
    if (channel && channel.parentId === config.ktvCategoryId() && channel.type === ChannelType.GuildVoice) { await channel.delete(reason).catch((error) => logger.error(`Could not delete tracked KTV ${record.channelId}`, error)); deleted += 1; }
    delete records[ownerId];
  }
  await save(); return deleted;
}

async function handleVoiceStateUpdate(oldState, newState, client) {
  await load();
  const channelId = oldState.channelId;
  if (!channelId || channelId === newState.channelId) return;
  const tracked = Object.values(records).some((record) => record.channelId === channelId);
  if (!tracked) return;
  const channel = await client.channels.fetch(channelId).catch(() => null);
  if (channel && channel.members.size === 0) await removeTracked(client, channelId);
}

async function removeTracked(client, channelId) {
  const entry = Object.entries(records).find(([, value]) => value.channelId === channelId);
  if (!entry) return;
  const channel = await client.channels.fetch(channelId).catch(() => null);
  if (channel && channel.parentId === config.ktvCategoryId() && channel.type === ChannelType.GuildVoice) await channel.delete('Empty PikaPeng Rented KTV').catch((error) => logger.error(`Could not delete empty KTV ${channelId}`, error));
  delete records[entry[0]]; await save();
}

async function cleanupStartup(client) { return deleteTracked(client, 'Cleaning stale PikaPeng Rented KTV on startup'); }
async function cleanupShutdown(client) { return deleteTracked(client, 'Cleaning PikaPeng Rented KTV on shutdown'); }

module.exports = { createRoom, getOwnedRoom, getKtvByChannel, updateKtv, addApprovedGuest, removeApprovedGuest, deleteKtv, getTrackedOwner, removeMemberAccess, handleVoiceStateUpdate, cleanupStartup, cleanupShutdown };
