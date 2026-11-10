// The app knows which version it is (APP_BUILD in app.js) and compares it with
// the live sw.js to refresh itself, so the two must always match.
const fs = require('fs');
const path = require('path');
const { check, finish } = require('./lib');
const root = path.join(__dirname, '..');
const sw = (fs.readFileSync(path.join(root, 'sw.js'), 'utf8').match(/const CACHE\s*=\s*'(ftb-v\d+)'/) || [])[1];
const app = (fs.readFileSync(path.join(root, 'app.js'), 'utf8').match(/const APP_BUILD = '(ftb-v\d+)'/) || [])[1];
check(sw && app && sw === app, `APP_BUILD in app.js matches CACHE in sw.js (${app} / ${sw})`);
finish('version');
