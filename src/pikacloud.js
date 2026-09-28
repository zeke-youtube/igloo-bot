const fs = require('node:fs');
const fsp = require('node:fs/promises');
const path = require('node:path');
const { pipeline } = require('node:stream/promises');
const http = require('node:http');
const https = require('node:https');
const economy = require('./economy');
const config = require('./config');
const logger = require('./utils/logger');

const PLANS = Object.freeze({
  tiny: { name: 'Tiny Igloo', bytes: 10 * 1024 ** 2, price: 100, transfer: 100 * 1024 ** 2 },
  small: { name: 'Small Igloo', bytes: 100 * 1024 ** 2, price: 500, transfer: 1024 ** 3 },
  big: { name: 'Big Igloo', bytes: 1024 ** 3, price: 2000, transfer: 10 * 1024 ** 3 },
  vault: { name: 'Penguin Vault', bytes: 2 * 1024 ** 3, price: 3500, transfer: 20 * 1024 ** 3 }
});
const GRACE_MS = 7 * 24 * 60 * 60 * 1000;
const PERIOD_MS = 30 * 24 * 60 * 60 * 1000;
const MAX_ALLOCATED = 100 * 1024 ** 3;
const statePath = path.join(__dirname, 'data', 'pikacloud.json');
const root = () => path.resolve(config.pikaCloudStorageDir());
let state = { subscriptions: {}, files: {} };
let loaded = false;
let queue = Promise.resolve();

async function load() { if (loaded) return; try { state = JSON.parse(await fsp.readFile(statePath, 'utf8')); } catch { state = { subscriptions: {}, files: {} }; } state.subscriptions ||= {}; state.files ||= {}; loaded = true; await fsp.mkdir(root(), { recursive: true }); }
async function save() { await fsp.mkdir(path.dirname(statePath), { recursive: true }); const tmp = `${statePath}.tmp`; await fsp.writeFile(tmp, `${JSON.stringify(state, null, 2)}\n`); await fsp.rename(tmp, statePath); }
function mutate(fn) { const next = queue.then(async () => { await load(); return fn(); }); queue = next.catch(() => {}); return next; }
function plan(key) { return PLANS[key]; }
function fmt(bytes) { if (bytes >= 1024 ** 3) return `${(bytes / 1024 ** 3).toFixed(2)} GB`; return `${(bytes / 1024 ** 2).toFixed(bytes % (1024 ** 2) ? 2 : 0)} MB`; }
function userDir(id) { return path.join(root(), Buffer.from(String(id)).toString('hex')); }
function used(id) { return (state.files[id] || []).reduce((n, f) => n + f.size, 0); }
function allocated(exclude) { return Object.entries(state.subscriptions).reduce((n, [id, s]) => n + (id === exclude ? 0 : (plan(s.plan)?.bytes || 0)), 0); }
function subscriptionActive(s, now = Date.now()) { return s && s.status === 'active' && s.expiresAt > now; }
function cleanName(input) { const name = path.basename(String(input || '')).normalize('NFC'); if (!name || name === '.' || name === '..' || /[\\/\0]/.test(name) || name.length > 180) throw new Error('Invalid filename.'); return name; }
function ensureNames(list, name) { if (list.some(f => f.name === name)) throw new Error('A file with that name already exists. Delete it first or choose a different filename.'); }

