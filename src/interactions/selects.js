const { ActionRowBuilder, UserSelectMenuBuilder } = require('discord.js');
const config = require('../config');
const ktv = require('../ktv-manager');
const doorbell = require('../doorbell-manager');
const manage = require('../commands/ktvmanage');
async function handleSelect(i) {
  if (!i.customId.startsWith('ktv_')) return false;
  const [action, channelId] = i.customId.split(':'); const room = await manage.owned(i, channelId);
  if (!room) return i.reply({ content: '🏚️ This KTV rental is no longer active.', ephemeral: true });
  const userId = i.values[0];
  if (action === 'ktv_doorbell_select') { const target = await i.client.users.fetch(userId); const result = await doorbell.createInvitation(i, target, room); if (result.rateLimited) return i.reply({ content: '🔕 Easy on the doorbell! Wait a little before ringing again. 🐧', ephemeral: true }); if (result.dmFailed) return i.reply({ content: '📪 Couldn’t deliver the doorbell. They may have DMs disabled.', ephemeral: true }); return i.update({ content: `🔔 Doorbell rung for <@${userId}>.`, embeds: [], components: [] }); }
  if (action === 'ktv_kick_select') { if (userId === i.user.id) return i.reply({ content: '🐧 You cannot revoke yourself.', ephemeral: true }); await ktv.removeApprovedGuest(i.user.id, userId); let disconnected = false; if (room.channel.members.has(userId)) { await room.channel.members.get(userId).voice.disconnect('KTV guest access revoked').then(() => { disconnected = true; }).catch(() => {}); } await room.channel.permissionOverwrites.delete(userId).catch(() => {}); return i.update({ content: `🧹 Guest access revoked for <@${userId}>${disconnected ? ' and they were disconnected.' : '.'}`, embeds: [], components: [] }); }
  return false;
}
module.exports = { handleSelect };
