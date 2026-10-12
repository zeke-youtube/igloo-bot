const crypto = require('node:crypto');
const { SlashCommandBuilder, EmbedBuilder } = require('discord.js');
const economy = require('../economy');
const logger = require('../utils/logger');

const COOLDOWN_MS = economy.FISHING_COOLDOWN_MS;
const CATCHES = Object.freeze([
  Object.freeze({ id: 'old-boot', name: '🥾 Old Boot', rarity: 'Common', weight: 20, reward: 0 }),
  Object.freeze({ id: 'sardine', name: '🐟 Sardine', rarity: 'Common', weight: 35, reward: 10 }),
  Object.freeze({ id: 'salmon', name: '🐠 Salmon', rarity: 'Uncommon', weight: 25, reward: 30 }),
  Object.freeze({ id: 'pufferfish', name: '🐡 Pufferfish', rarity: 'Rare', weight: 12, reward: 60 }),
  Object.freeze({ id: 'shark', name: '🦈 Shark', rarity: 'Epic', weight: 7, reward: 150 }),
  Object.freeze({ id: 'golden-fish', name: '👑 Golden Fish', rarity: 'Legendary', weight: 1, reward: 1000 }),
]);
const TOTAL_WEIGHT = CATCHES.reduce((sum, item) => sum + item.weight, 0);

function selectCatch(draw = crypto.randomInt(TOTAL_WEIGHT)) {
  if (!Number.isInteger(draw) || draw < 0 || draw >= TOTAL_WEIGHT) throw new RangeError('Fishing draw is outside the weighted range.');
  let cumulative = 0;
  for (const item of CATCHES) {
    cumulative += item.weight;
    if (draw < cumulative) return item;
  }
  throw new Error('Fishing catch table is invalid.');
}

function resultEmbed(result) {
  return new EmbedBuilder()
    .setColor(result.catch.reward === 1000 ? 0xf4c95d : 0x6bd6e8)
    .setTitle('🎣 Fishing Results')
    .setDescription(`${result.catch.name}\n\n- Rarity: ${result.catch.rarity}\n- Reward: +${result.fishAwarded} Fish\n- New balance: ${result.balance.toLocaleString('en-US')} Fish`)
    .setFooter({ text: 'PengBot · PikaStudio' });
}

function cooldownReply(remainingMs) {
  const seconds = Math.ceil(remainingMs / 1000);
  return { embeds: [new EmbedBuilder().setColor(0x6bd6e8).setTitle('🎣 Your fishing rod needs a break!').setDescription(`⏳ Try again in ${seconds} second${seconds === 1 ? '' : 's'}.`)] };
}

const data = new SlashCommandBuilder().setName('fish').setDescription('Cast a line and see what you catch.');

async function execute(interaction) {
  if (interaction.user.bot) return interaction.reply({ content: 'Bots cannot go fishing.', ephemeral: true });
  await interaction.deferReply();
  try {
    const result = await economy.processFishing({
      interactionId: interaction.id,
      userId: interaction.user.id,
      guildId: interaction.guildId || null,
      selectCatch,
    });
    if (result.status === 'cooldown') return interaction.editReply(cooldownReply(result.remainingMs));
    logger.info(`Fishing user=${result.userId} guild=${result.guildId || 'DM'} interaction=${result.interactionId} catch=${result.catch.id} fish=${result.fishAwarded} timestamp=${new Date(result.timestamp).toISOString()}${result.duplicate ? ' duplicate=true' : ''}`);
    return interaction.editReply({ embeds: [resultEmbed(result)] });
  } catch (error) {
    logger.error(`Fishing transaction failed user=${interaction.user.id} guild=${interaction.guildId || 'DM'} interaction=${interaction.id}`, error);
    return interaction.editReply({ content: '🎣 Your catch could not be saved. No Fish or cooldown were recorded. Please try again.' });
  }
}

module.exports = { data, execute, CATCHES, TOTAL_WEIGHT, COOLDOWN_MS, selectCatch, resultEmbed, cooldownReply };
