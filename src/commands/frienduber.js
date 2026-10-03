const { SlashCommandBuilder, EmbedBuilder, ActionRowBuilder, StringSelectMenuBuilder } = require('discord.js');
const service = require('../frienduber');
const { endRow } = require('../frienduber-ui');
const data = new SlashCommandBuilder().setName('frienduber').setDescription('Rent voluntary time with another server member')
  .addSubcommand(s => s.setName('find').setDescription('Find online available members'))
  .addSubcommand(s => s.setName('stock').setDescription('List yourself as available').addIntegerOption(o => o.setName('price').setDescription('Price in Fish').setRequired(true).setMinValue(1).setMaxValue(service.MAX_PRICE)).addIntegerOption(o => o.setName('duration').setDescription('Session duration in minutes').setRequired(true).setMinValue(1).setMaxValue(service.MAX_DURATION_MINUTES)))
  .addSubcommand(s => s.setName('unstock').setDescription('Remove yourself from FriendUber availability'))
  .addSubcommand(s => s.setName('status').setDescription('View your FriendUber status'))
  .addSubcommand(s => s.setName('block').setDescription('Prevent a member from seeing or renting you').addUserOption(o => o.setName('user').setDescription('Member to block').setRequired(true)))
  .addSubcommand(s => s.setName('unblock').setDescription('Allow a member to see or rent you').addUserOption(o => o.setName('user').setDescription('Member to unblock').setRequired(true)));
const header = '🐧 **FriendUber**';
async function execute(i) {
  const sub = i.options.getSubcommand();
  if (sub === 'find' && !(await service.owns(i.user.id))) return i.reply({ content: `${header}\n\nYou don't own FriendUber yet!\n\nBuy it from the shop first.`, ephemeral: true });
  if (sub === 'find') {
    const results = await service.available(i.guild, i.user.id);
    if (!results.length) return i.reply({ content: `${header}\n\nNo online friends are available right now.`, ephemeral: true });
    const rows = results.slice(0, 25).map(x => ({ label: x.displayName.slice(0, 100), value: x.userId, description: `${x.price} Fish / ${x.durationMinutes} minutes` }));
    return i.reply({ embeds: [new EmbedBuilder().setColor(0x38bdf8).setTitle('🚕 FriendUber').setDescription(results.map(x => `🟢 **${x.displayName}**\n${x.price} 🐟 / ${x.durationMinutes} minutes`).join('\n\n')).setFooter({ text: 'Only online members who listed themselves appear.' })], components: [new ActionRowBuilder().addComponents(new StringSelectMenuBuilder().setCustomId(`frienduber_select:${i.user.id}`).setPlaceholder('Choose someone to rent').addOptions(rows))], ephemeral: true });
  }
  if (sub === 'stock') {
    if (!(await service.owns(i.user.id))) return i.reply({ content: `${header}\n\nYou don't own FriendUber yet! Buy it from the shop first.`, ephemeral: true });
    const result = await service.stock(i.user.id, i.guildId, i.options.getInteger('price'), i.options.getInteger('duration'));
    if (result.error === 'rented') return i.reply({ content: `${header}\n\nYou can't change your listing during a rental.`, ephemeral: true });
    if (result.error) return i.reply({ content: 'Price must be 1–1,000,000 Fish and duration 1–1,440 minutes.', ephemeral: true });
    return i.reply({ content: `${header}\n\nYou're now available!\n\nPrice: ${result.listing.price} 🐟\nDuration: ${result.listing.durationMinutes} minutes\n\nYou will only appear in searches while your Discord presence is online.`, ephemeral: true });
  }
  if (sub === 'unstock') { await service.unstock(i.user.id, i.guildId); return i.reply({ content: `${header}\n\nYou're no longer listed.`, ephemeral: true }); }
  if (sub === 'status') {
    const s = await service.status(i.user.id, i.guildId);
    const active = s.session ? `${s.session.status} with <@${s.session.renterId === i.user.id ? s.session.friendId : s.session.renterId}> in <#${s.session.channelId}>` : 'None';
    return i.reply({ content: `${header}\n\nOwnership: ${s.owned ? 'Owned' : 'Not owned'}\nListing: ${s.listing.listed ? 'Listed' : 'Unlisted'}\nPrice: ${s.listing.price || '—'} 🐟\nDuration: ${s.listing.durationMinutes || '—'} minutes\nActive rental: ${active}`, ephemeral: true });
  }
  const target = i.options.getUser('user');
  const result = await service.block(i.user.id, i.guildId, target.id, sub === 'block');
  if (result.error) return i.reply({ content: 'You cannot block yourself.', ephemeral: true });
  return i.reply({ content: `${header}\n\n<@${target.id}> ${sub === 'block' ? 'blocked' : 'unblocked'} for FriendUber.`, ephemeral: true });
}
async function select(i) {
  if (i.customId.split(':')[1] !== i.user.id) return i.reply({ content: 'This FriendUber search belongs to another user.', ephemeral: true });
  await i.deferReply({ ephemeral: true });
  const result = await service.reserveAndCreate({ guild: i.guild, renterId: i.user.id, friendId: i.values[0], client: i.client });
  if (result.error === 'raced') return i.editReply({ content: 'That friend was just rented by someone else. 🐧' });
  if (result.error === 'funds') return i.editReply({ content: `Not enough Fish. Price: ${result.price} 🐟; balance: ${result.balance} 🐟.` });
  if (result.error === 'blocked') return i.editReply({ content: 'That FriendUber listing is no longer available to you.' });
  if (result.error === 'unowned') return i.editReply({ content: 'You need to own FriendUber to rent someone.' });
  if (result.error) return i.editReply({ content: 'That member is no longer available.' });
  return i.editReply({ content: `🚕 FriendUber request created: ${result.channel}\nYour ${result.session.price} 🐟 is held until they respond.`, components: [endRow(result.session.id)] });
}
async function button(i) {
  const id = i.customId.split(':')[1];
  const result = await service.end(id, i.user.id, i.client);
  if (result.error === 'participant') return i.reply({ content: 'Only the renter or rented friend can end this session.', ephemeral: true });
  if (result.error) return i.reply({ content: 'This FriendUber session has already ended.', ephemeral: true });
  return i.reply({ content: 'FriendUber session ended.', ephemeral: true });
}
async function moderatorEnd(i) { const id = i.options.getString('session'); if (!service.isModerator(i.member)) return i.reply({ content: 'Moderator access is required.', ephemeral: true }); const r = await service.end(id, i.user.id, i.client, true); return i.reply({ content: r.error ? 'Session not found or already ended.' : 'FriendUber session terminated.', ephemeral: true }); }
module.exports = { data, execute, select, button, moderatorEnd };
