const {
  ActionRowBuilder, ButtonBuilder, ButtonStyle, ChannelType, EmbedBuilder,
  ModalBuilder, PermissionFlagsBits, StringSelectMenuBuilder,
  TextInputBuilder, TextInputStyle
} = require('discord.js');
const crypto = require('node:crypto');
const store = require('../../member-features');
const config = require('../../config');
const logger = require('../../utils/logger');
const engine = require('./engine');
const tasks = require('./tasks');

const timers = new Map();
const RESULT_DELAY = 90_000;
const phaseDuration = { ACTION: 90_000, DISCUSSION: 60_000, VOTING: 45_000 };
const em = () => config.pengEmoji();
const disabledRows = () => [];

async function readGame(guildId) { return store.read(s => s.pengongus[guildId] || null); }
async function mutateGame(guildId, fn) {
  return store.mutate(state => {
    state.pengongus ||= {};
    const game = state.pengongus[guildId] || null;
    return fn(state.pengongus, game);
  });
}
function clearTimer(guildId) { const timer = timers.get(guildId); if (timer) clearTimeout(timer); timers.delete(guildId); }
function lobbyRows(game) {
  const id = game.id;
  return [new ActionRowBuilder().addComponents(
    new ButtonBuilder().setCustomId(`pengongus:${id}:join`).setLabel('Join').setStyle(ButtonStyle.Success),
    new ButtonBuilder().setCustomId(`pengongus:${id}:leave`).setLabel('Leave').setStyle(ButtonStyle.Secondary),
    new ButtonBuilder().setCustomId(`pengongus:${id}:start`).setLabel('Start').setStyle(ButtonStyle.Primary),
    new ButtonBuilder().setCustomId(`pengongus:${id}:cancel`).setLabel('Cancel').setStyle(ButtonStyle.Danger)
  )];
}
function lobbyEmbed(game) {
  return new EmbedBuilder().setColor(0xf4c95d).setTitle('🚨 PENGONGUS').setDescription(
    `A social deduction game for suspicious waddlers.\n\nPlayers: **${game.players.length}/${engine.MAX_PLAYERS}**\nMinimum players: **${engine.MIN_PLAYERS}**\nHost: <@${game.hostId}>\nLobby closes <t:${Math.floor(game.deadline / 1000)}:R>`
  );
}
function allowedNone() { return { parse: [], users: [], roles: [], repliedUser: false }; }
function isInGameChannel(interaction, game) {
  return Boolean(game && interaction.guildId === game.guildId && interaction.channelId === game.channelId);
}
function isActive(game, userId) {
  const player = engine.getPlayer(game, userId);
  return player?.status === 'ACTIVE' ? player : null;
}
async function getGuild(guildId, client) { return client.guilds.cache.get(guildId) || client.guilds.fetch(guildId); }
function hasPermission(member, permission) { return Boolean(member?.permissions?.has(permission)); }
function createChannelPermissions(guild, playerIds, botId) {
  return [
    { id: guild.roles.everyone.id, deny: [PermissionFlagsBits.ViewChannel] },
    { id: botId, allow: [PermissionFlagsBits.ViewChannel, PermissionFlagsBits.SendMessages, PermissionFlagsBits.ReadMessageHistory, PermissionFlagsBits.ManageChannels] },
    ...playerIds.map(id => ({ id, allow: [PermissionFlagsBits.ViewChannel, PermissionFlagsBits.SendMessages, PermissionFlagsBits.ReadMessageHistory] }))
  ];
}
function missingPermissions(guild) {
  const me = guild.members.me;
  const required = [PermissionFlagsBits.ManageChannels, PermissionFlagsBits.ViewChannel, PermissionFlagsBits.SendMessages];
  return required.filter(permission => !hasPermission(me, permission));
}
function permissionName(permission) {
  return ({ [PermissionFlagsBits.ManageChannels]: 'Manage Channels', [PermissionFlagsBits.ViewChannel]: 'View Channel', [PermissionFlagsBits.SendMessages]: 'Send Messages' })[permission] || 'required permission';
}

async function createLobby(interaction) {
  if (!interaction.guild || !interaction.guildId) return { error: 'guild' };
  let game;
  const result = await mutateGame(interaction.guildId, (games, existing) => {
    if (existing && ![engine.Phase.FINISHED].includes(existing.phase)) return { error: 'active' };
    game = engine.createLobby({ guildId: interaction.guildId, lobbyChannelId: interaction.channelId, hostId: interaction.user.id });
    games[interaction.guildId] = game;
    return { game };
  });
  if (result.error) return result;
  const message = await interaction.reply({ embeds: [lobbyEmbed(game)], components: lobbyRows(game), allowedMentions: allowedNone(), fetchReply: true });
  await mutateGame(interaction.guildId, (games, current) => {
    if (current?.id === game.id) current.lobbyMessageId = message.id;
    return null;
  });
  armWithClient(interaction.client, game.guildId).catch(error => logger.error('Pengongus lobby timer setup failed', error));
  return { game, message };
}

