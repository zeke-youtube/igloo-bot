const { SlashCommandBuilder, AttachmentBuilder } = require('discord.js');
const { encode, decode } = require('../pika-screaming');

const MAX_INPUT_LENGTH = 1000;
const HEADER = { encode: '🐧 **PikaScreamingLang Encoder**', decode: '🐧 **PikaScreamingLang Decoder**' };
const data = new SlashCommandBuilder()
  .setName('pikascreaminglang')
  .setDescription('Encode or decode PikaScreamingLang')
  .addSubcommand(command => command.setName('encode').setDescription('Encode text').addStringOption(option => option.setName('text').setDescription('Text to encode').setRequired(true).setMaxLength(MAX_INPUT_LENGTH)))
  .addSubcommand(command => command.setName('decode').setDescription('Decode PikaScreamingLang').addStringOption(option => option.setName('text').setDescription('Text to decode').setRequired(true).setMaxLength(MAX_INPUT_LENGTH)));

function codeFence(text) {
  const runs = text.match(/`+/g) || [];
  return '`'.repeat(Math.max(3, ...runs.map(run => run.length + 1)));
}

function response(mode, output) {
  const title = HEADER[mode];
  const fence = codeFence(output);
  const content = `${title}\n\n${fence}\n${output}\n${fence}`;
  if (content.length <= 1900) return { content, allowedMentions: { parse: [] }, ephemeral: true };
  return {
    content: `${title}\n\nThe result is attached as a text file.`,
    files: [new AttachmentBuilder(Buffer.from(output, 'utf8'), { name: `pikascreaminglang-${mode}.txt` })],
    allowedMentions: { parse: [] }, ephemeral: true
  };
}

async function execute(interaction) {
  const mode = interaction.options.getSubcommand();
  const input = interaction.options.getString('text', true);
  if (Array.from(input).length > MAX_INPUT_LENGTH) return interaction.reply({ content: `❌ Text is limited to ${MAX_INPUT_LENGTH} characters.`, ephemeral: true });
  let output;
  try {
    output = mode === 'encode' ? encode(input) : decode(input);
  } catch {
    return interaction.reply({ content: '❌ Invalid PikaScreamingLang.\n\nPikaPeng does not understand that scream. 🐧', ephemeral: true, allowedMentions: { parse: [] } });
  }
  return interaction.reply(response(mode, output));
}

module.exports = { data, execute, MAX_INPUT_LENGTH, response };
