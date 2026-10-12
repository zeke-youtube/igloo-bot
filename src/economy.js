const fs = require('node:fs/promises');
const path = require('node:path');

const storePath = path.join(process.env.IGLOOBOT_DATA_DIR || path.join(__dirname, 'data'), 'fish-balances.json');
let balances = {};
let friendUberLedger = {};
let loaded = false;
let writeQueue = Promise.resolve();
let mutationQueue = Promise.resolve();
const BIRTHDAY_LEDGER_KEY = '__birthdayRewardLedger';
const FISHING_LEDGER_KEY = '__fishingLedger';
let birthdayLedger = {};
let fishingLedger = { cooldowns: {}, interactions: {} };

async function load() { if (loaded) return; try { balances = JSON.parse(await fs.readFile(storePath, 'utf8')); birthdayLedger = balances[BIRTHDAY_LEDGER_KEY] || {}; friendUberLedger = balances.__friendUberLedger || {}; fishingLedger = balances[FISHING_LEDGER_KEY] || { cooldowns: {}, interactions: {} }; delete balances[BIRTHDAY_LEDGER_KEY]; delete balances.__friendUberLedger; delete balances[FISHING_LEDGER_KEY]; } catch { balances = {}; birthdayLedger = {}; friendUberLedger = {}; fishingLedger = { cooldowns: {}, interactions: {} }; } loaded = true; }
async function persist() { const snapshot = { ...balances, [BIRTHDAY_LEDGER_KEY]: birthdayLedger, __friendUberLedger: friendUberLedger, [FISHING_LEDGER_KEY]: fishingLedger }; writeQueue = writeQueue.catch(() => {}).then(async () => { const temporaryPath = `${storePath}.tmp`; await fs.writeFile(temporaryPath, `${JSON.stringify(snapshot, null, 2)}\n`, 'utf8'); await fs.rename(temporaryPath, storePath); }); return writeQueue; }
function validateUser(userId) { if (!userId || typeof userId !== 'string') throw new TypeError('A Discord user ID is required.'); }
function validateAmount(amount) { if (!Number.isInteger(amount) || amount < 0) throw new RangeError('Fish amounts must be non-negative whole integers.'); }

async function getFishBalance(userId) { validateUser(userId); await load(); return balances[userId] || 0; }
function mutate(task) { const next = mutationQueue.then(task, task); mutationQueue = next.catch(() => {}); return next; }
async function addFish(userId, amount) { validateUser(userId); validateAmount(amount); return mutate(async () => { await load(); const previous = balances[userId] || 0; balances[userId] = previous + amount; try { await persist(); return balances[userId]; } catch (error) { balances[userId] = previous; throw error; } }); }
async function removeFish(userId, amount) { validateUser(userId); validateAmount(amount); return mutate(async () => { await load(); const current = balances[userId] || 0; if (amount > current) throw new RangeError('Insufficient fish.'); balances[userId] = current - amount; try { await persist(); return balances[userId]; } catch (error) { balances[userId] = current; throw error; } }); }
async function transferFish(fromUserId, toUserId, amount) { validateUser(fromUserId); validateUser(toUserId); validateAmount(amount); if (amount < 1) throw new RangeError('Transfer amounts must be positive whole integers.'); if (fromUserId === toUserId) throw new RangeError('Users cannot transfer fish to themselves.'); return mutate(async () => { await load(); const senderBefore = balances[fromUserId] || 0; const recipientBefore = balances[toUserId] || 0; if (senderBefore < amount) throw new RangeError('Insufficient fish.'); balances[fromUserId] = senderBefore - amount; balances[toUserId] = recipientBefore + amount; try { await persist(); return { senderBalance: balances[fromUserId], recipientBalance: balances[toUserId] }; } catch (error) { balances[fromUserId] = senderBefore; balances[toUserId] = recipientBefore; throw error; } }); }
async function resolveGamble(userId, amount, won) { validateUser(userId); validateAmount(amount); if (amount < 1) throw new RangeError('Gamble amounts must be positive whole integers.'); return mutate(async () => { await load(); const before = balances[userId] || 0; if (before < amount) throw new RangeError('Insufficient fish.'); const after = won ? before + amount : before - amount; balances[userId] = after; try { await persist(); return { before, after, won, stake: amount }; } catch (error) { balances[userId] = before; throw error; } }); }
async function hasFish(userId, amount) { validateUser(userId); validateAmount(amount); return (await getFishBalance(userId)) >= amount; }

async function friendUberCredit(sessionId, kind, userId, amount) {
  validateUser(userId); validateAmount(amount);
  if (!sessionId || !['refund', 'payout'].includes(kind)) throw new TypeError('A FriendUber session and credit kind are required.');
  const key = `${sessionId}:${kind}`;
  return mutate(async () => {
    await load();
    if (friendUberLedger[key]) return { amount: friendUberLedger[key].amount, duplicate: true };
    const before = balances[userId] || 0;
    balances[userId] = before + amount;
    friendUberLedger[key] = { userId, amount, at: Date.now() };
    try { await persist(); return { amount, duplicate: false }; }
    catch (error) { balances[userId] = before; delete friendUberLedger[key]; throw error; }
  });
}

