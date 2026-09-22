const { SlashCommandBuilder, EmbedBuilder } = require('discord.js');
const config = require('../config');

module.exports = {
  data: new SlashCommandBuilder().setName('coinflip').setDescription('Flip a PikaPeng coin.'),
  async execute(interaction) {
    const result = Math.random() < 0.5 ? 'Heads' : 'Tails';
    return interaction.reply({ embeds: [new EmbedBuilder().setColor(0xf4c95d).setTitle(`${config.pengEmoji()} Coin Flip`).setDescription(`The PikaPeng coin landed on **${result}**!`).setFooter({ text: 'PengBot · PikaStudio' })] });
  }
};
