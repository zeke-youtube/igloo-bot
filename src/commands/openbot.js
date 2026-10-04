const { SlashCommandBuilder } = require('discord.js');
const config = require('../config');
const mode = require('../bot-mode');

async function execute(interaction, botMode = mode, resume = require('../maintenance-resume').resume) {
  if (!botMode.isOwner(interaction.user.id)) return interaction.reply({ content: 'This command is only available to the bot owner.', ephemeral: true });
  if (!(await botMode.isClosed())) return interaction.reply({ content: `${config.pengEmoji()} IglooBot is already open.`, ephemeral: true });
  await botMode.persistClosed(false);
  await botMode.setPresence(interaction.client, false);
  await interaction.reply({ content: `${config.pengEmoji()} IglooBot is open again!`, ephemeral: true });
  await resume(interaction.client);
}
module.exports = { data: new SlashCommandBuilder().setName('openbot').setDescription('Restore normal IglooBot command handling.'), execute };
