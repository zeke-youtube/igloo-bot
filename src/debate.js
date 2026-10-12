const crypto = require('node:crypto');
const store = require('./member-features');
const groq = require('./groq');
const logger = require('./utils/logger');

const SESSION_TTL_MS = 24 * 60 * 60 * 1000;
const SESSION_RETENTION_MS = 30 * 24 * 60 * 60 * 1000;
const START_COOLDOWN_MS = 60 * 1000;
const STALE_OPERATION_MS = 10 * 60 * 1000;
const SIDES = Object.freeze(['For', 'Against']);
const keyFor = (guildId, userId) => `${guildId}:${userId}`;
function active(session) { return session && !['COMPLETE', 'CANCELLED', 'EXPIRED', 'MODERATED'].includes(session.phase); }

async function start({ guildId, userId, topic, side, now = Date.now() }) {
  if (!guildId || !userId || typeof topic !== 'string' || topic.trim().length < 8 || topic.trim().length > 500 || !SIDES.includes(side)) return { error: 'invalid' };
  const key = keyFor(guildId, userId);
  const preflight = await store.read((state) => {
    const existing = state.debates?.sessions?.[key];
    if (existing && active(existing) && existing.expiresAt > now) return { error: 'active' };
    const previousStart = state.debates?.starts?.[key] || 0;
    if (previousStart && now - previousStart < START_COOLDOWN_MS) return { error: 'start-cooldown', remainingMs: START_COOLDOWN_MS - (now - previousStart) };
    return null;
  });
  if (preflight) return preflight;
  const safe = await groq.moderate(topic.trim());
  if (!safe.safe) return { error: 'moderated', reason: safe.reason };
  return store.mutate((state) => {
    state.debates ||= { sessions: {}, starts: {} };
    state.debates.sessions ||= {};
    state.debates.starts ||= {};
    for (const [sessionKey, existing] of Object.entries(state.debates.sessions)) {
      if (existing.expiresAt <= now && active(existing)) existing.phase = 'EXPIRED';
      if (!active(existing) && now - (existing.updatedAt || existing.startedAt) > SESSION_RETENTION_MS) delete state.debates.sessions[sessionKey];
      if (sessionKey === key && active(existing)) return { error: 'active', session: existing };
    }
    for (const [startKey, startedAt] of Object.entries(state.debates.starts)) if (now - startedAt > SESSION_RETENTION_MS) delete state.debates.starts[startKey];
    const previousStart = state.debates.starts[key] || 0;
    if (previousStart && now - previousStart < START_COOLDOWN_MS) return { error: 'start-cooldown', remainingMs: START_COOLDOWN_MS - (now - previousStart) };
    const session = {
      id: crypto.randomBytes(8).toString('hex'), guildId, userId, topic: topic.trim(), humanSide: side,
      aiSide: side === 'For' ? 'Against' : 'For', transcript: [], rounds: 0, phase: 'WAITING_HUMAN',
      startedAt: now, updatedAt: now, expiresAt: now + SESSION_TTL_MS, operations: {},
    };
    state.debates.sessions[key] = session;
    state.debates.starts[key] = now;
    logger.info(`Debate started guild=${guildId} user=${userId} session=${session.id} side=${side} fishReward=0`);
    return { session };
  });
}

async function get(guildId, userId, now = Date.now()) {
  const key = keyFor(guildId, userId);
  return store.mutate((state) => {
    const session = state.debates?.sessions?.[key] || null;
    if (session && active(session) && session.expiresAt <= now) session.phase = 'EXPIRED';
    return session ? structuredClone(session) : null;
  });
}

