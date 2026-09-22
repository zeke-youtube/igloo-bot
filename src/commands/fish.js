const crypto = require('node:crypto');
const { SlashCommandBuilder, EmbedBuilder, ActionRowBuilder, ButtonBuilder, ButtonStyle } = require('discord.js');
const economy = require('../economy');
const config = require('../config');
const logger = require('../utils/logger');

const sessions = new Map();
const cooldowns = new Map();
const locks = new Map();
const COOLDOWN_MS = 5 * 60 * 1000;
const SESSION_MS = 2 * 60 * 1000;
const bites = ['💥 SOMETHING BIT THE LINE!', '🐟 THE FLOAT JUST DISAPPEARED!', '🌊 SOMETHING IS PULLING!', '🎣 YOU GOT A BITE!', '🐧 PIKAPENG IS SCREAMING. REEL!!!'];

function withLock(userId, task) { const previous = locks.get(userId) || Promise.resolve(); const current = previous.then(task, task); locks.set(userId, current); current.finally(() => { if (locks.get(userId) === current) locks.delete(userId); }).catch(() => {}); return current; }
function expired(session) { return Date.now() >= session.expiresAt; }
function expire(id) { const session = sessions.get(id); if (session && session.state !== 'COMPLETED') { session.state = 'EXPIRED'; sessions.delete(id); } }
function button(customId, label, style) { return new ButtonBuilder().setCustomId(customId).setLabel(label).setStyle(style); }
function panel(balance, id) { return { embeds: [new EmbedBuilder().setColor(0x6bd6e8).setTitle(`${config.pengEmoji()} PIKAPENG FISHING`).setDescription('🌊 ～～～～～～～～～～ 🌊\n\n🐧 PikaPeng has brought you to the fishing spot.\n\nWallet: 🐟 **' + balance + '**\n\nReady to catch dinner?').setFooter({ text: 'Your fishing trip expires after 2 minutes.' })], components: [new ActionRowBuilder().addComponents(button(`fish_cast:${id}`, '🎣 Cast Line', ButtonStyle.Primary))] }; }
function waiting(id) { return { embeds: [new EmbedBuilder().setColor(0x6bd6e8).setTitle(`${config.pengEmoji()} PIKAPENG FISHING`).setDescription('│\n│\n🪝\n🌊🌊🌊🌊🌊🌊🌊🌊\n\nYour line is in the water...\n\n🐧 PikaPeng is watching very carefully.\n\nPlease wait for a bite...')], components: [] }; }
function bite(id) { return { embeds: [new EmbedBuilder().setColor(0xf4c95d).setTitle(`${config.pengEmoji()} PIKAPENG FISHING`).setDescription(`│\n│\n🐟 !!\n🌊🌊🌊🌊🌊🌊🌊🌊\n\n**${bites[Math.floor(Math.random() * bites.length)]}**\n\n🐧 PikaPeng:\n**“REEL IT IN!!!”**`)], components: [new ActionRowBuilder().addComponents(button(`fish_reel:${id}`, '🎣 Reel It In!', ButtonStyle.Success))] }; }
function result(amount, balance) { const mega = amount === 10; return { embeds: [new EmbedBuilder().setColor(mega ? 0xf4c95d : 0x6bd6e8).setTitle(mega ? '✨ 🐟 MEGA CATCH! 🐟 ✨' : '🏆 PIKAPENG’S CATCH').setDescription(mega ? `🐟 🐟 🐟\n🐟 🐟 🐟 🐟\n🐟 🐟 🐟\n\n🐧\n\n**YOU CAUGHT:**\n\n🐟 **10 FISH!**\n\n👛 Wallet: **${balance} fish**\n\n🐧 PikaPeng:\n**“WE’RE EATING GOOD TONIGHT”**` : `🐟\n🐟  🐧  🐟\n🐟\n\n🎣 You caught **${amount} FISH!**\n\n🐟 Catch: **+${amount}**\n👛 Wallet: **${balance} fish**\n\n🐧 PikaPeng has inspected your catch.`).setFooter({ text: 'PengBot · PikaStudio' })], components: [] }; }

async function handleButton(i) {
  const [action, id] = i.customId.split(':'); if (!action.startsWith('fish_')) return false;
  const session = sessions.get(id);
  if (!session || expired(session)) { if (session) expire(id); return i.reply({ content: '🔕 This fishing trip has expired.\n\nRun `/fish` to start another one. 🎣', ephemeral: true }); }
  if (session.userId !== i.user.id) return i.reply({ content: `${config.pengEmoji()} Hey! That’s not your fishing rod.\n\nUse `/fish` to get your own. 🎣`, ephemeral: true });
  if (action === 'fish_cast') { if (session.state !== 'READY') return i.reply({ content: '🎣 This fishing step is no longer available.', ephemeral: true }); session.state = 'CASTING'; await i.update(waiting(id)); const delay = 1000 + crypto.randomInt(0, 2001); session.timer = setTimeout(async () => { if (!sessions.has(id) || session.state !== 'CASTING' || expired(session)) return expire(id); session.state = 'BITE'; await i.editReply(bite(id)).catch(() => {}); }, delay); return; }
  if (action === 'fish_reel') { if (session.state !== 'BITE') return i.reply({ content: '🎣 That fishing step is no longer available.', ephemeral: true }); session.state = 'CLAIMING'; const amount = crypto.randomInt(1, 11); try { const balance = await economy.addFish(i.user.id, amount); session.state = 'COMPLETED'; sessions.delete(id); cooldowns.set(i.user.id, Date.now()); return i.update(result(amount, balance)); } catch (error) { session.state = 'BITE'; logger.error(`Fish award failed for ${i.user.id}`, error); return i.reply({ content: '🐧 PikaPeng dropped the fish bucket!\n\nYour catch couldn’t be saved.\n\nNo fish were awarded and your fishing cooldown was not started.\n\nTry reeling it in again.', ephemeral: true }); } }
  return false;
}

module.exports = { data: new SlashCommandBuilder().setName('fish').setDescription('Go fishing for PikaPeng fish.'), handleButton, async execute(i) { if (i.user.bot) return i.reply({ content: '🐧 Bots cannot go fishing.', ephemeral: true }); return withLock(i.user.id, async () => { const active = [...sessions.values()].find((session) => session.userId === i.user.id && session.state !== 'EXPIRED' && session.state !== 'COMPLETED'); if (active) return i.reply({ content: '🎣 You’re already fishing!\n\nFinish your current catch before casting another line. 🐧', ephemeral: true }); const last = cooldowns.get(i.user.id) || 0; const next = last + COOLDOWN_MS; if (Date.now() < next) return i.reply({ content: `🎣 The fishing spot needs time to recover!\n\nTry again <t:${Math.ceil(next / 1000)}:R>.\n\n🐧 PikaPeng says the fish need time to respawn.`, ephemeral: true }); const id = crypto.randomBytes(12).toString('hex'); const session = { id, userId: i.user.id, state: 'READY', createdAt: Date.now(), expiresAt: Date.now() + SESSION_MS, timer: null }; sessions.set(id, session); setTimeout(() => expire(id), SESSION_MS); const balance = await economy.getFishBalance(i.user.id); return i.reply({ ...panel(balance, id), ephemeral: true }); }); } };
