const { SlashCommandBuilder } = require('discord.js');
const { getOwnedRoom } = require('../ktv-manager');
const { createInvitation } = require('../doorbell-manager');
const config = require('../config');

module.exports = { data: new SlashCommandBuilder().setName('doorbell').setDescription('Ring a member’s doorbell for your PikaPeng KTV.').addUserOption((option) => option.setName('user').setDescription('The member to invite').setRequired(true)), async execute(interaction) {
  const target = interaction.options.getUser('user');
  if (target.id === interaction.user.id) return interaction.reply({ content: `${config.pengEmoji()} You cannot ring your own doorbell.`, ephemeral: true });
  if (target.bot) return interaction.reply({ content: `${config.pengEmoji()} You cannot doorbell bots.`, ephemeral: true });
  const room = await getOwnedRoom(interaction.guild, interaction.user.id);
  if (!room) return interaction.reply({ content: `${config.pengEmoji()} You don't currently rent a PikaPeng KTV.\n\nUse `/createroom` to rent one first.`, ephemeral: true });
  const member = await interaction.guild.members.fetch(target.id).catch(() => null);
  if (!member) return interaction.reply({ content: `${config.pengEmoji()} That user is no longer in this server.`, ephemeral: true });
  if (room.channel.members.has(target.id)) return interaction.reply({ content: `${config.pengEmoji()} They're already inside your KTV. You don't need to ring the doorbell 😭`, ephemeral: true });
  const result = await createInvitation(interaction, target, room);
  if (result.rateLimited) return interaction.reply({ content: `🔕 Easy on the doorbell!\n\nWait a little before ringing again. ${config.pengEmoji()}`, ephemeral: true });
  if (result.dmFailed) return interaction.reply({ content: '📪 Couldn’t deliver the doorbell.\n\nThey may have DMs from server members/bots disabled.', ephemeral: true });
  return interaction.reply({ content: `🔔 Doorbell rung!\nIglooBot delivered your KTV invitation to <@${target.id}>.`, ephemeral: true });
} };
