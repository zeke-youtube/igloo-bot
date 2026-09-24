const { ModalBuilder, ActionRowBuilder, TextInputBuilder, TextInputStyle } = require('discord.js');
const config = require('../config');
const inbox = require('../inbox');
const boop = require('../boop');

async function showPage(i, index) {
  const items = await inbox.list(i.user.id);
  if (!items.length) return i.update({ content: `${config.pengEmoji()} Your Igloo Inbox is empty.`, embeds: [], components: [] });
  const safeIndex = Math.max(0, Math.min(index, items.length - 1));
  const item = items[safeIndex];
  await inbox.update(i.user.id, item.id, { read: true });
  return i.update({ content: '', embeds: [inbox.render(item, safeIndex, items.length)], components: inbox.controls(item, safeIndex, items.length) });
}

async function handleButton(i) {
  const [action, id, rawIndex] = i.customId.split(':');
  if (action === 'inbox_prev' || action === 'inbox_next') {
    if (id !== i.user.id) return i.reply({ content: `${config.pengEmoji()} That inbox control belongs to someone else.`, ephemeral: true });
    return showPage(i, Number(rawIndex) + (action === 'inbox_prev' ? -1 : 1));
  }
  const item = await inbox.get(i.user.id, id);
  if (!item) return i.reply({ content: `${config.pengEmoji()} That inbox item is no longer available.`, ephemeral: true });
  if (action === 'inbox_read') { await inbox.update(i.user.id, id, { read: true }); return i.update({ content: `${config.pengEmoji()} Marked as read.`, embeds: [], components: [] }); }
  if (action === 'inbox_save') { await inbox.update(i.user.id, id, { saved: !item.saved }); return i.update({ content: `${config.pengEmoji()} ${item.saved ? 'Removed from saved mail.' : 'Saved to your inbox.'}`, embeds: [], components: [] }); }
  if (action === 'inbox_delete') { await inbox.update(i.user.id, id, { deleted: true }); return i.update({ content: `${config.pengEmoji()} Inbox item deleted.`, embeds: [], components: [] }); }
  if (action === 'inbox_reply') return i.showModal(new ModalBuilder().setCustomId(`inbox_reply_modal:${id}`).setTitle('Reply with PikaMail').addComponents(new ActionRowBuilder().addComponents(new TextInputBuilder().setCustomId('reply_message').setLabel('Your reply').setStyle(TextInputStyle.Paragraph).setRequired(true).setMaxLength(1000))));
  if (action === 'inbox_boop') { if (!item.senderId || item.senderId === i.user.id) return i.reply({ content: `${config.pengEmoji()} This person cannot be booped back.`, ephemeral: true }); const result = await boop.deliver(i.client, i.user.id, item.senderId); return i.reply({ content: result.delivered ? `${config.pengEmoji()} Boop delivered!` : `${config.pengEmoji()} I couldn't deliver that boop.`, ephemeral: true }); }
  return false;
}

async function handleReplyModal(i) {
  const item = await inbox.get(i.user.id, i.customId.split(':')[1]);
  if (!item || !item.senderId) return i.reply({ content: `${config.pengEmoji()} That mail is no longer available.`, ephemeral: true });
  const message = i.fields.getTextInputValue('reply_message').trim();
  if (!message) return i.reply({ content: `${config.pengEmoji()} Please enter a reply.`, ephemeral: true });
  const reply = await inbox.send({ client: i.client, recipientId: item.senderId, senderId: i.user.id, type: 'mail', title: 'PikaMail reply', message, metadata: { replyTo: item.id }, tryDM: true });
  return i.reply({ content: reply.dmDelivered ? `${config.pengEmoji()} Reply sent!` : `${config.pengEmoji()} Reply saved to their Igloo Inbox, but their DMs are unavailable.`, ephemeral: true });
}
module.exports = { handleButton, handleReplyModal };
