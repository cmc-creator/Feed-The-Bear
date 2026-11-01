// Runs every *.test.js in turn and keeps going past failures, so one flaky
// file can't hide the rest. Smoke runs first; the exit code is non-zero if
// any file failed. Same env vars as the tests (PW_CHANNEL, TEST_BASE).
//   node run-all.js            all tests
//   node run-all.js swipe vote only files whose name contains a word given
const fs = require('fs');
const path = require('path');
const { spawnSync } = require('child_process');

const filters = process.argv.slice(2);
const files = fs.readdirSync(__dirname)
  .filter(f => f.endsWith('.test.js'))
  .filter(f => !filters.length || filters.some(w => f.includes(w)))
  .sort((a, b) => (b === 'smoke.test.js') - (a === 'smoke.test.js') || a.localeCompare(b));

const failed = [];
const started = Date.now();
for (const f of files) {
  const t = Date.now();
  const run = spawnSync(process.execPath, [path.join(__dirname, f)], { stdio: 'inherit', timeout: 5 * 60 * 1000 });
  const secs = ((Date.now() - t) / 1000).toFixed(0);
  if (run.status !== 0) {
    failed.push(f);
    console.log(`  ✗ ${f} failed (${run.signal ? `killed: ${run.signal}` : `exit ${run.status}`}, ${secs}s)`);
  }
}

const total = ((Date.now() - started) / 1000).toFixed(0);
console.log(`\n${files.length - failed.length}/${files.length} test files passed in ${total}s`);
if (failed.length) {
  console.log(`Failed: ${failed.join(', ')}`);
  process.exit(1);
}
