const { SlashCommandBuilder, EmbedBuilder } = require('discord.js');
const debate = require('../debate');

const data = new SlashCommandBuilder().setName('debate').setDescription('Have a two-round debate with an AI and get an independent verdict.')
  .addSubcommand((sub) => sub.setName('start').setDescription('Start a Human vs AI debate.')
    .addStringOption((option) => option.setName('topic').setDescription('The debate topic').setRequired(true).setMinLength(8).setMaxLength(500))
    .addStringOption((option) => option.setName('side').setDescription('Which side you will argue').setRequired(true).addChoices({ name: 'For', value: 'For' }, { name: 'Against', value: 'Against' })))
  .addSubcommand((sub) => sub.setName('argue').setDescription('Submit your next argument (two rounds total).')
    .addStringOption((option) => option.setName('argument').setDescription('Your argument').setRequired(true).setMinLength(1).setMaxLength(1500)))
  .addSubcommand((sub) => sub.setName('status').setDescription('Check your debate or retry its independent judge.'))
  .addSubcommand((sub) => sub.setName('cancel').setDescription('Cancel your active debate.'));

function safeEmbed(title, description, color = 0x6bd6e8) {
  return new EmbedBuilder().setColor(color).setTitle(title).setDescription(description.slice(0, 4000)).setFooter({ text: 'IglooBot · Human vs AI debate · No Fish rewards' });
}
function roundEmbed(session, operation, judgement, judgeError) {
  let description = `**Topic:** ${session.topic}\n**Round ${operation.round} of 2 · ${session.aiSide}**\n\n${operation.aiResponse}`;
  if (judgement) description += `\n\n**Independent judge**\n${judgement}`;
  else if (judgeError) description += '\n\nThe judge is temporarily unavailable. Use `/debate status` to retry the separate judging step.';
  else if (operation.round < 2) description += '\n\nYour next `/debate argue` submission starts round 2.';
  return safeEmbed(operation.round === 2 ? '⚖️ Debate complete' : '🗣️ AI response', description, operation.round === 2 ? 0xf4c95d : 0x6bd6e8);
}

