const path = require('node:path');
const fs = require('node:fs');
const { joinVoiceChannel, createAudioPlayer, createAudioResource, AudioPlayerStatus, VoiceConnectionStatus, NoSubscriberBehavior, StreamType } = require('@discordjs/voice');
const config = require('./config');
const logger = require('./utils/logger');

let connection;
let player;
let reconnectTimer;
let stopping = false;

function audioPath() { return path.resolve(process.cwd(), config.radioAudioFile()); }
function playLoop() { if (!player || stopping || !fs.existsSync(audioPath())) return; player.play(createAudioResource(audioPath(), { inputType: StreamType.Arbitrary })); }
async function startRadio(client) {
  const guildId = config.radioGuildId(); const channelId = config.radioVoiceChannelId();
  if (!guildId || !channelId) { logger.info('Lofi radio is disabled: RADIO_GUILD_ID or RADIO_VOICE_CHANNEL_ID is not configured.'); return; }
  if (!fs.existsSync(audioPath())) { logger.error(`Lofi radio audio file not found: ${audioPath()}`); return; }
  const channel = await client.channels.fetch(channelId).catch(() => null);
  if (!channel || !channel.isVoiceBased() || channel.guildId !== guildId) { logger.error('Lofi radio voice channel is missing or not a voice channel.'); return; }
  stopping = false;
  player ||= createAudioPlayer({ behaviors: { noSubscriber: NoSubscriberBehavior.Play } });
  player.removeAllListeners(AudioPlayerStatus.Idle);
  player.on(AudioPlayerStatus.Idle, playLoop);
  player.on('error', (error) => { logger.error('Lofi radio player error', error); setTimeout(playLoop, 1000); });
  connection = joinVoiceChannel({ channelId: channel.id, guildId, adapterCreator: channel.guild.voiceAdapterCreator, selfDeaf: true, selfMute: false });
  connection.subscribe(player);
  connection.on(VoiceConnectionStatus.Disconnected, () => { if (stopping) return; logger.info('Lofi radio disconnected; reconnecting.'); clearTimeout(reconnectTimer); reconnectTimer = setTimeout(() => startRadio(client), 5000); });
  connection.on(VoiceConnectionStatus.Destroyed, () => { if (!stopping) { clearTimeout(reconnectTimer); reconnectTimer = setTimeout(() => startRadio(client), 5000); } });
  playLoop(); logger.info(`Lofi radio joined ${channel.name} and started looping.`);
}
function stopRadio() { stopping = true; clearTimeout(reconnectTimer); player?.stop(); connection?.destroy(); connection = null; }
module.exports = { startRadio, stopRadio };
