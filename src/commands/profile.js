const { SlashCommandBuilder, EmbedBuilder } = require('discord.js');
const economy = require('../economy');
const config = require('../config');

// Waddle and achievement persistence do not exist in the current project yet.
// Keep this provider isolated so those existing services can be connected later without changing the command UI.
async function getProfileSections() { return { currentWaddleStreak: 0, longestWaddleStreak: 0, totalWaddles: 0, achievements: [] }; }

module.exports = {
  data: new SlashCommandBuilder().setName('profile').setDescription('View a PikaPeng profile.').addUserOption((option) => option.setName('user').setDescription('The member whose profile you want to view').setRequired(false)),
  async execute(interaction) {
    const user = interaction.options.getUser('user') || interaction.user;
    const member = await interaction.guild.members.fetch(user.id).catch(() => null);
    const balance = await economy.getFishBalance(user.id);
    const sections = await getProfileSections(user.id);
    const achievements = sections.achievements.length ? sections.achievements.join(', ') : 'No achievements yet';
    const embed = new EmbedBuilder().setColor(0x6bd6e8).setTitle(`${config.pengEmoji()} PikaPeng Profile — ${member?.displayName || user.username}`).setThumbnail(user.displayAvatarURL({ size: 256 })).addFields(
      { name: '🐟 Fish balance', value: `**${balance} Fish**`, inline: true },
      { name: '🔥 Current /waddle streak', value: `**${sections.currentWaddleStreak}**`, inline: true },
      { name: '🏆 Longest waddle streak', value: `**${sections.longestWaddleStreak}**`, inline: true },
      { name: '🐧 Total waddles', value: `**${sections.totalWaddles}**`, inline: true },
      { name: '📅 Member since', value: member?.joinedAt ? `<t:${Math.floor(member.joinedAt.getTime() / 1000)}:D>` : 'Unknown', inline: true },
      { name: '🎖️ Achievements', value: achievements, inline: false }
    ).setFooter({ text: 'PengBot · PikaStudio' });
    return interaction.reply({ embeds: [embed] });
  }
};
