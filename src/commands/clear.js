const { SlashCommandBuilder, PermissionFlagsBits } = require('discord.js');
const config = require('../config');

module.exports = {
  data: new SlashCommandBuilder()
    .setName('clear')
    .setDescription('Delete recent messages from this channel (staff only).')
    .addIntegerOption((option) => option.setName('amount').setDescription('Number of messages to delete, from 1 to 100.').setRequired(true).setMinValue(1).setMaxValue(100)),
  async execute(interaction) {
    if (!interaction.member.permissions.has(PermissionFlagsBits.ManageMessages)) return interaction.reply({ content: `${config.pengEmoji()} You need Manage Messages permission to use this command.`, ephemeral: true });
    if (!interaction.channel?.isTextBased() || !interaction.channel.bulkDelete) return interaction.reply({ content: `${config.pengEmoji()} This channel does not support bulk message deletion.`, ephemeral: true });
    const amount = interaction.options.getInteger('amount');
    try {
      const deleted = await interaction.channel.bulkDelete(amount, true);
      return interaction.reply({ content: `${config.pengEmoji()} Deleted ${deleted.size} message${deleted.size === 1 ? '' : 's'}.`, ephemeral: true });
    } catch (error) {
      return interaction.reply({ content: `${config.pengEmoji()} I could not delete those messages. Check my Manage Messages permission.`, ephemeral: true });
    }
  }
};