async function updateLobbyMessage(client, game, content) {
  const channel = await client.channels.fetch(game.lobbyChannelId).catch(() => null);
  const message = await channel?.messages?.fetch(game.lobbyMessageId).catch(() => null);
  if (message) await message.edit({ content, embeds: [lobbyEmbed(game)], components: lobbyRows(game), allowedMentions: allowedNone() }).catch(error => logger.error('Pengongus lobby update failed', error));
}
async function disableLobby(client, game, content) {
  const channel = await client.channels.fetch(game.lobbyChannelId).catch(() => null);
  const message = await channel?.messages?.fetch(game.lobbyMessageId).catch(() => null);
  if (message) await message.edit({ content, components: disabledRows(), allowedMentions: allowedNone() }).catch(error => logger.error('Pengongus lobby cleanup failed', error));
}

async function button(interaction) {
  const [, gameId, action] = interaction.customId.split(':');
  if (!interaction.guildId) return interaction.reply({ content: 'Pengongus lobby controls only work in their server.', ephemeral: true });
  const game = await readGame(interaction.guildId);
  if (!game || game.id !== gameId || interaction.channelId !== game.lobbyChannelId || game.phase !== engine.Phase.LOBBY) return interaction.reply({ content: 'This Pengongus lobby has expired.', ephemeral: true });
  if (action === 'join' || action === 'leave') {
    if (action === 'join' && interaction.user.bot) return interaction.reply({ content: 'Bot accounts cannot join Pengongus.', ephemeral: true });
    let result;
    try {
      result = await mutateGame(interaction.guildId, (games, current) => {
        if (!current || current.id !== gameId || current.phase !== engine.Phase.LOBBY) throw new Error('expired');
        if (action === 'join') engine.join(current, interaction.user.id);
        else {
          const leaveResult = engine.leave(current, interaction.user.id);
          if (leaveResult.cancelled) { delete games[interaction.guildId]; return { cancelled: true, game: current }; }
        }
        return { game: current };
      });
    } catch (error) {
      const messages = { duplicate: 'You are already in this lobby.', full: 'This lobby is full.', phase: 'This lobby is no longer open.', player: 'You are not in this lobby.' };
      return interaction.reply({ content: messages[error.message] || 'That lobby action could not be completed.', ephemeral: true });
    }
    if (result.cancelled) { clearTimer(interaction.guildId); return interaction.update({ content: 'The lobby closed because no host remains.', embeds: [], components: [] }); }
    return interaction.update({ embeds: [lobbyEmbed(result.game)], components: lobbyRows(result.game), allowedMentions: allowedNone() });
  }
  if (action === 'cancel') {
    if (interaction.user.id !== game.hostId) return interaction.reply({ content: 'Only the lobby host can cancel this game.', ephemeral: true });
    await mutateGame(interaction.guildId, (games, current) => { if (current?.id === gameId && current.phase === engine.Phase.LOBBY) delete games[interaction.guildId]; });
    clearTimer(interaction.guildId);
    return interaction.update({ content: 'Pengongus lobby cancelled. Everyone may return to the igloo.', embeds: [], components: [] });
  }
  if (action === 'start') return startMatch(interaction, game);
  return interaction.reply({ content: 'That Pengongus control is not recognized.', ephemeral: true });
}

