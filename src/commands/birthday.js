const { SlashCommandBuilder, EmbedBuilder, PermissionFlagsBits, ChannelType } = require('discord.js');
const birthday = require('../birthday');
const config = require('../config');
const logger = require('../utils/logger');

const data = new SlashCommandBuilder().setName('birthday').setDescription('Register and view birthdays in this server.')
  .addSubcommand((s) => s.setName('set').setDescription('Register your birthday (month and day only).')
    .addIntegerOption((o) => o.setName('month').setDescription('Birthday month').setMinValue(1).setMaxValue(12).setRequired(true))
    .addIntegerOption((o) => o.setName('day').setDescription('Birthday day').setMinValue(1).setMaxValue(31).setRequired(true)))
  .addSubcommand((s) => s.setName('view').setDescription('View your registered birthday.'))
  .addSubcommand((s) => s.setName('remove').setDescription('Remove your registered birthday.'))
  .addSubcommand((s) => s.setName('upcoming').setDescription('View the next ten opted-in birthdays.'))
  .addSubcommand((s) => s.setName('config').setDescription('Configure birthday announcements and role (staff only).')
    .addChannelOption((o) => o.setName('channel').setDescription('Announcement channel (defaults to the configured announcements channel).').addChannelTypes(ChannelType.GuildText, ChannelType.GuildAnnouncement))
    .addRoleOption((o) => o.setName('role').setDescription('Birthday role to use (defaults to 🎂 Birthday Penguin).')));

function monthDay(month, day) { return new Date(Date.UTC(2000, month - 1, day)).toLocaleDateString('en-US', { timeZone: 'UTC', month: 'long', day: 'numeric' }); }
function canManage(i) { return i.memberPermissions?.has(PermissionFlagsBits.Administrator) || i.memberPermissions?.has(PermissionFlagsBits.ManageChannels) || config.staffRoleIds().some((id) => i.member?.roles?.cache?.has(id)); }
async function execute(i) {
  if (!i.guild) return i.reply({ content: 'Birthday commands are only available in a server.', ephemeral: true });
  const sub = i.options.getSubcommand();
  await i.deferReply({ ephemeral: true });
  if (sub === 'set') {
    const month = i.options.getInteger('month'); const day = i.options.getInteger('day');
    if (!birthday.isValidBirthday(month, day)) return i.editReply({ content: 'That date is not valid. February 29 is supported.' });
    const result = await birthday.setBirthday(i.guildId, i.user.id, month, day);
    if (result.error === 'cooldown') return i.editReply({ content: `You can change your birthday again <t:${Math.ceil(result.nextChangeAt / 1000)}:R>.` });
    if (result.error) return i.editReply({ content: 'That date is not valid.' });
    const isToday = birthday.celebrationDate(month, day, Number(birthday.taipeiDate().slice(0, 4))) === birthday.taipeiDate();
    let sameDayText = '';
    if (isToday) {
      try { await birthday.processBirthday(i.guild, result.birthday, birthday.taipeiDate()); sameDayText = '\nYour birthday celebration is being processed now.'; }
      catch (error) { logger.error(`Same-day birthday processing failed guild=${i.guildId} user=${i.user.id}`, error); sameDayText = '\nYour birthday celebration is registered and will be retried shortly.'; }
    }
    const status = result.changed ? 'registered' : 'already registered';
    return i.editReply({ content: `🎂 Your birthday is ${status} as **${monthDay(month, day)}**. Public birthday announcements are enabled.${sameDayText}` });
  }
  if (sub === 'view') {
    const record = await birthday.getBirthday(i.guildId, i.user.id);
    if (!record) return i.editReply({ content: 'You have not registered a birthday. Use `/birthday set` to opt in.' });
    const next = birthday.nextCelebration(record.month, record.day);
    return i.editReply({ embeds: [new EmbedBuilder().setColor(0x6bd6e8).setTitle('🎂 Your Birthday').setDescription(`Registered date: **${monthDay(record.month, record.day)}**\nNext celebration: **${next}**`)] });
  }
  if (sub === 'remove') {
    const record = await birthday.removeBirthday(i.guildId, i.user.id, i.guild);
    return i.editReply({ content: record ? 'Your birthday registration was removed. Previous reward and announcement history is preserved.' : 'You do not have a registered birthday.' });
  }
  if (sub === 'upcoming') {
    const records = await birthday.listUpcoming(i.guildId);
    const entries = [];
    for (const record of records) {
      if (entries.length >= 10) break;
      const member = await i.guild.members.fetch(record.userId).catch(() => null);
      if (member) entries.push(`**${monthDay(Number(record.nextDate.slice(5, 7)), Number(record.nextDate.slice(8, 10)))}** — ${member.displayName}`);
    }
    const description = entries.length ? entries.join('\n') : 'No upcoming birthdays are currently registered.';
    return i.editReply({ embeds: [new EmbedBuilder().setColor(0x6bd6e8).setTitle('🎂 Upcoming Birthdays').setDescription(description)] });
  }
  if (sub === 'config') {
    if (!canManage(i)) return i.editReply({ content: `${config.pengEmoji()} Administrator, Manage Channels, or a configured staff role is required.` });
    const channel = i.options.getChannel('channel'); const role = i.options.getRole('role');
    const updated = await birthday.setGuildConfig(i.guildId, { ...(channel ? { channelId: channel.id } : {}), ...(role ? { roleId: role.id } : {}) });
    const effective = await birthday.guildConfig(i.guildId);
    const channelLabel = updated.announcementChannelId ? `<#${updated.announcementChannelId}>` : `<#${effective.announcementChannelId}> (default)`;
    const roleLabel = updated.birthdayRoleId ? `<@&${updated.birthdayRoleId}>` : '🎂 Birthday Penguin (created automatically if needed)';
    return i.editReply({ content: `Birthday settings saved.\nAnnouncement channel: ${channelLabel}\nBirthday role: ${roleLabel}` });
  }
}

module.exports = { data, execute, canManage, monthDay };
