const { SlashCommandBuilder, PermissionFlagsBits } = require('discord.js');
const config = require('../config');

module.exports = {
  data: new SlashCommandBuilder()
    .setName('clear')
    .setDescription('Delete recent messages from this channel (staff only).')
    .addIntegerOption((option) => option.setName('amount').setDescription('Number of messages to delete, from 1 to 10000.').setRequired(true).setMinValue(1).setMaxValue(10000)),
  async execute(interaction) {
    if (!interaction.member.permissions.has(PermissionFlagsBits.ManageMessages)) return interaction.reply({ content: `${config.pengEmoji()} You need Manage Messages permission to use this command.`, ephemeral: true });
    if (!interaction.channel?.isTextBased() || !interaction.channel.bulkDelete) return interaction.reply({ content: `${config.pengEmoji()} This channel does not support bulk message deletion.`, ephemeral: true });
    const amount = interaction.options.getInteger('amount');
    try {
      let deletedTotal = 0;
      while (deletedTotal < amount) {
        const batchSize = Math.min(100, amount - deletedTotal);
        const deleted = await interaction.channel.bulkDelete(batchSize, true);
        deletedTotal += deleted.size;
        if (deleted.size < batchSize) break;
      }
      return interaction.reply({ content: `${config.pengEmoji()} Deleted ${deletedTotal} message${deletedTotal === 1 ? '' : 's'}.`, ephemeral: true });
    } catch (error) {
      return interaction.reply({ content: `${config.pengEmoji()} I could not delete those messages. Check my Manage Messages permission.`, ephemeral: true });
    }
  }
};