async function startMatch(interaction, observed) {
  if (interaction.user.id !== observed.hostId) return interaction.reply({ content: 'Only the lobby host can start the game.', ephemeral: true });
  if (observed.players.length < engine.MIN_PLAYERS) return interaction.reply({ content: `Pengongus needs at least ${engine.MIN_PLAYERS} players to start.`, ephemeral: true });
  const guild = interaction.guild;
  const missing = missingPermissions(guild);
  if (missing.length) return interaction.reply({ content: `I need these server permissions to make a private igloo: ${missing.map(permissionName).join(', ')}.`, ephemeral: true });
  await interaction.deferUpdate();
  let game;
  try {
    game = await mutateGame(interaction.guildId, (games, current) => {
      if (!current || current.id !== observed.id || current.phase !== engine.Phase.LOBBY) throw new Error('phase');
      if (current.players.length < engine.MIN_PLAYERS) throw new Error('players');
      engine.assignRoles(current);
      return structuredClone(current);
    });
  } catch (error) {
    await interaction.followUp({ content: error.message === 'players' ? `Pengongus needs at least ${engine.MIN_PLAYERS} players to start.` : 'This lobby has already started or expired.', ephemeral: true }).catch(() => {});
    return;
  }
  clearTimer(game.guildId);
  let channel;
  try {
    const permissions = createChannelPermissions(guild, game.players.map(p => p.id), interaction.client.user.id);
    channel = await guild.channels.create({
      name: `pengongus-${crypto.randomInt(1000, 10000)}`,
      type: ChannelType.GuildText,
      permissionOverwrites: permissions,
      reason: `Private Pengongus game ${game.id}`
    });
    const action = await mutateGame(game.guildId, (games, current) => {
      if (!current || current.id !== game.id || current.phase !== engine.Phase.STARTING) throw new Error('cancelled');
      current.channelId = channel.id;
      current.phase = engine.Phase.ACTION;
      current.round = 1;
      current.deadline = Date.now() + phaseDuration.ACTION;
      return structuredClone(current);
    });
    const content = `${em()} **PENGONGUS · ROUND 1**\n\nThe igloo is sealed. Waddlers: complete two private tasks. Pengostors: blend in and use /pengongus heat.\n\nUse /pengongus role for your private role and /pengongus task to work on a task.`;
    await channel.send({ content, allowedMentions: allowedNone() });
    for (const player of action.players) {
      const member = await interaction.client.users.fetch(player.id).catch(() => null);
      if (!member) continue;
      const roleMessage = player.role === 'WADDLER'
        ? `${em()} You are a WADDLER.\n\nComplete your tasks.\nWatch the other waddlers.\nFind the suspicious waddler.\nDo not get heated.`
        : `🔥 You are a PENGOSTOR.\n\nBlend in.\nPretend to complete tasks.\nSecretly send waddlers to the 40°C heater.\nDo not act sus.`;
      await member.send({ content: roleMessage, allowedMentions: allowedNone() }).catch(() => logger.info(`Pengongus private role DM unavailable for participant ${player.id}; private role command remains available.`));
    }
    await channel.send({ content: `If you did not receive a private role message, use /pengongus role here. Its reply is visible only to you.`, allowedMentions: allowedNone() });
    await disableLobby(interaction.client, game, `Pengongus has started in ${channel}.`);
    armWithClient(interaction.client, game.guildId).catch(error => logger.error('Pengongus action timer setup failed', error));
  } catch (error) {
    logger.error(`Pengongus game setup failed for guild ${game.guildId}`, error);
    if (channel) await channel.delete('Pengongus setup did not complete').catch(deleteError => logger.error('Pengongus setup channel cleanup failed', deleteError));
    await mutateGame(game.guildId, (games, current) => {
      if (current?.id === game.id) {
        if (current.phase === engine.Phase.STARTING) { current.phase = engine.Phase.LOBBY; for (const player of current.players) player.role = null; }
        else delete games[game.guildId];
      }
    }).catch(() => {});
    await armWithClient(interaction.client, game.guildId).catch(() => {});
    await interaction.followUp({ content: 'I could not finish making the private Pengongus igloo. No game was started; please try again.', ephemeral: true }).catch(() => {});
  }
}

async function requireGameInteraction(interaction) {
  const game = interaction.guildId ? await readGame(interaction.guildId) : null;
  if (!game || !isInGameChannel(interaction, game)) {
    await interaction.reply({ content: 'Use this Pengongus action in the private game channel.', ephemeral: true });
    return null;
  }
  return game;
}

async function getRole(interaction) {
  const game = await requireGameInteraction(interaction);
  if (!game) return;
  const player = engine.getPlayer(game, interaction.user.id);
  if (!player) return interaction.reply({ content: 'You are not part of this Pengongus game.', ephemeral: true });
  const role = player.role === 'PENGOSTOR' ? '🔥 You are a PENGOSTOR. Blend in, then choose a Waddler with /pengongus heat.' : `${em()} You are a WADDLER. Complete two private tasks with /pengongus task and help find the Pengostor.`;
  return interaction.reply({ content: role, ephemeral: true, allowedMentions: allowedNone() });
}

async function getTaskModal(interaction) {
  const game = await requireGameInteraction(interaction);
  if (!game) return;
  const player = engine.getPlayer(game, interaction.user.id);
  if (game.phase !== engine.Phase.ACTION) return interaction.reply({ content: 'Tasks are only available during the action phase.', ephemeral: true });
  if (!player || player.status !== 'ACTIVE') return interaction.reply({ content: 'Only active players can work on tasks.', ephemeral: true });
  if (player.role !== 'WADDLER') return interaction.reply({ content: 'Pengostors may pretend to work, but they do not receive real tasks.', ephemeral: true });
  if (player.tasksDone >= engine.TASKS_PER_WADDLER) return interaction.reply({ content: 'You have completed all your tasks for this igloo.', ephemeral: true });
  let task;
  await mutateGame(game.guildId, (games, current) => {
    if (!current || current.id !== game.id || current.phase !== engine.Phase.ACTION) throw new Error('phase');
    const member = engine.getPlayer(current, interaction.user.id);
    if (!member || member.status !== 'ACTIVE' || member.role !== 'WADDLER') throw new Error('player');
    if (!member.task) member.task = tasks.createTask();
    task = structuredClone(member.task);
  });
  const modal = new ModalBuilder().setCustomId(`pengongus_task:${game.id}:${interaction.user.id}`).setTitle(`Pengongus · ${task.type}`)
    .addComponents(new ActionRowBuilder().addComponents(new TextInputBuilder().setCustomId('answer').setLabel(`${task.type} answer`).setPlaceholder(task.prompt.slice(0, 100)).setStyle(TextInputStyle.Short).setRequired(true).setMaxLength(40)));
  return interaction.showModal(modal);
}

