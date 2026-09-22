const fs = require('node:fs/promises');
const path = require('node:path');
const crypto = require('node:crypto');
const economy = require('./economy');
const logger = require('./utils/logger');

const storePath = path.join(__dirname, 'data', 'waddle-stats.json');
const timezone = process.env.TZ || 'Asia/Taipei';
let records = {};
let loaded = false;
const locks = new Map();

async function load() { if (loaded) return; try { records = JSON.parse(await fs.readFile(storePath, 'utf8')); } catch { records = {}; } loaded = true; }
async function save() { await fs.writeFile(storePath, `${JSON.stringify(records, null, 2)}\n`, 'utf8'); }
function dateKey(date = new Date()) { return new Intl.DateTimeFormat('en-CA', { timeZone: timezone, year: 'numeric', month: '2-digit', day: '2-digit' }).format(date); }
function dayDistance(left, right) { const a = Date.parse(`${left}T00:00:00Z`); const b = Date.parse(`${right}T00:00:00Z`); return Math.round((b - a) / 86400000); }
function withLock(userId, task) { const previous = locks.get(userId) || Promise.resolve(); const current = previous.then(task, task); locks.set(userId, current); current.finally(() => { if (locks.get(userId) === current) locks.delete(userId); }).catch(() => {}); return current; }
function defaults() { return { lastWaddleDate: null, currentStreak: 0, longestStreak: 0, totalWaddles: 0 }; }
async function getWaddleStats(userId) { await load(); return { ...defaults(), ...(records[userId] || {}) }; }
async function claimWaddle(userId) { return withLock(userId, async () => { await load(); const today = dateKey(); const previous = { ...defaults(), ...(records[userId] || {}) }; if (previous.lastWaddleDate === today) return { alreadyClaimed: true, stats: previous }; const streak = previous.lastWaddleDate && dayDistance(previous.lastWaddleDate, today) === 1 ? previous.currentStreak + 1 : 1; const reward = crypto.randomInt(10, 31); const stats = { lastWaddleDate: today, currentStreak: streak, longestStreak: Math.max(previous.longestStreak, streak), totalWaddles: previous.totalWaddles + 1 }; let fishAdded = false; try { const balance = await economy.addFish(userId, reward); fishAdded = true; records[userId] = stats; await save(); return { alreadyClaimed: false, reward, balance, stats }; } catch (error) { if (fishAdded) await economy.removeFish(userId, reward).catch((rollbackError) => logger.error(`CRITICAL waddle rollback failed for ${userId}`, rollbackError)); records[userId] = previous; logger.error(`Waddle claim failed for ${userId}`, error); throw error; } }); }
module.exports = { claimWaddle, getWaddleStats, dateKey };
