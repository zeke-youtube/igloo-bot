const path = require('node:path');
const fs = require('node:fs');
const { spawn } = require('node:child_process');
const { joinVoiceChannel, createAudioPlayer, createAudioResource, AudioPlayerStatus, VoiceConnectionStatus, NoSubscriberBehavior, StreamType } = require('@discordjs/voice');
const config = require('./config');
const logger = require('./utils/logger');

let connection;
let player;
let reconnectTimer;
let stopping = false;
let ffmpegProcess;

function audioPath() { return path.resolve(process.cwd(), config.radioAudioFile()); }
function playLoop() {
  if (!player || stopping || !fs.existsSync(audioPath())) return;
  ffmpegProcess?.kill('SIGTERM');
  ffmpegProcess = spawn('ffmpeg', ['-hide_banner', '-loglevel', 'error', '-re', '-i', audioPath(), '-f', 's16le', '-ar', '48000', '-ac', '2', 'pipe:1'], { stdio: ['ignore', 'pipe', 'pipe'] });
  ffmpegProcess.stderr.on('data', (data) => logger.error(`Lofi FFmpeg: ${data.toString().trim()}`));
  ffmpegProcess.on('error', (error) => logger.error('Could not start FFmpeg for lofi radio', error));
  ffmpegProcess.on('close', (code) => { if (!stopping && code !== 0) setTimeout(playLoop, 1000); });
  player.play(createAudioResource(ffmpegProcess.stdout, { inputType: StreamType.Raw }));
}
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
function stopRadio() { stopping = true; clearTimeout(reconnectTimer); player?.stop(); ffmpegProcess?.kill('SIGTERM'); ffmpegProcess = null; connection?.destroy(); connection = null; }
module.exports = { startRadio, stopRadio };
