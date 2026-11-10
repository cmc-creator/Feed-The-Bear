const { BASE, check, launch, newPage, closeAllDialogs, finish } = require('./lib');

(async () => {
  const browser = await launch();
  try {
    const p = await newPage(browser, { seed: [
      { id: 'saved', name: 'Ramen Tatsu', cuisine: 'Japanese', status: 'want-to-try', tags: [], visits: [], dishes: [] },
    ] });
    await p.addInitScript(() => {
      localStorage.setItem('ftb_user_v1', JSON.stringify({ name: 'Connie' }));
      window.webkitSpeechRecognition = class {
        start () { window.__mic = this; }
        abort () {}
      };
      window.SpeechRecognition = window.webkitSpeechRecognition;
    });
    await p.route(/overpass|nominatim|open-meteo|place-info|wikimedia/, r => r.abort());
    await p.goto(`${BASE}/app.html`);
    await p.waitForSelector('#search-input');
    await closeAllDialogs(p);
    await p.evaluate(() => {
      state.userLat = 33.4942; state.userLng = -111.9261;
      setNearbyCards([
        { key: 'chiwas', name: 'Tacos Chiwas', cuisine: 'Mexican', amenity: 'restaurant', address: '102 Main Street', lat: 33.4945, lon: -111.9265, distMeters: 80, isSaved: false },
        { key: 'ramen', name: 'Ramen Tatsu', cuisine: 'Japanese', amenity: 'restaurant', lat: 33.4945, lon: -111.9265, distMeters: 80, isSaved: true, restaurantId: 'saved' },
      ]);
    });
    await p.click('#search-voice-btn');
    await p.evaluate(() => {
      const result = [{ transcript: 'Tacos Chiwas.' }]; result.isFinal = true;
      __mic.onresult({ results: [result] });
    });
    check(await p.inputValue('#search-input') === 'Tacos Chiwas', 'mic puts the spoken restaurant in the search field');
    check(await p.locator('#search-nearby-results .nearby-home-card').count() === 1, 'mic finds the unsaved restaurant already shown nearby');
    check(await p.locator('#search-nearby-results').isVisible() && await p.locator('#no-results').isHidden(), 'nearby match is visible instead of a contradictory no-results message');
    check(!/Nothing matches/.test(await p.locator('#search-summary').innerText()), 'nearby match is not described as no result');
    await p.click('#search-nearby-results .nearby-home-card-add');
    await p.waitForFunction(() => document.getElementById('form-name').value === 'Tacos Chiwas');
    check(await p.inputValue('#form-name') === 'Tacos Chiwas' && await p.inputValue('#form-address') === '102 Main Street', 'nearby search Save uses the correct restaurant and branch');
    await closeAllDialogs(p);
    await p.evaluate(() => { window.open = url => { window.__opened = url; }; });
    await p.click('#search-nearby-results .nearby-home-card-name');
    check(await p.evaluate(() => /google\.com\/maps/.test(window.__opened || '')), 'nearby search card opens its real directions link');
    await p.evaluate(() => parseVoiceInput('find Tacos Chiwas near me'));
    check(await p.locator('#search-nearby-results .nearby-home-card').count() === 1, 'spoken find and near-me wording finds the same restaurant');
    await p.fill('#search-input', 'ramen');
    check(await p.locator('#restaurant-grid .restaurant-card').count() === 1 && await p.locator('#search-nearby-results').count() === 0, 'saved match is not duplicated as nearby');
    await p.fill('#search-input', 'not a restaurant');
    check(/Nothing matches/.test(await p.locator('#search-summary').innerText()), 'genuine missing restaurant still offers nearby search');
    await p.evaluate(() => clearSearch());
    check(await p.locator('#search-nearby-results').count() === 0, 'clearing search removes nearby search results');
    check(await p.evaluate(() => matchesRestaurantSearch({ name: "Café O'Malley's", cuisine: 'Irish' }, 'cafe o malleys')) === true, 'search normalizes accented names and speech punctuation');

    // A slow location permission must not lose the query while opening Nearby.
    await p.evaluate(() => {
      window.__locationReady = null;
      ensureLocationForDiscovery = () => new Promise(resolve => { window.__locationReady = () => resolve(true); });
      fetchOverpassElements = async () => [
        { id: 1, lat: 33.4945, lon: -111.9265, tags: { name: 'Tacos Chiwas', amenity: 'restaurant', cuisine: 'mexican' } },
        { id: 2, lat: 33.4946, lon: -111.9266, tags: { name: 'Another Cafe', amenity: 'cafe', cuisine: 'coffee' } },
      ];
      window.__discovery = openDiscoverSearch('Tacos Chiwas');
    });
    await p.waitForTimeout(400);
    await p.evaluate(async () => { window.__locationReady(); await window.__discovery; });
    check(await p.inputValue('#disc-search') === 'Tacos Chiwas' && /Tacos Chiwas/.test(await p.locator('#nearby-results').innerText())
      && !/Another Cafe/.test(await p.locator('#nearby-results').innerText()), 'nearby search retains and applies its query after delayed location access');
    await closeAllDialogs(p);

    // Safari-style restriction: sharing must start within the submit handler,
    // not after an awaited promise has left the click event.
    await p.evaluate(() => {
      window.__insideInviteTap = false;
      window.__shared = null;
      navigator.share = async data => {
        if (!window.__insideInviteTap) throw new DOMException('Tap required', 'NotAllowedError');
        window.__shared = data;
      };
      inviteFriend();
    });
    await p.fill('#invite-who .invite-who-name', 'Mom');
    await p.evaluate(() => {
      window.__insideInviteTap = true;
      document.querySelector('#invite-who form').requestSubmit();
      window.__insideInviteTap = false;
    });
    await p.waitForTimeout(150);
    check(await p.evaluate(() => !!window.__shared), 'iPhone-style share starts directly from Send invite');

    // If Safari or an in-app browser rejects sharing, do not disappear into a
    // blocked clipboard/prompt: offer explicit send and manual-copy controls.
    await p.evaluate(() => {
      navigator.share = async () => { throw new DOMException('Blocked by browser', 'NotAllowedError'); };
      navigator.clipboard.writeText = async () => { throw new DOMException('Clipboard blocked', 'NotAllowedError'); };
      inviteFriend();
    });
    await p.click('#invite-who .invite-who-skip');
    await p.waitForTimeout(150);
    check(await p.locator('#share-menu').count() === 1, 'blocked iPhone sharing opens a usable fallback');
    if (await p.locator('#share-menu').count()) {
      const sentBeforeCopy = await p.evaluate(() => getSentInvites().length);
      await p.click('#share-menu [data-via="copy"]');
      check(await p.locator('#share-menu .share-menu-manual').isVisible(), 'blocked clipboard leaves the full invite selectable on screen');
      check(/invite\.html/.test(await p.inputValue('#share-menu .share-menu-text')), 'manual copy includes the actual invite link');
      check(await p.evaluate(() => getSentInvites().length) === sentBeforeCopy, 'blocked copying is not recorded as a sent invite');
      await p.setViewportSize({ width: 320, height: 568 });
      check(await p.evaluate(() => document.documentElement.scrollWidth <= innerWidth), 'manual-copy fallback fits a small iPhone screen');
      await p.click('#share-menu .share-menu-cancel');
    }

    await p.evaluate(() => navigator.share = async () => { throw new DOMException('Canceled', 'AbortError'); });
    const before = await p.evaluate(() => getSentInvites().length);
    await p.evaluate(() => { inviteFriend(); });
    await p.click('#invite-who .invite-who-skip');
    await p.waitForTimeout(100);
    check(await p.evaluate(() => getSentInvites().length) === before && await p.locator('#share-menu').count() === 0, 'cancelled sharing is not counted as a sent invite');
    const profile = { id: 'unicode-friend', u: 'Zoë 🐻', picks: [{ n: 'Café O’Malley', r: 5 }], w: [] };
    const encoded = Buffer.from(JSON.stringify(profile), 'utf8').toString('base64');
    for (const payload of [encoded, encodeURIComponent(encoded), encoded.replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '')]) {
      check(await p.evaluate(hash => decodeProfileLink(hash).u, '#profile=' + payload) === profile.u, 'raw, URL-escaped and URL-safe invite payloads preserve the friend name');
    }
    check(!p.errors.length, `search and invite paths have no uncaught errors (${p.errors.join(' | ')})`);

    const friend = await newPage(browser, { seed: [] });
    await friend.route(/overpass|nominatim|open-meteo|place-info|wikimedia/, r => r.abort());
    await friend.goto(`${BASE}/invite.html?accept=1#profile=${encodeURIComponent(encoded)}`);
    check((await friend.locator('h1').innerText()).includes(profile.u), 'iPhone-safe link preview names the sender');
    await friend.click('#go');
    await friend.waitForSelector('#guest-profile-overlay:not(.hidden)');
    check(await friend.evaluate(() => getFriends().some(f => f.name === 'Zoë 🐻')), 'Accept invite follows the sender through the escaped link');
    check(!friend.errors.length, `recipient invite flow has no errors (${friend.errors.join(' | ')})`);
  } finally { await browser.close(); }
  finish('search-invites');
})().catch(err => { console.error(err); process.exitCode = 1; });
