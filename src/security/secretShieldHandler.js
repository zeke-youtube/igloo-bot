const { detectAndRedactSecrets } = require('./secretShield');
const config = require('../config'); const logger = require('../utils/logger');
const warned = new Set();
function human(message) { return Boolean(message?.author && !message.author.bot && !message.webhookId); }
function safeContent(text) { const result = detectAndRedactSecrets(text); if (result.redactedText.length <= 1800) return result.redactedText; return `${result.redactedText.slice(0, 1750)}\n[… non-sensitive context truncated by SecretShield]`; }
async function inspect(message) {
  if (!config.secretShieldEnabled() || !human(message)) return { handled: false };
  const result = detectAndRedactSecrets(message.content);
  if (!result.detected) return { handled: false };
  const types = [...new Set(result.detections.map(d => d.type))].join(', ');
  try {
    await message.delete();
    const author = config.secretShieldWarnUser() ? `<@${message.author.id}>` : 'The sender';
    await message.channel.send({ content: `${config.pengEmoji()} **PikaPeng SecretShield**\n**${author} originally said:**\n${safeContent(message.content)}\n\n${config.pengEmoji()} PikaPeng ate the exposed secret.\n\nPlease revoke/rotate the exposed credential. Deleting the message does not guarantee it was not already seen or logged.`, allowedMentions: { parse: [], users: config.secretShieldWarnUser() ? [message.author.id] : [] } });
  } catch (error) {
    if (!warned.has(message.id)) { warned.add(message.id); await message.channel.send({ content: `⚠️ <@${message.author.id}> PikaPeng detected a possible exposed credential but could not remove the message. Please delete it immediately and revoke/rotate the credential.`, allowedMentions: { parse: [], users: [message.author.id] } }).catch(() => {}); }
    logger.error(`SecretShield deletion failed: channel=${message.channelId} author=${message.author.id} types=${types}`);
  }
  return { handled: true, deleted: true, types };
}
module.exports = { inspect, human, _resetWarnings: () => warned.clear() };
