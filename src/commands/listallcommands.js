const crypto = require('node:crypto');
const { SlashCommandBuilder, EmbedBuilder, ActionRowBuilder, ButtonBuilder, ButtonStyle } = require('discord.js');
const { discoverCommands, paginateCommands } = require('../list-all-commands');

const SESSION_TTL_MS = 2 * 60 * 1000;
const sessions = new Map();
const data = new SlashCommandBuilder()
  .setName('listallcommands')
  .setDescription('Browse IglooBot slash commands')
  .addStringOption(option => option.setName('search').setDescription('Filter commands by name or description').setRequired(false).setMaxLength(100));

function pageEmbed(page, pageIndex, pageCount, resultCount, search) {
  const description = page || (search ? `🐧 No IglooBot commands matched "${search}".` : 'No IglooBot commands are registered.');
  return new EmbedBuilder().setColor(0x6bd6e8).setTitle('🐧 IglooBot Commands').setDescription(description)
    .setFooter({ text: `${resultCount} command${resultCount === 1 ? '' : 's'} available${pageCount > 1 ? ` · Page ${pageIndex + 1} / ${pageCount}` : ''}` });
}

function controls(token, pageIndex, pageCount) {
  if (pageCount < 2) return [];
  return [new ActionRowBuilder().addComponents(
    new ButtonBuilder().setCustomId(`listallcommands:${token}:${pageIndex - 1}`).setLabel('◀ Previous').setStyle(ButtonStyle.Secondary).setDisabled(pageIndex === 0),
    new ButtonBuilder().setCustomId(`listallcommands:${token}:${pageIndex + 1}`).setLabel('Next ▶').setStyle(ButtonStyle.Secondary).setDisabled(pageIndex === pageCount - 1)
  )];
}

function removeSession(token) {
  const session = sessions.get(token);
  if (!session) return;
  clearTimeout(session.timer);
  sessions.delete(token);
  session.message?.edit({ components: [] }).catch(() => {});
}

async function execute(interaction) {
  const commands = interaction.client.commands;
  const search = interaction.options.getString('search') || '';
  const entries = discoverCommands(commands, interaction.memberPermissions, search);
  const pages = paginateCommands(entries);
  if (pages.length < 2) return interaction.reply({ embeds: [pageEmbed(pages[0], 0, 1, entries.length, search)], ephemeral: true, allowedMentions: { parse: [] } });

  const token = crypto.randomBytes(8).toString('hex');
  const message = await interaction.reply({ embeds: [pageEmbed(pages[0], 0, pages.length, entries.length, search)], components: controls(token, 0, pages.length), ephemeral: true, fetchReply: true, allowedMentions: { parse: [] } });
  const session = { ownerId: interaction.user.id, pages, resultCount: entries.length, search, message, timer: null };
  session.timer = setTimeout(() => removeSession(token), SESSION_TTL_MS);
  session.timer.unref?.();
  sessions.set(token, session);
}

async function button(interaction) {
  const [, token, requestedPage] = interaction.customId.split(':');
  const session = sessions.get(token);
  if (!session) return interaction.reply({ content: 'These command-list controls have expired. Run `/listallcommands` again.', ephemeral: true });
  if (interaction.user.id !== session.ownerId) return interaction.reply({ content: 'These command-list controls belong to another user.', ephemeral: true });
  const pageIndex = Number(requestedPage);
  if (!Number.isInteger(pageIndex) || pageIndex < 0 || pageIndex >= session.pages.length) return interaction.reply({ content: 'That command-list page is no longer available.', ephemeral: true });
  return interaction.update({ embeds: [pageEmbed(session.pages[pageIndex], pageIndex, session.pages.length, session.resultCount, session.search)], components: controls(token, pageIndex, session.pages.length), allowedMentions: { parse: [] } });
}

module.exports = { data, execute, button, pageEmbed, controls, SESSION_TTL_MS, _sessions: sessions };
