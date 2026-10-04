const { SlashCommandBuilder } = require('discord.js');

module.exports = {
  data: new SlashCommandBuilder().setName('ping').setDescription('Check IglooBot response latency.'),
  async execute(interaction) {
    const milliseconds = Math.max(0, Date.now() - interaction.createdTimestamp);
    return interaction.reply({ content: `🏓 Pong! ${milliseconds}ms` });
  }
};
