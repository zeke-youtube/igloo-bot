const { Client, GatewayIntentBits, Collection, PermissionFlagsBits } = require('discord.js');
const config = require('./config'); const logger = require('./utils/logger');
config.validateEnv();
const client = new Client({ intents: [GatewayIntentBits.Guilds, GatewayIntentBits.GuildMembers, GatewayIntentBits.GuildMessages, GatewayIntentBits.GuildVoiceStates] }); client.commands = new Collection();
for (const file of ['about', 'help', 'pengfact', 'pikastudiosites', 'announcements', 'coinflip', 'clear', 'global-cooldown', 'createroom', 'doorbell', 'ktvmanage', 'fish', 'balance', 'givefish', 'gamble']) { const command = require(`./commands/${file}`); client.commands.set(command.data.name, command); }
const { handleButton } = require('./interactions/buttons'); const { handleModal } = require('./interactions/modals'); const { syncGuildCommands, cleanCommandsOnlyChannel } = require('./command-sync');
const { handleSelect } = require('./interactions/selects');
const { handleVoiceStateUpdate, removeMemberAccess, cleanupStartup, cleanupShutdown } = require('./ktv-manager'); const doorbell = require('./doorbell-manager');
client.once('ready', async () => { client.user.setPresence({ status: 'idle', activities: [{ name: 'over the PikaStudio igloo', type: 3 }] }); const typingChannelId = config.typingChannelId(); if (typingChannelId) { const refreshTyping = async () => { const channel = await client.channels.fetch(typingChannelId).catch(() => null); if (channel?.isTextBased()) await channel.sendTyping().catch((error) => logger.error('Typing indicator failed', error)); }; await refreshTyping(); setInterval(refreshTyping, 8000); } doorbell.invalidateAll(); logger.info(`PengBot online as ${client.user.tag}`); try { await cleanupStartup(client); await cleanCommandsOnlyChannel(client); await syncGuildCommands(client.commands); } catch (error) { logger.error('Startup synchronization failed', error); } });
client.on('voiceStateUpdate', async (oldState, newState) => { try { if (oldState.channelId && oldState.channelId !== newState.channelId) await removeMemberAccess(client, oldState.channelId, oldState.id); await handleVoiceStateUpdate(oldState, newState, client); if (oldState.channelId && !(await client.channels.fetch(oldState.channelId).catch(() => null))) doorbell.invalidateForChannel(oldState.channelId); } catch (error) { logger.error('KTV voice-state cleanup failed', error); } });
let shuttingDown = false;
async function shutdown(signal) { if (shuttingDown) return; shuttingDown = true; logger.info(`${signal} received; cleaning temporary KTV rooms.`); await cleanupShutdown(client).catch((error) => logger.error('KTV shutdown cleanup failed', error)); client.destroy(); process.exit(0); }
process.once('SIGINT', () => shutdown('SIGINT')); process.once('SIGTERM', () => shutdown('SIGTERM'));
client.on('messageCreate', async (message) => {
  if (message.channel.id !== config.commandsOnlyChannelId() || message.author.id === client.user.id) return;
  try {
    // Keep this channel limited to slash-command interactions handled by integrations.
    // PengBot's own replies remain visible; every other bot message is removed.
    await message.delete();
  } catch (error) { logger.error('Commands-only channel cleanup failed', error); }
});
client.on('interactionCreate', async (interaction) => { if (interaction.isUserSelectMenu()) await handleSelect(interaction).catch((error) => logger.error('KTV select interaction failed', error)); });
client.on('interactionCreate', async (i) => { try { if (i.isChatInputCommand()) { if (i.channelId === config.commandsOnlyChannelId() && i.commandName !== 'bump') return i.reply({ content: '🐧 Only `/bump` can be used in this channel.', ephemeral: true }); const staffRoles = config.staffRoleIds(); if (i.commandName === 'announcements' && !i.member.permissions.has(PermissionFlagsBits.Administrator) && !staffRoles.some((id) => i.member.roles.cache.has(id))) return i.reply({ content: '<:PikaPeng:1551171560432345138> : Staff access is required for announcements.', ephemeral: true }); await client.commands.get(i.commandName)?.execute(i); const reply = await i.fetchReply().catch(() => null); const link = logger.interactionLink(i, reply); logger.info(`${i.user.tag} used /${i.commandName}${link ? ` · ${link}` : ''}`); } else if (i.isButton()) await handleButton(i); else if (i.isModalSubmit()) await handleModal(i); } catch (e) { logger.error('Interaction failed', e); if (!i.replied && !i.deferred) await i.reply({ content: '<:PikaPeng:1551171560432345138> : Something went wrong. Please try again later.', ephemeral: true }).catch(() => {}); } });
client.login(config.token()).catch((e) => { logger.error('Login failed', e); process.exitCode = 1; });
