const { ApplicationCommandOptionType, PermissionFlagsBits } = require('discord.js');

const PAGE_DESCRIPTION_LIMIT = 3600;

function commandData(command) {
  if (typeof command?.data?.toJSON === 'function') return command.data.toJSON();
  return command?.data || null;
}

function flattenOptions(options = [], restrictedSubcommands = {}) {
  const lines = [];
  for (const option of options) {
    if (option.type === ApplicationCommandOptionType.SubcommandGroup) {
      lines.push(`  **${option.name}** — ${option.description || 'No description provided.'}`);
      for (const subcommand of option.options || []) {
        const access = restrictedSubcommands[subcommand.name];
        lines.push(`    • ${subcommand.name} — ${subcommand.description || 'No description provided.'}${access ? ` · 🔒 ${access}` : ''}`);
      }
    } else if (option.type === ApplicationCommandOptionType.Subcommand) {
      const access = restrictedSubcommands[option.name];
      lines.push(`  • ${option.name} — ${option.description || 'No description provided.'}${access ? ` · 🔒 ${access}` : ''}`);
    }
  }
  return lines;
}

function permissionBits(memberPermissions) {
  if (memberPermissions == null) return null;
  try { return BigInt(memberPermissions.bitfield ?? memberPermissions); } catch { return null; }
}

function canUseByDefaultPermissions(data, memberPermissions) {
  if (data.default_member_permissions == null) return true;
  const actual = permissionBits(memberPermissions);
  if (actual === null) return true;
  const admin = BigInt(PermissionFlagsBits.Administrator);
  if ((actual & admin) === admin) return true;
  const required = BigInt(data.default_member_permissions);
  return (actual & required) === required;
}

function searchText(data, category, subcommandLines) {
  return [data.name, data.description, category || '', ...subcommandLines].join(' ').toLocaleLowerCase();
}

function discoverCommands(commands, memberPermissions, search = '') {
  const needle = String(search || '').trim().toLocaleLowerCase();
  const result = [];
  for (const command of commands.values()) {
    const data = commandData(command);
    if (!data?.name || !canUseByDefaultPermissions(data, memberPermissions)) continue;
    const category = command.category || data.category || '';
    const subcommandLines = flattenOptions(data.options, command.restrictedSubcommands);
    const haystack = searchText(data, category, subcommandLines);
    if (needle && !haystack.includes(needle)) continue;
    const marker = command.accessLabel ? ` · 🔒 ${command.accessLabel}` : '';
    const lines = [`**/${data.name}** — ${data.description || 'No description provided.'}${marker}`, ...subcommandLines];
    result.push({ name: data.name, description: data.description || '', category, lines, searchText: haystack });
  }
  result.sort((a, b) => a.name.localeCompare(b.name));
  return result;
}

function paginateCommands(entries, maxLength = PAGE_DESCRIPTION_LIMIT) {
  if (!entries.length) return [];
  const pages = [];
  let page = '';
  for (const entry of entries) {
    const block = entry.lines.join('\n');
    if (block.length > maxLength) {
      const lines = entry.lines;
      for (const line of lines) {
        const next = page ? `${page}\n\n${line}` : line;
        if (next.length > maxLength && page) { pages.push(page); page = line; }
        else page = next;
      }
      continue;
    }
    const next = page ? `${page}\n\n${block}` : block;
    if (next.length > maxLength && page) { pages.push(page); page = block; }
    else page = next;
  }
  if (page) pages.push(page);
  return pages;
}

module.exports = { PAGE_DESCRIPTION_LIMIT, commandData, flattenOptions, canUseByDefaultPermissions, discoverCommands, paginateCommands };