async function submitTask(interaction) {
  const [, gameId, playerId] = interaction.customId.split(':');
  if (playerId !== interaction.user.id) return interaction.reply({ content: 'That task belongs to another player.', ephemeral: true });
  const game = await requireGameInteraction(interaction);
  if (!game || game.id !== gameId) return;
  let result;
  try {
    result = await mutateGame(game.guildId, (games, current) => {
      if (!current || current.id !== gameId || current.phase !== engine.Phase.ACTION) throw new Error('phase');
      const player = engine.getPlayer(current, interaction.user.id);
      if (!player || player.status !== 'ACTIVE' || player.role !== 'WADDLER' || !player.task) throw new Error('player');
      if (!tasks.isCorrect(player.task, interaction.fields.getTextInputValue('answer'))) return { correct: false, taskType: player.task.type };
      player.tasksDone += 1; current.taskTotal += 1; player.task = null;
      const winner = engine.outcome(current);
      if (winner) return { correct: true, tasksDone: player.tasksDone, winner: setResultInState(current, winner, 'all tasks completed') };
      return { correct: true, tasksDone: player.tasksDone };
    });
  } catch (error) {
    return interaction.reply({ content: error.message === 'phase' ? 'That task phase has ended.' : 'You no longer have an active Pengongus task.', ephemeral: true });
  }
  if (!result.correct) return interaction.reply({ content: `Not quite. Your ${result.taskType} task is still waiting in the igloo.`, ephemeral: true });
  if (result.winner) {
    await interaction.reply({ content: 'Task complete! The waddlers finished their checklist.', ephemeral: true });
    return publishResult(interaction.client, game.guildId, result.winner);
  }
  return interaction.reply({ content: `Task complete! Progress: **${result.tasksDone}/${engine.TASKS_PER_WADDLER}**.`, ephemeral: true });
}

async function getHeatMenu(interaction) {
  const game = await requireGameInteraction(interaction);
  if (!game) return;
  const actor = engine.getPlayer(game, interaction.user.id);
  if (game.phase !== engine.Phase.ACTION) return interaction.reply({ content: 'The heater is available only during the action phase.', ephemeral: true });
  if (!actor || actor.status !== 'ACTIVE' || actor.role !== 'PENGOSTOR') return interaction.reply({ content: 'Only an active Pengostor can use the 40°C heater.', ephemeral: true });
  if (actor.heatedRound === game.round) return interaction.reply({ content: 'You have already used the heater this round.', ephemeral: true });
  const targets = engine.activePlayers(game).filter(p => p.role === 'WADDLER');
  if (!targets.length) return interaction.reply({ content: 'There are no active Waddlers to send to the heater.', ephemeral: true });
  const menu = new StringSelectMenuBuilder().setCustomId(`pengongus_heat:${game.id}:${interaction.user.id}`).setPlaceholder('Choose a Waddler for the 40°C heater')
    .addOptions(await Promise.all(targets.map(async p => ({ label: (await displayName(interaction.guild, p.id)).slice(0, 100), value: p.id }))));
  return interaction.reply({ content: '🔥 **40°C HEATER**\n\nChoose a Waddler to send to the heater:', components: [new ActionRowBuilder().addComponents(menu)], ephemeral: true, allowedMentions: allowedNone() });
}

async function selectHeat(interaction) {
  const [, gameId, actorId] = interaction.customId.split(':');
  if (actorId !== interaction.user.id) return interaction.reply({ content: 'Those heater controls belong to another Pengostor.', ephemeral: true });
  const game = interaction.guildId ? await readGame(interaction.guildId) : null;
  if (!game || game.id !== gameId || !isInGameChannel(interaction, game)) return interaction.reply({ content: 'Those heater controls have expired.', ephemeral: true });
  let target;
  try {
    target = await mutateGame(game.guildId, (games, current) => {
      if (!current || current.id !== gameId) throw new Error('game');
      const heated = engine.heatPlayer(current, interaction.user.id, interaction.values[0]);
      return { playerId: heated.id, round: current.round };
    });
  } catch (error) {
    const messages = { phase: 'The action phase has ended.', actor: 'Only an active Pengostor can use the heater.', used: 'You have already used the heater this round.', target: 'That player cannot be sent to the heater.' };
    return interaction.reply({ content: messages[error.message] || 'That heater action is no longer valid.', ephemeral: true });
  }
  const victim = await interaction.client.users.fetch(target.playerId).catch(() => null);
  await victim?.send({ content: '🔥 OH NO.\n\nYou have been placed in the 40°C heater.\n\nPikaPeng operating temperature: ❄️\nCurrent temperature: 40°C\n\nYOU ARE COOKED. 💀', allowedMentions: allowedNone() }).catch(() => {});
  const gameChannel = await interaction.client.channels.fetch(game.channelId).catch(() => null);
  await gameChannel?.permissionOverwrites.edit(target.playerId, { SendMessages: false }).catch(error => logger.error(`Pengongus could not mute heated player ${target.playerId}`, error));
  return interaction.update({ content: '🔥 Heater action completed. The waddlers will discover what happened when the action phase ends.', components: [], allowedMentions: allowedNone() });
}

