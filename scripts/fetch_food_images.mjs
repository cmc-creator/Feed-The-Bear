import fs from 'node:fs';
import path from 'node:path';

const outDir = path.resolve('assets/food');
fs.mkdirSync(outDir, { recursive: true });

const items = [
  ['pancakes', 'Pancake'],
  ['waffles', 'Waffle'],
  ['omelette', 'Omelette'],
  ['french_toast', 'French toast'],
  ['eggs_benedict', 'Eggs Benedict'],
  ['burger', 'Hamburger'],
  ['fries', 'French fries'],
  ['pizza', 'Pizza'],
  ['pasta', 'Pasta'],
  ['lasagna', 'Lasagne'],
  ['gnocchi', 'Gnocchi'],
  ['sushi', 'Sushi'],
  ['ramen', 'Ramen'],
  ['udon', 'Udon'],
  ['dumplings', 'Dumpling'],
  ['fried_rice', 'Fried rice'],
  ['chow_mein', 'Chow mein'],
  ['biryani', 'Biryani'],
  ['butter_chicken', 'Butter chicken'],
  ['tikka_masala', 'Chicken tikka masala'],
  ['dosa', 'Dosa'],
  ['pad_thai', 'Pad Thai'],
  ['thai_curry', 'Thai curry'],
  ['pho', 'Pho'],
  ['banh_mi', 'Banh mi'],
  ['tacos', 'Taco'],
  ['burrito', 'Burrito'],
  ['quesadilla', 'Quesadilla'],
  ['enchiladas', 'Enchilada'],
  ['shawarma', 'Shawarma'],
  ['kebab', 'Kebab'],
  ['falafel', 'Falafel'],
  ['bbq_ribs', 'Barbecue'],
  ['brisket', 'Brisket'],
  ['steak', 'Steak'],
  ['seafood', 'Seafood'],
  ['salmon', 'Salmon as food'],
  ['shrimp', 'Shrimp and prawn as food'],
  ['fried_chicken', 'Fried chicken'],
  ['mac_and_cheese', 'Macaroni and cheese'],
  ['grilled_cheese', 'Grilled cheese'],
  ['caesar_salad', 'Caesar salad'],
  ['poke_bowl', 'Poke'],
  ['bibimbap', 'Bibimbap'],
  ['korean_bbq', 'Korean barbecue'],
  ['paella', 'Paella'],
  ['gelato', 'Gelato'],
  ['cheesecake', 'Cheesecake'],
  ['churros', 'Churro']
];

async function getThumbUrl(title) {
  const t = encodeURIComponent(title);
  const api = `https://en.wikipedia.org/w/api.php?action=query&titles=${t}&prop=pageimages&format=json&pithumbsize=960`;
  const res = await fetch(api, { headers: { 'user-agent': 'FeedTheBear/1.0' } });
  if (!res.ok) return null;
  const json = await res.json();
  const pages = json?.query?.pages ? Object.values(json.query.pages) : [];
  const page = pages.find(p => p?.thumbnail?.source);
  return page?.thumbnail?.source ?? null;
}

async function download(url, outPath) {
  const res = await fetch(url, { headers: { 'user-agent': 'FeedTheBear/1.0' } });
  if (!res.ok) return false;
  const buf = Buffer.from(await res.arrayBuffer());
  fs.writeFileSync(outPath, buf);
  return true;
}

async function getOpenverseUrl(query) {
  const q = encodeURIComponent(query);
  const api = `https://api.openverse.org/v1/images/?q=${q}&page_size=12`;
  const res = await fetch(api, { headers: { 'user-agent': 'FeedTheBear/1.0' } });
  if (!res.ok) return null;
  const json = await res.json();
  const results = Array.isArray(json?.results) ? json.results : [];
  const pick = results.find(r => r?.url && /\.(jpg|jpeg|png)(\?|$)/i.test(r.url)) || results.find(r => r?.url);
  return pick?.url ?? null;
}

function makeSeed(str) {
  let h = 2166136261;
  for (let i = 0; i < str.length; i++) {
    h ^= str.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return Math.abs(h >>> 0) % 100000;
}

const downloaded = [];
for (const [key, title] of items) {
  const existing = path.join(outDir, `${key}.jpg`);
  if (fs.existsSync(existing)) {
    downloaded.push(key);
    continue;
  }
  try {
    const thumb = await getThumbUrl(title);
    if (!thumb) continue;
    const ok = await download(thumb, existing);
    if (ok) downloaded.push(key);
  } catch {
    // keep going
  }

  if (!fs.existsSync(existing)) {
    const t = title.toLowerCase().replace(/[^a-z0-9\s-]/g, ' ').trim().replace(/\s+/g, ',');
    const lock = makeSeed(`${key}|${title}`);
    const fallback = `https://loremflickr.com/960/640/${t},food?lock=${lock}`;
    try {
      const ok = await download(fallback, existing);
      if (ok) downloaded.push(key);
    } catch {
      // keep going
    }
  }

  if (!fs.existsSync(existing)) {
    const k = key.replace(/_/g, ',');
    const lock = makeSeed(`${title}|${key}|k`);
    const fallback2 = `https://loremflickr.com/960/640/${k},food?lock=${lock}`;
    try {
      const ok = await download(fallback2, existing);
      if (ok) downloaded.push(key);
    } catch {
      // keep going
    }
  }

  if (!fs.existsSync(existing)) {
    try {
      const ov = await getOpenverseUrl(`${title} food dish`);
      if (ov) {
        const ok = await download(ov, existing);
        if (ok) downloaded.push(key);
      }
    } catch {
      // keep going
    }
  }
}

console.log(`Downloaded/available: ${downloaded.length}`);
console.log(downloaded.join(', '));