async function friendUberHold(sessionId, userId, amount) {
  validateUser(userId); validateAmount(amount);
  if (!sessionId || amount < 1) throw new TypeError('A FriendUber session and positive Fish amount are required.');
  return mutate(async () => {
    await load();
    const key = `${sessionId}:hold`;
    if (friendUberLedger[key]) return { held: true, duplicate: true };
    const before = balances[userId] || 0;
    if (before < amount) return { held: false, balance: before };
    balances[userId] = before - amount;
    friendUberLedger[key] = { userId, amount, at: Date.now() };
    try { await persist(); return { held: true, duplicate: false, balance: balances[userId] }; }
    catch (error) { balances[userId] = before; delete friendUberLedger[key]; throw error; }
  });
}

async function transferAvailableFish(fromUserId, toUserId, requestedAmount) {
  validateUser(fromUserId); validateUser(toUserId); validateAmount(requestedAmount);
  if (fromUserId === toUserId) throw new RangeError('Users cannot transfer fish to themselves.');
  return mutate(async () => {
    await load();
    const senderBefore = balances[fromUserId] || 0;
    const amount = Math.min(requestedAmount, senderBefore);
    const recipientBefore = balances[toUserId] || 0;
    balances[fromUserId] = senderBefore - amount;
    balances[toUserId] = recipientBefore + amount;
    try { await persist(); return { amount, senderBalance: balances[fromUserId], recipientBalance: balances[toUserId] }; }
    catch (error) { balances[fromUserId] = senderBefore; balances[toUserId] = recipientBefore; throw error; }
  });
}

async function confiscateFish(thiefId, victimId, rate) {
  validateUser(thiefId); validateUser(victimId);
  if (thiefId === victimId) throw new RangeError('Users cannot transfer fish to themselves.');
  return mutate(async () => {
    await load();
    const thiefBefore = balances[thiefId] || 0; const victimBefore = balances[victimId] || 0;
    const amount = Math.floor(thiefBefore * rate);
    balances[thiefId] = thiefBefore - amount; balances[victimId] = victimBefore + amount;
    try { await persist(); return { amount, thiefBalance: balances[thiefId], victimBalance: balances[victimId] }; }
    catch (error) { balances[thiefId] = thiefBefore; balances[victimId] = victimBefore; throw error; }
  });
}

async function awardBirthdayFish(guildId, userId, celebrationYear, amount = 1000) {
  validateUser(guildId); validateUser(userId); validateAmount(amount);
  if (!Number.isInteger(celebrationYear) || celebrationYear < 2000) throw new RangeError('A valid birthday celebration year is required.');
  const key = `${guildId}:${userId}:${celebrationYear}`;
  return mutate(async () => {
    await load();
    if (birthdayLedger[key]) return { awarded: false, balance: balances[userId] || 0, reward: birthdayLedger[key] };
    const before = balances[userId] || 0;
    const reward = { guildId, userId, celebrationYear, amount, awardedAt: new Date().toISOString() };
    balances[userId] = before + amount;
    birthdayLedger[key] = reward;
    try { await persist(); return { awarded: true, balance: balances[userId], reward }; }
    catch (error) { balances[userId] = before; delete birthdayLedger[key]; throw error; }
  });
}
async function hasBirthdayReward(guildId, userId, celebrationYear) {
  validateUser(guildId); validateUser(userId); await load();
  return Boolean(birthdayLedger[`${guildId}:${userId}:${celebrationYear}`]);
}

const FISHING_COOLDOWN_MS = 30 * 1000;
async function processFishing({ interactionId, userId, guildId = null, selectCatch, now = Date.now() }) {
  validateUser(userId);
  validateUser(interactionId);
  if (typeof selectCatch !== 'function' || !Number.isSafeInteger(now) || now < 0) throw new TypeError('A valid fishing selector and timestamp are required.');
  return mutate(async () => {
    await load();
    const prior = fishingLedger.interactions[interactionId];
    if (prior) return { ...prior, duplicate: true };

    const previousAt = fishingLedger.cooldowns[userId];
    const remainingMs = previousAt === undefined ? 0 : Math.max(0, previousAt + FISHING_COOLDOWN_MS - now);
    if (remainingMs > 0) {
      const rejected = { status: 'cooldown', interactionId, userId, guildId, remainingMs, timestamp: now };
      fishingLedger.interactions[interactionId] = rejected;
      try { await persist(); return { ...rejected, duplicate: false }; }
      catch (error) { delete fishingLedger.interactions[interactionId]; throw error; }
    }

    const catchResult = selectCatch();
    validateAmount(catchResult?.reward);
    if (!catchResult?.id) throw new TypeError('A valid fishing result is required.');
    const before = balances[userId] || 0;
    const previousCooldown = previousAt;
    const result = { status: 'caught', interactionId, userId, guildId, catch: catchResult, fishAwarded: catchResult.reward, timestamp: now, balance: before + catchResult.reward };
    balances[userId] = result.balance;
    fishingLedger.cooldowns[userId] = now;
    fishingLedger.interactions[interactionId] = result;
    try { await persist(); return { ...result, duplicate: false }; }
    catch (error) { balances[userId] = before; if (previousCooldown === undefined) delete fishingLedger.cooldowns[userId]; else fishingLedger.cooldowns[userId] = previousCooldown; delete fishingLedger.interactions[interactionId]; throw error; }
  });
}

module.exports = { getFishBalance, addFish, removeFish, hasFish, transferFish, transferAvailableFish, confiscateFish, resolveGamble, friendUberCredit, friendUberHold, awardBirthdayFish, hasBirthdayReward, processFishing, FISHING_COOLDOWN_MS };
