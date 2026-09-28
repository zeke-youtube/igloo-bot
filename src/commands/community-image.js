const { SlashCommandBuilder, AttachmentBuilder } = require('discord.js');
const community = require('../community-image');
const data = new SlashCommandBuilder().setName('progress').setDescription('View the partially revealed Community Image.');
async function execute(i) { await i.deferReply(); try { const result = await community.progress(); return i.editReply({ content: `🎨 **Community Image**\n\n🐟 ${result.fish.toLocaleString()} / ${result.goal.toLocaleString()}\nProgress: ${result.percent.toFixed(2)}%`, files: [new AttachmentBuilder(result.image, { name: 'community-image.png' })] }); } catch (error) { return i.editReply(`🎨 ${error.message}`); } }
module.exports = { data, execute };