async function submit({ guildId, userId, interactionId, text, now = Date.now() }) {
  if (!guildId || !userId || !interactionId || typeof text !== 'string' || !text.trim() || text.trim().length > 1500) return { error: 'invalid' };
  const key = keyFor(guildId, userId);
  const claim = await store.mutate((state) => {
    const session = state.debates?.sessions?.[key];
    if (!session) return { error: 'missing' };
    if (session.expiresAt <= now && active(session)) { session.phase = 'EXPIRED'; return { error: 'expired' }; }
    if (session.operations?.[interactionId]) return { duplicate: true, session, operation: session.operations[interactionId] };
    if (session.phase === 'PROCESSING' && now - session.pending?.startedAt > STALE_OPERATION_MS) { session.phase = 'WAITING_HUMAN'; session.pending = null; }
    if (session.phase === 'PROCESSING') return { error: 'busy' };
    if (session.phase !== 'WAITING_HUMAN') return { error: session.phase === 'JUDGING' || session.phase === 'JUDGE_PROCESSING' ? 'judging' : 'not-ready', session };
    session.phase = 'PROCESSING';
    session.pending = { interactionId, text: text.trim(), startedAt: now };
    session.updatedAt = now;
    return { session: structuredClone(session) };
  });
  if (claim.error || claim.duplicate) return claim;

  try {
    const moderation = await groq.moderate(text.trim());
    if (!moderation.safe) {
      return store.mutate((state) => {
        const session = state.debates.sessions[key];
        if (session?.pending?.interactionId === interactionId) {
          session.phase = 'WAITING_HUMAN'; session.pending = null; session.operations[interactionId] = { status: 'moderated', reason: moderation.reason }; session.updatedAt = Date.now();
        }
        return { error: 'moderated', reason: moderation.reason };
      });
    }
    const reply = await groq.argument({ topic: claim.session.topic, aiSide: claim.session.aiSide, transcript: claim.session.transcript, humanArgument: text.trim() });
    const responseModeration = await groq.moderate(reply);
    if (!responseModeration.safe) {
      return store.mutate((state) => {
        const session = state.debates.sessions[key];
        if (session?.pending?.interactionId === interactionId) {
          session.phase = 'MODERATED'; session.pending = null; session.moderationReason = responseModeration.reason; session.updatedAt = Date.now();
        }
        return { error: 'ai-moderated' };
      });
    }
    const committed = await store.mutate((state) => {
      const session = state.debates.sessions[key];
      if (!session || session.pending?.interactionId !== interactionId || session.phase !== 'PROCESSING') return { error: 'stale' };
      const round = session.rounds + 1;
      session.transcript.push({ speaker: 'Human', side: session.humanSide, text: text.trim() }, { speaker: 'AI', side: session.aiSide, text: reply });
      session.rounds = round;
      session.operations[interactionId] = { status: 'complete', round, humanArgument: text.trim(), aiResponse: reply };
      session.pending = null;
      session.phase = round === 2 ? 'JUDGING' : 'WAITING_HUMAN';
      session.updatedAt = Date.now();
      logger.info(`Debate round guild=${guildId} user=${userId} session=${session.id} round=${round} fishReward=0`);
      return { session: structuredClone(session), operation: session.operations[interactionId] };
    });
    if (committed.error || committed.session?.phase !== 'JUDGING') return committed;
    const judged = await judge({ guildId, userId });
    return { ...committed, session: judged.session || committed.session, judgement: judged.judgement, judgeError: judged.error };
  } catch (error) {
    logger.error(`Debate argument failed guild=${guildId} user=${userId} interaction=${interactionId}`, error);
    await store.mutate((state) => {
      const session = state.debates?.sessions?.[key];
      if (session?.pending?.interactionId === interactionId) { session.phase = 'WAITING_HUMAN'; session.pending = null; session.updatedAt = Date.now(); }
    }).catch(() => {});
    return { error: 'unavailable' };
  }
}

async function judge({ guildId, userId, now = Date.now() }) {
  const key = keyFor(guildId, userId);
  const attemptId = crypto.randomBytes(8).toString('hex');
  const claim = await store.mutate((state) => {
    const session = state.debates?.sessions?.[key];
    if (!session) return { error: 'missing' };
    if (session.phase === 'COMPLETE') return { judgement: session.judgement, session };
    if (session.phase === 'JUDGE_PROCESSING' && now - (session.judgeStartedAt || now) <= STALE_OPERATION_MS) return { error: 'busy' };
    if (session.phase === 'JUDGE_PROCESSING' && now - (session.judgeStartedAt || now) > STALE_OPERATION_MS) session.phase = 'JUDGING';
    if (session.phase !== 'JUDGING' || session.rounds !== 2) return { error: 'not-ready', session };
    session.phase = 'JUDGE_PROCESSING'; session.judgeStartedAt = now; session.judgeAttemptId = attemptId;
    return { session: structuredClone(session) };
  });
  if (claim.error || claim.judgement) return claim;
  try {
    const judgement = await groq.judge({ topic: claim.session.topic, transcript: claim.session.transcript });
    return store.mutate((state) => {
      const session = state.debates.sessions[key];
      if (session?.judgeAttemptId !== attemptId) return { error: 'stale' };
      session.judgement = judgement; session.phase = 'COMPLETE'; session.completedAt = Date.now(); session.updatedAt = Date.now();
      logger.info(`Debate judged guild=${guildId} user=${userId} session=${session.id} fishReward=0`);
      return { judgement, session: structuredClone(session) };
    });
  } catch (error) {
    logger.error(`Debate judge failed guild=${guildId} user=${userId}`, error);
    await store.mutate((state) => {
      const session = state.debates?.sessions?.[key];
      if (session?.judgeAttemptId === attemptId) { session.phase = 'JUDGING'; session.updatedAt = Date.now(); }
    }).catch(() => {});
    return { error: 'judge-unavailable' };
  }
}

async function cancel({ guildId, userId }) {
  const key = keyFor(guildId, userId);
  return store.mutate((state) => {
    const session = state.debates?.sessions?.[key];
    if (!session || !active(session)) return { error: 'missing' };
    if (session.phase === 'PROCESSING' || session.phase === 'JUDGE_PROCESSING') return { error: 'busy' };
    session.phase = 'CANCELLED'; session.updatedAt = Date.now();
    return { session };
  });
}

module.exports = { start, get, submit, judge, cancel, SESSION_TTL_MS, SESSION_RETENTION_MS, START_COOLDOWN_MS, SIDES };
