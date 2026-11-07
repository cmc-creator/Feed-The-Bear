const { BASE, check, launch, newPage, closeAllDialogs, finish } = require('./lib');

async function say (page, text) {
  await page.fill('#chat-input', text);
  await page.press('#chat-input', 'Enter');
  await page.waitForTimeout(500);
}

(async () => {
  const browser = await launch();
  try {
    const seed = [
      { id: 'old', name: 'Old Cafe', status: 'visited', myRating: 5, googleRating: 5, priceRange: 1, notes: 'Great memories', photo: 'https://example.com/cafe.jpg', visits: [{ date: '2026-10-01', note: 'Birthday', rating: 5 }], dishes: [{ id: 'soup', name: 'Tomato soup', verdict: 'again' }], tags: [] },
      { id: 'open', name: 'Open Cafe', status: 'want-to-try', cuisine: 'Cafe', googleRating: 4, tags: [], visits: [], dishes: [] },
      { id: 'russo', name: 'Subway', address: '300 Russo Road, Surprise, AZ', status: 'want-to-try', notes: 'Original branch', tags: [], visits: [], dishes: [] },
    ];
    const p = await newPage(browser, { seed, grizzly: true });
    await p.route(/overpass|nominatim|open-meteo|wikimedia/, r => r.abort());
    await p.route('**/api/place-info?name=**', r => r.fulfill({ json: { found: false } }));
    const asked = [];
    await p.route('**/api/place-info?mode=search**', r => {
      asked.push(new URL(r.request().url()).searchParams.get('q'));
      return r.fulfill({ json: { places: [
        { placeId: 'wrong', name: 'Subway', address: '300 Russo Road, Surprise, AZ' },
        { placeId: 'pizza', name: 'Russo Pizza', address: '150 W Waddell Road, Surprise, AZ' },
        { placeId: 'waddell', name: 'Subway', address: '138 W Waddell Road, Surprise, AZ' },
      ] } });
    });
    await p.route('**/api/food-events**', r => r.fulfill({ json: { events: [
      { name: 'Wing Competition', kind: 'contest', date: '2027-07-04', city: 'Phoenix', state: 'AZ', url: 'https://example.com/contest' },
    ] } }));
    await p.goto(`${BASE}/app.html`);
    await p.waitForTimeout(1500);
    await closeAllDialogs(p);

    await p.evaluate(() => openDetailModal('old'));
    p.once('dialog', d => d.dismiss());
    await p.click('#detail-closed-btn');
    check(await p.evaluate(() => isAvailableSpot(state.restaurants.find(r => r.id === 'old'))), 'cancelling closure leaves the place unchanged');
    p.once('dialog', d => d.accept());
    await p.click('#detail-closed-btn');
    const closed = await p.evaluate(() => {
      const r = state.restaurants.find(r => r.id === 'old');
      setView('visited');
      return { r, visible: getFiltered().some(x => x.id === 'old'), suggest: nearEnoughToSuggest(r),
        status: openStatus(r), picks: buildDecisionModeShortlist().map(x => x.r.id),
        cloud: cloudSafeRestaurant(r), profile: buildProfileData().picks };
    });
    check(closed.r.permanentlyClosed && !closed.suggest && !closed.picks.includes('old'), 'permanently closed places are excluded even when location is off');
    check(closed.visible && closed.r.status === 'visited' && closed.r.myRating === 5 && closed.r.visits[0].note === 'Birthday' && closed.r.photo === seed[0].photo && closed.r.dishes[0].name === 'Tomato soup', 'closure preserves Been There, visits, rating, photos and dishes');
    check(closed.cloud.permanentlyClosed && !closed.profile.some(r => r.n === 'Old Cafe'), 'closure survives cloud serialization and is not published as a recommended pick');
    check(closed.status.text === 'Permanently closed' && closed.status.open === false, 'permanent closure is distinct from closed-for-the-night hours');
    check(await p.evaluate(() => openStatus(null) === null), 'missing opening hours are not mistaken for permanent closure');
    check(await p.locator('#detail-closed-btn').innerText() === 'Mark reopened' && /Permanently closed/.test(await p.locator('#detail-hours').innerText()), 'detail shows the closure and a reopen control');
    check(/Permanently closed/.test(await p.locator('#restaurant-grid').innerText()), 'the visited list labels closed places');
    await closeAllDialogs(p);
    const pools = await p.evaluate(() => {
      openSwipeDeck(); openSpinWheel(); _populateDuelPickers(); _renderGroupVotePicker();
      return { spin: _spinItems.map(r => r.id), swipe: _swipeDeck.map(r => r.id),
        duel: document.getElementById('duel-pick-a').innerHTML, vote: document.getElementById('groupvote-picker').innerHTML,
        surprise: surpriseMeResponse(), budget: budgetResponse(), recommend: recommendResponse() };
    });
    check(!pools.spin.includes('old') && !pools.swipe.includes('old') && !/Old Cafe/.test(pools.duel + pools.vote + pools.surprise + pools.budget + pools.recommend), 'games, vote choices and built-in recommendations exclude closed places');
    await p.reload();
    await p.waitForTimeout(1000);
    await closeAllDialogs(p);
    check(await p.evaluate(() => state.restaurants.find(r => r.id === 'old').permanentlyClosed), 'closure persists after reload');
    await p.evaluate(() => { openDetailModal('old'); openEditModal('old'); });
    await p.fill('#form-notes', 'Great memories, still kept');
    await p.evaluate(() => handleFormSubmit({ preventDefault () {} }));
    check(await p.evaluate(() => state.restaurants.find(r => r.id === 'old').permanentlyClosed), 'editing notes does not erase the closure flag');
    await closeAllDialogs(p);
    await p.evaluate(() => openDetailModal('old'));
    await p.click('#detail-closed-btn');
    check(await p.evaluate(() => nearEnoughToSuggest(state.restaurants.find(r => r.id === 'old'))), 'Mark reopened restores eligibility');
    await closeAllDialogs(p);

    await p.evaluate(() => openChat());
    const request = 'can you please add the subway on waddell to visitied and note they have the broccoli cheddar soup';
    await say(p, request);
    check(asked.includes('subway on waddell'), `search keeps the requested branch (${asked.join(', ')})`);
    check(await p.evaluate(() => state.restaurants.length) === 3, 'nothing is saved before branch confirmation');
    const confirmText = await p.locator('#chat-messages').innerText();
    check(/Is it Subway, 138 W Waddell Road/.test(confirmText) && !/Is it Russo/.test(confirmText), 'confirms Waddell, not the other Subway or an unrelated restaurant');
    await p.locator('.chat-actions button').filter({ hasText: /^Yes$/ }).last().click();
    const saved = await p.evaluate(() => state.restaurants.find(r => r.placeId === 'waddell'));
    check(saved?.status === 'visited' && saved.address.includes('Waddell') && saved.notes === 'they have the broccoli cheddar soup', 'the exact request saves Waddell to Been There with the soup note');
    check(saved?.visits[0]?.note === saved.notes && !saved.dishes?.length, 'availability is a note, not a fabricated eaten/liked dish');
    check(await p.evaluate(() => state.restaurants.find(r => r.id === 'russo').notes === 'Original branch' && state.restaurants.find(r => r.id === 'russo').status === 'want-to-try'), 'the other Subway branch is untouched');
    check(/Saved note: they have the broccoli cheddar soup/.test(await p.locator('#chat-messages').innerText()), 'confirmation says what was actually saved');
    await say(p, 'add Subway to visited');
    check(/more than one saved location/.test(await p.locator('#chat-messages').innerText()), 'a chain without a branch asks which saved location');
    check(await p.evaluate(() => state.restaurants.find(r => r.placeId === 'waddell').visits.length) === 1, 'ambiguity does not log another visit');
    await say(p, 'add Subway on Missing Road to visited');
    check(/couldn't verify.*Missing Road/.test(await p.locator('#chat-messages').innerText()) && await p.evaluate(() => state.restaurants.length) === 4, 'an unverified branch is never silently substituted');
    await say(p, 'add Subway on Waddell to visited and note ask about soup availability');
    check(await p.evaluate(() => state.restaurants.filter(r => r.placeId === 'waddell').length === 1 && state.restaurants.find(r => r.placeId === 'waddell').notes.includes('ask about soup availability')), 'a verified saved branch is reused and prior notes are preserved');
    await p.evaluate(async () => {
      closeChat();
      openAiPanel();
      await sendAiMessage('add Subway on Waddell to visited and note soup on Tuesdays');
    });
    check(await p.locator('#ai-panel-overlay').isHidden() && await p.locator('#chat-panel').isVisible()
      && await p.evaluate(() => state.restaurants.find(r => r.placeId === 'waddell').notes.includes('soup on Tuesdays')), 'the full AI panel uses real save controls too, rather than claiming phantom saves');

    const prompt = await p.evaluate(async () => {
      const call = AI.call;
      try {
        AI.call = async (text, system, opts) => ({ text, system, opts });
        return await AI.chat('what soup did I note at Subway?', [
          { role: 'user', text: 'Tell me about Waddell' }, { role: 'assistant', text: 'Your Waddell branch is saved.' },
          { role: 'user', text: 'what soup did I note at Subway?' },
        ], state.restaurants);
      } finally { AI.call = call; }
    });
    check(prompt.system.includes('broccoli cheddar soup') && prompt.system.includes('Tomato soup') && prompt.system.includes('Birthday') && prompt.system.includes('Waddell'), 'AI sees saved notes, dishes, visits and branch addresses');
    check((prompt.text.match(/what soup did I note at Subway\?/g) || []).length === 1 && prompt.text.includes('Your Waddell branch is saved.'), 'AI retains conversation context without duplicating the current question');
    check(/Never claim you added/.test(prompt.system) && /Never recommend a record marked permanentlyClosed/.test(prompt.system), 'AI cannot claim phantom saves or recommend closed records');
    await p.evaluate(() => {
      window.__chat = AI.chat;
      window.__hasAccess = AI.hasAccess;
      AI.hasAccess = () => true;
      AI.chat = async text => { window.__askedCub = text; return 'Your note says they have the broccoli cheddar soup at Waddell.'; };
    });
    await say(p, 'tell me what soup I noted for Subway');
    check(await p.evaluate(() => window.__askedCub) === 'tell me what soup I noted for Subway', 'mentioning a saved place does not intercept a real question before AI');
    await p.evaluate(() => { AI.chat = async () => { throw new Error('test outage'); }; });
    await say(p, 'help with a different food question');
    check(/couldn't reach the AI just now/.test(await p.locator('#chat-messages').innerText()), 'an AI outage is disclosed rather than silently pretending to be smart');
    await p.evaluate(() => { AI.chat = window.__chat; AI.hasAccess = window.__hasAccess; });
    await say(p, 'where do I find eating competitions?');
    await p.locator('.chat-actions button').filter({ hasText: 'Open eating competitions' }).click();
    await p.waitForSelector('#bc-list .bc-card');
    check(await p.locator('#bear-challenges-overlay').isVisible(), 'Byte Cub opens Bear Challenges directly');
    await p.click('#bear-challenges-close');
    await p.evaluate(() => openMobileHub());
    await p.click('#hub-contests-btn');
    await p.waitForSelector('#bc-list .bc-card');
    check(/Wing Competition/.test(await p.locator('#bc-list').innerText()), 'the visible competitions shortcut opens Bear Challenges');
    await p.click('#bear-challenges-close');
    await p.fill('#mobile-hub-search', 'competitions');
    await p.waitForSelector('.fe-card');
    check(/Wing Competition/.test(await p.locator('.food-events').innerText()), 'hub search still finds competitions');

    await closeAllDialogs(p);
    await p.evaluate(() => openDetailModal('old'));
    p.once('dialog', d => d.accept());
    await p.click('#detail-delete-btn');
    check(await p.evaluate(() => !state.restaurants.some(r => r.id === 'old')), 'Delete still removes a visited place');
    check(!p.errors.length, `no browser errors (${p.errors.join(' | ')})`);

    const desktop = await newPage(browser, { seed, viewport: { width: 1280, height: 900 } });
    await desktop.route(/overpass|nominatim|open-meteo|place-info|wikimedia/, r => r.abort());
    await desktop.route('**/api/food-events**', r => r.fulfill({ json: { events: [] } }));
    await desktop.goto(`${BASE}/app.html`);
    await desktop.waitForTimeout(1000);
    await closeAllDialogs(desktop);
    await desktop.evaluate(() => openDetailModal('old'));
    await desktop.locator('#detail-closed-btn').scrollIntoViewIfNeeded();
    check(await desktop.locator('#detail-closed-btn').isVisible(), 'desktop exposes the same closure control');
    await desktop.evaluate(() => { closeDetailModal(); openMobileHub(); });
    check(await desktop.locator('#hub-contests-btn').isVisible(), 'desktop Discover exposes the competition shortcut');
    check(!desktop.errors.length, `no desktop browser errors (${desktop.errors.join(' | ')})`);
  } finally { await browser.close(); }
  finish('place-management');
})();
