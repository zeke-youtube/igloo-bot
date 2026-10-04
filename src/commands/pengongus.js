const { SlashCommandBuilder } = require('discord.js');
const manager = require('../games/pengongus/manager');

const data = new SlashCommandBuilder()
  .setName('pengongus')
  .setDescription('Play Pengongus, a private-igloo social deduction game.')
  .addSubcommand(s => s.setName('start').setDescription('Start a Pengongus lobby in this server.'))
  .addSubcommand(s => s.setName('role').setDescription('Privately check your Pengongus role.'))
  .addSubcommand(s => s.setName('task').setDescription('Work on your private Waddler task.'))
  .addSubcommand(s => s.setName('heat').setDescription('Choose a Waddler for the 40°C heater.'))
  .addSubcommand(s => s.setName('vote').setDescription('Privately vote during the voting phase.'))
  .addSubcommand(s => s.setName('status').setDescription('Check the current round and phase.'));

module.exports = { data, execute: manager.execute };
