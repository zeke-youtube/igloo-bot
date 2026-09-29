const { SlashCommandBuilder } = require('discord.js');
const afk = require('../afk');
const config = require('../config');
module.exports = { data: new SlashCommandBuilder().setName('afk').setDescription('Set yourself as AFK.').addStringOption((o) => o.setName('reason').setDescription('Why you are AFK').setMaxLength(afk.MAX_REASON_LENGTH).setRequired(false)), async execute(i) { const state = await afk.set(i.user.id, i.options.getString('reason')); return i.reply(`${config.pengEmoji()} You are now AFK: **${state.reason}**.`); } };
