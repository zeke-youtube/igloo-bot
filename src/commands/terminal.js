const { SlashCommandBuilder, EmbedBuilder } = require('discord.js');

const RESPONSES = Object.freeze({
  'give-me-fish': 'ERROR: Fish dispenser is currently on strike.\nTry fishing like a normal penguin. 🐟',
  'give-me-admin': 'ERROR: Permission denied.\nNice try. 💀',
});

const data = new SlashCommandBuilder()
  .setName('terminal')
  .setDescription('Use the fictional penguin computer.')
  .addStringOption((option) => option
    .setName('command')
    .setDescription('Choose a terminal command.')
    .setRequired(true)
    .addChoices(
      { name: 'give-me-fish', value: 'give-me-fish' },
      { name: 'give-me-admin', value: 'give-me-admin' },
    ));

module.exports = {
  data,
  RESPONSES,
  async execute(interaction) {
    const command = interaction.options.getString('command');
    const response = RESPONSES[command];
    if (!response) throw new Error('Unsupported terminal command.');

    const embed = new EmbedBuilder()
      .setColor(0x18251e)
      .setTitle('Igloo Terminal')
      .setDescription(`\`\`\`text\n peng@igloo:~$ ${command}\n${response}\n\`\`\``);
    return interaction.reply({ embeds: [embed] });
  },
};