async function getVoteMenu(interaction) {
  const game = await requireGameInteraction(interaction);
  if (!game) return;
  const voter = engine.getPlayer(game, interaction.user.id);
  if (game.phase !== engine.Phase.VOTING) return interaction.reply({ content: 'Voting is not open right now.', ephemeral: true });
  if (!voter || voter.status !== 'ACTIVE') return interaction.reply({ content: 'Only active players can vote.', ephemeral: true });
  if (Object.hasOwn(game.votes, voter.id)) return interaction.reply({ content: 'Your vote is already recorded.', ephemeral: true });
  const targets = engine.activePlayers(game).filter(p => p.id !== voter.id);
  const options = await Promise.all(targets.map(async p => ({ label: (await displayName(interaction.guild, p.id)).slice(0, 95), value: p.id })));
  options.push({ label: 'Skip', value: 'skip' });
  const menu = new StringSelectMenuBuilder().setCustomId(`pengongus_vote:${game.id}:${interaction.user.id}`).setPlaceholder('Choose an active player or Skip').addOptions(options);
  return interaction.reply({ content: '🚨 **PENGONGUS VOTE**\n\nYour choice is private until voting ends.', components: [new ActionRowBuilder().addComponents(menu)], ephemeral: true, allowedMentions: allowedNone() });
}

async function castVote(interaction) {
  const [, gameId, voterId] = interaction.customId.split(':');
  if (voterId !== interaction.user.id) return interaction.reply({ content: 'Those voting controls belong to another player.', ephemeral: true });
  const game = interaction.guildId ? await readGame(interaction.guildId) : null;
  if (!game || game.id !== gameId || !isInGameChannel(interaction, game)) return interaction.reply({ content: 'Those voting controls have expired.', ephemeral: true });
  let completed;
  try {
    completed = await mutateGame(game.guildId, (games, current) => {
      if (!current || current.id !== gameId) throw new Error('game');
      const allVoted = engine.castVote(current, interaction.user.id, interaction.values[0]);
      if (allVoted) {
        const tally = engine.tally(current);
        const winner = engine.outcome(current);
        if (winner) return { transition: setResultInState(current, winner, 'vote resolved'), tally, game: structuredClone(current) };
        engine.nextRound(current);
        current.deadline = Date.now() + phaseDuration.ACTION;
        return { transition: null, tally, game: structuredClone(current) };
      }
      return { transition: null };
    });
  } catch (error) {
    const messages = { phase: 'Voting has ended.', voter: 'Only active players can vote.', duplicate: 'Your vote is already recorded.', target: 'That is not a valid vote target.' };
    return interaction.reply({ content: messages[error.message] || 'That vote could not be recorded.', ephemeral: true });
  }
  await interaction.reply({ content: 'Your vote has been recorded privately.', ephemeral: true });
  if (completed?.game) await publishVoteResult(interaction.client, completed);
}

async function earlyVote(interaction) {
  const [, gameId] = interaction.customId.split(':');
  const game = interaction.guildId ? await readGame(interaction.guildId) : null;
  if (!game || game.id !== gameId || !isInGameChannel(interaction, game) || game.phase !== engine.Phase.DISCUSSION) return interaction.reply({ content: 'This discussion has ended.', ephemeral: true });
  let result;
  try { result = await mutateGame(game.guildId, (games, current) => {
    if (!current || current.id !== gameId || current.phase !== engine.Phase.DISCUSSION) throw new Error('phase');
    if (!isActive(current, interaction.user.id)) throw new Error('player');
    if (!current.earlyVotes.includes(interaction.user.id)) current.earlyVotes.push(interaction.user.id);
    const threshold = Math.ceil(engine.activePlayers(current).length * 0.6);
    if (current.earlyVotes.length >= threshold) { engine.beginVoting(current); return { started: true, game: structuredClone(current) }; }
    return { started: false, count: current.earlyVotes.length, threshold };
  }); } catch (error) {
    return interaction.reply({ content: error.message === 'player' ? 'Only active players can call an early vote.' : 'The discussion has already ended.', ephemeral: true });
  }
  await interaction.reply({ content: result.started ? 'Enough waddlers agreed. Voting is starting.' : `Early vote request noted (${result.count}/${result.threshold}).`, ephemeral: true });
  if (result.started) await publishVoting(interaction.client, result.game);
}

