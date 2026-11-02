// Byte Cub, the floating food assistant: tap the cub to chat; he logs visits,
// saves places, picks dinner and opens lists. Plus where a spot is on its page.
const { BASE, check, launch, newPage, closeAllDialogs, finish } = require('./lib');

const say = async (p, text) => {
  await p.fill('#chat-input', text);
  await p.press('#chat-input', 'Enter');
  await p.waitForTimeout(700);
};

(async () => {
  const browser = await launch();
  const p = await newPage(browser, { seed: [
    { id: 't', name: 'Tacos Chiwas', cuisine: 'Mexican', status: 'want-to-try', tags: [], visits: [], dishes: [], address: '1923 E McDowell Rd, Phoenix', lat: 33.465, lng: -112.04 },
    { id: 'p', name: 'Pizzeria Bianco', cuisine: 'Pizza', status: 'visited', myRating: 4, tags: [], visits: [{ date: '2026-10-01', rating: 4 }], dishes: [] },
  ] });
  await p.route(/overpass|nominatim|open-meteo/, r => r.abort());
  await p.route('**/api/place-info?mode=search**', r => r.fulfill({ json: { places: [
    { placeId: 'g1', name: 'Bacanora', address: '1301 Grand Ave, Phoenix', lat: 33.46, lng: -112.09, kind: 'Mexican Restaurant', rating: 4.6, reviews: 800, priceLevel: 2 }] } }));
  await p.route('**/api/place-info?name=**', r => r.fulfill({ json: { found: false } }));
  await p.goto(`${BASE}/app.html`);
  await p.waitForTimeout(1800);
  await closeAllDialogs(p);

  // He's there, and tapping him opens his chat (free, no upsell).
  check(await p.locator('#cub-buddy .cub-btn').isVisible(), 'the floating Byte Cub is on screen');
  await p.click('#cub-buddy .cub-btn');
  check(await p.locator('#chat-panel').isVisible(), 'tapping him opens the chat');
  check(!(await p.locator('#upgrade-overlay:not(.hidden)').count()), 'no upgrade wall for free users');
  check(!(await p.locator('#cub-buddy').isVisible()), 'the floating cub steps aside while chatting');

  // "I went to …" logs a saved spot, with dish and stars.
  await say(p, 'I went to Tacos Chiwas and had the birria, 5 stars');
  let r = await p.evaluate(() => { const x = state.restaurants.find(r => r.id === 't'); return { s: x.status, my: x.myRating, dish: x.dishes?.[0]?.name, v: x.visits.length }; });
  check(r.s === 'visited' && r.my === 5 && r.dish === 'birria' && r.v === 1, `logs the visit with dish and stars (${JSON.stringify(r)})`);
  check(/Done!.*Tacos Chiwas.*Been There/s.test(await p.locator('#chat-messages').innerText()), 'and says where it went');

  // A place you haven't saved: he finds the real one and asks.
  await say(p, 'just had lunch at Bacanora, it was amazing');
  check(/Is it Bacanora, 1301 Grand Ave/.test(await p.locator('#chat-messages').innerText()), 'finds the real restaurant and checks');
  await p.locator('.chat-actions button', { hasText: 'Yes' }).last().click();
  await p.waitForTimeout(300);
  r = await p.evaluate(() => { const x = state.restaurants.find(r => r.name === 'Bacanora'); return x && { s: x.status, my: x.myRating, addr: x.address, g: x.googleRating }; });
  check(r && r.s === 'visited' && r.my === 5 && r.addr === '1301 Grand Ave, Phoenix' && r.g === 4.6, `adds it to Been There with the real details (${JSON.stringify(r)})`);

  // Save to Want to Try.
  await p.route('**/api/place-info?mode=search**', route => route.fulfill({ json: { places: [{ placeId: 'g2', name: 'Kai Restaurant', address: '5594 W Wild Horse Pass Blvd, Chandler', lat: 33.27, lng: -111.97, kind: 'Fine Dining Restaurant', rating: 4.8 }] } }));
  await say(p, 'add Kai to my want to try');
  await p.locator('.chat-actions button', { hasText: 'Yes' }).last().click();
  await p.waitForTimeout(300);
  check(await p.evaluate(() => state.restaurants.find(r => r.name === 'Kai Restaurant')?.status) === 'want-to-try', 'saves a place to Want to Try');

  // Pick for me, and lists.
  await say(p, 'what should I eat tonight?');
  check(/My picks for/.test(await p.locator('#chat-messages').innerText()), 'picks somewhere to eat');
  await say(p, 'show my want to try');
  await p.waitForTimeout(400);
  check(await p.evaluate(() => state.currentView) === 'want-to-try' && await p.locator('#chat-panel').isHidden(), 'opens your Want to Try list');

  // Spot page shows where it is.
  await p.evaluate(() => openDetailModal('t'));
  await p.waitForTimeout(400);
  check(await p.locator('#detail-location .dl-map').count() === 1, 'a spot page has a map');
  check(/1923 E McDowell Rd/.test(await p.locator('#detail-location').innerText()), 'and the address');
  check(await p.locator('#detail-location .dl-maps').isVisible() && await p.locator('#detail-directions-btn').isVisible(), 'and Google Maps + Directions');
  check(!(await p.locator('#cub-buddy').isVisible()), 'the floating cub does not hang over the page');
  await closeAllDialogs(p);

  // Header invite.
  check(await p.locator('#header-invite-btn').isVisible(), 'a small Invite button in the header');

  check(!p.errors.length, `no page errors ${p.errors.join(' | ')}`);
  await browser.close();
  finish('bytecub');
})();
