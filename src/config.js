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
  fishDropChannelId: () => process.env.FISH_DROP_CHANNEL_ID || null,
  ktvCategoryId: () => process.env.KTV_CATEGORY_ID,
  ktvRentalPrice: () => Number.isInteger(Number(process.env.KTV_RENTAL_PRICE)) && Number(process.env.KTV_RENTAL_PRICE) >= 0 ? Number(process.env.KTV_RENTAL_PRICE) : 5,
  pengEmoji: () => process.env.PIKAPENG_EMOJI_ID && /^\d{17,20}$/.test(process.env.PIKAPENG_EMOJI_ID) ? `<:pikapeng:${process.env.PIKAPENG_EMOJI_ID}>` : '<:PikaPeng:1551565899331538975>',
  pengEmojiId: () => process.env.PIKAPENG_EMOJI_ID && /^\d{17,20}$/.test(process.env.PIKAPENG_EMOJI_ID) ? process.env.PIKAPENG_EMOJI_ID : '1551565899331538975',
  staffRoleIds: () => csv(process.env.STAFF_ROLE_IDS || process.env.STAFF_ROLE_ID),
  allowAnnouncementMentions: () => process.env.ALLOW_ANNOUNCEMENT_MENTIONS === 'true'
  ,stealFishAmount: () => 10
  ,stealFishDurationMs: () => Number.isInteger(Number(process.env.STEAL_DURATION_MS)) && Number(process.env.STEAL_DURATION_MS) > 0 ? Number(process.env.STEAL_DURATION_MS) : 60 * 60 * 1000
  ,policePengConfiscationRate: () => 0.50
  ,bankDurationMs: () => Number.isInteger(Number(process.env.BANK_DURATION_MS)) && Number(process.env.BANK_DURATION_MS) > 0 ? Number(process.env.BANK_DURATION_MS) : 10 * 60 * 1000
  ,bankInterestRate: () => 0.01
  ,bankCompoundPeriods: () => 10
  ,bankMaxDeposit: () => Number.isSafeInteger(Number(process.env.BANK_MAX_DEPOSIT)) && Number(process.env.BANK_MAX_DEPOSIT) > 0 ? Number(process.env.BANK_MAX_DEPOSIT) : Number.MAX_SAFE_INTEGER
  ,ramMarket: () => ({ ddr5_8gb_price_ntd: 1200, salmon_100g_price_ntd: 350, updated_at: '2026-09-26' })
};
