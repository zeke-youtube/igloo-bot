const fs = require('node:fs');
const path = require('node:path');
const { spawnSync } = require('node:child_process');

const roots = [path.join(__dirname, '..', 'src'), __dirname];
const files = [];
function collect(directory) {
  for (const entry of fs.readdirSync(directory, { withFileTypes: true })) {
    const full = path.join(directory, entry.name);
    if (entry.isDirectory() && entry.name !== 'data') collect(full);
    else if (entry.isFile() && full.endsWith('.js')) files.push(full);
  }
}
for (const root of roots) collect(root);

let failed = 0;
for (const file of [...new Set(files)]) {
  const result = spawnSync(process.execPath, ['--check', file], { encoding: 'utf8' });
  if (result.status !== 0) {
    failed += 1;
    process.stderr.write(result.stderr || `Syntax error in ${file}\n`);
  }
}
if (failed) {
  console.error(`Typecheck failed: ${failed} JavaScript file${failed === 1 ? '' : 's'} need attention.`);
  process.exit(1);
}
console.log(`Typecheck passed: ${new Set(files).size} JavaScript files checked.`);
