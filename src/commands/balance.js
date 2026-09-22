const { SlashCommandBuilder, EmbedBuilder } = require('discord.js');
const economy = require('../economy');
const config = require('../config');
module.exports = { data: new SlashCommandBuilder().setName('balance').setDescription('View a fish wallet.').addUserOption((option) => option.setName('user').setDescription('Whose balance to view').setRequired(false)), async execute(i) { const user = i.options.getUser('user') || i.user; const balance = await economy.getFishBalance(user.id); return i.reply({ embeds: [new EmbedBuilder().setColor(0x6bd6e8).setTitle(`${config.pengEmoji()} PikaPeng Fish Wallet`).setDescription(`<@${user.id}> has:\n\n🐟 **${balance} fish**`).setFooter({ text: 'PengBot · PikaStudio' })] }); } };
