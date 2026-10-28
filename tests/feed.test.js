// Friends' feed: live friend activity on the home screen, invites, and saving a friend's spot.
const { BASE, check, launch, newPage, closeAllDialogs, finish } = require('./lib');

const day = n => { const d = new Date(Date.now() - n * 86400000); return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`; };
const ME = [
  { id: 'm1', name: 'Tacos Chiwas', cuisine: 'Mexican', status: 'visited', myRating: 5, dateAdded: day(10), tags: [], visits: [{ date: day(1), rating: 5, note: '' }],
    dishes: [{ id: 'd1', name: 'Birria', verdict: 'again', rating: 5, date: day(1) }] },
  { id: 'm2', name: 'Pizzeria Bianco', cuisine: 'Pizza', status: 'want-to-try', dateAdded: day(3), tags: [], visits: [], dishes: [] },
];
const SAM = { key: 'id:sam123', name: 'Sam', savedAt: 1, data: { id: 'sam123', u: 'Sam', picks: [], w: [], ts: 1 } };
const OLD_LINK_FRIEND = { key: 'name:jo', name: 'Jo', savedAt: 1, data: { id: '', u: 'Jo', picks: [{ n: 'Pho 43', c: 'Vietnamese', a: '', r: 5, g: ['Pho tai'], s: [] }], w: [], ts: 1 } };

(async () => {
  const browser = await launch();

  // No friends yet: an invite card.
  const e = await newPage(browser, { seed: ME });
  await e.route(/overpass|nominatim|place-info/, r => r.abort());
  await e.goto(`${BASE}/app.html`);
  await e.waitForTimeout(1200);
  check(await e.locator('#friends-feed-home').isVisible(), 'the home screen has a Friends\' Feed');
  check(await e.locator('#ff-invite').isVisible(), 'with no friends, it invites one');
  await e.evaluate(() => { navigator.share = undefined; });
  await e.context().grantPermissions(['clipboard-read', 'clipboard-write']).catch(() => {});
  await e.locator('#ff-invite').click();
  await e.waitForTimeout(300);
  check(await e.evaluate(() => state.settings.shareLive === true), 'inviting turns on live sharing');

  // What gets published: recent activity, newest first, nothing while not sharing.
  const live = await e.evaluate(() => buildLiveProfile());
  check(live && live.recent[0].k === 'visit' && live.recent[0].n === 'Tacos Chiwas', 'latest visit is first in your activity');
  check(live.recent.some(x => x.k === 'dish' && x.d === 'Birria') && live.recent.some(x => x.k === 'save' && x.n === 'Pizzeria Bianco'), 'dishes and saves are in your activity');
  check(live.av === 'bear-chef' && !('ts' in live.profile), 'profile has your bear, and no timestamp churn');
  await e.evaluate(() => { stopSharingLive(); });
  check(await e.evaluate(() => buildLiveProfile()) === null, 'stop sharing publishes nothing');
  await e.close();

  // Following friends: live activity from the cloud, and an older link-only friend.
  const p = await newPage(browser, { seed: ME });
  await p.addInitScript(([a, b]) => localStorage.setItem('ftb_friends_v1', JSON.stringify([a, b])), [SAM, OLD_LINK_FRIEND]);
  await p.route(/overpass|nominatim|place-info/, r => r.abort());
  await p.goto(`${BASE}/app.html`);
  await p.waitForTimeout(1200);
  const fetched = await p.evaluate(async d => {
    let asked = [];
    window.fbFetchFriendProfiles = async ids => { asked = ids; return ids.map(() => ({
      u: 'Sam <img src=x onerror=alert(1)>', av: 'panda',
      profile: { picks: [{ n: 'Tacos Chiwas', c: 'Mexican', r: 5, g: ['Al pastor'] }], w: [] },
      recent: [
        { k: 'dish', n: 'Pizzeria Bianco', c: 'Pizza', d: 'Rosa pizza', at: d[0] },
        { k: 'visit', n: 'Little Miss BBQ', c: 'BBQ', a: '4301 E University Dr', r: 5, at: d[1] },
        { k: 'bogus', n: 'x', at: d[0] },
      ],
    })); };
    await refreshFriendsLive(true);
    return asked;
  }, [day(0), day(2)]);
  check(fetched.length === 1 && fetched[0] === 'sam123', 'only friends with a share id are looked up');
  const items = await p.locator('#ff-list .ff-item').allInnerTexts();
  check(items.length === 3, `feed shows live items plus the link-only friend (${items.length})`);
  check(items[0].includes('Rosa pizza') && items[0].includes('today'), `newest first (${items[0]})`);
  check(items.some(t => t.includes('Pho tai') && t.includes('Jo')), 'a link-only friend still shows their go-to');
  check(await p.locator('#ff-list img').count() === 0, 'friend names are escaped');
  check(await p.locator('#ff-list .ff-item').first().locator('.ff-view').count() === 1, 'a spot you already saved offers View');

  // Save a friend's spot straight to your list.
  const bbq = p.locator('#ff-list .ff-item', { hasText: 'Little Miss BBQ' });
  await bbq.locator('.ff-save').click();
  await p.waitForTimeout(300);
  const saved = await p.evaluate(() => state.restaurants.find(r => r.name === 'Little Miss BBQ'));
  check(saved && saved.status === 'want-to-try' && saved.address === '4301 E University Dr', 'Save adds it to Want to Try');
  check(saved.notes.includes('recommended'), 'and remembers who recommended it');
  check(await p.locator('#ff-list .ff-item', { hasText: 'Little Miss BBQ' }).locator('.ff-view').count() === 1, 'after saving, it offers View');
  const pizza = await p.evaluate(() => state.restaurants.find(r => r.name === 'Pizzeria Bianco'));
  check(pizza.dishes.length === 0, 'saving nothing new leaves your own spots alone');

  // Passport stamps show food emoji.
  check(await p.evaluate(() => { renderPassport(); return [...document.querySelectorAll('#chart-passport .passport-stamp.unlocked .ps-emoji')].every(e => e.textContent.trim()); }), 'unlocked passport stamps show an emoji');
  check(p.errors.length === 0, `no page errors (${p.errors.slice(0, 2).join(' | ')})`);
  await browser.close();
  finish('feed');
})();
