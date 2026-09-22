const stamp = () => new Date().toISOString();
module.exports = {
  info: (message) => console.log(`[${stamp()}] INFO ${message}`),
  error: (message, error) => console.error(`[${stamp()}] ERROR ${message}`, error?.stack || error || ''),
  interactionLink: (interaction, message) => message?.url || (interaction.guildId && interaction.channelId && message?.id ? `https://discord.com/channels/${interaction.guildId}/${interaction.channelId}/${message.id}` : null)
};