function setResultInState(game, winner, reason) {
  game.phase = engine.Phase.RESULT;
  game.winner = winner;
  game.endReason = reason;
  game.cleanupAt = Date.now() + RESULT_DELAY;
  game.deadline = null;
  return structuredClone(game);
}
function listMentions(ids) { return ids.length ? ids.map(id => `<@${id}>`).join(', ') : 'None'; }
function roleSummary(game) { return listMentions(game.players.filter(p => p.role === 'PENGOSTOR').map(p => p.id)); }
function resultsEmbed(game, winner) {
  const duration = Math.max(0, Date.now() - game.createdAt);
  const minutes = Math.floor(duration / 60_000), seconds = Math.floor((duration % 60_000) / 1000);
  const pengostorCount = game.players.filter(p => p.role === 'PENGOSTOR').length;
  return new EmbedBuilder().setColor(winner === 'WADDLERS' ? 0x6bd6e8 : winner === 'PENGOSTORS' ? 0xf4c95d : 0x999999)
    .setTitle(winner === 'WADDLERS' ? '❄️ THE WADDLERS WIN!' : winner === 'PENGOSTORS' ? pengostorCount > 1 ? '🔥 THE PENGOSTORS WIN' : '🔥 THE PENGOSTOR WINS' : '🧊 PENGONGUS ENDED')
    .setDescription(winner === 'WADDLERS'
      ? `The suspicious Pengostor has been removed from the igloo.\nThe thermostat is back at a reasonable waddler temperature.\n\n${em()}`
      : winner === 'PENGOSTORS'
        ? 'The entire igloo has been heated to 40°C.\nThere are no surviving waddlers.\nThis building has become a sauna. 💀'
        : 'There are too few active waddlers to keep this igloo game going.')
    .addFields(
      { name: 'Pengostor(s)', value: roleSummary(game) },
      { name: 'Heated', value: listMentions(game.heated.map(h => h.playerId)) },
      { name: 'Ejected', value: listMentions(game.ejected.map(e => e.playerId)) },
      { name: 'Rounds', value: String(game.round), inline: true },
      { name: 'Duration', value: `${minutes}m ${seconds}s`, inline: true }
    );
}
async function publishResult(client, guildId, game) {
  if (!game) game = await readGame(guildId);
  if (!game?.channelId) return;
  const channel = await client.channels.fetch(game.channelId).catch(() => null);
  if (!channel?.isTextBased()) return removeGame(guildId);
  await channel.send({ embeds: [resultsEmbed(game, game.winner)], components: [], allowedMentions: allowedNone() }).catch(error => logger.error('Pengongus result message failed', error));
  await armWithClient(client, guildId);
}
async function finish(client, guildId, winner, reason) {
  const game = await mutateGame(guildId, (games, current) => {
    if (!current || [engine.Phase.RESULT, engine.Phase.FINISHED].includes(current.phase)) return null;
    return setResultInState(current, winner, reason);
  });
  clearTimer(guildId);
  if (game) await publishResult(client, guildId, game);
  return game;
}

async function resolveVote(client, guildId) {
  let transition;
  await mutateGame(guildId, (games, game) => {
    if (!game || game.phase !== engine.Phase.VOTING) return;
    const tally = engine.tally(game);
    const winner = engine.outcome(game);
    if (winner) transition = { finished: setResultInState(game, winner, winner === 'CANCELLED' ? 'too few active players' : 'vote resolved'), tally, game: structuredClone(game) };
    else {
      engine.nextRound(game);
      game.deadline = Date.now() + phaseDuration.ACTION;
      transition = { finished: null, tally, game: structuredClone(game) };
    }
  });
  clearTimer(guildId);
  if (!transition) return;
  const channel = await client.channels.fetch(transition.game.channelId).catch(() => null);
  if (!channel?.isTextBased()) return removeGame(guildId);
  if (transition.finished) {
    const target = transition.tally.ejectedId;
    if (target) await channel.permissionOverwrites.edit(target, { SendMessages: false }).catch(error => logger.error(`Pengongus could not mute ejected player ${target}`, error));
    const role = target ? engine.getPlayer(transition.game, target)?.role : null;
    const reveal = target ? `<@${target}> was ejected.\n\n${role === 'PENGOSTOR' ? 'They WERE a Pengostor. 🔥' : 'They were not a Pengostor.'}` : 'The votes tied or Skip won. Nobody was ejected.';
    await channel.send({ content: `${reveal}\n\n${transition.finished.winner === 'WADDLERS' ? 'The waddlers have won!' : transition.finished.winner === 'PENGOSTORS' ? 'The Pengostors have won.' : 'This igloo cannot continue.'}`, allowedMentions: allowedNone() });
    return publishResult(client, guildId, transition.finished);
  }
  const target = transition.tally.ejectedId;
  if (target) await channel.permissionOverwrites.edit(target, { SendMessages: false }).catch(error => logger.error(`Pengongus could not mute ejected player ${target}`, error));
  const role = target ? engine.getPlayer(transition.game, target)?.role : null;
  const reveal = target ? `<@${target}> was ejected. ${role === 'PENGOSTOR' ? 'They WERE a Pengostor. 🔥' : 'They were not a Pengostor.'}` : 'The votes tied or Skip won. Nobody was ejected.';
  await channel.send({ content: `${reveal}\n\n${em()} **ROUND ${transition.game.round}** begins. Waddlers, continue your private tasks.`, allowedMentions: allowedNone() });
  await armWithClient(client, guildId);
}