async function execute(interaction) {
  if (!interaction.guildId) return interaction.reply({ content: 'Debates are available in a server only.', ephemeral: true });
  const subcommand = interaction.options.getSubcommand();
  if (subcommand === 'start') {
    await interaction.deferReply({ ephemeral: true });
    try {
      const result = await debate.start({ guildId: interaction.guildId, userId: interaction.user.id, topic: interaction.options.getString('topic'), side: interaction.options.getString('side') });
      if (result.error === 'moderated') return interaction.editReply({ content: `That topic was blocked by the debate safety moderator${result.reason ? `: ${result.reason}` : '.'}` });
      if (result.error === 'active') return interaction.editReply({ content: 'You already have an active debate here. Use `/debate argue`, `/debate status`, or `/debate cancel`.' });
      if (result.error === 'start-cooldown') return interaction.editReply({ content: `Please wait ${Math.ceil(result.remainingMs / 1000)} seconds before starting another debate.` });
      if (result.error) return interaction.editReply({ content: 'Enter a topic between 8 and 500 characters and choose For or Against.' });
      const session = result.session;
      return interaction.editReply({ embeds: [safeEmbed('🗣️ Human vs AI debate started', `**Topic:** ${session.topic}\n**Your side:** ${session.humanSide}\n**AI side:** ${session.aiSide}\n\nSubmit your first argument with /debate argue. You will have two argument rounds, with an AI response after each. A separate AI judge will decide the result. No Fish or other rewards are given.`)], allowedMentions: { parse: [] } });
    } catch (error) {
      return interaction.editReply({ content: error.message?.includes('GROQ_API_KEY') ? 'Debate AI is not configured. The bot administrator must set GROQ_API_KEY.' : 'The safety moderator is temporarily unavailable. No debate was started; please try again later.' });
    }
  }
  if (subcommand === 'argue') {
    await interaction.deferReply({ ephemeral: true });
    try {
      const result = await debate.submit({ guildId: interaction.guildId, userId: interaction.user.id, interactionId: interaction.id, text: interaction.options.getString('argument') });
      if (result.error === 'missing') return interaction.editReply({ content: 'No active debate found. Start one with `/debate start`.' });
      if (result.error === 'expired') return interaction.editReply({ content: 'This debate expired after 24 hours. Start a new one with `/debate start`.' });
      if (result.error === 'moderated') return interaction.editReply({ content: `That argument was blocked by the debate safety moderator${result.reason ? `: ${result.reason}` : '.'} It did not use a round.` });
      if (result.error === 'ai-moderated') return interaction.editReply({ content: 'The AI response did not pass the safety review, so this debate was stopped without displaying it.' });
      if (result.error === 'busy') return interaction.editReply({ content: 'Your previous argument is still processing. Check `/debate status` shortly.' });
      if (result.error === 'judging') return interaction.editReply({ content: 'Both rounds are complete; the independent judge is deciding. Use `/debate status` shortly.' });
      if (result.error === 'not-ready') return interaction.editReply({ content: 'There is no argument round available. Use `/debate status` to check the session.' });
      if (result.error === 'unavailable') return interaction.editReply({ content: 'The AI could not complete that turn. Your argument was not added to the debate; please retry shortly.' });
      if (result.error) return interaction.editReply({ content: 'The debate state changed while processing. Check `/debate status` before trying again.' });
      const session = result.session;
      const operation = result.operation;
      if (operation?.status === 'moderated') return interaction.editReply({ content: 'That argument was blocked by the debate safety moderator. It did not use a round.' });
      return interaction.editReply({ embeds: [roundEmbed(session, operation, result.judgement, result.judgeError)], allowedMentions: { parse: [] } });
    } catch (error) {
      return interaction.editReply({ content: error.message?.includes('GROQ_API_KEY') ? 'Debate AI is not configured. The bot administrator must set GROQ_API_KEY.' : 'The AI service is temporarily unavailable. Your debate turn was not recorded; please try again.' });
    }
  }
  if (subcommand === 'cancel') {
    const result = await debate.cancel({ guildId: interaction.guildId, userId: interaction.user.id });
    if (result.error === 'busy') return interaction.reply({ content: 'An AI response is processing; try cancelling after it finishes.', ephemeral: true });
    if (result.error) return interaction.reply({ content: 'You have no active debate to cancel.', ephemeral: true });
    return interaction.reply({ content: 'Debate cancelled. No Fish were awarded or changed.', ephemeral: true });
  }

  await interaction.deferReply({ ephemeral: true });
  const session = await debate.get(interaction.guildId, interaction.user.id);
  if (!session || session.phase === 'EXPIRED') return interaction.editReply({ content: 'You have no active debate. Start one with `/debate start`.' });
  if (session.phase === 'JUDGING') {
    try {
      const result = await debate.judge({ guildId: interaction.guildId, userId: interaction.user.id });
      if (result.judgement) return interaction.editReply({ embeds: [safeEmbed('⚖️ Independent debate verdict', `**Topic:** ${session.topic}\n\n${result.judgement}`, 0xf4c95d)], allowedMentions: { parse: [] } });
      if (result.error === 'busy') return interaction.editReply({ content: 'The independent judge is already processing this debate. Try `/debate status` again shortly.' });
      if (result.error) return interaction.editReply({ content: 'The judge is temporarily unavailable. Try `/debate status` again shortly.' });
    } catch { return interaction.editReply({ content: 'The judge is temporarily unavailable. Try `/debate status` again shortly.' }); }
  }
  const phase = session.phase.replaceAll('_', ' ').toLowerCase();
  const transcript = session.transcript.map((turn, index) => `**${turn.speaker} · ${turn.side}**\n${turn.text}`).join('\n\n').slice(0, 2600) || 'No arguments submitted yet.';
  const verdict = session.judgement ? `\n\n**Independent judge**\n${session.judgement}` : '';
  return interaction.editReply({ embeds: [safeEmbed('🗣️ Debate status', `**Topic:** ${session.topic}\n**Sides:** Human ${session.humanSide} · AI ${session.aiSide}\n**Phase:** ${phase}\n**Rounds:** ${session.rounds}/2\n\n${transcript}${verdict}`)], allowedMentions: { parse: [] } });
}

module.exports = { data, execute, roundEmbed, safeEmbed };
