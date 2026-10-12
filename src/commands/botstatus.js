const { SlashCommandBuilder, EmbedBuilder } = require('discord.js');

const CPU_SAMPLE_MS = 100;
const MB = 1024 * 1024;

function formatDuration(seconds) {
  const total = Math.floor(seconds);
  const days = Math.floor(total / 86400);
  const hours = Math.floor((total % 86400) / 3600);
  const minutes = Math.floor((total % 3600) / 60);
  const remainingSeconds = total % 60;
  return `${days}d ${hours}h ${minutes}m ${remainingSeconds}s`;
}

function formatMeasurement(value, formatter) {
  return Number.isFinite(value) ? formatter(value) : 'Unavailable';
}

module.exports = {
  data: new SlashCommandBuilder().setName('botstatus').setDescription('View bot process and connection status.'),
  async execute(interaction) {
    await interaction.deferReply();

    const cpuStart = process.cpuUsage();
    const elapsedStart = process.hrtime.bigint();
    await new Promise((resolve) => setTimeout(resolve, CPU_SAMPLE_MS));
    const cpu = process.cpuUsage(cpuStart);
    const elapsedMicroseconds = Number(process.hrtime.bigint() - elapsedStart) / 1000;
    const cpuPercent = elapsedMicroseconds > 0
      ? ((cpu.user + cpu.system) / elapsedMicroseconds) * 100
      : NaN;

    const uptime = process.uptime();
    const memoryMb = process.memoryUsage().rss / MB;
    const latency = interaction.client.ws.ping;
    const guildCount = interaction.client.guilds.cache.size;

    const embed = new EmbedBuilder()
      .setColor(0x6bd6e8)
      .setTitle('🐧 Bot Status')
      .addFields(
        { name: 'Status', value: 'Online', inline: true },
        { name: 'Uptime', value: formatMeasurement(uptime, formatDuration), inline: true },
        { name: 'Gateway latency', value: formatMeasurement(latency, (value) => `${Math.round(value)} ms`), inline: true },
        { name: 'Process memory (RSS)', value: formatMeasurement(memoryMb, (value) => `${value.toFixed(1)} MB`), inline: true },
        { name: 'Process CPU', value: formatMeasurement(cpuPercent, (value) => `${value.toFixed(1)}%`), inline: true },
        { name: 'Node.js', value: process.version, inline: true },
        { name: 'Connected guilds', value: formatMeasurement(guildCount, (value) => String(value)), inline: true }
      )
      .setFooter({ text: `Process CPU over ${CPU_SAMPLE_MS} ms · 100% equals one logical core; multicore use can exceed 100%.` });

    return interaction.editReply({ embeds: [embed] });
  }
};
