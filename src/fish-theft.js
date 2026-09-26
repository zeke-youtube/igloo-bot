const fs = require('node:fs/promises');
const path = require('node:path');
const crypto = require('node:crypto');
const economy = require('./economy');
const config = require('./config');
const logger = require('./utils/logger');

const storePath = path.join(__dirname, 'data', 'fish-thefts.json');
const STEAL_FISH_AMOUNT = config.stealFishAmount();
const STEAL_DURATION_MS = config.stealFishDurationMs();
const POLICEPENG_CONFISCATION_RATE = config.policePengConfiscationRate();
let records = {}; let loaded = false; let queue = Promise.resolve(); const timers = new Map();
const mutate = (task) => { const next = queue.then(task, task); queue = next.catch(() => {}); return next; };
async function load() { if (loaded) return; try { records = JSON.parse(await fs.readFile(storePath, 'utf8')); } catch { records = {}; } loaded = true; }
async function save() { await fs.writeFile(storePath, `${JSON.stringify(records, null, 2)}\n`, 'utf8'); }
function activeFor(id, role) { return Object.values(records).some((r) => r.status === 'active' && r[role] === id); }
function button(id, label) { const { ActionRowBuilder, ButtonBuilder, ButtonStyle } = require('discord.js'); return [new ActionRowBuilder().addComponents(new ButtonBuilder().setCustomId(`stealfish_catch:${id}`).setLabel(label).setEmoji('🚓').setStyle(ButtonStyle.Danger))]; }
function disabledButton(id, label) { const { ActionRowBuilder, ButtonBuilder, ButtonStyle } = require('discord.js'); return [new ActionRowBuilder().addComponents(new ButtonBuilder().setCustomId(`stealfish_catch:${id}`).setLabel(label).setEmoji('🚓').setStyle(ButtonStyle.Danger).setDisabled(true))]; }
async function updateMessage(client, record, content, components) { if (!record.dmChannelId || !record.dmMessageId) return; const channel = await client.channels.fetch(record.dmChannelId).catch(() => null); const message = await channel?.messages?.fetch(record.dmMessageId).catch(() => null); await message?.edit({ content, components }).catch(() => {}); }
async function resolve(id, outcome, client) {
  return mutate(async () => { await load(); const r = records[id]; if (!r || r.status !== 'active') return { already: true, record: r };
    if (outcome === 'caught' && Date.now() >= r.deadlineAt) outcome = 'escaped';
    let result;
    if (outcome === 'caught') result = await economy.confiscateFish(r.thiefId, r.victimId, POLICEPENG_CONFISCATION_RATE);
    else result = await economy.transferAvailableFish(r.victimId, r.thiefId, STEAL_FISH_AMOUNT);
    r.status = outcome; r.resolvedAt = Date.now(); r.resolvedAmount = result.amount; await save(); timers.delete(id);
    logger.info(`[STEAL_${outcome.toUpperCase()}] theft=${id} thief=${r.thiefId} victim=${r.victimId} amount=${result.amount} timestamp=${new Date(r.resolvedAt).toISOString()}`);
    const fishText = outcome === 'caught' ? `🚨 THIEF CAUGHT!\n\nYou caught <@${r.thiefId}>!\n\n🐟 Confiscated: ${result.amount} fish\n💰 Your new balance: ${result.victimBalance} fish` : `🥷 TOO LATE!\n\n<@${r.thiefId}> escaped!\n\n🐟 ${result.amount} fish were stolen.`;
    await updateMessage(client, r, fishText, disabledButton(id, 'THEFT OVER'));
    const thief = await client.users.fetch(r.thiefId).catch(() => null); await thief?.send(outcome === 'caught' ? `🚨 POLICEPENG CAUGHT YOU!\n\n<@${r.victimId}> caught you stealing fish.\n\n🐟 Confiscated: ${result.amount}\n💰 Remaining balance: ${result.thiefBalance}` : `🥷 HEIST SUCCESSFUL!\n\n<@${r.victimId}> didn't catch you within one hour.\n\n🐟 You stole ${result.amount} fish!`).catch(() => {});
    return { already: false, record: r, result };
  });
}
function schedule(id, client) { const r = records[id]; if (!r || r.status !== 'active') return; const delay = Math.max(0, r.deadlineAt - Date.now()); timers.set(id, setTimeout(() => resolve(id, 'escaped', client).catch((e) => logger.error('Fish theft timeout failed', e)), delay)); }
async function start(client, thief, victim) {
  return mutate(async () => { await load(); if (activeFor(thief.id, 'thiefId')) throw new Error('You already have an active fish theft.'); if (activeFor(victim.id, 'victimId')) throw new Error('That user is already being targeted by an active fish theft.'); if ((await economy.getFishBalance(victim.id)) < STEAL_FISH_AMOUNT) throw new Error('That user needs at least 10 fish to be targeted.');
    const id = crypto.randomUUID(); const deadlineAt = Date.now() + STEAL_DURATION_MS; const content = `🚨 FISH THEFT IN PROGRESS!\n\n<@${thief.id}> is trying to steal 10 🐟 from you!\n\nYou have ONE HOUR to catch them.\n\nIf you catch them, PolicePeng will confiscate 50% of their CURRENT fish balance and give it to you.\n\nDeadline: <t:${Math.ceil(deadlineAt / 1000)}:R>`;
    let dm; try { dm = await victim.send({ content, components: button(id, `CATCH ${thief.username}`) }); } catch { logger.info(`[STEAL_CANCELLED_DM_FAILURE] theft=${id} thief=${thief.id} victim=${victim.id} timestamp=${new Date().toISOString()}`); throw new Error('I couldn’t deliver the warning to that user’s DMs. No fish were moved.'); }
    records[id] = { id, thiefId: thief.id, victimId: victim.id, startedAt: Date.now(), deadlineAt, status: 'active', dmChannelId: dm.channelId, dmMessageId: dm.id }; await save(); schedule(id, client); logger.info(`[STEAL_STARTED] theft=${id} thief=${thief.id} victim=${victim.id} timestamp=${new Date().toISOString()}`); return records[id];
  });
}
async function catchTheft(interaction, id) { await load(); const r = records[id]; if (!r || r.status !== 'active') return interaction.reply({ content: '🐧 This fish theft is already over.', ephemeral: true }); if (interaction.user.id !== r.victimId) return interaction.reply({ content: '🐧 Only the targeted victim can catch this thief.', ephemeral: true }); const result = await resolve(id, 'caught', interaction.client); if (result.record.status === 'escaped') return interaction.reply({ content: '🐧 The deadline passed — this theft escaped.', ephemeral: true }); await interaction.update({ content: `🚨 THIEF CAUGHT!\n\nYou caught <@${r.thiefId}>!\n\n🐟 Confiscated: ${result.result.amount} fish\n💰 Your new balance: ${result.result.victimBalance} fish`, components: disabledButton(id, 'THEFT OVER') }); }
async function restore(client) { await mutate(async () => { await load(); for (const r of Object.values(records)) if (r.status === 'active') { if (Date.now() >= r.deadlineAt) await resolve(r.id, 'escaped', client); else schedule(r.id, client); } }); }
module.exports = { start, catchTheft, restore, STEAL_FISH_AMOUNT, STEAL_DURATION_MS, POLICEPENG_CONFISCATION_RATE };
