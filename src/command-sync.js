const { REST, Routes } = require('discord.js');
const config = require('./config');
const logger = require('./utils/logger');
async function syncGuildCommands(commands) {
  const payloads = [...commands.values()].map((command) => command.data.toJSON());
  const rest = new REST({ version: '10' }).setToken(config.token());
  await rest.put(Routes.applicationGuildCommands(config.clientId(), config.guildId()), { body: payloads });
  logger.info(`Synchronized ${payloads.length} guild slash commands.`);
}
module.exports = { syncGuildCommands };

async function cleanCommandsOnlyChannel(client) {
  const channelId = config.commandsOnlyChannelId();
  if (!channelId) return;
  const channel = await client.channels.fetch(channelId);
  if (!channel?.isTextBased() || !channel.messages) return;
  let removed = 0;
  let batch;
  do {
    batch = await channel.messages.fetch({ limit: 100 });
    if (!batch.size) break;
    const recent = batch.filter((message) => Date.now() - message.createdTimestamp < 14 * 24 * 60 * 60 * 1000);
    if (recent.size) {
      const deleted = await channel.bulkDelete(recent, true);
      removed += deleted.size;
    }
    const old = batch.filter((message) => Date.now() - message.createdTimestamp >= 14 * 24 * 60 * 60 * 1000);
    for (const message of old.values()) {
      await message.delete().catch(() => {});
      removed += 1;
    }
  } while (batch.size === 100);
  logger.info(`Cleaned ${removed} messages from the commands-only channel.`);
}

module.exports.cleanCommandsOnlyChannel = cleanCommandsOnlyChannel;
