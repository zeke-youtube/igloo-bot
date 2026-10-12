const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');
const { spawnSync } = require('node:child_process');
const { SlashCommandBuilder } = require('discord.js');

const dataDirPromise = fs.mkdtemp(path.join(os.tmpdir(), 'igloobot-debate-'));
let debate;
let command;
let calls;
let fetchImpl;
function response(content, status = 200, headers = {}) {
  return new Response(JSON.stringify(status === 200 ? { choices: [{ message: { content } }] } : { error: { message: 'rate limited' } }), { status, headers });
}
async function setup() {
  const dataDir = await dataDirPromise;
  process.env.IGLOOBOT_DATA_DIR = dataDir;
  process.env.GROQ_API_KEY = 'test-key-only';
  calls = [];
  fetchImpl = global.fetch;
  global.fetch = async (_url, options) => {
    const body = JSON.parse(options.body);
    calls.push(body);
    if (body.messages[0].content.includes('debate safety moderator')) {
      const input = body.messages.at(-1).content;
      return response(JSON.stringify(input.includes('BLOCK_ME') ? { safe: false, reason: 'Not suitable for debate' } : { safe: true, reason: '' }));
    }
    if (body.model === 'llama-3.3-70b-versatile') return response('A medium length rebuttal grounded in relevant reasoning and a useful example.');
    if (body.model === 'openai/gpt-oss-120b') return response('Winner: Human. Human: 8/10. AI: 7/10. The human directly answered the opposing case with clearer reasoning.');
    return response('unexpected model', 400);
  };
  debate = require('../src/debate');
  command = require('../src/commands/debate');
  return dataDir;
}

test('debate persists a two-round Human vs AI flow and uses a separate judge model without rewards', async () => {
  const dataDir = await setup();
  const started = await debate.start({ guildId: 'guild', userId: 'human', topic: 'Should cities add more parks?', side: 'For', now: 1000 });
  assert.equal(started.session.phase, 'WAITING_HUMAN');
  assert.equal(started.session.aiSide, 'Against');

  const [first, competing] = await Promise.all([
    debate.submit({ guildId: 'guild', userId: 'human', interactionId: 'turn-1', text: 'Parks improve health and community life.', now: 2000 }),
    debate.submit({ guildId: 'guild', userId: 'human', interactionId: 'turn-race', text: 'A concurrent second turn must not pass.', now: 2001 }),
  ]);
  assert.equal(first.operation.round, 1);
  assert.equal(competing.error, 'busy');
  const duplicate = await debate.submit({ guildId: 'guild', userId: 'human', interactionId: 'turn-1', text: 'Different content should not replace a processed interaction.', now: 2002 });
  assert.equal(duplicate.duplicate, true);
  assert.equal(duplicate.operation.aiResponse, first.operation.aiResponse);

  const second = await debate.submit({ guildId: 'guild', userId: 'human', interactionId: 'turn-2', text: 'The benefits justify the land allocation.', now: 3000 });
  assert.equal(second.session.phase, 'COMPLETE');
  assert.match(second.judgement, /Winner: Human/);
  assert.equal(second.session.rounds, 2);
  assert.equal(second.session.transcript.length, 4);
  assert.ok(calls.some((call) => call.model === 'openai/gpt-oss-120b'));
  assert.equal(calls.filter((call) => call.model === 'llama-3.3-70b-versatile' && call.messages[0].content.includes('You are one side')).length, 2);
  assert.equal(JSON.parse(await fs.readFile(path.join(dataDir, 'member-features.json'), 'utf8')).fishBalances, undefined);

  const restart = spawnSync(process.execPath, ['-e', `const d=require('./src/debate'); d.get('guild','human').then(s=>{if(s.phase!=='COMPLETE'||s.rounds!==2||!s.judgement)process.exit(1)}).catch(()=>process.exit(2))`], { cwd: path.join(__dirname, '..'), env: { ...process.env, IGLOOBOT_DATA_DIR: dataDir }, encoding: 'utf8' });
  assert.equal(restart.status, 0, restart.stderr);
});

test('moderation blocks unsafe topics and arguments without consuming turns', async () => {
  await setup();
  const blockedTopic = await debate.start({ guildId: 'guild', userId: 'blocked', topic: 'BLOCK_ME topic discussion', side: 'For' });
  assert.equal(blockedTopic.error, 'moderated');
  const started = await debate.start({ guildId: 'guild', userId: 'safe', topic: 'Should libraries be open late?', side: 'Against', now: 10_000 });
  assert.ok(started.session);
  const blockedArgument = await debate.submit({ guildId: 'guild', userId: 'safe', interactionId: 'unsafe-turn', text: 'BLOCK_ME argument', now: 10_001 });
  assert.equal(blockedArgument.error, 'moderated');
  assert.equal((await debate.get('guild', 'safe')).rounds, 0);
});

test('moderation reuses the configured debate model instead of a separate low-quota model', async () => {
  await setup();
  const config = require('../src/config');
  const previous = process.env.DEBATE_AI_MODEL;
  process.env.DEBATE_AI_MODEL = 'test-debate-model';
  try {
    assert.equal(config.debateModerationModel(), 'test-debate-model');
    const started = await debate.start({ guildId: 'guild', userId: 'model-check', topic: 'Should libraries be open late?', side: 'For' });
    assert.ok(started.session);
    assert.equal(calls[0].model, 'test-debate-model');
  } finally {
    if (previous === undefined) delete process.env.DEBATE_AI_MODEL;
    else process.env.DEBATE_AI_MODEL = previous;
  }
});

test('Groq 429 errors retry and configured models receive bounded requests', async () => {
  await setup();
  const groq = require('../src/groq');
  let callsMade = 0;
  global.fetch = async () => { callsMade += 1; return callsMade === 1 ? response('', 429, { 'retry-after': '0.01' }) : response('recovered'); };
  assert.equal(await groq.chat({ model: 'test-model', messages: [{ role: 'user', content: 'hi' }], maxTokens: 10 }), 'recovered');
  assert.equal(callsMade, 2);
  global.fetch = async (_url, options) => { const payload = JSON.parse(options.body); assert.ok(payload.max_tokens <= 500); assert.equal(payload.stream, false); return response('ok'); };
  assert.equal(await groq.chat({ model: 'test-model', messages: [{ role: 'user', content: 'hi' }], maxTokens: 500 }), 'ok');
});

test('/debate has start, argue, status, and cancel slash subcommands with rewardless replies', async () => {
  await setup();
  assert.equal(command.data instanceof SlashCommandBuilder, true);
  assert.deepEqual(command.data.toJSON().options.map(({ name }) => name), ['start', 'argue', 'status', 'cancel']);
  const original = debate.start;
  try {
    debate.start = async () => ({ session: { topic: 'A fair test topic', humanSide: 'For', aiSide: 'Against' } });
    let reply;
    await command.execute({ guildId: 'g', user: { id: 'u' }, options: { getSubcommand: () => 'start', getString: () => 'A fair test topic' }, deferReply: async () => {}, editReply: async (value) => { reply = value; } });
    assert.match(reply.embeds[0].toJSON().description, /No Fish or other rewards/);
  } finally { debate.start = original; global.fetch = fetchImpl; }
});

test.after(async () => {
  if (fetchImpl) global.fetch = fetchImpl;
  await fs.rm(await dataDirPromise, { recursive: true, force: true });
});
