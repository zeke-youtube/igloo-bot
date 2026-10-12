const { SlashCommandBuilder, EmbedBuilder } = require('discord.js');
const config = require('../config');

module.exports = {
  data: new SlashCommandBuilder().setName('help').setDescription('Show PengBot commands and what they do.'),
  async execute(interaction) {
    const embed = new EmbedBuilder()
      .setColor(0x6bd6e8)
      .setTitle(`${config.pengEmoji()} PengBot Help`)
      .setDescription('Here are the commands available in the PikaStudio server:')
      .addFields(
        { name: 'Community', value: '`/about` — Learn about PengBot\n`/listallcommands` — Browse all commands, with optional search\n`/ping` — Check IglooBot response latency\n`/profile` — View a PikaPeng profile\n`/timezone` and `/time` — Set and check local time\n`/wikipengia` — Search Wikipedia\n`/pepy` — Look up a PyPI package\n`/httpcat` — View an HTTP status cat\n`/pengwater` — Play the channel word game\n`/chess` — Play chess\n`/rentmonitor` — Rent website monitoring\n`/waddle` — Daily Fish check-in\n`/pengfact` — Get a random PikaPeng fact\n`/coinflip` — Flip a PikaPeng coin\n`/pikastudiosites` — Browse official PikaStudio projects\n`/pikascreaminglang encode` or `decode` — Convert text with PikaScreamingLang\n`/fish` — Go fishing\n`/balance` — View a fish wallet' },
        { name: 'Moderation', value: '`/clear amount:<1-100>` — Delete recent messages; requires Manage Messages' },
        { name: 'Staff', value: '`/announcements` — Create and publish an announcement; staff/admin only' }
      )
      .setFooter({ text: 'PengBot · PikaStudio' });
    return interaction.reply({ embeds: [embed] });
  }
};
