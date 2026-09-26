const { SlashCommandBuilder, EmbedBuilder } = require('discord.js');
const config = require('../config');
const work = require('../work');
const { discordTimestamp } = require('../utils/time');

module.exports = {
  data: new SlashCommandBuilder().setName('work').setDescription('Perform a random PikaPeng job for Fish.'),
  async execute(i) {
    const peng = config.pengEmoji();
    if (i.user.bot) return i.reply({ content: `${peng} Bots cannot work shifts.`, ephemeral: true });
    const result = await work.performWork(i.user.id);
    if (result.onCooldown) return i.reply({ content: `${peng} You're still recovering from your last shift.\n\nYou can work again ${discordTimestamp(result.nextWorkAt)}.`, ephemeral: true });
    const labels = { normal: `${peng} SHIFT COMPLETE`, great: `${peng} EXCELLENT WORK!`, failure: `${peng} SHIFT FAILED`, rare: `${peng} EMPLOYEE OF THE MINUTE` };
    const notes = { normal: 'PikaPeng inspected your work and somehow approved it.', great: 'Nobody is admitting who unplugged the cable.', failure: 'The shift was a disaster, but at least it was entertaining.', rare: 'This result has been added to the IglooBot incident archives.' };
    const embed = new EmbedBuilder().setColor(result.outcome === 'failure' ? 0xf4c95d : 0x6bd6e8).setTitle(labels[result.outcome]).setDescription(`${result.message}\n\n${notes[result.outcome]}`).addFields(
      { name: `${peng} Job`, value: result.job.title, inline: true },
      { name: 'Fish Earnings', value: `+${result.reward} fish`, inline: true },
      { name: 'Fish Balance', value: `${result.balance} fish`, inline: true },
      { name: 'Next shift', value: discordTimestamp(result.nextWorkAt), inline: false },
    ).setFooter({ text: 'PengBot - PikaStudio' });
    return i.reply({ embeds: [embed] });
  },
};