async function publishVoteResult(client, transition) {
  clearTimer(transition.game.guildId);
  const channel = await client.channels.fetch(transition.game.channelId).catch(() => null);
  if (!channel?.isTextBased()) return removeGame(transition.game.guildId);
  const target = transition.tally.ejectedId;
  if (target) await channel.permissionOverwrites.edit(target, { SendMessages: false }).catch(error => logger.error(`Pengongus could not mute ejected player ${target}`, error));
  const role = target ? engine.getPlayer(transition.game, target)?.role : null;
  const reveal = target ? `<@${target}> was ejected.\n\n${role === 'PENGOSTOR' ? 'They WERE a Pengostor. 🔥' : 'They were not a Pengostor.'}` : 'The votes tied or Skip won. Nobody was ejected.';
  const winner = transition.game.phase === engine.Phase.RESULT;
  const ending = transition.game.winner === 'WADDLERS' ? 'The waddlers have won!' : transition.game.winner === 'PENGOSTORS' ? 'The Pengostors have won.' : 'This igloo cannot continue.';
  await channel.send({ content: `${reveal}\n\n${winner ? ending : `${em()} **ROUND ${transition.game.round}** begins. Waddlers, continue your private tasks.`}`, allowedMentions: allowedNone() });
  if (winner) return publishResult(client, transition.game.guildId, transition.game);
  await postAction(client, transition.game);
}

async function publishVoting(client, game) {
  const channel = await client.channels.fetch(game.channelId).catch(() => null);
  if (!channel?.isTextBased()) return removeGame(game.guildId);
  await channel.send({ content: `🗳️ **VOTING IS OPEN**\n\nUse /pengongus vote to privately choose an active player or Skip. Voting ends <t:${Math.floor(game.deadline / 1000)}:R>.`, allowedMentions: allowedNone() });
  await armWithClient(client, game.guildId);
}
async function publishDiscussion(client, game) {
  const channel = await client.channels.fetch(game.channelId).catch(() => null);
  if (!channel?.isTextBased()) return removeGame(game.guildId);
  const heatedThisRound = game.heated.filter(h => h.round === game.round).map(h => `<@${h.playerId}>`);
  const row = new ActionRowBuilder().addComponents(new ButtonBuilder().setCustomId(`pengongus_early:${game.id}`).setLabel('Call Vote Early').setStyle(ButtonStyle.Danger));
  await channel.send({ content: `🚨 **EMERGENCY WADDLE**\n\n${em()} ${heatedThisRound.join(', ')} ${heatedThisRound.length === 1 ? 'was discovered' : 'were discovered'} next to\n**THE 40°C HEATER.**\n\nCause:\n🔥 EXTREME UN-PENGUIN TEMPERATURE\n\nDiscussion ends <t:${Math.floor(game.deadline / 1000)}:R>. An early vote needs agreement from 60% of active players.`, components: [row], allowedMentions: allowedNone() });
  await armWithClient(client, game.guildId);
}

async function postAction(client, game) {
  const channel = await client.channels.fetch(game.channelId).catch(() => null);
  if (!channel?.isTextBased()) return removeGame(game.guildId);
  await channel.send({ content: `${em()} **PENGONGUS · ROUND ${game.round}**\n\nAction phase ends <t:${Math.floor(game.deadline / 1000)}:R>. Use /pengongus task or /pengongus heat.`, allowedMentions: allowedNone() });
  await armWithClient(client, game.guildId);
}

async function onDeadline(client, guildId, gameId, phase, deadline) {
  const game = await readGame(guildId);
  if (!game || game.id !== gameId || game.phase !== phase || game.deadline !== deadline) return;
  if (phase === engine.Phase.LOBBY) {
    await disableLobby(client, game, 'This Pengongus lobby expired. Start a fresh igloo to play.');
    return removeGame(guildId);
  }
  if (phase === engine.Phase.ACTION) {
    let next;
    await mutateGame(guildId, (games, current) => {
      if (!current || current.id !== gameId || current.phase !== engine.Phase.ACTION || current.deadline !== deadline) return;
      if (engine.beginDiscussion(current)) next = { phase: 'DISCUSSION', game: structuredClone(current) };
      else {
        current.round += 1;
        if (current.round > engine.MAX_ROUNDS) next = { phase: 'FINISH', winner: 'PENGOSTORS' };
        else { current.deadline = Date.now() + phaseDuration.ACTION; next = { phase: 'ACTION', game: structuredClone(current) }; }
      }
    });
    if (next?.phase === 'FINISH') return finish(client, guildId, next.winner, 'round limit reached');
    if (next?.phase === 'DISCUSSION') return publishDiscussion(client, next.game);
    if (next?.phase === 'ACTION') return postAction(client, next.game);
  }
  if (phase === engine.Phase.DISCUSSION) {
    const updated = await mutateGame(guildId, (games, current) => {
      if (!current || current.id !== gameId || current.phase !== engine.Phase.DISCUSSION) return null;
      engine.beginVoting(current); return structuredClone(current);
    });
    if (updated) return publishVoting(client, updated);
  }
  if (phase === engine.Phase.VOTING) return resolveVote(client, guildId);
  if (phase === engine.Phase.RESULT) {
    const channel = await client.channels.fetch(game.channelId).catch(() => null);
    if (channel) await channel.delete('Pengongus results period ended').catch(error => logger.error(`Pengongus channel cleanup failed for guild ${guildId}`, error));
    return removeGame(guildId);
  }
}
async function armWithClient(client, guildId) {
  clearTimer(guildId);
  const game = await readGame(guildId);
  if (!game) return;
  const deadline = game.phase === engine.Phase.RESULT ? game.cleanupAt : game.deadline;
  if (!deadline) return;
  const timer = setTimeout(() => onDeadline(client, guildId, game.id, game.phase, game.deadline).catch(error => logger.error(`Pengongus phase timer failed for guild ${guildId}`, error)), Math.max(0, deadline - Date.now()));
  timer.unref?.(); timers.set(guildId, timer);
}

