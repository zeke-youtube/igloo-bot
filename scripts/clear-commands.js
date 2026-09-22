require('dotenv').config();
const { REST, Routes } = require('discord.js');

const required = ['DISCORD_TOKEN', 'CLIENT_ID', 'GUILD_ID'];
const missing = required.filter((key) => !process.env[key]);
const validSnowflake = (value) => /^\d{17,20}$/.test(value || '');

if (missing.length) {
  console.error(`Missing environment variables: ${missing.join(', ')}`);
  process.exit(1);
}
if (!validSnowflake(process.env.CLIENT_ID) || !validSnowflake(process.env.GUILD_ID)) {
  console.error('CLIENT_ID and GUILD_ID must be real Discord snowflake IDs.');
  process.exit(1);
}

(async () => {
  const rest = new REST({ version: '10' }).setToken(process.env.DISCORD_TOKEN);

  // Remove commands registered specifically in the configured server.
  await rest.put(Routes.applicationGuildCommands(process.env.CLIENT_ID, process.env.GUILD_ID), { body: [] });
  // Remove global commands registered by this application as well.
  await rest.put(Routes.applicationCommands(process.env.CLIENT_ID), { body: [] });

  console.log('Cleared all PengBot guild and global slash commands.');
})().catch((error) => {
  console.error(`Could not clear commands: ${error.message}`);
  process.exitCode = 1;
});
