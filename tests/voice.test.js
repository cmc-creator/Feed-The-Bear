// Voice: the search-bar mic searches (or adds with "add …"), shows readable
// errors, cancels cleanly; Byte Cub's chat mic sends what you say. A fake
// SpeechRecognition stands in for the browser's.
const { BASE, check, launch, newPage, closeAllDialogs, finish } = require('./lib');

const FAKE = () => {
  window.__recs = [];
  window.webkitSpeechRecognition = class {
    constructor () { window.__recs.push(this); this.aborted = false; }
    start () {}
    stop () { this.onend && this.onend(); }
    abort () { this.aborted = true; this.onerror && this.onerror({ error: 'aborted' }); this.onend && this.onend(); }
  };
  window.SpeechRecognition = window.webkitSpeechRecognition;
  window.__say = (text) => {
    const r = window.__recs[window.__recs.length - 1];
    const res = [[{ transcript: text }]]; res[0].isFinal = true;
    r.onresult({ results: res });
    r.onend && r.onend();
  };
  window.__fail = (error) => { const r = window.__recs[window.__recs.length - 1]; r.onerror({ error }); r.onend && r.onend(); };
};

(async () => {
  const browser = await launch();
  const p = await newPage(browser, { seed: [
    { id: 'r', name: 'Ramen Tatsu', cuisine: 'Japanese', status: 'want-to-try', tags: [], visits: [], dishes: [] },
    { id: 't', name: 'Tacos Chiwas', cuisine: 'Mexican', status: 'want-to-try', tags: [], visits: [], dishes: [] },
  ] });
  await p.addInitScript(FAKE);
  await p.route(/overpass|nominatim|open-meteo|place-info/, r => r.abort());
  await p.goto(`${BASE}/app.html`);
  await p.waitForTimeout(1800);
  await closeAllDialogs(p);

  check(await p.locator('#search-voice-btn').isVisible(), 'search mic shows when the browser can listen');
  await p.click('#search-voice-btn');
  check(await p.locator('#voice-overlay').isVisible(), 'tapping it shows the listening card');
  await p.evaluate(() => __say('ramen.'));
  await p.waitForTimeout(300);
  check(await p.inputValue('#search-input') === 'ramen', 'what you say goes in the search box');
  check(!(await p.locator('#voice-overlay').isVisible()), 'the card closes');
  check(!(await p.locator('#add-modal:not(.hidden), #add-modal[open]').count()), 'it does not open the Add form for a search');

  // "add …" still adds.
  await p.fill('#search-input', '');
  await p.click('#search-voice-btn');
  await p.evaluate(() => __say('add Nobu on 105 Hudson Street'));
  await p.waitForTimeout(400);
  check(await p.inputValue('#form-name') === 'Nobu', '"add Nobu" opens Add with the name');
  check(await p.inputValue('#form-address') === '105 Hudson Street', 'and the address');
  await closeAllDialogs(p);

  // Blocked mic: readable message that stays up.
  await p.click('#search-voice-btn');
  await p.evaluate(() => __fail('not-allowed'));
  await p.waitForTimeout(300);
  check(await p.locator('#voice-overlay').isVisible(), 'error card stays up to read');
  check(/Microphone blocked/.test(await p.locator('#voice-status').innerText()), 'and says the mic is blocked');
  await p.waitForTimeout(2700);
  check(!(await p.locator('#voice-overlay').isVisible()), 'then closes');

  // Cancel throws away anything heard.
  await p.click('#search-voice-btn');
  await p.click('#voice-cancel-btn');
  check(await p.evaluate(() => __recs[__recs.length - 1].aborted), 'cancel aborts listening');
  check(!(await p.locator('#voice-overlay').isVisible()), 'and closes the card');

  // Byte Cub's mic sends what you say.
  await p.evaluate(() => openChat());
  await p.waitForTimeout(300);
  check(await p.locator('#chat-mic-btn').isVisible(), 'Byte Cub chat has a mic');
  await p.click('#chat-mic-btn');
  check(await p.locator('#chat-mic-btn.listening').count() === 1, 'it shows it is listening');
  await p.evaluate(() => __say('show my want to try'));
  await p.waitForTimeout(700);
  check(/show my want to try/.test(await p.locator('#chat-messages').innerText()), 'what you say is sent to Byte Cub');
  check(!(await p.locator('#chat-mic-btn.listening').count()), 'and it stops listening');
  await p.close();

  // No speech recognition (Android app web view): both mics hidden.
  const q = await newPage(browser, {});
  await q.addInitScript(() => { window.SpeechRecognition = undefined; window.webkitSpeechRecognition = undefined; });
  await q.route(/overpass|nominatim|open-meteo|place-info/, r => r.abort());
  await q.goto(`${BASE}/app.html`);
  await q.waitForTimeout(1800);
  check(!(await q.locator('#search-voice-btn').isVisible()), 'no search mic where voice is unsupported');
  check(await q.locator('#chat-mic-btn.hidden').count() === 1, 'no chat mic either');

  check(!p.errors.length && !q.errors.length, `no page errors ${[...p.errors, ...q.errors].join(' | ')}`);
  await browser.close();
  finish('voice');
})();
