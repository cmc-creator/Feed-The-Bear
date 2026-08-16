// Re-fetch ALL food images from Wikipedia article lead images ONLY.
// The original script fell back to loremflickr/openverse random photos,
// which produced junk (wrong subjects entirely). Wikipedia lead images are
// editor-curated so the subject is always correct.
// Usage: node scripts/refetch_food_images.mjs
import fs from 'node:fs';
import path from 'node:path';

const outDir = path.resolve('assets/food');
fs.mkdirSync(outDir, { recursive: true });

// key -> Wikipedia article title (verified article names)
const items = [
  ['pancakes', 'Pancake'],
  ['waffles', 'Waffle'],
  ['omelette', 'Omelette'],
  ['french_toast', 'French toast'],
  ['eggs_benedict', 'Eggs Benedict'],
  ['burger', 'Cheeseburger'],
  ['fries', 'French fries'],
  ['pizza', 'Pizza Margherita'],
  ['pasta', 'Spaghetti alla carbonara'],
  ['italian_pasta', 'Fettuccine Alfredo'],
  ['lasagna', 'Lasagne'],
  ['gnocchi', 'Gnocchi'],
  ['sushi', 'Sushi'],
  ['ramen', 'Ramen'],
  ['udon', 'Udon'],
  ['dumplings', 'Jiaozi'],
  ['fried_rice', 'Fried rice'],
  ['chow_mein', 'Chow mein'],
  ['biryani', 'Biryani'],
  ['butter_chicken', 'Butter chicken'],
  ['tikka_masala', 'Chicken tikka masala'],
  ['indian_curry', 'Curry'],
  ['dosa', 'Dosa (food)'],
  ['pad_thai', 'Pad thai'],
  ['thai_curry', 'Green curry'],
  ['pho', 'Pho'],
  ['banh_mi', 'Bánh mì'],
  ['tacos', 'Taco'],
  ['burrito', 'Burrito'],
  ['quesadilla', 'Quesadilla'],
  ['enchiladas', 'Enchilada'],
  ['shawarma', 'Shawarma'],
  ['kebab', 'Doner kebab'],
  ['falafel', 'Falafel'],
  ['steak', 'Beefsteak'],
  ['seafood', 'Seafood'],
  ['salmon', 'Smoked salmon'],
  ['shrimp', 'Scampi'],
  ['fried_chicken', 'Fried chicken'],
  ['mac_and_cheese', 'Macaroni and cheese'],
  ['grilled_cheese', 'Grilled cheese'],
  ['caesar_salad', 'Caesar salad'],
  ['poke_bowl', 'Poke (dish)'],
  ['bibimbap', 'Bibimbap'],
  ['korean_bbq', 'Korean barbecue'],
  ['paella', 'Paella'],
  ['gelato', 'Gelato'],
  ['cheesecake', 'Cheesecake'],
  ['churros', 'Churro'],
];

async function getThumbUrl (title) {
  const t = encodeURIComponent(title);
  const api = `https://en.wikipedia.org/w/api.php?action=query&titles=${t}&prop=pageimages&format=json&formatversion=2&redirects=1&pithumbsize=960`;
  for (let attempt = 0; attempt < 3; attempt++) {
    const res = await fetch(api, { headers: { 'user-agent': 'FeedTheBear/1.0 (image refresh; contact: repo cmc-creator/Feed-The-Bear)' } });
    if (res.status === 429) { await sleep(3000 * (attempt + 1)); continue; }
    if (!res.ok) return null;
    const json = await res.json();
    const pages = json?.query?.pages || [];
    const page = pages.find(p => p?.thumbnail?.source);
    return page?.thumbnail?.source ?? null;
  }
  return null;
}

const sleep = ms => new Promise(r => setTimeout(r, ms));

async function download (url, outPath) {
  for (let attempt = 0; attempt < 3; attempt++) {
    const res = await fetch(url, { headers: { 'user-agent': 'FeedTheBear/1.0 (image refresh; contact: repo cmc-creator/Feed-The-Bear)' } });
    if (res.status === 429) { await sleep(3000 * (attempt + 1)); continue; }
    if (!res.ok) return false;
    const type = res.headers.get('content-type') || '';
    if (!/image\/(jpeg|png)/i.test(type)) return false;
    const buf = Buffer.from(await res.arrayBuffer());
    if (buf.length < 8_000) return false; // reject tiny/placeholder files
    fs.writeFileSync(outPath, buf);
    return true;
  }
  return false;
}

let ok = 0;
const failed = [];
const onlyKeys = process.argv.slice(2); // optional: node script.mjs key1 key2 ...
const work = onlyKeys.length ? items.filter(([k]) => onlyKeys.includes(k)) : items;
for (const [key, title] of work) {
  const outPath = path.join(outDir, `${key}.jpg`);
  try {
    const thumb = await getThumbUrl(title);
    if (thumb && await download(thumb, outPath)) {
      ok++;
      console.log(`OK   ${key}  <-  ${title}`);
      await sleep(700); // stay under Wikipedia rate limits
      continue;
    }
  } catch { /* fallthrough */ }
  failed.push(key);
  console.log(`FAIL ${key}  (kept existing file)`);
  await sleep(700);
}
console.log(`\nDone: ${ok} refreshed, ${failed.length} failed${failed.length ? ': ' + failed.join(', ') : ''}`);