async function displayName(guild, userId) {
  const member = await guild.members.fetch(userId).catch(() => null);
  return String(member?.displayName || member?.user?.username || `Player ${userId.slice(-4)}`).replace(/[@`*_~|]/g, '').slice(0, 100);
}

async function startCommand(interaction) {
  const result = await createLobby(interaction);
  if (result.error === 'guild') return interaction.reply({ content: 'Pengongus can only be started inside a server.', ephemeral: true });
  if (result.error === 'active') return interaction.reply({ content: 'This server already has an active Pengongus lobby or match.', ephemeral: true });
  return result;
}

async function cancelForLeave(client, guildId, playerId) {
  const game = await readGame(guildId);
  if (!game || !engine.getPlayer(game, playerId)) return;
  if (game.phase === engine.Phase.LOBBY) {
    if (game.hostId === playerId) {
      await disableLobby(client, game, 'The host left the server, so this Pengongus lobby was cancelled.');
      await removeGame(guildId);
    } else {
      const updated = await mutateGame(guildId, (games, current) => { if (current?.id === game.id && current.phase === engine.Phase.LOBBY) { engine.leave(current, playerId); return structuredClone(current); } return null; });
      if (updated) await updateLobbyMessage(client, updated);
    }
    return;
  }
  if ([engine.Phase.RESULT, engine.Phase.FINISHED].includes(game.phase)) return;
  let next;
  await mutateGame(guildId, (games, current) => {
    if (!current || current.id !== game.id) return;
    engine.leave(current, playerId);
    const winner = engine.outcome(current);
    if (winner) next = setResultInState(current, winner, 'player left the server');
    else if (current.phase === engine.Phase.VOTING && engine.activePlayers(current).every(p => Object.hasOwn(current.votes, p.id))) next = { resolveVotes: true };
    else next = structuredClone(current);
  });
  if (next?.resolveVotes) return resolveVote(client, guildId);
  if (next?.phase === engine.Phase.RESULT) { clearTimer(guildId); return publishResult(client, guildId, next); }
  if (next) await armWithClient(client, guildId);
}

async function removeGame(guildId) {
  clearTimer(guildId);
  await mutateGame(guildId, (games, game) => { if (game) delete games[guildId]; });
}
async function channelDeleted(channel) {
  const games = await store.read(s => Object.values(s.pengongus));
  const game = games.find(g => g.channelId === channel.id || (g.lobbyChannelId === channel.id && g.phase === engine.Phase.LOBBY));
  if (game) await removeGame(game.guildId);
}
async function recover(client) {
  const games = await store.read(s => Object.values(s.pengongus).map(game => structuredClone(game)));
  for (const game of games) {
    if (game.phase === engine.Phase.LOBBY || game.phase === engine.Phase.STARTING) {
      await disableLobby(client, game, 'This Pengongus lobby expired when IglooBot restarted.');
      if (game.channelId) await client.channels.fetch(game.channelId).then(channel => channel?.delete('Pengongus startup recovery')).catch(() => {});
      await removeGame(game.guildId);
      continue;
    }
    if (game.phase !== engine.Phase.RESULT) {
      const result = await mutateGame(game.guildId, (all, current) => {
        if (!current) return null;
        return setResultInState(current, 'CANCELLED', 'the bot restarted');
      });
      const channel = await client.channels.fetch(game.channelId).catch(() => null);
      if (channel?.isTextBased()) await channel.send({ content: '🧊 This Pengongus match ended because IglooBot restarted. The private igloo will close shortly.', allowedMentions: allowedNone() }).catch(() => {});
      if (result) await armWithClient(client, game.guildId);
    } else await armWithClient(client, game.guildId);
  }
}

async function execute(interaction) {
  const sub = interaction.options.getSubcommand();
  if (sub === 'start') return startCommand(interaction);
  if (sub === 'role') return getRole(interaction);
  if (sub === 'task') return getTaskModal(interaction);
  if (sub === 'heat') return getHeatMenu(interaction);
  if (sub === 'vote') return getVoteMenu(interaction);
  if (sub === 'status') {
    const game = await requireGameInteraction(interaction); if (!game) return;
    return interaction.reply({ content: `${em()} **PENGONGUS · ${game.phase}**\nRound: **${game.round}**\nActive players: **${engine.activePlayers(game).length}**\nTasks: **${game.taskTotal}** completed\nDeadline: ${game.deadline ? `<t:${Math.floor(game.deadline / 1000)}:R>` : 'results'}`, ephemeral: true, allowedMentions: allowedNone() });
  }
}

module.exports = {
  execute, button, selectHeat, castVote, earlyVote, submitTask, recover, cancelForLeave, channelDeleted,
  createChannelPermissions, isInGameChannel, lobbyEmbed, lobbyRows,
  _readGame: readGame, _timers: timers,
  _resetForTests: async () => { for (const timer of timers.values()) clearTimeout(timer); timers.clear(); }
};
