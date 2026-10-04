const memberFeatures = require('./member-features');
const config = require('./config');

const NORMAL_PRESENCE = { status: 'idle', activities: [{ name: "PikaPeng's Igloo", type: 3 }] };

function createBotMode({ read, mutate, ownerId, emoji }) {
  async function isClosed() { return Boolean(await read(state => state.botClosed)); }
  function isOwner(userId) { return Boolean(ownerId() && userId === ownerId()); }
  async function persistClosed(closed) { await mutate(state => { state.botClosed = Boolean(closed); }); }
  async function setPresence(client, closed) {
    if (!client?.user?.setPresence) return;
    await client.user.setPresence(closed ? { status: 'invisible' } : NORMAL_PRESENCE);
  }
  async function applySavedPresence(client) { return setPresence(client, await isClosed()); }
  async function gate(interaction) {
    if (!(await isClosed())) return true;
    if (interaction.isChatInputCommand?.() && ['openbot', 'shutdownbot'].includes(interaction.commandName)) return true;
    if (interaction.isAutocomplete?.()) {
      await interaction.respond([]).catch(() => {});
      return false;
    }
    if (!interaction.replied && !interaction.deferred) {
      await interaction.reply({
        content: `${emoji()} IglooBot is currently closed.`,
        ephemeral: true,
        allowedMentions: { parse: [] }
      }).catch(() => {});
    }
    return false;
  }
  return { isClosed, isOwner, persistClosed, setPresence, applySavedPresence, gate };
}

module.exports = createBotMode({
  read: memberFeatures.read,
  mutate: memberFeatures.mutate,
  ownerId: config.botOwnerId,
  emoji: config.pengEmoji
});
module.exports.createBotMode = createBotMode;
module.exports.NORMAL_PRESENCE = NORMAL_PRESENCE;
