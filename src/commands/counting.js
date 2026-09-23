const { SlashCommandBuilder, EmbedBuilder, PermissionFlagsBits } = require('discord.js');
const counting = require('../counting');
const config = require('../config');

const data = new SlashCommandBuilder().setName('counting').setDescription('Play and manage Igloo Counting.')
  .addSubcommand((s) => s.setName('setup').setDescription('Configure the counting channel.').addChannelOption((o) => o.setName('channel').setDescription('Counting text channel').setRequired(true)))
  .addSubcommand((s) => s.setName('reset').setDescription('Reset the current count.'))
  .addSubcommand((s) => s.setName('leaderboard').setDescription('Show the counting leaderboard.'))
  .addSubcommand((s) => s.setName('stats').setDescription('Show counting statistics.'));

module.exports = { data, async execute(i) {
  const sub = i.options.getSubcommand();
  if ((sub === 'setup' || sub === 'reset') && !i.memberPermissions.has(PermissionFlagsBits.ManageGuild)) return i.reply({ content: `${config.pengEmoji()} You need Manage Server permission for that.`, ephemeral: true });
  if (sub === 'setup') { const channel = i.options.getChannel('channel'); if (!channel.isTextBased()) return i.reply({ content: 'Please choose a text channel.', ephemeral: true }); await counting.configure(i.guildId, channel.id); return i.reply({ content: `${config.pengEmoji()} Counting channel configured: ${channel}.\nThe first valid number is **1**.` }); }
  const stats = sub === 'reset' ? await counting.reset(i.guildId) : await counting.getStats(i.guildId);
  if (sub === 'reset') return i.reply({ content: `${config.pengEmoji()} Counting reset. The server record remains **${stats.record}**.` });
  if (sub === 'leaderboard') { const rows = Object.entries(stats.users).sort((a, b) => b[1] - a[1]).slice(0, 10); return i.reply({ embeds: [new EmbedBuilder().setColor(0x6bd6e8).setTitle(`${config.pengEmoji()} Counting Leaderboard`).setDescription(rows.length ? rows.map(([id, count], n) => `**${n + 1}.** <@${id}> — **${count}** successful counts`).join('\n') : 'No successful counts yet.')] }); }
  return i.reply({ embeds: [new EmbedBuilder().setColor(0x6bd6e8).setTitle(`${config.pengEmoji()} Igloo Counting`).setDescription(`Current: **${stats.current}**\nRecord: **${stats.record}**\nNext number: **${BigInt(stats.current) + 1n}**\n\nTotal successful counts: **${stats.totalSuccessful}**\nTotal resets: **${stats.totalResets}**\nConfigured channel: ${stats.channelId ? `<#${stats.channelId}>` : 'Not configured'}`)] });
} };
