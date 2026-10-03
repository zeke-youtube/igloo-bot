const fs = require('node:fs/promises');
const path = require('node:path');
const { ROLE_ID, formatStaffList } = require('./staff-list-core');
const logger = require('./utils/logger');

const stateFile = path.join(__dirname, 'data', 'staff-list.json');
let messageId = null;
let loaded = false;
let timer = null;
let running = Promise.resolve();
let clientRef = null;

async function loadState() {
  if (loaded) return;
  try {
    const saved = JSON.parse(await fs.readFile(stateFile, 'utf8'));
    messageId = typeof saved.messageId === 'string' ? saved.messageId : null;
  } catch (error) {
    if (error.code !== 'ENOENT') logger.error('Could not read staff-list message state.', error);
  }
  loaded = true;
}

async function saveState() {
  await fs.mkdir(path.dirname(stateFile), { recursive: true });
  const temporaryFile = `${stateFile}.tmp`;
  await fs.writeFile(temporaryFile, `${JSON.stringify({ messageId }, null, 2)}\n`, 'utf8');
  await fs.rename(temporaryFile, stateFile);
}

function memberOrder(a, b) {
  const rolePosition = (b.roles.highest?.position || 0) - (a.roles.highest?.position || 0);
  if (rolePosition) return rolePosition;
  const nameOrder = a.displayName.localeCompare(b.displayName, undefined, { sensitivity: 'base' });
  return nameOrder || a.id.localeCompare(b.id);
}

async function refresh(client) {
  const channelId = require('./config').staffListChannelId();
  if (!channelId) {
    logger.error('Staff list is disabled: STAFF_LIST_CHANNEL_ID is not configured.');
    return;
  }
  const guildId = require('./config').guildId();
  const guild = client.guilds.cache.get(guildId) || await client.guilds.fetch(guildId).catch(error => {
    logger.error(`Staff list could not fetch configured guild ${guildId}.`, error); return null;
  });
  if (!guild) return;
  const role = guild.roles.cache.get(ROLE_ID) || await guild.roles.fetch(ROLE_ID).catch(error => {
    logger.error(`Staff list role ${ROLE_ID} is missing or could not be fetched in guild ${guildId}.`, error); return null;
  });
  if (!role) {
    logger.error(`Staff list role ${ROLE_ID} does not exist in guild ${guildId}.`);
    return;
  }
  let members;
  try { members = await guild.members.fetch(); }
  catch (error) { logger.error(`Staff list could not fetch all members for guild ${guildId}.`, error); return; }
  const staff = [...members.values()].filter(member => member.roles.cache.has(ROLE_ID)).sort(memberOrder);
  const content = formatStaffList(staff);
  const channel = await client.channels.fetch(channelId).catch(error => {
    logger.error(`Staff list cannot access configured channel ${channelId}.`, error); return null;
  });
  if (!channel?.isTextBased() || !channel.messages) {
    logger.error(`Staff list channel ${channelId} is missing or is not a text channel.`);
    return;
  }
  await loadState();
  let message = null;
  if (messageId) {
    try { message = await channel.messages.fetch(messageId); }
    catch (error) {
      if (error.code !== 10008 && error.status !== 404) {
        logger.error(`Staff list could not fetch saved message ${messageId}.`, error);
        return;
      }
      logger.info(`Saved staff-list message ${messageId} was deleted; creating a replacement.`);
    }
  }
  if (message) {
    if (message.author.id !== client.user.id) {
      logger.error(`Saved staff-list message ${messageId} is not authored by this bot; creating a replacement.`);
      message = null;
    } else if (message.content !== content) {
      try { await message.edit({ content, allowedMentions: { parse: [], users: [], roles: [], repliedUser: false } }); }
      catch (error) { logger.error(`Staff list could not edit message ${messageId}.`, error); return; }
      return;
    } else return;
  }
  try {
    message = await channel.send({ content, allowedMentions: { parse: [], users: [], roles: [], repliedUser: false } });
    messageId = message.id;
    await saveState();
    logger.info(`Created staff list message ${messageId} in channel ${channelId}.`);
  } catch (error) { logger.error(`Staff list could not create a message in channel ${channelId}.`, error); }
}

function enqueue(client = clientRef) {
  if (!client) return;
  clearTimeout(timer);
  timer = setTimeout(() => {
    running = running.then(() => refresh(client)).catch(error => logger.error('Staff list refresh failed.', error));
  }, 1200);
  timer.unref?.();
}

function relevantRoleChanged(oldMember, newMember) {
  return oldMember.roles.cache.has(ROLE_ID) !== newMember.roles.cache.has(ROLE_ID);
}

function start(client) {
  clientRef = client;
  client.on('guildMemberUpdate', (oldMember, newMember) => {
    if (newMember.guild.id === require('./config').guildId() && relevantRoleChanged(oldMember, newMember)) enqueue(client);
  });
  client.on('guildMemberAdd', member => { if (member.guild.id === require('./config').guildId() && member.roles.cache.has(ROLE_ID)) enqueue(client); });
  client.on('guildMemberRemove', member => { if (member.guild.id === require('./config').guildId() && member.roles.cache.has(ROLE_ID)) enqueue(client); });
  return refresh(client).catch(error => logger.error('Staff list startup sync failed; the bot will continue running.', error));
}

module.exports = { start, refresh, enqueue, ROLE_ID, _resetForTests: () => { clearTimeout(timer); timer = null; messageId = null; loaded = false; running = Promise.resolve(); clientRef = null; } };
