const crypto = require('node:crypto');
const { EmbedBuilder, ActionRowBuilder, ButtonBuilder, ButtonStyle } = require('discord.js');
const config = require('./config');
const logger = require('./utils/logger');
const invitations = new Map();
const ownerHistory = new Map();
const INVITE_TTL = 10 * 60 * 1000;

function prune() { const now = Date.now(); for (const [id, invite] of invitations) if (invite.status === 'pending' && now - invite.createdAt >= INVITE_TTL) invite.status = 'expired'; for (const [owner, times] of ownerHistory) { const fresh = times.filter((time) => now - time < 5 * 60 * 1000); if (fresh.length) ownerHistory.set(owner, fresh); else ownerHistory.delete(owner); } }
function rateLimited(ownerId, targetId) { prune(); const times = ownerHistory.get(ownerId) || []; const lastSame = [...invitations.values()].some((i) => i.ownerId === ownerId && i.invitedUserId === targetId && i.status === 'pending' && Date.now() - i.createdAt < 60 * 1000); return lastSame || times.length >= 5; }
function recordRate(ownerId) { ownerHistory.set(ownerId, [...(ownerHistory.get(ownerId) || []), Date.now()]); }
function get(id) { prune(); return invitations.get(id); }
function buttons(id) { return new ActionRowBuilder().addComponents(new ButtonBuilder().setCustomId(`doorbell_accept:${id}`).setLabel('🚪 Enter KTV').setStyle(ButtonStyle.Success), new ButtonBuilder().setCustomId(`doorbell_decline:${id}`).setLabel('❌ Decline').setStyle(ButtonStyle.Secondary)); }
async function createInvitation(interaction, target, room) {
  if (rateLimited(interaction.user.id, target.id)) return { rateLimited: true };
  const id = crypto.randomBytes(12).toString('hex');
  const invite = { id, channelId: room.channelId, ownerId: interaction.user.id, invitedUserId: target.id, createdAt: Date.now(), status: 'pending' };
  const ownerName = interaction.member.displayName;
  const embed = new EmbedBuilder().setColor(0xf4c95d).setTitle('🔔 DING DONG!').setDescription(`${config.pengEmoji()} **${ownerName}** is ringing your doorbell!\n\nYou've been invited to:\n🎤 **${room.channel.name}**`).setFooter({ text: 'PikaPeng KTV Rental Service' });
  try { await target.send({ embeds: [embed], components: [buttons(id)] }); } catch (error) { logger.error(`Doorbell DM failed for ${target.id}`, error); return { dmFailed: true }; }
  invitations.set(id, invite); recordRate(interaction.user.id); return { invite };
}
async function handleButton(interaction, client) {
  const [action, id] = interaction.customId.split(':'); if (!action.startsWith('doorbell_')) return false;
  const invite = get(id);
  if (!invite || invite.status !== 'pending' || Date.now() - invite.createdAt >= INVITE_TTL) { if (invite) invite.status = 'expired'; return interaction.reply({ content: '🔕 This doorbell invitation has expired.', ephemeral: true }); }
  if (interaction.user.id !== invite.invitedUserId) return interaction.reply({ content: '🐧 This invitation was sent to someone else.', ephemeral: true });
  if (action === 'doorbell_decline') { invite.status = 'declined'; return interaction.update({ content: '🐧 Doorbell declined.\n\nThe penguin has quietly walked away from your door.', embeds: [], components: [] }); }
  const channel = await client.channels.fetch(invite.channelId).catch(() => null);
  const guild = client.guilds.cache.get(config.guildId());
  const ownerRoom = guild ? await require('./ktv-manager').getOwnedRoom(guild, invite.ownerId).catch(() => null) : null;
  if (!channel || !ownerRoom || ownerRoom.channelId !== invite.channelId) { invite.status = 'expired'; return interaction.update({ content: '🏚️ Too late!\n\nThat PikaPeng KTV rental has already ended.', embeds: [], components: [] }); }
  try { await channel.permissionOverwrites.edit(interaction.user.id, { ViewChannel: true, Connect: true, Speak: true, Stream: true, UseVAD: true }); } catch (error) { logger.error(`Could not grant KTV access to ${interaction.user.id}`, error); return interaction.reply({ content: '🐧 I could not open the KTV door. Please try again later.', ephemeral: true }); }
  await require('./ktv-manager').addApprovedGuest(invite.ownerId, interaction.user.id);
  invite.status = 'accepted'; return interaction.update({ content: `🚪 Door opened!\n\nJoin:\n🎤 ${channel}`, embeds: [], components: [] });
}
function invalidateForChannel(channelId) { for (const invite of invitations.values()) if (invite.channelId === channelId && invite.status === 'pending') invite.status = 'expired'; }
function invalidateAll() { for (const invite of invitations.values()) if (invite.status === 'pending') invite.status = 'expired'; }
module.exports = { createInvitation, handleButton, invalidateForChannel, invalidateAll };
