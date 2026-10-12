const { randomInt } = require('node:crypto');
const WORDS = ['FISH', 'WADDLE', 'IGLOO', 'SALMON', 'ICEBERG'];
const MEMORY = ['🍎', '⭐', '🌙', '🎈', '🧊', '🍀'];
function createTask() {
  const type = randomInt(3);
  if (type === 0) { const a = randomInt(10, 50), b = randomInt(10, 50); return { type: 'QUICK MATH', prompt: `${a} + ${b} = ?`, answer: String(a + b) }; }
  if (type === 1) { const sequence = Array.from({ length: 4 }, () => MEMORY[randomInt(MEMORY.length)]); return { type: 'MEMORY', prompt: `Remember this sequence, then enter it in order:\n\n${sequence.join(' ')}`, answer: sequence.join('') }; }
  const word = WORDS[randomInt(WORDS.length)], scrambled = word.split('');
  for (let i = scrambled.length - 1; i > 0; i--) { const j = randomInt(i + 1); [scrambled[i], scrambled[j]] = [scrambled[j], scrambled[i]]; }
  if (scrambled.join('') === word) scrambled.reverse();
  return { type: 'UNSCRAMBLE', prompt: `Put these letters in order:\n\n${scrambled.join('')}`, answer: word };
}
function isCorrect(task, answer) { return String(answer).replace(/\s+/g, '').toUpperCase() === task.answer.replace(/\s+/g, '').toUpperCase(); }
module.exports = { createTask, isCorrect, WORDS };
