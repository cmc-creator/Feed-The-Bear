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

  // Android app: no browser speech, so both mics use the phone's (SpeechPlugin).
  const a = await newPage(browser, {});
  await a.addInitScript(() => {
    window.SpeechRecognition = undefined; window.webkitSpeechRecognition = undefined;
    delete Navigator.prototype.share; // like Android's web view
    window.__speech = { listeners: {}, starts: 0, aborts: 0 };
    window.Capacitor = { isNativePlatform: () => true, isPluginAvailable: () => true, Plugins: {
      Speech: {
        addListener: async (ev, fn) => { __speech.listeners[ev] = fn; return { remove: () => { delete __speech.listeners[ev]; } }; },
        start: () => { __speech.starts++; return new Promise((res, rej) => { __speech.finish = res; __speech.fail = rej; }); },
        stop: async () => {}, abort: async () => { __speech.aborts++; },
      },
      PlayBilling: { checkoutToken: async () => (window.__billing || { token: 'TOK' }) },
      ShareSheet: { share: async o => { window.__shared = o; } },
    } };
  });
  await a.route(/overpass|nominatim|open-meteo|place-info/, r => r.abort());
  await a.goto(`${BASE}/app.html`);
  await a.waitForTimeout(1800);
  await closeAllDialogs(a);
  check(await a.locator('#search-voice-btn').isVisible(), 'Android app: the search mic shows');
  await a.click('#search-voice-btn');
  await a.waitForTimeout(200);
  await a.evaluate(() => __speech.listeners.partial?.({ text: 'pi' }));
  check(/pi/.test(await a.locator('#voice-transcript').innerText()), 'words show as you speak');
  await a.evaluate(() => __speech.finish({ text: 'pizza' }));
  await a.waitForTimeout(300);
  check(await a.inputValue('#search-input') === 'pizza', 'and it searches what you said');
  await a.click('#search-voice-btn');
  await a.waitForTimeout(200);
  await a.evaluate(() => __speech.fail(Object.assign(new Error('not-allowed'), { code: 'not-allowed' })));
  await a.waitForTimeout(200);
  check(/Microphone blocked/.test(await a.locator('#voice-status').innerText()), 'a refused microphone says so');
  await a.waitForTimeout(2700);
  await a.evaluate(() => openChat());
  await a.waitForTimeout(300);
  check(await a.locator('#chat-mic-btn').isVisible(), 'Android app: Byte Cub has a mic');
  await a.click('#chat-mic-btn');
  await a.waitForTimeout(200);
  await a.evaluate(() => __speech.finish({ text: 'show my want to try' }));
  await a.waitForTimeout(700);
  check(/show my want to try/.test(await a.locator('#chat-messages').innerText()), 'and what you say is sent');
  // Share and Invite buttons use the phone's share sheet (the web view has none).
  await a.evaluate(() => navigator.share({ title: 'Feed the Bear', text: 'Follow me', url: 'https://www.feed-the-bear.com/invite.html' }));
  check(await a.evaluate(() => window.__shared?.url === 'https://www.feed-the-bear.com/invite.html' && window.__shared.text === 'Follow me'), 'Android app: Share opens the phone share sheet');

  // Checkout in the Play app gets Google's token; backing out of Google's notice stops it.
  check(await a.evaluate(() => _playBillingToken()) === 'TOK', 'Play checkout gets the reporting token');
  check(await a.evaluate(() => { window.Capacitor.Plugins.PlayBilling.checkoutToken = async () => { throw Object.assign(new Error('canceled'), { code: 'canceled' }); }; return _playBillingToken(); }) === false, "backing out of Google's notice stops checkout");
  check(await a.evaluate(() => { window.Capacitor.Plugins.PlayBilling.checkoutToken = async () => ({ unavailable: true }); return _playBillingToken(); }) === '', 'not from Play: checkout goes ahead without a token');

  check(!p.errors.length && !q.errors.length && !a.errors.length, `no page errors ${[...p.errors, ...q.errors, ...a.errors].join(' | ')}`);
  await browser.close();
  finish('voice');
})();
