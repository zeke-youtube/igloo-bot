const { SlashCommandBuilder } = require('discord.js');
const config = require('../config');
const mode = require('../bot-mode');

async function execute(interaction, botMode = mode) {
  if (!botMode.isOwner(interaction.user.id)) return interaction.reply({ content: 'This command is only available to the bot owner.', ephemeral: true });
  if (await botMode.isClosed()) return interaction.reply({ content: `${config.pengEmoji()} IglooBot is already closed.`, ephemeral: true });
  await botMode.persistClosed(true);
  await interaction.reply({ content: `${config.pengEmoji()} IglooBot is now closed.`, ephemeral: true });
  await botMode.setPresence(interaction.client, true);
}
module.exports = { data: new SlashCommandBuilder().setName('shutdownbot').setDescription('Put IglooBot into owner-only closed mode.'), execute };
