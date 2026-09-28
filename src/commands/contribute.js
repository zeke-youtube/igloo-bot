const { SlashCommandBuilder } = require('discord.js');
const community = require('../community-image');
const data = new SlashCommandBuilder().setName('contribute').setDescription('Contribute Fish to reveal the Community Image.').addIntegerOption(o => o.setName('fish').setDescription('Positive whole Fish amount').setRequired(true).setMinValue(1).setMaxValue(Number.MAX_SAFE_INTEGER));
async function execute(i) { try { const result = await community.contribute(i.user.id, i.options.getInteger('fish')); if (result.completed) await community.announce(i.client); return i.reply(`🐟 You contributed ${result.contribution.toLocaleString()} Fish!\n\nCommunity progress:\n${result.fish.toLocaleString()} / ${result.goal.toLocaleString()} — ${(result.fish / result.goal * 100).toFixed(2)}%`); } catch (error) { return i.reply({ content: `🎨 ${error.message}`, ephemeral: true }); } }
module.exports = { data, execute };
