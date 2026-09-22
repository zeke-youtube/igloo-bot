const fs = require('node:fs/promises');
const path = require('node:path');
const crypto = require('node:crypto');
const economy = require('./economy');
const logger = require('./utils/logger');
const storePath = path.join(__dirname, 'data', 'waddle-stats.json');
const timezone = process.env.TZ || 'Asia/Taipei';
let records = {}; let loaded = false; const locks = new Map();
async function load() { if (loaded) return; try { records = JSON.parse(await fs.readFile(storePath, 'utf8')); } catch { records = {}; } loaded = true; }
async function save() { await fs.writeFile(storePath, `${JSON.stringify(records, null, 2)}\n`, 'utf8'); }
function dateKey(date = new Date()) { return new Intl.DateTimeFormat('en-CA', { timeZone: timezone, year: 'numeric', month: '2-digit', day: '2-digit' }).format(date); }
function dayDistance(a, b) { return Math.round((Date.parse(`${b}T00:00:00Z`) - Date.parse(`${a}T00:00:00Z`)) / 86400000); }
function withLock(id, task) { const previous = locks.get(id) || Promise.resolve(); const current = previous.then(task, task); locks.set(id, current); current.finally(() => { if (locks.get(id) === current) locks.delete(id); }).catch(() => {}); return current; }
function normalize(record) { const value = { lastWaddleDate: null, currentStreak: 0, longestStreak: 0, totalWaddles: 0, ...(record || {}) }; value.history = [...new Set((Array.isArray(value.history) ? value.history : []).filter((d) => /^\d{4}-\d{2}-\d{2}$/.test(d)))].sort(); return value; }
async function getWaddleStats(id) { await load(); return normalize(records[id]); }
async function claimWaddle(id) { return withLock(id, async () => { await load(); const today = dateKey(); const old = normalize(records[id]); if (old.lastWaddleDate === today || old.history.includes(today)) return { alreadyClaimed: true, stats: old }; const streak = old.lastWaddleDate && dayDistance(old.lastWaddleDate, today) === 1 ? old.currentStreak + 1 : 1; const reward = crypto.randomInt(10, 31); const stats = { ...old, lastWaddleDate: today, currentStreak: streak, longestStreak: Math.max(old.longestStreak, streak), totalWaddles: old.totalWaddles + 1, history: [...old.history, today].sort() }; let added = false; try { const balance = await economy.addFish(id, reward); added = true; records[id] = stats; await save(); return { alreadyClaimed: false, reward, balance, stats }; } catch (error) { if (added) await economy.removeFish(id, reward).catch((e) => logger.error(`CRITICAL waddle rollback failed for ${id}`, e)); records[id] = old; logger.error(`Waddle claim failed for ${id}`, error); throw error; } }); }
module.exports = { claimWaddle, getWaddleStats, dateKey, timezone };
