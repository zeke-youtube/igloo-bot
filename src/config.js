require('dotenv').config();

const required = ['DISCORD_TOKEN', 'CLIENT_ID', 'GUILD_ID', 'ANNOUNCEMENTS_CHANNEL_ID', 'KTV_CATEGORY_ID'];
function validateEnv() {
  const missing = required.filter((key) => !process.env[key]);
  if (missing.length) throw new Error(`Missing required environment variables: ${missing.join(', ')}`);
  const snowflakes = ['CLIENT_ID', 'GUILD_ID', 'ANNOUNCEMENTS_CHANNEL_ID', 'KTV_CATEGORY_ID'];
  const invalid = snowflakes.filter((key) => !/^\d{17,20}$/.test(process.env[key]));
  if (invalid.length) throw new Error(`Invalid Discord ID(s): ${invalid.join(', ')}. Replace example placeholders in .env with real Discord snowflake IDs.`);
}

const csv = (value) => (value || '').split(',').map((v) => v.trim()).filter(Boolean);
module.exports = {
  validateEnv,
  token: () => process.env.DISCORD_TOKEN,
  clientId: () => process.env.CLIENT_ID,
  guildId: () => process.env.GUILD_ID,
  announcementsChannelId: () => process.env.ANNOUNCEMENTS_CHANNEL_ID,
  commandsOnlyChannelId: () => process.env.COMMANDS_ONLY_CHANNEL_ID || null,
  typingChannelId: () => process.env.TYPING_CHANNEL_ID || null,
  ktvCategoryId: () => process.env.KTV_CATEGORY_ID,
  ktvRentalPrice: () => Number.isInteger(Number(process.env.KTV_RENTAL_PRICE)) && Number(process.env.KTV_RENTAL_PRICE) >= 0 ? Number(process.env.KTV_RENTAL_PRICE) : 5,
  pengEmoji: () => process.env.PIKAPENG_EMOJI_ID && /^\d{17,20}$/.test(process.env.PIKAPENG_EMOJI_ID) ? `<:pikapeng:${process.env.PIKAPENG_EMOJI_ID}>` : '<:PikaPeng:1551565899331538975>',
  pengEmojiId: () => process.env.PIKAPENG_EMOJI_ID && /^\d{17,20}$/.test(process.env.PIKAPENG_EMOJI_ID) ? process.env.PIKAPENG_EMOJI_ID : '1551565899331538975',
  oauthClientSecret: () => process.env.OAUTH_CLIENT_SECRET || '',
  oauthRedirectUri: () => process.env.OAUTH_REDIRECT_URI || '',
  oauthHost: () => process.env.OAUTH_HOST || '0.0.0.0',
  oauthPort: () => Number(process.env.OAUTH_PORT || 3000),
  staffRoleIds: () => csv(process.env.STAFF_ROLE_IDS || process.env.STAFF_ROLE_ID),
  allowAnnouncementMentions: () => process.env.ALLOW_ANNOUNCEMENT_MENTIONS === 'true'
};
