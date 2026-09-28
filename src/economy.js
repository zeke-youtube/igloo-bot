const fs = require('node:fs/promises');
const path = require('node:path');

const storePath = path.join(__dirname, 'data', 'fish-balances.json');
let balances = {};
let loaded = false;
let writeQueue = Promise.resolve();
let mutationQueue = Promise.resolve();

async function load() { if (loaded) return; try { balances = JSON.parse(await fs.readFile(storePath, 'utf8')); } catch { balances = {}; } loaded = true; }
async function persist() { writeQueue = writeQueue.then(() => fs.writeFile(storePath, `${JSON.stringify(balances, null, 2)}\n`, 'utf8')); return writeQueue; }
function validateUser(userId) { if (!userId || typeof userId !== 'string') throw new TypeError('A Discord user ID is required.'); }
function validateAmount(amount) { if (!Number.isInteger(amount) || amount < 0) throw new RangeError('Fish amounts must be non-negative whole integers.'); }

async function getFishBalance(userId) { validateUser(userId); await load(); return balances[userId] || 0; }
function mutate(task) { const next = mutationQueue.then(task, task); mutationQueue = next.catch(() => {}); return next; }
async function addFish(userId, amount) { validateUser(userId); validateAmount(amount); return mutate(async () => { await load(); const previous = balances[userId] || 0; balances[userId] = previous + amount; try { await persist(); return balances[userId]; } catch (error) { balances[userId] = previous; throw error; } }); }
async function removeFish(userId, amount) { validateUser(userId); validateAmount(amount); return mutate(async () => { await load(); const current = balances[userId] || 0; if (amount > current) throw new RangeError('Insufficient fish.'); balances[userId] = current - amount; try { await persist(); return balances[userId]; } catch (error) { balances[userId] = current; throw error; } }); }
async function transferFish(fromUserId, toUserId, amount) { validateUser(fromUserId); validateUser(toUserId); validateAmount(amount); if (amount < 1) throw new RangeError('Transfer amounts must be positive whole integers.'); if (fromUserId === toUserId) throw new RangeError('Users cannot transfer fish to themselves.'); return mutate(async () => { await load(); const senderBefore = balances[fromUserId] || 0; const recipientBefore = balances[toUserId] || 0; if (senderBefore < amount) throw new RangeError('Insufficient fish.'); balances[fromUserId] = senderBefore - amount; balances[toUserId] = recipientBefore + amount; try { await persist(); return { senderBalance: balances[fromUserId], recipientBalance: balances[toUserId] }; } catch (error) { balances[fromUserId] = senderBefore; balances[toUserId] = recipientBefore; throw error; } }); }
async function resolveGamble(userId, amount, won) { validateUser(userId); validateAmount(amount); if (amount < 1) throw new RangeError('Gamble amounts must be positive whole integers.'); return mutate(async () => { await load(); const before = balances[userId] || 0; if (before < amount) throw new RangeError('Insufficient fish.'); const after = won ? before + amount : before - amount; balances[userId] = after; try { await persist(); return { before, after, won, stake: amount }; } catch (error) { balances[userId] = before; throw error; } }); }
async function hasFish(userId, amount) { validateUser(userId); validateAmount(amount); return (await getFishBalance(userId)) >= amount; }

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

module.exports = { getFishBalance, addFish, removeFish, hasFish, transferFish, transferAvailableFish, confiscateFish, resolveGamble };
