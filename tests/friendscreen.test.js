// The Friends screen: friends' latest bites, a 30-day board, a card per
// friend (taste match, best picks, "Plan it" for spots you share), their
// Bear Cave page, or an invite that opens username setup for them.
const { BASE, check, launch, newPage, closeAllDialogs, finish, asGrizzly } = require('./lib');

const day = n => new Date(Date.now() - n * 864e5).toISOString().slice(0, 10);

(async () => {
  asGrizzly();
  const browser = await launch();
  const p = await newPage(browser, { seed: [
    { id: 'm1', name: 'Tacos Chiwas', cuisine: 'Mexican', status: 'visited', myRating: 5, visits: [{ date: day(3) }], tags: [], dishes: [] },
    { id: 'm2', name: 'Pizzeria Bianco', cuisine: 'Pizza', status: 'visited', myRating: 4, tags: [], visits: [], dishes: [] },
    { id: 'm4', name: 'Cien Agaves', cuisine: 'Mexican', status: 'want-to-try', tags: [], visits: [], dishes: [] },
    { id: 'm5', name: 'Hash Kitchen', cuisine: 'Breakfast', status: 'want-to-try', tags: [], visits: [], dishes: [] },
  ] });
  await p.addInitScript(([d1, d2]) => {
    if (localStorage.getItem('ftb_friends_v1')) return;
    localStorage.setItem('ftb_user_v1', JSON.stringify({ name: 'Connie' }));
    localStorage.setItem('ftb_friends_v1', JSON.stringify([
      { key: 'id:jeremyshare01', name: 'Jeremy Beyer', data: { id: 'jeremyshare01', u: 'Jeremy', picks: [
        { n: 'Cien Agaves', c: 'Mexican', r: 5, g: ['Birria tacos'] }, { n: 'Tacos Chiwas', c: 'Mexican', r: 5 }, { n: 'Pizzeria Bianco', c: 'Pizza', r: 4 } ], w: [] },
        recent: [{ k: 'visit', n: 'Cien Agaves', c: 'Mexican', r: 5, at: d1 }, { k: 'save', n: 'Little Miss BBQ', c: 'BBQ', at: d2 }] },
      { key: 'id:mariashare001', name: 'Maria', data: { id: 'mariashare001', u: 'Maria', picks: [], w: [{ d: 'Pancakes', at: 'Hash Kitchen' }] }, recent: [] },
    ]));
  }, [day(1), day(2)]);
  await p.route(/overpass|nominatim|open-meteo|place-info|wikimedia|restaurant-image|place-photo/, r => r.abort());
  const asked = [];
  await p.route(/\/api\/handle/, r => {
    const u = new URL(r.request().url());
    asked.push(u.search);
    r.fulfill({ json: u.searchParams.get('pagesOf') ? { pages: { mariashare001: 'maria_eats' } }
      : u.searchParams.get('followers') ? { followers: [] } : u.searchParams.get('invites') ? { invites: [] }
        : u.searchParams.get('following') ? { following: [] } : { handle: '' } });
  });
  await p.goto(`${BASE}/app.html`);
  await p.waitForTimeout(1500);
  await closeAllDialogs(p);
  await p.evaluate(() => openFoodieFriends());
  await p.waitForTimeout(1500);
  const list = () => p.locator('#friends-list').innerText();

  check(/Jeremy Beyer ate at Cien Agaves/.test(await list()) && /Jeremy Beyer wants to try Little Miss BBQ/.test(await list()), "friends' latest bites are at the top");
  check(await p.locator('.fx-save').count() === 1 && await p.locator('.fx-view').count() === 1, 'Save for new places, View for ones you have');
  const board = await p.evaluate(() => friendsBoard().map(r => r.name + ':' + r.n).join(','));
  check(/Who ate out most/i.test(await list()) && await p.locator('.fx-board li').count() === 2, `a 30-day board of who ate out most, you included (${board})`);
  const jeremy = p.locator('.fx-card', { hasText: 'Jeremy' });
  check(/taste match/i.test(await jeremy.innerText()) && /get the Birria tacos/.test(await jeremy.innerText()), 'a friend card shows taste match and their best picks with what to order');
  check(/gave\s+Cien Agaves[\s\S]*on your list/.test(await jeremy.innerText()), 'a spot on your list they rated 5 stars is called out');
  check(/You both want to try\s+Hash Kitchen/.test(await p.locator('.fx-card', { hasText: 'Maria' }).innerText()), 'a spot you both want to try is called out');

  await p.evaluate(() => { window._shared = null; navigator.share = async d => { window._shared = d; }; });
  await jeremy.locator('.fx-plan').click();
  await p.waitForFunction(() => window._shared, null, { timeout: 3000 }).catch(() => {});
  check(/Jeremy, want to go to Cien Agaves together/.test((await p.evaluate(() => window._shared?.text)) || ''), 'Plan it asks them to go together');

  check(asked.some(q => q.startsWith('?pagesOf=')) && await p.locator('.fx-card', { hasText: 'Maria' }).locator('a.fx-page').getAttribute('href') === '/@maria_eats', "a friend's Bear Cave page is one tap away");
  await p.evaluate(() => { window._shared = null; });
  await jeremy.locator('.fx-page-invite').click();
  await p.waitForFunction(() => window._shared, null, { timeout: 3000 }).catch(() => {});
  const inv = await p.evaluate(() => window._shared);
  check(/Hey Jeremy!/.test(inv?.text || '') && /Bear Cave page/.test(inv?.text || '') && inv?.url === 'https://www.feed-the-bear.com/app.html?action=page', 'no page yet: an invite to make one, with a link to pick a username');
  check(!p.errors.length, `no page errors ${p.errors.join(' | ')}`);

  // Their side: the link opens username setup once signed in.
  const q = await newPage(browser, { seed: [] });
  await q.route(/overpass|nominatim|open-meteo|place-info|wikimedia/, r => r.abort());
  await q.route(/\/api\/handle/, r => r.fulfill({ json: { handle: '' } }));
  await q.goto(`${BASE}/app.html?action=page`);
  await q.waitForTimeout(2500);
  check(await q.locator('#handle-overlay').isVisible(), 'the invite link opens "pick your username"');
  await browser.close();
  finish('friendscreen');
})();
