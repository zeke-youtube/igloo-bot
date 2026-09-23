const { SlashCommandBuilder, PermissionFlagsBits, ModalBuilder, ActionRowBuilder, TextInputBuilder, TextInputStyle, EmbedBuilder } = require('discord.js');
const qotd = require('../qotd');
const config = require('../config');

const data = new SlashCommandBuilder().setName('qotd').setDescription('Manage the daily trivia question.')
  .addSubcommand((s) => s.setName('setup').setDescription('Set the QOTD channel.').addChannelOption((o) => o.setName('channel').setDescription('Question channel').setRequired(true)))
  .addSubcommand((s) => s.setName('disable').setDescription('Disable daily questions.'))
  .addSubcommand((s) => s.setName('now').setDescription('Post a rewardless test question in the configured channel.'))
  .addSubcommand((s) => s.setName('send').setDescription('Post a rewardless test question here.'))
  .addSubcommand((s) => s.setName('status').setDescription('Show QOTD status.'));

module.exports = { data, async execute(i) {
  const sub = i.options.getSubcommand();
  if (sub !== 'status' && !i.memberPermissions.has(PermissionFlagsBits.ManageGuild)) return i.reply({ content: `${config.pengEmoji()} Manage Server permission is required.`, ephemeral: true });
  if (sub === 'setup') { const channel = i.options.getChannel('channel'); if (!channel.isTextBased()) return i.reply({ content: 'Choose a text channel.', ephemeral: true }); await qotd.configure(i.guildId, channel.id); return i.reply({ content: `${config.pengEmoji()} QOTD is enabled in ${channel}.` }); }
  if (sub === 'disable') { await qotd.disable(i.guildId); return i.reply({ content: `${config.pengEmoji()} QOTD disabled.` }); }
  if (sub === 'now') { await qotd.post(i.client, i.guildId, false); return i.reply({ content: `${config.pengEmoji()} Posted a rewardless test question in the configured channel.`, ephemeral: true }); }
  if (sub === 'send') { if (!i.channel?.isTextBased()) return i.reply({ content: 'This command must be used in a text channel.', ephemeral: true }); await qotd.postTest(i.client, i.guildId, i.channelId); return i.reply({ content: `${config.pengEmoji()} Posted a rewardless test question here.`, ephemeral: true }); }
  const s = await qotd.status(i.guildId); return i.reply({ embeds: [new EmbedBuilder().setColor(0x6bd6e8).setTitle(`${config.pengEmoji()} QOTD Status`).setDescription(`Enabled: **${s.enabled ? 'Yes' : 'No'}**\nChannel: ${s.channelId ? `<#${s.channelId}>` : 'Not configured'}\nToday's question ID: **${s.daily?.date === qotd.utcDate() ? s.daily.questionId : 'None'}**\nAttempts: **${s.daily?.attempts || 0}**\nCorrect answers: **${s.daily?.correct || 0}**\nNext question: **00:00 UTC**`)] });
}, showAnswerModal(i) { return i.showModal(new ModalBuilder().setCustomId(i.customId).setTitle('Answer the QOTD').addComponents(new ActionRowBuilder().addComponents(new TextInputBuilder().setCustomId('qotd_answer').setLabel('Your answer').setStyle(TextInputStyle.Short).setRequired(true).setMaxLength(200)))); } };
