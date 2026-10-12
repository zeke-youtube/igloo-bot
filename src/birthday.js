const fs = require('node:fs/promises');
const path = require('node:path');
const crypto = require('node:crypto');
const { EmbedBuilder, PermissionFlagsBits } = require('discord.js');
const economy = require('./economy');
const config = require('./config');
const logger = require('./utils/logger');

const TIME_ZONE = 'Asia/Taipei';
const ROLE_NAME = '🎂 Birthday Penguin';
const REWARD = 1000;
const CHANGE_COOLDOWN_MS = 30 * 24 * 60 * 60 * 1000;
const storePath = path.join(process.env.IGLOOBOT_DATA_DIR || path.join(__dirname, 'data'), 'birthdays.json');
let state = { birthdays: {}, guilds: {}, announcements: {}, roleRemovals: {} };
let loaded = false;
let queue = Promise.resolve();
let saveQueue = Promise.resolve();
let saveSequence = 0;
let scheduler = null;
let running = false;
const eventLocks = new Map();

const mutate = (task) => { const next = queue.then(task, task); queue = next.catch(() => {}); return next; };
async function load() {
  if (loaded) return;
  try { state = { ...state, ...JSON.parse(await fs.readFile(storePath, 'utf8')) }; }
  catch (error) { if (error.code !== 'ENOENT') logger.error('Birthday data load failed', error); }
  loaded = true;
}
async function save() {
  const snapshot = `${JSON.stringify(state, null, 2)}\n`;
  const temporaryPath = `${storePath}.${process.pid}.${++saveSequence}.tmp`;
  const write = saveQueue.then(async () => {
    await fs.writeFile(temporaryPath, snapshot, 'utf8');
    await fs.rename(temporaryPath, storePath);
  });
  saveQueue = write.catch(() => {});
  return write;
}
function taipeiDate(date = new Date()) {
  const parts = new Intl.DateTimeFormat('en-CA', { timeZone: TIME_ZONE, year: 'numeric', month: '2-digit', day: '2-digit' }).formatToParts(date);
  const p = Object.fromEntries(parts.map(({ type, value }) => [type, value]));
  return `${p.year}-${p.month}-${p.day}`;
}
function dateParts(dateKey) { const [year, month, day] = dateKey.split('-').map(Number); return { year, month, day }; }
function isValidBirthday(month, day) {
  return Number.isInteger(month) && Number.isInteger(day) && month >= 1 && month <= 12 && day >= 1 && day <= 31
    && new Date(Date.UTC(2000, month - 1, day)).getUTCMonth() === month - 1
    && new Date(Date.UTC(2000, month - 1, day)).getUTCDate() === day;
}
function celebrationDate(month, day, year) {
  if (month === 2 && day === 29 && new Date(Date.UTC(year, 1, 29)).getUTCMonth() !== 1) return `${year}-02-28`;
  return `${year}-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
}
function nextCelebration(month, day, now = new Date()) {
  const today = taipeiDate(now); const { year } = dateParts(today);
  let next = celebrationDate(month, day, year);
  if (next < today) next = celebrationDate(month, day, year + 1);
  return next;
}
function key(guildId, userId) { return `${guildId}:${userId}`; }
function canManage(interaction) {
  return interaction.memberPermissions?.has(PermissionFlagsBits.Administrator)
    || interaction.memberPermissions?.has(PermissionFlagsBits.ManageChannels)
    || config.staffRoleIds().some((id) => interaction.member?.roles?.cache?.has(id));
}

async function setBirthday(guildId, userId, month, day, now = Date.now()) {
  if (!isValidBirthday(month, day)) return { error: 'date' };
  return mutate(async () => {
    await load(); const id = key(guildId, userId); const previous = state.birthdays[id];
    if (previous && (previous.month !== month || previous.day !== day) && now < Date.parse(previous.updatedAt) + CHANGE_COOLDOWN_MS) {
      return { error: 'cooldown', nextChangeAt: Date.parse(previous.updatedAt) + CHANGE_COOLDOWN_MS };
    }
    if (previous?.month === month && previous?.day === day) return { birthday: previous, changed: false };
    const birthday = { guildId, userId, month, day, createdAt: previous?.createdAt || new Date(now).toISOString(), updatedAt: new Date(now).toISOString(), roleAssignedUntil: previous?.roleAssignedUntil || null };
    state.birthdays[id] = birthday;
    try { await save(); } catch (error) { if (previous) state.birthdays[id] = previous; else delete state.birthdays[id]; throw error; }
    return { birthday, changed: true };
  });
}

async function removeBirthday(guildId, userId, guild) {
  const birthday = await mutate(async () => {
    await load(); const id = key(guildId, userId); const previous = state.birthdays[id];
    if (!previous) return null;
    delete state.birthdays[id];
    try { await save(); } catch (error) { state.birthdays[id] = previous; throw error; }
    return previous;
  });
  if (birthday && guild) {
    await mutate(async () => { await load(); state.roleRemovals[key(guildId, userId)] = { guildId, userId, roleId: birthday.roleAssignedRoleId || state.guilds[guildId]?.birthdayRoleId || null }; await save(); });
    await retryRoleRemoval(guild, key(guildId, userId)).catch((error) => logger.error(`Birthday role removal failed guild=${guildId} user=${userId}`, error));
  }
  return birthday;
}

async function getBirthday(guildId, userId) { await load(); return state.birthdays[key(guildId, userId)] || null; }
async function listUpcoming(guildId, now = new Date()) {
  await load(); const today = taipeiDate(now);
  return Object.values(state.birthdays).filter((b) => b.guildId === guildId)
    .map((b) => ({ ...b, nextDate: nextCelebration(b.month, b.day, now) }))
    .sort((a, b) => a.nextDate.localeCompare(b.nextDate) || a.userId.localeCompare(b.userId))
    .filter((b) => b.nextDate >= today);
}

async function getRole(guild) {
  await load(); const configured = state.guilds[guild.id]?.birthdayRoleId;
  if (configured) {
    const role = await guild.roles.fetch(configured).catch(() => null);
    if (role) return role;
  }
  let role = guild.roles.cache.find((candidate) => candidate.name === ROLE_NAME);
  if (role) {
    await rememberRole(guild.id, role.id, Boolean(configured));
    return role;
  }
  if (!guild.members.me?.permissions.has(PermissionFlagsBits.ManageRoles)) throw new Error('Manage Roles permission is required to create the birthday role.');
  role = await guild.roles.create({ name: ROLE_NAME, reason: 'IglooBot birthday system role' });
  await rememberRole(guild.id, role.id, Boolean(configured));
  return role;
}
async function rememberRole(guildId, roleId, replace = false) {
  await mutate(async () => {
    await load(); const settings = state.guilds[guildId] || {};
    if (settings.birthdayRoleId && !replace) return;
    state.guilds[guildId] = { ...settings, birthdayRoleId: roleId };
    await save();
  });
}
async function assignRole(guild, birthday, untilDate) {
  const role = await getRole(guild);
  if (!guild.members.me?.permissions.has(PermissionFlagsBits.ManageRoles) || role.managed || role.position >= guild.members.me.roles.highest.position) throw new Error('Birthday role is above the bot or Manage Roles permission is unavailable.');
  const member = await guild.members.fetch(birthday.userId).catch(() => null);
  if (!member) return false;
  if (!member.roles.cache.has(role.id)) await member.roles.add(role, 'Birthday celebration');
  await mutate(async () => { await load(); const record = state.birthdays[key(guild.id, birthday.userId)]; if (!record) return; const oldUntil = record.roleAssignedUntil; const oldRoleId = record.roleAssignedRoleId; record.roleAssignedUntil = untilDate; record.roleAssignedRoleId = role.id; try { await save(); } catch (error) { record.roleAssignedUntil = oldUntil; record.roleAssignedRoleId = oldRoleId; throw error; } });
  return true;
}
async function removeRole(guild, birthday, roleIdOverride) {
  const configuredId = roleIdOverride || state.guilds[guild.id]?.birthdayRoleId;
  let role = configuredId ? await guild.roles.fetch(configuredId).catch(() => null) : null;
  if (!role) role = guild.roles.cache.find((candidate) => candidate.name === ROLE_NAME);
  if (!role) return;
  if (!guild.members.me?.permissions.has(PermissionFlagsBits.ManageRoles) || role.managed || role.position >= guild.members.me.roles.highest.position) throw new Error('Birthday role is above the bot or Manage Roles permission is unavailable.');
  const member = await guild.members.fetch(birthday.userId).catch(() => null);
  if (member?.roles.cache.has(role.id)) await member.roles.remove(role, 'Birthday celebration ended');
}
async function retryRoleRemoval(guild, removalKey) {
  await load(); const removal = state.roleRemovals[removalKey]; if (!removal) return;
  await removeRole(guild, removal, removal.roleId);
  delete state.roleRemovals[removalKey]; await save();
}

async function setGuildConfig(guildId, { channelId, roleId }) {
  return mutate(async () => {
    await load(); const previous = state.guilds[guildId] || {}; const updated = { ...previous };
    if (channelId !== undefined) updated.announcementChannelId = channelId;
    if (roleId !== undefined) updated.birthdayRoleId = roleId;
    state.guilds[guildId] = updated;
    try { await save(); } catch (error) { state.guilds[guildId] = previous; throw error; }
    return updated;
  });
}
async function guildConfig(guildId) { await load(); return { announcementChannelId: state.guilds[guildId]?.announcementChannelId || config.announcementsChannelId(), birthdayRoleId: state.guilds[guildId]?.birthdayRoleId || null }; }

async function findAnnouncement(channel, marker) {
  const messages = await channel.messages.fetch({ limit: 100 });
  return messages.find((message) => message.embeds.some((embed) => embed.footer?.text === marker)) || null;
}
async function announce(guild, birthday, year, rewardAwarded) {
  await load(); const id = key(guild.id, birthday.userId); const marker = `Birthday record ${birthday.userId}-${year}`;
  const recordKey = `${id}:${year}`; let record = state.announcements[recordKey];
  if (record?.status === 'sent') return;
  const target = await guildConfig(guild.id); const channel = await guild.channels.fetch(target.announcementChannelId).catch(() => null);
  if (!channel?.isTextBased() || !channel.messages) throw new Error('Birthday announcement channel is unavailable.');
  if (record?.status === 'sending') {
    const recovered = await findAnnouncement(channel, marker);
    if (recovered) { record.status = 'sent'; record.messageId = recovered.id; await save(); return; }
  }
  state.announcements[recordKey] = { status: 'sending', updatedAt: new Date().toISOString() };
  await save();
  const rewardText = rewardAwarded ? '🐟 **+1,000 Fish**' : '🐟 **No new Fish were awarded** (this year’s gift was already claimed).';
  const role = await getRole(guild).catch(() => null);
  const embed = new EmbedBuilder().setColor(0xf4c95d).setTitle('🎉 HAPPY BIRTHDAY! 🎂')
    .setDescription(`Everyone, give a big birthday waddle to <@${birthday.userId}>! 🐧\n\n🎁 A gift from IglooBot!\n\n${rewardText}\n\n🏅 Special Birthday Role:\n${role ? `<@&${role.id}>` : ROLE_NAME}\n\nHave an amazing birthday!`)
    .setFooter({ text: marker });
  const nonce = crypto.createHash('sha256').update(recordKey).digest('hex').slice(0, 25);
  const message = await channel.send({ embeds: [embed], allowedMentions: { users: [birthday.userId], parse: [] }, nonce, enforceNonce: true });
  state.announcements[recordKey] = { status: 'sent', messageId: message.id, updatedAt: new Date().toISOString() };
  await save();
}

async function processBirthdayRun(guild, birthday, today) {
  const { year } = dateParts(today); const celebration = celebrationDate(birthday.month, birthday.day, year);
  if (celebration !== today) return;
  const member = await guild.members.fetch(birthday.userId).catch(() => null);
  if (!member) return;
  const until = nextDate(today);
  const reward = await economy.awardBirthdayFish(guild.id, birthday.userId, year, REWARD);
  try { await assignRole(guild, birthday, until); }
  catch (error) { logger.error(`Birthday role assignment failed guild=${guild.id} user=${birthday.userId}`, error); }
  await announce(guild, birthday, year, reward.awarded);
}
async function processBirthday(guild, birthday, today) {
  const id = `${guild.id}:${birthday.userId}:${dateParts(today).year}`;
  const previous = eventLocks.get(id) || Promise.resolve();
  const current = previous.then(() => processBirthdayRun(guild, birthday, today));
  const tracked = current.catch(() => {});
  eventLocks.set(id, tracked);
  try { return await current; }
  finally { if (eventLocks.get(id) === tracked) eventLocks.delete(id); }
}
function nextDate(dateKey) { const { year, month, day } = dateParts(dateKey); return new Date(Date.UTC(year, month - 1, day + 1)).toISOString().slice(0, 10); }
async function reconcileRoles(guild, today) {
  await load();
  for (const [id, removal] of Object.entries(state.roleRemovals)) if (removal.guildId === guild.id) {
    try { await retryRoleRemoval(guild, id); } catch (error) { logger.error(`Birthday role removal retry failed guild=${guild.id} user=${removal.userId}`, error); }
  }
  for (const birthday of Object.values(state.birthdays)) {
    if (birthday.guildId !== guild.id || !birthday.roleAssignedUntil || birthday.roleAssignedUntil > today) continue;
    try { await removeRole(guild, birthday, birthday.roleAssignedRoleId); birthday.roleAssignedUntil = null; birthday.roleAssignedRoleId = null; await save(); }
    catch (error) { logger.error(`Birthday role expiry failed guild=${guild.id} user=${birthday.userId}`, error); }
  }
}
async function processGuild(guild) {
  const today = taipeiDate(); await reconcileRoles(guild, today); await load();
  for (const birthday of Object.values(state.birthdays)) {
    if (birthday.guildId !== guild.id || celebrationDate(birthday.month, birthday.day, dateParts(today).year) !== today) continue;
    try { await processBirthday(guild, birthday, today); }
    catch (error) { logger.error(`Birthday processing failed guild=${guild.id} user=${birthday.userId}`, error); }
  }
}
async function processAll(client) {
  if (running) return; running = true;
  try { for (const guild of client.guilds.cache.values()) await processGuild(guild).catch((error) => logger.error(`Birthday guild processing failed guild=${guild.id}`, error)); }
  finally { running = false; }
}
function start(client) { if (scheduler) return; scheduler = setInterval(() => processAll(client), 60_000); scheduler.unref?.(); processAll(client).catch((error) => logger.error('Birthday scheduler startup failed', error)); logger.info('Birthday scheduler started (Asia/Taipei, 60-second interval).'); }
function stop() { if (scheduler) clearInterval(scheduler); scheduler = null; }

module.exports = { TIME_ZONE, ROLE_NAME, REWARD, CHANGE_COOLDOWN_MS, taipeiDate, isValidBirthday, celebrationDate, nextCelebration, setBirthday, removeBirthday, getBirthday, listUpcoming, setGuildConfig, guildConfig, processBirthday, processGuild, processAll, reconcileRoles, start, stop, canManage };
