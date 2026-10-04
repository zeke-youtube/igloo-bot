const crypto = require('node:crypto');
const { ActionRowBuilder, ButtonBuilder, ButtonStyle, EmbedBuilder } = require('discord.js');
const economy = require('./economy');
const config = require('./config');
const logger = require('./utils/logger');

const FISH_DROP_INTERVAL_MS = Number.isFinite(Number(process.env.FISH_DROP_INTERVAL_MS)) && Number(process.env.FISH_DROP_INTERVAL_MS) > 0 ? Number(process.env.FISH_DROP_INTERVAL_MS) : 10 * 60 * 1000;
const FISH_DROP_ACTIVITY_WINDOW_MS = 60 * 60 * 1000;
const FISH_DROP_REWARD = 10;
let schedulerStarted = false;
let timer = null;
let activeDrop = null;
const claimLocks = new Map();
const lastHumanActivityByGuild = new Map();

function recordActivity(message, now = Date.now()) {
  const guildId = message?.guildId || message?.guild?.id;
  if (!guildId || message?.author?.bot !== false) return false;
  lastHumanActivityByGuild.set(guildId, now);
  return true;
}

function hasRecentActivity(guildId, now = Date.now()) {
  const lastActivity = lastHumanActivityByGuild.get(guildId);
  return lastActivity !== undefined && now - lastActivity <= FISH_DROP_ACTIVITY_WINDOW_MS;
}

function withClaimLock(id, task) {
  const previous = claimLocks.get(id) || Promise.resolve();
  const current = previous.then(task, task);
  claimLocks.set(id, current);
  current.finally(() => { if (claimLocks.get(id) === current) claimLocks.delete(id); }).catch(() => {});
  return current;
}

function payload(token) {
  return {
    embeds: [new EmbedBuilder().setColor(0x6bd6e8).setTitle(`${config.pengEmoji()} FISH DROP!`).setDescription(`PikaPeng dropped a fish!\n\nFirst person to click the button gets:\n\n🐟 **${FISH_DROP_REWARD} fish**`).setFooter({ text: 'PengBot - PikaStudio' })],
    components: [new ActionRowBuilder().addComponents(new ButtonBuilder().setCustomId(`fishdrop:${token}`).setLabel('CLAIM FISH').setStyle(ButtonStyle.Primary))],
  };
}

async function disableDrop(drop, content) {
  if (!drop?.message?.editable) return;
  try { await drop.message.edit({ content, components: [] }); } catch (error) { logger.error('Fish Drop message update failed', error); }
}

async function expireActiveDrop() {
  if (!activeDrop || activeDrop.claimed || activeDrop.expired) return;
  activeDrop.expired = true;
  logger.info('Fish Drop expired');
  await disableDrop(activeDrop, `${config.pengEmoji()} Fish Drop expired. A fresh drop is on the way.`);
}

async function postDrop(client, now = Date.now(), { bypassActivityCheck = false } = {}) {
  if (await require('./bot-mode').isClosed()) return null;
  const channelId = config.fishDropChannelId();
  const channel = channelId ? await client.channels.fetch(channelId).catch((error) => { logger.error(`Fish Drop channel fetch failed for ${channelId}`, error); return null; }) : null;
  if (!channel?.isTextBased() || typeof channel.send !== 'function') { logger.error(`Fish Drop skipped: configured channel ${channelId || '(missing)'} is unavailable or not text-capable.`); return null; }
  if (!bypassActivityCheck && !hasRecentActivity(channel.guildId || channel.guild?.id, now)) {
    logger.info('Fish Drop skipped: no human server activity in the last 60 minutes');
    return null;
  }
  await expireActiveDrop();
  const token = crypto.randomBytes(12).toString('hex');
  try {
    const message = await channel.send(payload(token));
    activeDrop = { token, message, claimed: false, expired: false };
    logger.info('Fish Drop posted');
    return activeDrop;
  } catch (error) { logger.error('Fish Drop posting failed', error); return null; }
}

async function claim(interaction, token) {
  return withClaimLock(token, async () => {
    const drop = activeDrop;
    if (!drop || drop.token !== token || drop.claimed || drop.expired) return interaction.reply({ content: `${config.pengEmoji()} Too slow! Someone already grabbed this fish.`, ephemeral: true }).catch(() => null);
    drop.claimed = true;
    let credited = false;
    try {
      const balance = await economy.addFish(interaction.user.id, FISH_DROP_REWARD);
      credited = true;
      await interaction.update({ embeds: [new EmbedBuilder().setColor(0x6bd6e8).setTitle(`${config.pengEmoji()} FISH CLAIMED!`).setDescription(`<@${interaction.user.id}> grabbed the fish!\n\n🐟 **+${FISH_DROP_REWARD} fish**\n\nBalance: **${balance} fish**`).setFooter({ text: 'PengBot - PikaStudio' })], components: [] });
      logger.info(`Fish Drop claimed by ${interaction.user.id}`);
      return { claimed: true, balance };
    } catch (error) {
      if (!credited) drop.claimed = false;
      logger.error(`Fish Drop claim failed for ${interaction.user.id}`, error);
      if (interaction.replied || interaction.deferred) return null;
      return interaction.reply({ content: `${config.pengEmoji()} PikaPeng dropped the fish paperwork. Please try again.`, ephemeral: true }).catch(() => null);
    }
  });
}

async function start(client) {
  if (schedulerStarted) return false;
  schedulerStarted = true;
  logger.info(`Fish Drop scheduler started (interval ${FISH_DROP_INTERVAL_MS}ms)`);
  logger.info('Fish Drop startup drop triggered');
  const startupDrop = await postDrop(client, Date.now(), { bypassActivityCheck: true });
  if (startupDrop) logger.info('Fish Drop sent successfully');
  timer = setInterval(() => postDrop(client, Date.now(), { bypassActivityCheck: false }).catch((error) => logger.error('Fish Drop scheduler failed', error)), FISH_DROP_INTERVAL_MS);
  timer.unref?.();
  return true;
}

async function stop() { if (timer) clearInterval(timer); timer = null; schedulerStarted = false; activeDrop = null; lastHumanActivityByGuild.clear(); }
function isStarted() { return schedulerStarted; }

module.exports = { start, stop, claim, postDrop, expireActiveDrop, recordActivity, hasRecentActivity, isStarted, FISH_DROP_INTERVAL_MS, FISH_DROP_ACTIVITY_WINDOW_MS, FISH_DROP_REWARD };
