const { ActionRowBuilder, ButtonBuilder, ButtonStyle } = require('discord.js');
function endRow(id) { return new ActionRowBuilder().addComponents(new ButtonBuilder().setCustomId(`frienduber_end:${id}`).setLabel('End FriendUber session').setStyle(ButtonStyle.Danger)); }
module.exports = { endRow };
