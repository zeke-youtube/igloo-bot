const { SlashCommandBuilder, EmbedBuilder } = require('discord.js');
const config = require('../config');
const facts = require('../data/pengfacts.json');
module.exports = { data: new SlashCommandBuilder().setName('pengfact').setDescription('Get a random PikaPeng fact.'), async execute(interaction) { const fact = facts[Math.floor(Math.random() * facts.length)]; const emoji = config.pengEmoji(); return interaction.reply({ embeds: [new EmbedBuilder().setColor(0xf4c95d).setTitle(`${emoji} PikaPeng Fact`).setDescription(fact).setFooter({ text: 'PengBot · PikaStudio' })] }); } };
