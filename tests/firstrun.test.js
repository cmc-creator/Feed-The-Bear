// A brand-new den stays calm: no sales card or empty taste modules, and dark cards are readable.
const { BASE, check, launch, newPage, finish } = require('./lib');

const spot = (i, name, cuisine) => ({ id: 's' + i, name, cuisine, status: i ? 'want-to-try' : 'visited', myRating: i ? 0 : 5, tags: [], visits: [], dishes: [] });
const ALL = [spot(0, 'Taqueria Uno', 'Mexican'), spot(1, 'Pho 43', 'Vietnamese'), spot(2, 'Little Miss BBQ', 'BBQ'), spot(3, 'Pizzeria Bianco', 'Pizza'), spot(4, 'Shake Shack', 'Burgers')];

// Rough contrast of an element's text against a dark backdrop.
const lightText = el => {
  const m = getComputedStyle(el).color.match(/[\d.]+/g).map(Number);
  const lin = v => { v /= 255; return v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4; };
  return 0.2126 * lin(m[0]) + 0.7152 * lin(m[1]) + 0.0722 * lin(m[2]) > 0.35;
};

(async () => {
  const browser = await launch();
  const at = async n => {
    const p = await newPage(browser, { seed: ALL.slice(0, n) });
    await p.route(/overpass|nominatim|place-info/, r => r.abort());
    await p.goto(`${BASE}/app.html`);
    await p.waitForTimeout(1200);
    return p;
  };

  const one = await at(1);
  check(await one.locator('#grizzly-home').isHidden(), 'one spot: no Grizzly sales card yet');
  check(await one.locator('#for-you-home').isHidden() && await one.locator('#mood-picks-home').isHidden(), 'one spot: no For You or Mood Picks with nothing to pick from');
  check(await one.locator('#week-recap-home').isHidden(), 'one spot: no empty week recap');
  check(await one.locator('.restaurant-card').count() === 1, 'the spot itself is shown');
  check(await one.locator('.restaurant-card .my-rating-row').evaluate(lightText), 'card text is light on the dark card');
  check(one.errors.length === 0, `no page errors (${one.errors.slice(0, 2).join(' | ')})`);
  await one.close();

  const three = await at(3);
  check(await three.locator('#for-you-home').isVisible() && await three.locator('#mood-picks-home').isVisible(), 'three spots: For You and Mood Picks appear');
  check(await three.locator('.for-you-home-title').evaluate(lightText) && await three.locator('.mood-picks-home-title').evaluate(lightText), 'their titles are readable');
  const recap = await three.locator('#week-recap-text').innerText();
  check(!recap.includes('No streak yet in the lead'), `week recap reads naturally (${recap})`);
  check(await three.locator('#grizzly-home').isHidden(), 'three spots: still no sales card');
  await three.close();

  const five = await at(5);
  check(await five.locator('#grizzly-home').isVisible(), 'five spots: the Grizzly card appears');
  await five.close();
  await browser.close();
  finish('firstrun');
})();
