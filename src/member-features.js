const fs = require('node:fs/promises');
const path = require('node:path');
const file = path.join(__dirname, 'data', 'member-features.json');
let state = { timezones: {}, pengwater: {}, chess: { games: {}, stats: {} }, monitors: {}, botClosed: false };
let loaded = false, queue = Promise.resolve();
async function load() { if (loaded) return; try { state = { ...state, ...JSON.parse(await fs.readFile(file, 'utf8')) }; } catch {} state.timezones ||= {}; state.pengwater ||= {}; state.chess ||= { games: {}, stats: {} }; state.chess.games ||= {}; state.chess.stats ||= {}; state.monitors ||= {}; loaded = true; }
async function save() { await fs.mkdir(path.dirname(file), { recursive: true }); const tmp = `${file}.tmp`; await fs.writeFile(tmp, `${JSON.stringify(state, null, 2)}\n`); await fs.rename(tmp, file); }
function mutate(fn) { const next = queue.then(async () => { await load(); const out = await fn(state); await save(); return out; }); queue = next.catch(() => {}); return next; }
async function read(fn) { await queue; await load(); return fn(state); }
module.exports = { read, mutate };
