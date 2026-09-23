const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const { spawnSync } = require('node:child_process');

const output = path.join(__dirname, '..', 'src', 'questions.json');
const temporary = `${output}.tmp`;
const requested = Number(process.argv[2] || 5000);
const delayMs = 5000;
const blocked = /politic|religion|religious|adult|nsfw|porn|sexual|graphic|gore/i;
const normalize = (value) => String(value).normalize('NFKC').trim().toLocaleLowerCase('en-US').replace(/\s+/g, ' ');
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
function decode(value) { return String(value).replace(/&quot;/g, '"').replace(/&#039;|&apos;/g, "'").replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&#(\d+);/g, (_, n) => String.fromCodePoint(Number(n))); }
async function getJson(url) { const response = await fetch(url); if (!response.ok) throw new Error(`OpenTDB HTTP ${response.status}`); return response.json(); }
async function token() { const data = await getJson('https://opentdb.com/api_token.php?command=request'); if (data.response_code !== 0) throw new Error(`OpenTDB token request failed with response code ${data.response_code}`); return data.token; }
async function main() {
  if (!Number.isInteger(requested) || requested < 1) throw new Error('Usage: node scripts/import-opentdb.js <maximum questions to fetch>');
  let existing = []; try { if (fs.existsSync(output) && fs.statSync(output).size > 0) existing = JSON.parse(fs.readFileSync(output, 'utf8')); } catch (error) { console.warn(`Existing questions.json is invalid; importing without it: ${error.message}`); }
  const validExisting = existing.filter((q) => q && typeof q.id === 'string' && typeof q.question === 'string' && Array.isArray(q.answers) && q.answers.length && q.answers.every(Boolean));
  const questions = []; const ids = new Set(); const texts = new Set();
  for (const q of validExisting) { const text = normalize(q.question); if (!ids.has(q.id) && !texts.has(text)) { ids.add(q.id); texts.add(text); questions.push(q); } }
  const stats = { existing: questions.length, fetched: 0, accepted: 0, duplicates: 0, filtered: 0, malformed: 0 };
  let session = await token(); let fetched = 0; let stop = false;
  while (fetched < requested && !stop) {
    const batch = Math.min(50, requested - fetched); const data = await getJson(`https://opentdb.com/api.php?amount=${batch}&encode=url3986&token=${encodeURIComponent(session)}`); const code = Number(data.response_code);
    if (code === 3) { session = await token(); continue; }
    if (code === 4 || code === 1) break;
    if (code === 5) { console.warn('OpenTDB rate limited; stopping cleanly.'); break; }
    if (code === 2) throw new Error('OpenTDB rejected the request parameters.');
    if (code !== 0 || !Array.isArray(data.results)) throw new Error(`Unexpected OpenTDB response code ${code}`);
    for (const item of data.results) {
      fetched += 1; stats.fetched += 1; const question = decode(decodeURIComponent(item.question)); const correct = decode(decodeURIComponent(item.correct_answer)); const category = decode(decodeURIComponent(item.category || 'OpenTDB')); const text = normalize(question); const answer = normalize(correct);
      if (!question || !answer || !text || !item.type || blocked.test(category) || blocked.test(question)) { stats.filtered += 1; continue; }
      if (ids.has(`opentdb-${crypto.createHash('sha256').update(text).digest('hex').slice(0, 16)}`) || texts.has(text)) { stats.duplicates += 1; continue; }
      const id = `opentdb-${crypto.createHash('sha256').update(text).digest('hex').slice(0, 16)}`; ids.add(id); texts.add(text); questions.push({ id, question, answers: [correct], reward: 100, category, difficulty: item.difficulty, source: 'OpenTDB' }); stats.accepted += 1;
    }
    if (fetched < requested) await sleep(delayMs);
  }
  fs.writeFileSync(temporary, `${JSON.stringify(questions, null, 2)}\n`, 'utf8'); const check = spawnSync(process.execPath, [path.join(__dirname, 'validate-question-db.js'), temporary], { stdio: 'inherit' }); if (check.status !== 0) { fs.rmSync(temporary, { force: true }); throw new Error('Validation failed; existing questions.json was preserved.'); } fs.renameSync(temporary, output);
  const categories = {}; const difficulty = {}; for (const q of questions) { categories[q.category || 'Uncategorized'] = (categories[q.category || 'Uncategorized'] || 0) + 1; if (q.difficulty) difficulty[q.difficulty] = (difficulty[q.difficulty] || 0) + 1; }
  console.log(JSON.stringify({ existingValid: stats.existing, opentdbFetched: stats.fetched, opentdbAccepted: stats.accepted, duplicatesRemoved: stats.duplicates, filtered: stats.filtered, malformed: stats.malformed, uniqueFinal: questions.length, categories, difficulty }, null, 2));
}
main().catch((error) => { fs.rmSync(temporary, { force: true }); console.error(`OpenTDB import failed: ${error.message}`); process.exitCode = 1; });
