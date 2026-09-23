const fs = require('node:fs');
const path = require('node:path');
const out = path.join(__dirname, '..', 'src', 'data', 'questions.json');
const existing = JSON.parse(fs.readFileSync(out, 'utf8'));
const questions = []; const ids = new Set(); for (const question of existing) if (!ids.has(question.id)) { ids.add(question.id); question.answers = [...new Set(question.answers.map((answer) => String(answer).normalize('NFKC').trim().toLowerCase().replace(/\s+/g, ' ')))]; questions.push(question); }
const add = (category, id, question, answers) => { if (!ids.has(id)) { ids.add(id); questions.push({ id, question, answers: answers.map(String), reward: 100, category }); } };
for (let a = 1; a <= 100; a++) add('Mathematics', `addition-${a}`, `What is ${a} + ${a}?`, [a + a]);
for (let n = 1; n <= 100; n++) add('Mathematics', `square-${n}`, `What is ${n} squared?`, [n * n]);
for (let n = 1; n <= 100; n++) add('Geometry', `square-area-${n}`, `What is the area of a square with side length ${n}?`, [n * n]);
for (let n = 1; n <= 100; n++) add('Geometry', `rectangle-area-${n}`, `What is the area of a rectangle with length ${n} and width 2?`, [n * 2]);
for (let n = 1; n <= 100; n++) add('Computer Science', `binary-${n}`, `What is the binary representation of decimal ${n}?`, [n.toString(2)]);
for (let n = 1; n <= 100; n++) add('Computer Science', `hex-${n}`, `What is the hexadecimal representation of decimal ${n}?`, [`${n.toString(16).toUpperCase()}`]);
for (let n = 1; n <= 100; n++) add('Programming', `power-two-${n}`, `What is 2 to the power of ${n}?`, [2 ** n]);
for (let n = 1; n <= 100; n++) add('Mathematics', `cube-${n}`, `What is the cube of ${n}?`, [n ** 3]);
for (let n = 1; n <= 100; n++) add('Language', `roman-${n}`, `How is the number ${n} written using Roman numerals?`, [toRoman(n)]);
for (let n = 1; n <= 100; n++) add('Science', `even-${n}`, `Is ${n * 2} an even number or an odd number?`, ['even']);
fs.writeFileSync(out, `${JSON.stringify(questions, null, 2)}\n`);
function toRoman(n) { const values = [[1000,'M'],[900,'CM'],[500,'D'],[400,'CD'],[100,'C'],[90,'XC'],[50,'L'],[40,'XL'],[10,'X'],[9,'IX'],[5,'V'],[4,'IV'],[1,'I']]; let result = ''; for (const [value, symbol] of values) while (n >= value) { result += symbol; n -= value; } return result; }
console.log(`Generated ${questions.length} questions at ${out}`);
