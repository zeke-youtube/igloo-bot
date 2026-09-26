const { EmbedBuilder, ActionRowBuilder, UserSelectMenuBuilder, ModalBuilder, TextInputBuilder, TextInputStyle, ButtonBuilder, ButtonStyle } = require('discord.js');
const config = require('../config');
const logger = require('../utils/logger');
const doorbell = require('../doorbell-manager');
const ktv = require('../ktv-manager');
const manage = require('../commands/ktvmanage');
const fish = require('../commands/fish');
const rental = require('../ktv-rental');
const givefish = require('../commands/givefish');
const gamble = require('../commands/gamble');
const qotd = require('../commands/qotd');
const adManager = require('../ad-manager');
const boop = require('../boop');
const inbox = require('./inbox');
const fishDrop = require('../fish-drop');

async function handleButton(i) {
  if (i.customId.startsWith('fishdrop:')) return fishDrop.claim(i, i.customId.split(':')[1]);
  if (i.customId.startsWith('inbox_')) return inbox.handleButton(i);
  if (i.customId.startsWith('fish_')) return fish.handleButton(i);
  if (i.customId.startsWith('givefish_confirm:')) return givefish.confirm(i, i.customId.split(':')[1]);
  if (i.customId.startsWith('givefish_cancel:')) return givefish.cancel(i, i.customId.split(':')[1]);
  if (i.customId.startsWith('gamble_play:')) return gamble.play(i, i.customId.split(':')[1]);
  if (i.customId.startsWith('gamble_cancel:')) return gamble.cancel(i, i.customId.split(':')[1]);
  if (i.customId.startsWith('qotd_answer:')) return qotd.showAnswerModal(i);
  if (i.customId.startsWith('qotd_test_answer:')) return qotd.showAnswerModal(i);
  if (i.customId.startsWith('ad_approve:')) { const id = i.customId.split(':')[1]; const result = await adManager.process(i, id, true); await adManager.notifyStatus(i.client, id); return result; }
  if (i.customId.startsWith('ad_reject:')) { const id = i.customId.split(':')[1]; const result = await adManager.process(i, id, false); await adManager.notifyStatus(i.client, id); return result; }
  if (i.customId.startsWith('boop_back:')) return boop.boopBack(i, i.customId.split(':')[1]);
  if (i.customId.startsWith('ktv_pay:')) return rental.pay(i, i.customId.split(':')[1]);
  if (i.customId.startsWith('ktv_cancel_rent:')) return rental.cancel(i, i.customId.split(':')[1]);
  if (i.customId.startsWith('doorbell_')) return doorbell.handleButton(i, i.client);
  if (i.customId.startsWith('announcement_')) { if (i.customId === 'announcement_cancel') return i.update({ content: 'Announcement cancelled.', embeds: [], components: [] }); const channel = await i.client.channels.fetch(config.announcementsChannelId()).catch(() => null); if (!channel?.isTextBased()) return i.update({ content: 'I could not find the configured announcements channel.', embeds: [], components: [] }); try { await channel.send({ embeds: [EmbedBuilder.from(i.message.embeds[0])] }); logger.info(`Announcement published by ${i.user.tag}`); return i.update({ content: 'Announcement published.', embeds: [], components: [] }); } catch (error) { logger.error('Announcement publish failed', error); return i.update({ content: 'Discord rejected the announcement.', embeds: [], components: [] }); } }
  if (!i.customId.startsWith('ktv_')) return false;
  const [action, channelId] = i.customId.split(':'); const room = await manage.owned(i, channelId); if (!room) return i.reply({ content: '🏚️ This KTV rental is no longer active.', ephemeral: true });
  if (action === 'ktv_rename') return i.showModal(new ModalBuilder().setCustomId(`ktv_rename_modal:${channelId}`).setTitle('Rename your KTV').addComponents(new ActionRowBuilder().addComponents(new TextInputBuilder().setCustomId('ktv_name').setLabel('Custom room name').setPlaceholder('Gaming Night').setStyle(TextInputStyle.Short).setRequired(true).setMaxLength(80))));
  if (action === 'ktv_limit') return i.showModal(new ModalBuilder().setCustomId(`ktv_limit_modal:${channelId}`).setTitle('Set user limit').addComponents(new ActionRowBuilder().addComponents(new TextInputBuilder().setCustomId('ktv_limit').setLabel('Number (0 = unlimited)').setStyle(TextInputStyle.Short).setRequired(true).setMaxLength(2))));
  if (action === 'ktv_doorbell' || action === 'ktv_kick') return i.update({ content: action === 'ktv_doorbell' ? 'Choose a member to doorbell:' : 'Choose an approved guest to revoke:', embeds: [], components: [new ActionRowBuilder().addComponents(new UserSelectMenuBuilder().setCustomId(`${action}_select:${channelId}`).setPlaceholder('Select a member').setMinValues(1).setMaxValues(1))] });
  if (action === 'ktv_lock') { const locked = !room.record.locked; await room.channel.permissionOverwrites.edit(i.guild.roles.everyone, locked ? { ViewChannel: false, Connect: false } : { ViewChannel: null, Connect: null, Speak: null, Stream: null, UseVAD: null }); await ktv.updateKtv(i.user.id, { locked }); return i.update({ ...manage.panel(await ktv.getOwnedRoom(i.guild, i.user.id)) }); }
  if (action === 'ktv_guests') return i.reply({ content: `👥 Approved KTV Guests\n\n${(room.record.approvedGuestIds || []).map((id) => `• <@${id}>`).join('\n') || 'No approved guests.'}\n\n${(room.record.approvedGuestIds || []).length} approved guests`, ephemeral: true });
  if (action === 'ktv_end') return i.update({ content: `🏠 Return your KTV?\n\nYou're about to return:\n🎤 ${room.channel.name}\n\nEveryone currently inside will be disconnected when the room is removed.\n\n🐟 Your rental fee is non-refundable after the KTV is created.`, embeds: [], components: [new ActionRowBuilder().addComponents(new ButtonBuilder().setCustomId(`ktv_end_confirm:${channelId}`).setLabel('🔑 Return Keys').setStyle(ButtonStyle.Danger), new ButtonBuilder().setCustomId(`ktv_end_cancel:${channelId}`).setLabel('❌ KEEP PARTYING').setStyle(ButtonStyle.Secondary))] });
  if (action === 'ktv_end_cancel') return i.update({ content: '🎤 RENTAL CONTINUES\n\nPikaPeng has put the demolition equipment away. 🐧', embeds: [], components: [] });
  if (action === 'ktv_end_confirm') { const result = await ktv.deleteKtv(i.guild, i.user.id, 'Owner returned KTV rental'); if (!result.deleted) return i.update({ content: '🐧 I could not return the room. It is still active.', components: [] }); doorbell.invalidateForChannel(channelId); return i.update({ content: '🔑 Keys returned!\n\nYour PikaPeng KTV rental has ended.\n\n🐟 Rental fee refunded: **0 fish**\n\nReason: PikaPeng already ate them.\n\n🐧 "nom nom"\n\nThank you for choosing PikaPeng Real Estate™.', embeds: [], components: [] }); }
  return false;
}
module.exports = { handleButton };
