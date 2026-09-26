const { SlashCommandBuilder, PermissionFlagsBits, EmbedBuilder } = require('discord.js');
const economy = require('../economy');
const config = require('../config');
const logger = require('../utils/logger');

const MAX_ADMIN_FISH_GRANT = Number.isSafeInteger(Number(process.env.MAX_ADMIN_FISH_GRANT)) && Number(process.env.MAX_ADMIN_FISH_GRANT) > 0 ? Number(process.env.MAX_ADMIN_FISH_GRANT) : 100000;
function isAdmin(interaction) { return Boolean(interaction.member?.permissions?.has(PermissionFlagsBits.Administrator)); }
function validateAmount(amount) { if (!Number.isSafeInteger(amount) || amount < 1) return 'Amount must be a positive whole number.'; if (amount > MAX_ADMIN_FISH_GRANT) return `Amount cannot exceed ${MAX_ADMIN_FISH_GRANT.toLocaleString()} fish.`; return null; }

module.exports = {
  MAX_ADMIN_FISH_GRANT, isAdmin, validateAmount,
  data: new SlashCommandBuilder().setName('addfish').setDescription('Add Fish to a user wallet. Administrator only.').setDefaultMemberPermissions(PermissionFlagsBits.Administrator).addUserOption((option) => option.setName('user').setDescription('The recipient').setRequired(true)).addIntegerOption((option) => option.setName('amount').setDescription('Positive Fish amount').setRequired(true).setMinValue(1).setMaxValue(MAX_ADMIN_FISH_GRANT)).addStringOption((option) => option.setName('reason').setDescription('Optional audit reason').setRequired(false).setMaxLength(500)),
  async execute(interaction) {
    if (!isAdmin(interaction)) return interaction.reply({ content: `${config.pengEmoji()} Administrator access is required to add Fish.`, ephemeral: true });
    const recipient = interaction.options.getUser('user'); const amount = interaction.options.getInteger('amount'); const reason = interaction.options.getString('reason')?.trim() || 'No reason provided';
    if (!recipient || recipient.bot) return interaction.reply({ content: `${config.pengEmoji()} Bot accounts cannot participate in the Fish economy.`, ephemeral: true });
    const amountError = validateAmount(amount); if (amountError) return interaction.reply({ content: `${config.pengEmoji()} ${amountError}`, ephemeral: true });
    try { const balance = await economy.addFish(recipient.id, amount); logger.info(`[ECONOMY] admin fish grant actor=${interaction.user.id} recipient=${recipient.id} amount=${amount} reason=${JSON.stringify(reason)} timestamp=${new Date().toISOString()}`); const embed = new EmbedBuilder().setColor(0x6bd6e8).setTitle(`${config.pengEmoji()} FISH ADDED`).setDescription(`Recipient: <@${recipient.id}>\nAmount: **+${amount} fish**\nBalance: **${balance} fish**\n\nReason: ${reason}\nAdded by: <@${interaction.user.id}>`).setFooter({ text: 'PengBot - PikaStudio' }); return interaction.reply({ embeds: [embed], ephemeral: true }); } catch (error) { logger.error(`Admin fish grant failed actor=${interaction.user.id} recipient=${recipient.id}`, error); return interaction.reply({ content: `${config.pengEmoji()} The Fish grant could not be persisted. No success was recorded.`, ephemeral: true }); }
  },
};
