function discordTimestamp(timeMs, style = 'R') {
  if (!Number.isFinite(timeMs)) throw new TypeError('A finite millisecond timestamp is required.');
  return `<t:${Math.floor(timeMs / 1000)}:${style}>`;
}

module.exports = { discordTimestamp };
