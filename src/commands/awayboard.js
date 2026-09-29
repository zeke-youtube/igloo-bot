const { SlashCommandBuilder, EmbedBuilder, ActionRowBuilder, ButtonBuilder, ButtonStyle } = require('discord.js');
const afk = require('../afk');

const PAGE_SIZE = 8;
const EXPIRE_MS = 5 * 60 * 1000;
const boards = new Map();

function clean(value) { return String(value || afk.DEFAULT_REASON).replace(/[\r\n]+/g, ' ').slice(0, 300); }
function pagesFor(rows) { const pages = []; for (let i = 0; i < rows.length; i += PAGE_SIZE) pages.push(rows.slice(i, i + PAGE_SIZE)); return pages.length ? pages : [[]]; }
function render(board, page) {
  const rows = board.pages[page];
  const embed = new EmbedBuilder().setColor(0x6bd6e8).setTitle('🐧💤 Igloo Away Board').setDescription(board.total ? `${board.total} penguin${board.total === 1 ? '' : 's'} are currently away.\n\n${rows.map((row) => `💤 **${clean(row.name)}**\n${clean(row.state.reason)}\nAway for ${afk.durationText(row.state.since)}`).join('\n\n')}` : 'Everyone is here! No penguins are currently AFK. 🎉').setFooter({ text: 'Last updated' }).setTimestamp();
  if (!board.total) return { embeds: [embed], components: [] };
  const controls = new ActionRowBuilder().addComponents(
    new ButtonBuilder().setCustomId(`awayboard:prev:${board.owner}:${board.id}`).setLabel('◀ Previous').setStyle(ButtonStyle.Secondary).setDisabled(page === 0),
    new ButtonBuilder().setCustomId(`awayboard:page:${board.owner}:${board.id}`).setLabel(`${page + 1} / ${board.pages.length}`).setStyle(ButtonStyle.Secondary).setDisabled(true),
    new ButtonBuilder().setCustomId(`awayboard:next:${board.owner}:${board.id}`).setLabel('Next ▶').setStyle(ButtonStyle.Secondary).setDisabled(page === board.pages.length - 1)
  );
  return { embeds: [embed], components: [controls] };
}
async function execute(i) {
  const states = await afk.getAll();
  const members = i.guild.members.cache;
  const rows = states.map((state) => ({ state, name: members.get(state.userId)?.displayName })).filter((row) => row.name && Number.isFinite(row.state.since)).sort((a, b) => a.state.since - b.state.since);
  const board = { id: `${Date.now()}_${Math.random().toString(36).slice(2)}`, owner: i.user.id, total: rows.length, pages: pagesFor(rows) };
  boards.set(board.id, board);
  setTimeout(() => boards.delete(board.id), EXPIRE_MS).unref?.();
  return i.reply(render(board, 0));
}
async function button(i) {
  const [, action, owner, id] = i.customId.split(':');
  const board = boards.get(id);
  if (i.user.id !== owner) return i.reply({ content: 'These Away Board controls belong to the person who opened them.', ephemeral: true });
  if (!board) return i.reply({ content: 'This Away Board has expired. Run `/awayboard` again.', ephemeral: true });
  const current = i.message.embeds[0]?.footer?.text === 'Last updated' ? Number(i.message.components?.[0]?.components?.[1]?.label?.split(' / ')[0]) - 1 : 0;
  const page = Math.max(0, Math.min(board.pages.length - 1, current + (action === 'next' ? 1 : -1)));
  return i.update(render(board, page));
}
module.exports = { data: new SlashCommandBuilder().setName('awayboard').setDescription('Show members who are currently AFK.'), execute, button };