async function plans() { await load(); return PLANS; }
async function buy(id, key) { return mutate(async () => { const p = plan(key); if (!p) throw new Error('Unknown plan.'); if (state.subscriptions[id] && state.subscriptions[id].status !== 'deleted') throw new Error('You already have a PikaCloud plan.'); if (allocated() + p.bytes > MAX_ALLOCATED) throw new Error('PikaCloud has no remaining allocated capacity for that plan.'); await economy.removeFish(id, p.price); const now = Date.now(); state.subscriptions[id] = { plan: key, status: 'active', startedAt: now, expiresAt: now + PERIOD_MS, renewalPrice: p.price, transferUsed: 0, transferPeriodStartedAt: now, autoRenew: true }; state.files[id] ||= []; await save(); return state.subscriptions[id]; }); }
async function getInfo(id) { await load(); const s = state.subscriptions[id]; return { subscription: s, plan: s && plan(s.plan), used: used(id), balance: await economy.getFishBalance(id), files: state.files[id] || [] }; }
async function beginUpload(id, attachment) { return mutate(async () => { const s = state.subscriptions[id]; if (!subscriptionActive(s)) throw new Error(s?.status === 'grace' ? 'Uploads are disabled during the grace period.' : 'You need an active PikaCloud subscription.'); const p = plan(s.plan); const size = Number(attachment.size); if (!Number.isSafeInteger(size) || size < 0 || size > p.bytes - used(id)) throw new Error('That file would exceed your storage quota.'); if (s.transferUsed + size > p.transfer) throw new Error('Your monthly transfer allowance is exhausted.'); const name = cleanName(attachment.name); const files = state.files[id] || []; ensureNames(files, name); const dir = userDir(id); await fsp.mkdir(dir, { recursive: true }); const target = path.join(dir, `${Date.now()}-${Math.random().toString(36).slice(2)}.part`); const resolved = path.resolve(target); if (!resolved.startsWith(`${path.resolve(dir)}${path.sep}`)) throw new Error('Unsafe storage path.'); return { s, p, name, size, files, dir, target }; }); }
async function finishUpload(id, ctx) { return mutate(async () => { const actual = (await fsp.stat(ctx.target)).size; const current = state.subscriptions[id]; if (actual !== ctx.size || actual > ctx.p.bytes - used(id) || current.transferUsed + actual > ctx.p.transfer || (state.files[id] || []).some(f => f.name === ctx.name)) { await fsp.rm(ctx.target, { force: true }); throw new Error('Upload no longer fits the quota, transfer allowance, or filename policy.'); } const final = path.join(ctx.dir, `${Date.now()}-${Math.random().toString(36).slice(2)}.data`); await fsp.rename(ctx.target, final); const rec = { name: ctx.name, size: actual, uploadedAt: Date.now(), file: path.basename(final) }; state.files[id] ||= []; state.files[id].push(rec); state.subscriptions[id].transferUsed += actual; await save(); return rec; }); }
async function failUpload(target) { await fsp.rm(target, { force: true }).catch(() => {}); }
async function list(id) { await load(); return state.files[id] || []; }
async function filePath(id, name) { await load(); const rec = (state.files[id] || []).find(f => f.name === name); if (!rec) throw new Error('File not found.'); const dir = userDir(id); const full = path.resolve(dir, rec.file); if (!full.startsWith(`${path.resolve(dir)}${path.sep}`)) throw new Error('Unsafe file path.'); const st = await fsp.lstat(full); if (!st.isFile() || st.isSymbolicLink()) throw new Error('Stored file is unavailable.'); return { rec, full }; }
async function deleteFile(id, name) { return mutate(async () => { const { rec, full } = await filePath(id, name); await fsp.unlink(full); state.files[id] = (state.files[id] || []).filter(f => f !== rec); await save(); return rec; }); }
async function consumeTransfer(id, bytes) { return mutate(async () => { const s = state.subscriptions[id]; if (!s || !['active', 'grace'].includes(s.status) || s.transferUsed + bytes > plan(s.plan).transfer) throw new Error('Your monthly transfer allowance is exhausted or subscription is not active.'); s.transferUsed += bytes; await save(); }); }
async function billing() { return mutate(async () => { const now = Date.now(); for (const [id, s] of Object.entries(state.subscriptions)) { if (s.status === 'active' && s.expiresAt <= now) { if (s.autoRenew) { try { await economy.removeFish(id, s.renewalPrice); s.expiresAt += PERIOD_MS; s.transferUsed = 0; s.transferPeriodStartedAt = now; } catch { s.status = 'grace'; s.graceUntil = now + GRACE_MS; } } else s.status = 'expired'; } if (s.status === 'grace' && s.graceUntil <= now) { for (const f of state.files[id] || []) await fsp.rm(path.join(userDir(id), f.file), { force: true }).catch(() => {}); await fsp.rm(userDir(id), { recursive: true, force: true }).catch(() => {}); delete state.files[id]; delete state.subscriptions[id]; logger.info(`PikaCloud cleanup completed for account ${id}.`); } } await save(); }); }
async function renew(id) { return mutate(async () => { const s = state.subscriptions[id]; if (!s || !['grace', 'active'].includes(s.status)) throw new Error('There is no renewable subscription.'); await economy.removeFish(id, s.renewalPrice); const now = Date.now(); s.status = 'active'; s.expiresAt = Math.max(s.expiresAt, now) + PERIOD_MS; s.graceUntil = null; s.transferUsed = 0; s.transferPeriodStartedAt = now; await save(); return s; }); }
async function cancel(id) { return mutate(async () => { const s = state.subscriptions[id]; if (!s) throw new Error('No subscription found.'); s.autoRenew = false; await save(); return s; }); }
async function adminStatus() { await load(); return { allocated: allocated(), actual: Object.values(state.files).flat().reduce((n, f) => n + f.size, 0), active: Object.values(state.subscriptions).filter(s => s.status === 'active').length, grace: Object.values(state.subscriptions).filter(s => s.status === 'grace').length }; }
function downloadStream(url) { return new Promise((resolve, reject) => { const client = url.startsWith('https:') ? https : http; const req = client.get(url, { headers: { 'User-Agent': 'IglooBot-PikaCloud/1.0' } }, res => { if (res.statusCode >= 300 && res.statusCode < 400 && res.headers.location) return downloadStream(res.headers.location).then(resolve, reject); if (res.statusCode !== 200) return reject(new Error(`Discord download failed (${res.statusCode}).`)); resolve(res); }); req.on('error', reject); }); }
module.exports = { PLANS, MAX_ALLOCATED, GRACE_MS, fmt, plans, buy, getInfo, beginUpload, finishUpload, failUpload, list, filePath, deleteFile, consumeTransfer, billing, renew, cancel, adminStatus, downloadStream, subscriptionActive };
