const crypto = require('node:crypto');
const { SlashCommandBuilder, EmbedBuilder, ActionRowBuilder, ButtonBuilder, ButtonStyle } = require('discord.js');
const config = require('../config');
const travel = require('../travel');
const economy = require('../economy');
const oauth = require('../oauth');

const PRICE = 50;
const sessions = new Map();

module.exports = {
  data: new SlashCommandBuilder().setName('travel').setDescription('Book a trip through the PikaPeng Travel Network.'),
  async execute(i) {
    const balance = await economy.getFishBalance(i.user.id);
    if (balance < PRICE) return i.reply({ content: `${config.pengEmoji()} PikaPeng Travel\n\nCost: **${PRICE} Fish**\nYour wallet: **${balance} Fish**\n\nYou need more Fish to travel.`, ephemeral: true });
    const token = crypto.randomBytes(10).toString('hex');
    sessions.set(token, { userId: i.user.id, guildId: i.guildId, expires: Date.now() + 120000 });
    setTimeout(() => sessions.delete(token), 120000);
    return i.reply({ embeds: [new EmbedBuilder().setColor(0x6bd6e8).setTitle(`${config.pengEmoji()} PikaPeng Travel`).setDescription(`Travel through the PikaPeng Travel Network?\n\nCost: **${PRICE} Fish**\nWallet: **${balance} Fish**\n\nA random destination you have not joined will be selected after confirmation.`)], components: [new ActionRowBuilder().addComponents(new ButtonBuilder().setCustomId(`travel_confirm:${token}`).setLabel(`Book for ${PRICE} Fish`).setStyle(ButtonStyle.Success), new ButtonBuilder().setCustomId(`travel_cancel:${token}`).setLabel('Cancel').setStyle(ButtonStyle.Secondary))], ephemeral: true });
  },
  async confirm(i, token) {
    const session = sessions.get(token);
    if (!session || session.userId !== i.user.id || session.expires < Date.now()) return i.reply({ content: `${config.pengEmoji()} This travel booking has expired.`, ephemeral: true });
    sessions.delete(token);
    const joinedGuildIds = await oauth.userGuildIds(i.user.id);
    const destination = await travel.choose(i.client, i.user.id, i.guildId, joinedGuildIds);
    if (!destination) return i.update({ content: `${config.pengEmoji()} No more destinations to go to! You have already joined every reachable Travel Network server. No Fish were charged.`, embeds: [], components: [] });
    try {
      const balance = await economy.getFishBalance(i.user.id);
      if (balance < PRICE) return i.update({ content: `${config.pengEmoji()} Your balance changed. You need **${PRICE} Fish** to travel.`, embeds: [], components: [] });
      if (!await oauth.joinGuild(i.user.id, destination.guildId)) return i.update({ content: `${config.pengEmoji()} Discord could not add you to that destination. No Fish were charged.`, embeds: [], components: [] });
      const remaining = await economy.removeFish(i.user.id, PRICE);
      return i.update({ embeds: [new EmbedBuilder().setColor(0x6bd6e8).setTitle(`${config.pengEmoji()} Flight booked!`).setDescription(`Destination: **${destination.name}**\nRegion: **${destination.region || 'Unknown'}**\nStamp: **${destination.stamp}**\n\nCost: **${PRICE} Fish**\nRemaining balance: **${remaining} Fish**\n\nYou have been added to the destination. Your passport stamp is recorded after an actual visit.`)], components: [new ActionRowBuilder().addComponents(new ButtonBuilder().setLabel('Open Server').setURL(destination.invite).setStyle(ButtonStyle.Link))] });
    } catch { return i.update({ content: `${config.pengEmoji()} Travel payment failed safely. No booking was completed.`, embeds: [], components: [] }); }
  },
  cancel(i, token) { const session = sessions.get(token); if (!session || session.userId !== i.user.id) return i.reply({ content: `${config.pengEmoji()} This booking is not yours.`, ephemeral: true }); sessions.delete(token); return i.update({ content: `${config.pengEmoji()} Travel booking cancelled. No Fish were charged.`, embeds: [], components: [] }); }
};
