const { BASE, check, launch, newPage, closeAllDialogs, finish } = require('./lib');

(async () => {
  const browser = await launch();
  const p = await newPage(browser, { seed: [
    { id: 'tacos', name: 'Tacos & Friends', cuisine: 'Mexican', status: 'want-to-try', address: '123 Taco St', notes: 'Private diary note', tags: [], visits: [], dishes: [] },
    { id: 'closed', name: 'Closed Cafe', status: 'visited', permanentlyClosed: true, tags: [], visits: [], dishes: [] },
  ] });
  await p.route(/overpass|nominatim|open-meteo|place-info|wikimedia/, r => r.abort());
  await p.route('**/api/**', r => r.fulfill({ json: { following: [], followers: [], invites: [], pages: {} } }));
  await p.goto(`${BASE}/app.html`);
  await p.evaluate(() => { window.__realMyShareLink = window.myShareLink; });
  await p.waitForTimeout(1000);
  await closeAllDialogs(p);
  await p.evaluate(() => {
    localStorage.setItem('ftb_friends_v1', JSON.stringify([{
      key: 'id:sam', name: 'Sam Foodie', data: { id: 'sam', u: 'Sam', picks: [{ n: 'Tacos & Friends', c: 'Mexican', r: 5, g: ['Birria'] }], w: [] },
      recent: [{ k: 'visit', n: 'Tacos & Friends', c: 'Mexican', r: 5, at: new Date().toISOString().slice(0, 10) }],
    }]));
    renderFriendsFeedHome();
  });
  check(await p.locator('#ff-plan-date').isVisible(), 'friend activity offers a food date directly on Home');
  await p.click('#ff-plan-date');
  check(await p.locator('#foodie-plan-overlay').isVisible(), 'Home opens the food date composer');
  check(await p.locator('.fp-spot option').count() === 1, 'permanently closed spots are excluded from plans');
  await p.selectOption('.fp-friend', 'id:sam');
  await p.fill('.fp-day', '2099-06-21');
  await p.fill('.fp-time', '18:30');
  await p.fill('.fp-note', 'Bring your appetite!');
  const preview = await p.locator('.fp-text').innerText();
  check(preview.includes('Sam, want to go to Tacos & Friends together?') && preview.includes('2099') && preview.includes('Birria')
    && preview.includes('Bring your appetite!') && /google.*maps/.test(preview), 'invitation contains the chosen friend, place, date, dish tip, message and Maps link');
  check(!preview.includes('Private diary note'), 'private restaurant notes are never included in invitations');
  await p.evaluate(() => { navigator.share = async data => { window.__invite = data; }; });
  await p.click('.fp-send');
  await p.waitForFunction(() => !!window.__invite);
  check(await p.evaluate(text => window.__invite.text === text, preview), 'Send shares exactly the preview without extra account data');
  await p.evaluate(() => { navigator.clipboard.writeText = async text => { window.__copied = text; }; });
  await p.click('.fp-copy');
  check(await p.evaluate(text => window.__copied === text, preview), 'Copy invite produces the same complete invitation');
  await p.evaluate(() => {
    window.__realOpenStory = StoryCard.openStory;
    StoryCard.openStory = async (spec, text) => { window.__story = { spec, text }; };
  });
  await p.click('.fp-story');
  check(await p.evaluate(() => window.__story.spec.kind === 'invite' && window.__story.spec.title === 'Tacos & Friends'
    && window.__story.spec.sections[0].items.includes('Bring your appetite!')), 'invite card uses the real plan and chosen message');
  await p.evaluate(() => { StoryCard.openStory = window.__realOpenStory; });
  await p.click('.fp-story');
  await p.waitForSelector('#story-card-overlay:not(.hidden) .story-img');
  await p.waitForFunction(() => document.querySelector('.story-img').naturalWidth > 0);
  check(await p.locator('.story-img').evaluate(img => img.naturalWidth === 1080 && img.naturalHeight === 1920), 'food date renders an actual 1080x1920 share image');
  await p.evaluate(() => StoryCard.close());
  await p.fill('.fp-day', '2000-01-01');
  await p.evaluate(() => { window.__invite = null; });
  await p.click('.fp-send');
  check(await p.evaluate(() => !window.__invite), 'a past date cannot be shared as a new plan');
  await p.fill('.fp-day', '');
  await p.evaluate(() => { navigator.share = async () => { throw new DOMException('Canceled', 'AbortError'); }; });
  await p.click('.fp-send');
  check(await p.locator('.fp-send').isEnabled() && !(await p.locator('.fp-status').innerText()), 'canceling share does not claim success or leave controls busy');
  await p.evaluate(() => { navigator.share = async () => { throw new DOMException('Blocked', 'NotAllowedError'); }; });
  await p.click('.fp-send');
  await p.waitForFunction(() => document.querySelector('.fp-status').textContent.includes('Could not share'));
  check(await p.locator('.fp-send').isEnabled(), 'blocked sharing reports an error and lets the foodie retry');
  await p.evaluate(() => { navigator.share = undefined; });
  await p.click('.fp-send');
  check(await p.locator('#share-menu').isVisible(), 'unsupported native sharing uses the existing text/WhatsApp/email/copy menu');
  await p.click('.share-menu-cancel');
  await p.click('.fp-close');
  await p.waitForTimeout(300);
  await p.evaluate(() => openFoodiePlan('tacos'));
  await p.waitForTimeout(100);
  await p.evaluate(() => history.back());
  await p.waitForTimeout(300);
  check(await p.locator('#foodie-plan-overlay').count() === 0, 'the phone Back button closes the planner without leaving the app');
  await p.evaluate(() => openFoodieFriends());
  await p.click('.fx-date');
  check(await p.locator('.fp-friend').inputValue() === 'id:sam' && await p.locator('.fp-spot').inputValue() === 'tacos',
    'Pick a time on a friend overlap preselects that friend and spot');
  await closeAllDialogs(p);
  await p.evaluate(() => {
    navigator.share = async data => { window.__caption = data.text; };
    offerShareMeal({ r: state.restaurants[0], note: 'My private meal note' });
  });
  await p.click('.sn-caption summary');
  await p.fill('.sn-caption-text', 'Who is in for taco night?');
  await p.click('.sn-media');
  check(await p.evaluate(() => window.__caption === 'Who is in for taco night?'), 'post-save sharing uses your edited caption');
  await p.evaluate(() => {
    StoryCard.openStory = async spec => { window.__bucketStory = spec; };
  });
  await p.click('.sn-go');
  check(await p.evaluate(() => window.__bucketStory.kicker === 'On my food bucket list' && !window.__bucketStory.sections.length),
    'Want to Try shares as a bucket-list card, never Just ate, and keeps meal notes private by default');
  await p.evaluate(() => {
    offerShareMeal({ r: state.restaurants[0], note: 'A note I choose to share' });
  });
  await p.click('.sn-caption summary');
  await p.check('.sn-include-note');
  await p.click('.sn-go');
  check(await p.evaluate(() => window.__bucketStory.sections[0].items[0] === 'A note I choose to share'), 'meal notes enter the card only after explicit opt-in');
  check(await p.evaluate(() => window.__bucketStory.place === 'Tacos & Friends' && window.__bucketStory.location === '123 Taco St'
    && window.__bucketStory.photos.length === 0), 'post-save card receives the restaurant and address without inventing a photo');
  await p.evaluate(async () => {
    const r = state.restaurants[0];
    r.placePhoto = 'https://example.com/listing.jpg';
    r.photo = 'https://example.com/my-photo.jpg';
    r.media = [{ photo: 'https://example.com/my-second-photo.jpg' }];
    await shareCard(r);
  });
  check(await p.evaluate(() => window.__bucketStory.kind === 'spot'
    && window.__bucketStory.photos.join('|') === 'https://example.com/my-photo.jpg|https://example.com/my-second-photo.jpg'
    && window.__bucketStory.place === 'Tacos & Friends'), 'detail sharing uses the same personal-photo place card and excludes listing imagery');
  await p.evaluate(() => { StoryCard.openStory = window.__realOpenStory; });
  await p.waitForTimeout(350);
  await p.evaluate(() => openFoodiePlan('tacos'));
  for (const width of [320, 390, 1280]) {
    await p.setViewportSize({ width, height: 844 });
    check(await p.evaluate(() => document.documentElement.scrollWidth <= innerWidth
      && document.querySelector('.foodie-plan-card').scrollWidth <= document.querySelector('.foodie-plan-card').clientWidth),
    `food date controls fit at ${width}px without horizontal scrolling`);
  }
  await p.evaluate(() => {
    clearAccountUI(deviceAppearance());
    renderFriendsFeedHome();
  });
  check(await p.locator('#foodie-plan-overlay').isHidden() && await p.locator('#friends-feed-home').isHidden(),
    'account transition immediately hides both the private plan and friend activity');
  check(await p.locator('#ff-list').count() === 1 && await p.locator('#ff-plan-date').count() === 1,
    'clearing a session preserves the feed markup and its action buttons');
  await p.evaluate(() => {
    window._ftbAccountSwitching = false;
    state.restaurants = [];
    renderFriendsFeedHome();
  });
  check(await p.locator('#friends-feed-home').isVisible() && await p.locator('.ff-view').count() === 0 && await p.locator('.ff-save').count() === 1,
    'friends can inspire the first save even when your own diary is empty');
  await p.evaluate(() => openFoodiePlan());
  check(await p.locator('.fp-send').isDisabled() && await p.locator('.fp-add').isVisible(), 'empty diaries get an actionable Add a spot path rather than a broken plan');
  await p.click('.fp-add');
  check(await p.locator('#quick-add-overlay').isVisible(), 'the empty planner opens the existing quick-save flow');
  await closeAllDialogs(p);
  await p.evaluate(() => {
    window.myShareLink = () => new Promise(resolve => { window.__finishLink = resolve; });
    window.__pendingStory = StoryCard.openStory({ title: 'Private old account card' }, 'Private caption');
  });
  await p.waitForFunction(() => !!window.__finishLink);
  await p.evaluate(async () => {
    clearAccountUI(deviceAppearance());
    window.__finishLink('feed-the-bear.com');
    await window.__pendingStory;
  });
  check(await p.locator('#story-card-overlay').isHidden(), 'a slow Story card cannot reopen private content after the account changes');
  const staleHandle = await p.evaluate(async () => {
    window.myShareLink = window.__realMyShareLink;
    window._ftbAccountSwitching = false;
    window._ftbUid = 'old-social-account';
    let finish;
    handleApi = () => new Promise(resolve => { finish = resolve; });
    const pending = myShareLink();
    clearAccountUI(deviceAppearance());
    window._ftbUid = 'new-social-account';
    finish({ ok: true, data: { handle: 'private_old_handle', public: true } });
    const link = await pending;
    return { link, handle: _myHandle, owner: _myHandleFor };
  });
  check(staleHandle.link === 'feed-the-bear.com' && staleHandle.handle === null && staleHandle.owner === '',
    'a delayed public-profile link cannot brand the next account share card with the old username');
  const errors = p.errors.filter(e => !/Food date sharing failed/.test(e));
  check(!errors.length, `no unexpected page errors (${errors.join(' | ')})`);
  await browser.close();
  finish('social-planning');
})();
