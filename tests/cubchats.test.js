// Byte Cub keeps your chats: reopen the app and your last chat is there,
// start a new one, and pick any past chat up again from "Past chats".
const { BASE, check, launch, newPage, finish } = require('./lib');

const SEED = [{ id: 'm1', name: 'Pizzeria Bianco', cuisine: 'Pizza', status: 'visited', myRating: 5, tags: [], dateAdded: '2026-09-05', visits: [] }];

(async () => {
  const browser = await launch();
  const p = await newPage(browser, { seed: SEED });
  await p.route(/overpass|nominatim|place-info|open-meteo/, r => r.abort());
  const saved = [];
  const server = {};
  await p.route('**/api/chats**', route => {
    const req = route.request();
    const url = new URL(req.url());
    if (req.method() === 'POST') {
      const b = JSON.parse(req.postData());
      saved.push(b);
      if (b.action === 'delete') delete server[b.id]; else server[b.id] = { ...b, updatedAt: Date.now() };
      return route.fulfill({ json: { ok: true } });
    }
    const id = url.searchParams.get('id');
    if (id) return route.fulfill({ json: { chat: { id, title: server[id].title, updatedAt: server[id].updatedAt, messages: server[id].messages } } });
    return route.fulfill({ json: { chats: Object.values(server).map(c => ({ id: c.id, title: c.title, updatedAt: c.updatedAt, count: c.messages.length })) } });
  });
  await p.goto(`${BASE}/app.html`);
  await p.waitForTimeout(1500);
  await p.evaluate(() => { window._ftbUid = 'user0000001'; window.AI.hasAccess = () => false; openChat(); });
  await p.fill('#chat-input', 'what is my top rated spot?');
  await p.press('#chat-input', 'Enter');
  await p.waitForTimeout(2200);
  check(saved.some(b => b.messages?.some(m => m.r === 'u' && /top rated/.test(m.t))), 'the chat is saved to your account');
  const before = await p.locator('#chat-messages .chat-msg').count();

  // Reopen the app: the chat is still there.
  await p.reload();
  await p.waitForTimeout(1500);
  await p.evaluate(() => { window._ftbUid = 'user0000001'; window.AI.hasAccess = () => false; openChat(); });
  await p.waitForTimeout(300);
  const text = await p.locator('#chat-messages').innerText();
  check(/top rated/.test(text), 'reopening the app, your last chat is still there');
  check(await p.locator('#chat-messages .chat-msg').count() >= before - 1, 'with its replies');
  check(await p.evaluate(() => _cubChatHistory.some(m => m.role === 'user' && /top rated/.test(m.text))), 'and Byte Cub remembers it for his next answer');

  // New chat starts fresh.
  await p.click('#chat-new-btn');
  await p.waitForTimeout(300);
  check(!/top rated/.test(await p.locator('#chat-messages').innerText()) && await p.locator('#chat-messages .chat-msg').count() === 1, 'New chat starts fresh with a hello');
  check(await p.evaluate(() => _cubChatHistory.length) === 0, "and Byte Cub doesn't carry the old chat into it");
  await p.fill('#chat-input', 'show my want to try');
  await p.press('#chat-input', 'Enter');
  await p.waitForTimeout(800);
  await p.evaluate(() => { if (document.getElementById('chat-panel').classList.contains('hidden')) openChat(); });

  // Past chats lists both; open the first one again.
  await p.click('#chat-history-btn');
  await p.waitForTimeout(500);
  check(await p.locator('#chat-history').isVisible(), 'Past chats opens');
  const rows = await p.locator('.chat-history-row').allInnerTexts();
  check(rows.length === 2 && rows.some(r => /top rated/.test(r)) && rows.some(r => /want to try/.test(r)), `both chats are listed (${rows.join(' | ').replace(/\n/g, ' ')})`);
  await p.locator('.chat-history-open', { hasText: 'top rated' }).click();
  await p.waitForTimeout(400);
  check(await p.locator('#chat-history').isHidden() && /top rated/.test(await p.locator('#chat-messages').innerText()), 'tapping one picks it up again');
  check(/Picking up where we left off/.test(await p.locator('#chat-messages').innerText()), 'Byte Cub says he is picking up where you left off');

  // A chat that only lives on the account (another phone) opens from the server.
  await p.evaluate(() => {
    const d = JSON.parse(localStorage.getItem('ftb_cub_chats_v1'));
    Object.values(d.chats).forEach(c => { c.messages = null; });
    d.current = '';
    localStorage.setItem('ftb_cub_chats_v1', JSON.stringify(d));
  });
  await p.click('#chat-history-btn');
  await p.waitForTimeout(500);
  await p.locator('.chat-history-open', { hasText: 'want to try' }).click();
  await p.waitForTimeout(500);
  check(/want to try/.test(await p.locator('#chat-messages').innerText()), 'a chat from another device loads from your account');

  // Delete one.
  await p.click('#chat-history-btn');
  await p.waitForTimeout(400);
  await p.locator('.chat-history-row', { hasText: 'top rated' }).locator('.chat-history-del').click();
  await p.waitForTimeout(300);
  check(await p.locator('.chat-history-row').count() === 1 && saved.some(b => b.action === 'delete'), 'deleting a chat removes it here and on your account');

  check(!p.errors.length, `no page errors (${p.errors.slice(0, 2).join(' | ')})`);
  await browser.close();
  finish('cubchats');
})();
