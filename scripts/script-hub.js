const { spawnSync } = require('node:child_process');
const path = require('node:path');
const readline = require('node:readline/promises');
const commands = [
  ['generate', 'generate-question-db.js', 'Rebuild trivia database'],
  ['import-opentdb', 'import-opentdb.js', 'Import unique OpenTDB questions'],
  ['validate', 'validate-question-db.js', 'Validate trivia database'],
  ['deploy', 'deploy-commands.js', 'Deploy slash commands'],
  ['clear', 'clear-commands.js', 'Clear slash commands']
];

function run(command, args = []) { const result = spawnSync(process.execPath, [path.join(__dirname, command[1]), ...args], { stdio: 'inherit' }); process.exit(result.status ?? 1); }
async function main() {
  const direct = process.argv[2];
  if (direct) { const command = commands.find(([name]) => name === direct); if (!command) { console.error(`Unknown script: ${direct}`); process.exit(1); } return run(command, process.argv.slice(3)); }
  const terminal = readline.createInterface({ input: process.stdin, output: process.stdout });
  console.log('\n🐧 IglooBot Script Hub\n');
  commands.forEach(([name, , description], index) => console.log(`${index + 1}. ${description} (${name})`));
  console.log('0. Exit\n');
  const answer = await terminal.question('Choose a script: '); terminal.close();
  const choice = Number(answer);
  if (choice === 0) return;
  const command = commands[choice - 1];
  if (!command) { console.error('Invalid selection.'); process.exit(1); }
  if (command[0] === 'generate') { const count = await readline.createInterface({ input: process.stdin, output: process.stdout }).question('How many questions? (minimum 1000): '); return run(command, [count]); }
  return run(command);
}
main().catch((error) => { console.error(error); process.exit(1); });
