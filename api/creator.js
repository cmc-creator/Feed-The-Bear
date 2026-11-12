/* ════════════════════════════════════════════════════════════
   Feed The Bear - Vercel Serverless: public creator pages
   ════════════════════════════════════════════════════════════
   feed-the-bear.com/@connie (vercel.json rewrite → /api/creator?h=connie)
   A member who picked a username and turned on "Public page" (handle.js
   publicPage) gets a page anyone can open, no account needed: their top
   spots and what to order. Made for a TikTok or Instagram bio.
   One button: join free, follow them, and add their spots. It carries
   ?ref=<their uid> (the friend's 30-day trial, and a free month for the
   creator when that friend pays: _referral.js) and ?src=<handle> (counted
   as a join on their page: handle.js pageJoined).
   Off, or no such username: a plain "not found" page (never says which).
   ════════════════════════════════════════════════════════════ */

const admin = require('firebase-admin');
const { overLimit } = require('./_limit');

const HANDLE_RE = /^[a-z0-9_]{3,20}$/;
const SITE = 'https://www.feed-the-bear.com';

function getAdmin () {
  if (!admin.apps.length) {
    const raw = process.env.FIREBASE_SERVICE_ACCOUNT;
    if (!raw) throw new Error('FIREBASE_SERVICE_ACCOUNT env var is not set');
    admin.initializeApp({ credential: admin.credential.cert(JSON.parse(raw)) });
  }
  return admin;
}

const esc = v => String(v ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const str = (v, n) => String(v ?? '').slice(0, n);
const httpUrl = v => (/^https:\/\/[^\s"'<>]+$/i.test(String(v || '')) ? String(v).slice(0, 300) : '');

const EMOJI = { mexican: '🌮', pizza: '🍕', italian: '🍝', japanese: '🍣', sushi: '🍣', chinese: '🥡', thai: '🍜', burgers: '🍔', burger: '🍔', bbq: '🍖', barbecue: '🍖', indian: '🍛', coffee: '☕', cafe: '☕', bakery: '🥐', breakfast: '🥞', seafood: '🦞', vietnamese: '🍜', korean: '🍲', mediterranean: '🥙', dessert: '🍨', american: '🍔', vegan: '🥗' };
// Map tags ("steak_house", "regional", "mexican;pizza") read like a person wrote them.
function niceCuisine (raw) {
  const first = String(raw ?? '').split(';')[0].replace(/[_-]+/g, ' ').replace(/\s+/g, ' ').trim().toLowerCase();
  if (!first || ['regional', 'restaurant', 'food', 'fast food', 'local', 'yes', 'other'].includes(first)) return '';
  const fixed = { 'steak house': 'steakhouse', 'coffee shop': 'coffee', 'ice cream': 'ice cream', 'bubble tea': 'bubble tea' }[first] || first;
  return fixed.replace(/\b\w/g, c => c.toUpperCase()).slice(0, 40);
}
const EMOJI_WORDS = [[/steak/, '🥩'], [/brew|pub|bar|beer/, '🍺'], [/sandwich|sub|deli/, '🥪'], [/chicken|wing/, '🍗'],
  [/taco|mexican|tex mex/, '🌮'], [/pizza/, '🍕'], [/burger|american|diner/, '🍔'], [/noodle|ramen|pho/, '🍜'], [/donut/, '🍩'], [/ice cream|gelato|frozen/, '🍦']];
const emojiFor = c => { const k = String(c || '').toLowerCase().trim(); return EMOJI[k] || EMOJI_WORDS.find(([re]) => re.test(k))?.[1] || '🍽️'; };

// Bear Cave decor: the same themes and decorations the app offers in
// Username & public page (friends.js). The cave rides in the live profile
// (profile.cave, short form {t, d}); anything unknown falls back to cozy.
const CAVE_THEMES = { cozy: '🧸', forest: '🐻', neon: '⚡', pastel: '🌸', witchy: '🔮', elf: '🧚', cute: '💖', mancave: '🛋️', beach: '🏖️', winter: '❄️', cosmic: '🌌', jungle: '🌿', den: '🐾', grotto: '💧', lookout: '⛰️', arch: '🪨', midnight: '🌙', golden: '🌅', misty: '🌫️', ember: '🔥', aurora: '🌌', royal: '👑', halloween: '🎃', christmas: '🎄' };
const CAVE_DECOR = { lights: '✨', rug: '🧶', posters: '🖼️', plant: '🪴', trophy: '🏆', candle: '🕯️', fireplace: '🔥', shelf: '📚', barcart: '🍷', lantern: '🏮', honeypot: '🍯', picnic: '🧺', mushroom: '🍄', campfire: '🔥', crystal: '💎', chandelier: '✨', throne: '🪑', goldenbear: '🐻', marblehearth: '🏛️', candelabra: '🕯️', jeweledrug: '🧶' };
const CAVE_THEME_LABELS = { cozy: 'Cozy Cave', forest: 'Forest Cave', neon: 'Neon Cave', pastel: 'Pastel Cave', witchy: 'Witchy Cave', elf: 'Elf Cave', cute: 'Cute Cave', mancave: 'Man Cave', beach: 'Beach Cave', winter: 'Winter Cave', cosmic: 'Cosmic Cave', jungle: 'Jungle Cave', den: 'Bear Den', grotto: 'Grotto', lookout: 'Mountain Lookout', arch: 'Stone Arch', midnight: 'Midnight Den', golden: 'Golden Hour Cave', misty: 'Misty Hollow', ember: 'Ember Grotto', aurora: 'Aurora Cave', royal: 'Royal Bear Suite', halloween: 'Halloween Cave', christmas: 'Christmas Cave' };
// Real cave photos (assets/caves/): each theme is a real photo, colour-graded
// to fit the theme, and each decoration is a real photo tile. The emoji is
// kept in the image alt text so the look is real but the name still reads.
// Shop themes reuse a real photo with a colour-grade tint (no new files).
// The 16 base themes and the 2 seasonal themes are single 3D-rendered
// furnished cave scenes (scene-*.jpg): the whole room in one picture.
// Pasting decor or furniture on top of a 3D scene recreates the collage
// look, so CAVE_3D_SCENES themes render with NO placed pieces — just the
// scene image. The graded shop themes have no 3D scene and still show
// placed decor and furniture.
const CAVE_PHOTOS = { cozy: 'scene-cozy-3d.jpg', forest: 'scene-forest-3d.jpg', neon: 'scene-neon-3d.jpg', pastel: 'scene-pastel-3d.jpg', witchy: 'scene-witchy-3d.jpg', elf: 'scene-elf-3d.jpg', cute: 'scene-cute-3d.jpg', mancave: 'scene-mancave-3d.jpg', beach: 'scene-beach-3d.jpg', winter: 'scene-winter-3d.jpg', cosmic: 'scene-cosmic-3d.jpg', jungle: 'scene-jungle-3d.jpg', den: 'scene-den-3d.jpg', grotto: 'scene-grotto-3d.jpg', lookout: 'scene-lookout-3d.jpg', arch: 'scene-arch-3d.jpg', midnight: 'theme-forest.jpg', golden: 'theme-arch.jpg', misty: 'theme-grotto.jpg', ember: 'theme-den.jpg', aurora: 'theme-cosmic.jpg', royal: 'theme-cozy.jpg', halloween: 'scene-halloween-3d.jpg', christmas: 'scene-christmas-3d.jpg' };
const CAVE_3D_SCENES = new Set(Object.keys(CAVE_PHOTOS).filter(id => CAVE_PHOTOS[id].startsWith('scene-')));
const CAVE_DECOR_PHOTOS = { lights: 'decor-lights.jpg', rug: 'decor-rug.jpg', posters: 'decor-posters.jpg', plant: 'decor-plant.jpg', trophy: 'decor-trophy.jpg', candle: 'decor-candle.jpg', fireplace: 'decor-fireplace.jpg', shelf: 'decor-shelf.jpg', barcart: 'decor-barcart.jpg', lantern: 'decor-lantern.jpg', honeypot: 'decor-honeypot.jpg', picnic: 'decor-picnic.jpg', mushroom: 'decor-mushroom.jpg', campfire: 'decor-campfire.jpg', crystal: 'decor-crystal.jpg', chandelier: 'decor-chandelier.jpg', throne: 'decor-throne.jpg', goldenbear: 'decor-lux-goldenbear.jpg', marblehearth: 'decor-lux-marblehearth.jpg', candelabra: 'decor-lux-candelabra.jpg', jeweledrug: 'decor-lux-jeweledrug.jpg' };
const CAVE_DECOR_LABELS = { lights: 'Fairy lights', rug: 'Rug', posters: 'Posters', plant: 'Plant', trophy: 'Trophy shelf', candle: 'Candles', fireplace: 'Stone fireplace', shelf: 'Cookbook shelf', barcart: 'Bar cart', lantern: 'Lantern glow', honeypot: 'Honey pot', picnic: 'Picnic basket', mushroom: 'Mushroom patch', campfire: 'Campfire', crystal: 'Crystal cluster', chandelier: 'Crystal chandelier', throne: 'Bear throne', goldenbear: 'Golden Bear Statue', marblehearth: 'Marble Hearth', candelabra: 'Golden Candelabra', jeweledrug: 'Jeweled Rug' };
// Furniture (Cave Shop): real photos of furniture, placed in the scene like
// decor. The photo/label maps mirror friends.js CAVE_SHOP_FURNITURE.
const CAVE_FURNITURE_PHOTOS = { couch: 'furn-couch.jpg', bed: 'furn-bed.jpg', table: 'furn-table.jpg', lamp: 'furn-lamp.jpg', fridge: 'furn-fridge.jpg', sink: 'furn-sink.jpg' };
const CAVE_FURNITURE_LABELS = { couch: 'Couch', bed: 'Bed', table: 'Table', lamp: 'Lamp', fridge: 'Fridge', sink: 'Sink' };
// Add-on rooms (Cave Shop): each room is one full 3D scene, like a theme.
// The photo/label map mirrors friends.js CAVE_SHOP_ROOMS.
const CAVE_ROOMS = { kitchen: { label: 'Kitchen', photo: 'scene-room-kitchen-3d.jpg' }, bedroom: { label: 'Bedroom', photo: 'scene-room-bedroom-3d.jpg' }, pantry: { label: 'Pantry', photo: 'scene-room-pantry-3d.jpg' }, games: { label: 'Game Room', photo: 'scene-room-games-3d.jpg' }, bath: { label: 'Bathroom', photo: 'scene-room-bath-3d.jpg' }, library: { label: 'Library', photo: 'scene-room-library-3d.jpg' }, royal: { label: 'Royal Suite', photo: 'scene-room-royal-3d.jpg' }, spa: { label: 'Spa Retreat', photo: 'scene-room-spa-3d.jpg' }, wine: { label: 'Wine Cellar', photo: 'scene-room-wine-3d.jpg' }, observatory: { label: 'Observatory', photo: 'scene-room-observatory-3d.jpg' } };
function normalizeCave (raw) {
  const src = raw && typeof raw === 'object' ? raw : {};
  const theme = CAVE_THEMES[src.theme || src.t] ? (src.theme || src.t) : 'cozy';
  const list = Array.isArray(src.decor) ? src.decor : (Array.isArray(src.d) ? src.d : null);
  const decor = list === null ? ['lights', 'plant']
    : [...new Set(list.map(x => String(x)).filter(id => CAVE_DECOR[id]))].slice(0, 4);
  const flist = Array.isArray(src.furniture) ? src.furniture : (Array.isArray(src.f) ? src.f : []);
  const furniture = [...new Set(flist.map(x => String(x)).filter(id => CAVE_FURNITURE_PHOTOS[id]))].slice(0, 3);
  return { theme, decor, furniture };
}

// The same shape the app's profile links use (friends.js sanitizeFriendData).
function cleanPicks (raw) {
  const list = (v, n, len) => (Array.isArray(v) ? v : []).slice(0, n).map(x => str(x, len)).filter(Boolean);
  return (Array.isArray(raw) ? raw : []).slice(0, 15).map(p => ({
    n: str(p?.n, 80), c: niceCuisine(str(p?.c, 60)), a: str(p?.a, 60),
    r: Math.max(0, Math.min(5, Math.round(Number(p?.r) || 0))),
    p: httpUrl(p?.p), g: list(p?.g, 3, 40), s: list(p?.s, 2, 40),
  })).filter(p => p.n);
}

function page (res, status, { title, description, body, url = SITE, theme = 'cozy' }) {
  res.setHeader('Content-Type', 'text/html; charset=utf-8');
  res.setHeader('Cache-Control', 'no-store');
  return res.status(status).send(`<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1.0, viewport-fit=cover" />
  <title>${esc(title)}</title>
  <meta name="description" content="${esc(description)}" />
  <meta property="og:title" content="${esc(title)}" />
  <meta property="og:description" content="${esc(description)}" />
  <meta property="og:type" content="profile" />
  <meta property="og:url" content="${esc(url)}" />
  <meta property="og:image" content="${SITE}/og-image.jpg" />
  <meta property="og:image:width" content="1200" />
  <meta property="og:image:height" content="630" />
  <meta name="twitter:card" content="summary_large_image" />
  <meta name="theme-color" content="#1b241c" />
  <link rel="icon" href="/feedbear-sm.jpg" />
  <style>
    :root { --bg: #1b241c; --card: #26322a; --text: #f6ecdc; --dim: #c9bfae; --accent: #ff8a3d; --gold: #ffd98a; }
    /* Realistic cave scenes: warm light pooling from above and below, a
       grainy wall (SVG turbulence, no external assets), and a vignette,
       so the page feels like a real room instead of a flat color block. */
    body[data-cave-theme="cozy"] { --bg: #241a12; --card: #33261a; --accent: #ff8a3d; --gold: #ffd98a; --glow: rgba(255, 150, 60, .30); --glow2: rgba(255, 190, 90, .16); --wood: #4a3220; }
    body[data-cave-theme="forest"] { --bg: #0e1f14; --card: #1a2e1e; --accent: #8fd07a; --gold: #e8d98a; --glow: rgba(222, 232, 120, .20); --glow2: rgba(120, 200, 110, .12); --wood: #3a2c1c; }
    body[data-cave-theme="neon"] { --bg: #1c1030; --card: #2a1848; --accent: #ff5da2; --gold: #ffd166; --glow: rgba(255, 93, 162, .26); --glow2: rgba(120, 180, 255, .15); --wood: #3a2060; }
    body[data-cave-theme="pastel"] { --bg: #2b2430; --card: #3a3040; --accent: #ffb3d9; --gold: #ffe3a3; --glow: rgba(255, 190, 220, .22); --glow2: rgba(255, 230, 170, .13); --wood: #54405e; }
    body[data-cave-theme="witchy"] { --bg: #150e22; --card: #241839; --accent: #b57edc; --gold: #d8c8ff; --glow: rgba(150, 90, 220, .30); --glow2: rgba(90, 60, 160, .15); --wood: #2e1f3d; }
    body[data-cave-theme="elf"] { --bg: #10241a; --card: #1d3a2a; --accent: #a8e063; --gold: #f2e6a0; --glow: rgba(170, 230, 100, .22); --glow2: rgba(120, 220, 160, .12); --wood: #2f3d24; }
    body[data-cave-theme="cute"] { --bg: #331e2a; --card: #452c3c; --accent: #ff8fc7; --gold: #ffd6ea; --glow: rgba(255, 150, 200, .28); --glow2: rgba(255, 200, 220, .14); --wood: #5a3a4a; }
    body[data-cave-theme="mancave"] { --bg: #1d150f; --card: #2e2118; --accent: #e0a050; --gold: #ffcf8a; --glow: rgba(230, 160, 70, .28); --glow2: rgba(180, 120, 50, .14); --wood: #4a2f1a; }
    body[data-cave-theme="beach"] { --bg: #12303a; --card: #1d4552; --accent: #5ec8d8; --gold: #ffe9a8; --glow: rgba(120, 210, 230, .26); --glow2: rgba(255, 220, 140, .14); --wood: #8a6b45; }
    body[data-cave-theme="winter"] { --bg: #101c26; --card: #1b2c3a; --accent: #9fd8ff; --gold: #ffd98a; --glow: rgba(150, 205, 255, .24); --glow2: rgba(255, 195, 105, .20); --wood: #3d4a55; }
    body[data-cave-theme="cosmic"] { --bg: #0a0e26; --card: #171a42; --accent: #8fb8ff; --gold: #d9e4ff; --glow: rgba(140, 110, 255, .30); --glow2: rgba(70, 140, 255, .16); --wood: #241a3d; }
    body[data-cave-theme="jungle"] { --bg: #0d2410; --card: #17351c; --accent: #7ee081; --gold: #ffe08a; --glow: rgba(120, 230, 120, .22); --glow2: rgba(255, 190, 120, .14); --wood: #2e3d1e; }
    body[data-cave-theme="den"] { --bg: #221610; --card: #2e2118; --accent: #ffb35c; --gold: #ffe0a8; --glow: rgba(255, 170, 80, .30); --glow2: rgba(255, 200, 120, .14); --wood: #4a3220; }
    body[data-cave-theme="grotto"] { --bg: #0f2422; --card: #173632; --accent: #7fd8cf; --gold: #d8f2e8; --glow: rgba(110, 210, 200, .26); --glow2: rgba(90, 180, 220, .14); --wood: #2e3d3a; }
    body[data-cave-theme="lookout"] { --bg: #1a2430; --card: #26344a; --accent: #a8c8e8; --gold: #ffe9a8; --glow: rgba(160, 200, 240, .24); --glow2: rgba(255, 220, 140, .14); --wood: #3d4a55; }
    body[data-cave-theme="arch"] { --bg: #241d16; --card: #332a20; --accent: #e8b878; --gold: #ffe0a8; --glow: rgba(230, 180, 110, .28); --glow2: rgba(255, 200, 120, .14); --wood: #4a3a28; }
    /* Cave Shop themes: the same real photos, colour-graded with a tint. */
    body[data-cave-theme="midnight"] { --bg: #0c0c24; --card: #181838; --accent: #8fa8ff; --gold: #d9e4ff; --glow: rgba(90, 110, 255, .30); --glow2: rgba(60, 80, 200, .16); --wood: #241a3d; }
    body[data-cave-theme="golden"] { --bg: #2a1a08; --card: #3a2810; --accent: #ffb35c; --gold: #ffe0a8; --glow: rgba(255, 170, 60, .32); --glow2: rgba(255, 200, 120, .16); --wood: #4a3220; }
    body[data-cave-theme="misty"] { --bg: #1c2424; --card: #2a3434; --accent: #b8d8d8; --gold: #e8f2f2; --glow: rgba(200, 220, 220, .26); --glow2: rgba(160, 190, 190, .14); --wood: #3a4444; }
    body[data-cave-theme="ember"] { --bg: #22100a; --card: #331a10; --accent: #ff7a3d; --gold: #ffd98a; --glow: rgba(255, 90, 20, .32); --glow2: rgba(255, 150, 60, .16); --wood: #4a2010; }
    body[data-cave-theme="aurora"] { --bg: #0a1a24; --card: #122e2a; --accent: #7fe8b8; --gold: #d9ffe8; --glow: rgba(80, 255, 170, .28); --glow2: rgba(140, 110, 255, .16); --wood: #1a2e3d; }
    body[data-cave-theme="royal"] { --bg: #241a08; --card: #33260f; --accent: #ffd76a; --gold: #fff0c0; --glow: rgba(255, 215, 120, .32); --glow2: rgba(255, 190, 90, .16); --wood: #4a3410; }
    body[data-cave-theme="halloween"] { --bg: #1a0e06; --card: #2a180c; --accent: #ff8a3d; --gold: #ffb35c; --glow: rgba(255, 140, 40, .30); --glow2: rgba(255, 180, 80, .14); --wood: #3a2410; }
    body[data-cave-theme="christmas"] { --bg: #0f1c22; --card: #1a2c30; --accent: #ff5a5a; --gold: #ffd98a; --glow: rgba(255, 200, 120, .28); --glow2: rgba(150, 205, 255, .14); --wood: #3d2c1c; }
    /* The cave itself is a real photo now: the theme picks the photo, shown
       on the page background (dimmed) and on the cave scene (bright). */
    body[data-cave-theme="cozy"] .cave-scene { background-image: radial-gradient(85% 95% at 50% 108%, var(--glow), transparent 72%), linear-gradient(180deg, rgba(0,0,0,.15), rgba(0,0,0,.55)), url(/assets/caves/scene-cozy-3d.jpg); }
    body[data-cave-theme="forest"] .cave-scene { background-image: radial-gradient(85% 95% at 50% 108%, var(--glow), transparent 72%), linear-gradient(180deg, rgba(0,0,0,.15), rgba(0,0,0,.55)), url(/assets/caves/scene-forest-3d.jpg); }
    body[data-cave-theme="neon"] .cave-scene { background-image: radial-gradient(85% 95% at 50% 108%, var(--glow), transparent 72%), linear-gradient(180deg, rgba(0,0,0,.15), rgba(0,0,0,.55)), url(/assets/caves/scene-neon-3d.jpg); }
    body[data-cave-theme="pastel"] .cave-scene { background-image: radial-gradient(85% 95% at 50% 108%, var(--glow), transparent 72%), linear-gradient(180deg, rgba(0,0,0,.15), rgba(0,0,0,.55)), url(/assets/caves/scene-pastel-3d.jpg); }
    body[data-cave-theme="witchy"] .cave-scene { background-image: radial-gradient(85% 95% at 50% 108%, var(--glow), transparent 72%), linear-gradient(180deg, rgba(0,0,0,.15), rgba(0,0,0,.55)), url(/assets/caves/scene-witchy-3d.jpg); }
    body[data-cave-theme="elf"] .cave-scene { background-image: radial-gradient(85% 95% at 50% 108%, var(--glow), transparent 72%), linear-gradient(180deg, rgba(0,0,0,.15), rgba(0,0,0,.55)), url(/assets/caves/scene-elf-3d.jpg); }
    body[data-cave-theme="cute"] .cave-scene { background-image: radial-gradient(85% 95% at 50% 108%, var(--glow), transparent 72%), linear-gradient(180deg, rgba(0,0,0,.15), rgba(0,0,0,.55)), url(/assets/caves/scene-cute-3d.jpg); }
    body[data-cave-theme="mancave"] .cave-scene { background-image: radial-gradient(85% 95% at 50% 108%, var(--glow), transparent 72%), linear-gradient(180deg, rgba(0,0,0,.15), rgba(0,0,0,.55)), url(/assets/caves/scene-mancave-3d.jpg); }
    body[data-cave-theme="beach"] .cave-scene { background-image: radial-gradient(85% 95% at 50% 108%, var(--glow), transparent 72%), linear-gradient(180deg, rgba(0,0,0,.15), rgba(0,0,0,.55)), url(/assets/caves/scene-beach-3d.jpg); }
    body[data-cave-theme="winter"] .cave-scene { background-image: radial-gradient(85% 95% at 50% 108%, var(--glow), transparent 72%), linear-gradient(180deg, rgba(0,0,0,.15), rgba(0,0,0,.55)), url(/assets/caves/scene-winter-3d.jpg); }
    body[data-cave-theme="cosmic"] .cave-scene { background-image: radial-gradient(85% 95% at 50% 108%, var(--glow), transparent 72%), linear-gradient(180deg, rgba(0,0,0,.15), rgba(0,0,0,.55)), url(/assets/caves/scene-cosmic-3d.jpg); }
    body[data-cave-theme="jungle"] .cave-scene { background-image: radial-gradient(85% 95% at 50% 108%, var(--glow), transparent 72%), linear-gradient(180deg, rgba(0,0,0,.15), rgba(0,0,0,.55)), url(/assets/caves/scene-jungle-3d.jpg); }
    body[data-cave-theme="den"] .cave-scene { background-image: radial-gradient(85% 95% at 50% 108%, var(--glow), transparent 72%), linear-gradient(180deg, rgba(0,0,0,.15), rgba(0,0,0,.55)), url(/assets/caves/scene-den-3d.jpg); }
    body[data-cave-theme="grotto"] .cave-scene { background-image: radial-gradient(85% 95% at 50% 108%, var(--glow), transparent 72%), linear-gradient(180deg, rgba(0,0,0,.15), rgba(0,0,0,.55)), url(/assets/caves/scene-grotto-3d.jpg); }
    body[data-cave-theme="lookout"] .cave-scene { background-image: radial-gradient(85% 95% at 50% 108%, var(--glow), transparent 72%), linear-gradient(180deg, rgba(0,0,0,.15), rgba(0,0,0,.55)), url(/assets/caves/scene-lookout-3d.jpg); }
    body[data-cave-theme="arch"] .cave-scene { background-image: radial-gradient(85% 95% at 50% 108%, var(--glow), transparent 72%), linear-gradient(180deg, rgba(0,0,0,.15), rgba(0,0,0,.55)), url(/assets/caves/scene-arch-3d.jpg); }
    body[data-cave-theme="midnight"] .cave-scene { background-image: radial-gradient(85% 95% at 50% 108%, var(--glow), transparent 72%), linear-gradient(180deg, rgba(15,15,50,.45), rgba(5,5,20,.60)), url(/assets/caves/theme-forest.jpg); }
    body[data-cave-theme="golden"] .cave-scene { background-image: radial-gradient(85% 95% at 50% 108%, var(--glow), transparent 72%), linear-gradient(180deg, rgba(255,170,60,.30), rgba(120,60,0,.45)), url(/assets/caves/theme-arch.jpg); }
    body[data-cave-theme="misty"] .cave-scene { background-image: radial-gradient(85% 95% at 50% 108%, var(--glow), transparent 72%), linear-gradient(180deg, rgba(200,220,220,.30), rgba(120,140,140,.45)), url(/assets/caves/theme-grotto.jpg); }
    body[data-cave-theme="ember"] .cave-scene { background-image: radial-gradient(85% 95% at 50% 108%, var(--glow), transparent 72%), linear-gradient(180deg, rgba(255,90,20,.30), rgba(80,20,0,.50)), url(/assets/caves/theme-den.jpg); }
    body[data-cave-theme="aurora"] .cave-scene { background-image: radial-gradient(85% 95% at 50% 108%, var(--glow), transparent 72%), linear-gradient(180deg, rgba(80,255,170,.22), rgba(40,20,90,.50)), url(/assets/caves/theme-cosmic.jpg); }
    body[data-cave-theme="royal"] .cave-scene { background-image: radial-gradient(85% 95% at 50% 108%, var(--glow), transparent 72%), linear-gradient(180deg, rgba(255,215,120,.30), rgba(90,60,0,.45)), url(/assets/caves/theme-cozy.jpg); }
    body[data-cave-theme="halloween"] .cave-scene { background-image: radial-gradient(85% 95% at 50% 108%, var(--glow), transparent 72%), linear-gradient(180deg, rgba(0,0,0,.15), rgba(0,0,0,.55)), url(/assets/caves/scene-halloween-3d.jpg); }
    body[data-cave-theme="christmas"] .cave-scene { background-image: radial-gradient(85% 95% at 50% 108%, var(--glow), transparent 72%), linear-gradient(180deg, rgba(0,0,0,.15), rgba(0,0,0,.55)), url(/assets/caves/scene-christmas-3d.jpg); }
    /* Add-on rooms: one full 3D scene each, shown when a room tab is
       active. A room never shows pasted decor or furniture. */
    body[data-cave-room="kitchen"] .cave-scene { background-image: radial-gradient(85% 95% at 50% 108%, var(--glow), transparent 72%), linear-gradient(180deg, rgba(0,0,0,.15), rgba(0,0,0,.55)), url(/assets/caves/scene-room-kitchen-3d.jpg); }
    body[data-cave-room="bedroom"] .cave-scene { background-image: radial-gradient(85% 95% at 50% 108%, var(--glow), transparent 72%), linear-gradient(180deg, rgba(0,0,0,.15), rgba(0,0,0,.55)), url(/assets/caves/scene-room-bedroom-3d.jpg); }
    body[data-cave-room="pantry"] .cave-scene { background-image: radial-gradient(85% 95% at 50% 108%, var(--glow), transparent 72%), linear-gradient(180deg, rgba(0,0,0,.15), rgba(0,0,0,.55)), url(/assets/caves/scene-room-pantry-3d.jpg); }
    body[data-cave-room="games"] .cave-scene { background-image: radial-gradient(85% 95% at 50% 108%, var(--glow), transparent 72%), linear-gradient(180deg, rgba(0,0,0,.15), rgba(0,0,0,.55)), url(/assets/caves/scene-room-games-3d.jpg); }
    body[data-cave-room="bath"] .cave-scene { background-image: radial-gradient(85% 95% at 50% 108%, var(--glow), transparent 72%), linear-gradient(180deg, rgba(0,0,0,.15), rgba(0,0,0,.55)), url(/assets/caves/scene-room-bath-3d.jpg); }
    body[data-cave-room="library"] .cave-scene { background-image: radial-gradient(85% 95% at 50% 108%, var(--glow), transparent 72%), linear-gradient(180deg, rgba(0,0,0,.15), rgba(0,0,0,.55)), url(/assets/caves/scene-room-library-3d.jpg); }
    /* Luxury rooms: same one-image rule, gold-leaning glow each. */
    body[data-cave-room="royal"] .cave-scene { background-image: radial-gradient(85% 95% at 50% 108%, var(--glow), transparent 72%), linear-gradient(180deg, rgba(0,0,0,.15), rgba(0,0,0,.55)), url(/assets/caves/scene-room-royal-3d.jpg); }
    body[data-cave-room="spa"] .cave-scene { background-image: radial-gradient(85% 95% at 50% 108%, var(--glow), transparent 72%), linear-gradient(180deg, rgba(0,0,0,.15), rgba(0,0,0,.55)), url(/assets/caves/scene-room-spa-3d.jpg); }
    body[data-cave-room="wine"] .cave-scene { background-image: radial-gradient(85% 95% at 50% 108%, var(--glow), transparent 72%), linear-gradient(180deg, rgba(0,0,0,.15), rgba(0,0,0,.55)), url(/assets/caves/scene-room-wine-3d.jpg); }
    body[data-cave-room="observatory"] .cave-scene { background-image: radial-gradient(85% 95% at 50% 108%, var(--glow), transparent 72%), linear-gradient(180deg, rgba(0,0,0,.15), rgba(0,0,0,.55)), url(/assets/caves/scene-room-observatory-3d.jpg); }
    body[data-cave-room] .cave-decor { display: none; }
    body[data-cave-theme="cozy"] { background-image: linear-gradient(180deg, rgba(20,12,6,.45), rgba(10,8,6,.85)), url(/assets/caves/scene-cozy-3d.jpg); background-size: cover; background-position: center 25%; background-attachment: fixed; background-color: var(--bg); }
    body[data-cave-theme="forest"] { background-image: linear-gradient(180deg, rgba(10,20,12,.45), rgba(8,10,8,.85)), url(/assets/caves/scene-forest-3d.jpg); background-size: cover; background-position: center 25%; background-attachment: fixed; background-color: var(--bg); }
    body[data-cave-theme="neon"] { background-image: linear-gradient(180deg, rgba(20,12,40,.45), rgba(10,8,14,.85)), url(/assets/caves/scene-neon-3d.jpg); background-size: cover; background-position: center 25%; background-attachment: fixed; background-color: var(--bg); }
    body[data-cave-theme="pastel"] { background-image: linear-gradient(180deg, rgba(30,25,35,.45), rgba(12,10,14,.85)), url(/assets/caves/scene-pastel-3d.jpg); background-size: cover; background-position: center 25%; background-attachment: fixed; background-color: var(--bg); }
    body[data-cave-theme="witchy"] { background-image: linear-gradient(180deg, rgba(18,12,30,.45), rgba(8,8,14,.85)), url(/assets/caves/scene-witchy-3d.jpg); background-size: cover; background-position: center 25%; background-attachment: fixed; background-color: var(--bg); }
    body[data-cave-theme="elf"] { background-image: linear-gradient(180deg, rgba(12,26,18,.45), rgba(8,12,10,.85)), url(/assets/caves/scene-elf-3d.jpg); background-size: cover; background-position: center 25%; background-attachment: fixed; background-color: var(--bg); }
    body[data-cave-theme="cute"] { background-image: linear-gradient(180deg, rgba(35,20,30,.45), rgba(14,10,12,.85)), url(/assets/caves/scene-cute-3d.jpg); background-size: cover; background-position: center 25%; background-attachment: fixed; background-color: var(--bg); }
    body[data-cave-theme="mancave"] { background-image: linear-gradient(180deg, rgba(22,16,10,.45), rgba(10,8,6,.85)), url(/assets/caves/scene-mancave-3d.jpg); background-size: cover; background-position: center 25%; background-attachment: fixed; background-color: var(--bg); }
    body[data-cave-theme="beach"] { background-image: linear-gradient(180deg, rgba(14,32,38,.45), rgba(8,12,14,.85)), url(/assets/caves/scene-beach-3d.jpg); background-size: cover; background-position: center 25%; background-attachment: fixed; background-color: var(--bg); }
    body[data-cave-theme="winter"] { background-image: linear-gradient(180deg, rgba(12,22,30,.45), rgba(8,10,14,.85)), url(/assets/caves/scene-winter-3d.jpg); background-size: cover; background-position: center 25%; background-attachment: fixed; background-color: var(--bg); }
    body[data-cave-theme="cosmic"] { background-image: linear-gradient(180deg, rgba(10,12,30,.45), rgba(6,8,14,.85)), url(/assets/caves/scene-cosmic-3d.jpg); background-size: cover; background-position: center 25%; background-attachment: fixed; background-color: var(--bg); }
    body[data-cave-theme="jungle"] { background-image: linear-gradient(180deg, rgba(10,26,12,.45), rgba(8,12,8,.85)), url(/assets/caves/scene-jungle-3d.jpg); background-size: cover; background-position: center 25%; background-attachment: fixed; background-color: var(--bg); }
    body[data-cave-theme="den"] { background-image: linear-gradient(180deg, rgba(24,16,10,.45), rgba(10,8,6,.85)), url(/assets/caves/scene-den-3d.jpg); background-size: cover; background-position: center 25%; background-attachment: fixed; background-color: var(--bg); }
    body[data-cave-theme="grotto"] { background-image: linear-gradient(180deg, rgba(12,26,24,.45), rgba(8,12,12,.85)), url(/assets/caves/scene-grotto-3d.jpg); background-size: cover; background-position: center 25%; background-attachment: fixed; background-color: var(--bg); }
    body[data-cave-theme="lookout"] { background-image: linear-gradient(180deg, rgba(20,26,32,.45), rgba(8,10,14,.85)), url(/assets/caves/scene-lookout-3d.jpg); background-size: cover; background-position: center 25%; background-attachment: fixed; background-color: var(--bg); }
    body[data-cave-theme="arch"] { background-image: linear-gradient(180deg, rgba(26,20,14,.45), rgba(10,8,6,.85)), url(/assets/caves/scene-arch-3d.jpg); background-size: cover; background-position: center 25%; background-attachment: fixed; background-color: var(--bg); }
    body[data-cave-theme="midnight"] { background-image: linear-gradient(180deg, rgba(15,15,50,.45), rgba(5,5,20,.85)), url(/assets/caves/theme-forest.jpg); background-size: cover; background-position: center 25%; background-attachment: fixed; background-color: var(--bg); }
    body[data-cave-theme="golden"] { background-image: linear-gradient(180deg, rgba(255,170,60,.35), rgba(120,60,0,.80)), url(/assets/caves/theme-arch.jpg); background-size: cover; background-position: center 25%; background-attachment: fixed; background-color: var(--bg); }
    body[data-cave-theme="misty"] { background-image: linear-gradient(180deg, rgba(200,220,220,.35), rgba(120,140,140,.80)), url(/assets/caves/theme-grotto.jpg); background-size: cover; background-position: center 25%; background-attachment: fixed; background-color: var(--bg); }
    body[data-cave-theme="ember"] { background-image: linear-gradient(180deg, rgba(255,90,20,.35), rgba(80,20,0,.80)), url(/assets/caves/theme-den.jpg); background-size: cover; background-position: center 25%; background-attachment: fixed; background-color: var(--bg); }
    body[data-cave-theme="aurora"] { background-image: linear-gradient(180deg, rgba(80,255,170,.25), rgba(40,20,90,.80)), url(/assets/caves/theme-cosmic.jpg); background-size: cover; background-position: center 25%; background-attachment: fixed; background-color: var(--bg); }
    body[data-cave-theme="royal"] { background-image: linear-gradient(180deg, rgba(255,215,120,.35), rgba(90,60,0,.80)), url(/assets/caves/theme-cozy.jpg); background-size: cover; background-position: center 25%; background-attachment: fixed; background-color: var(--bg); }
    body[data-cave-theme="halloween"] { background-image: linear-gradient(180deg, rgba(26,14,6,.45), rgba(10,6,4,.85)), url(/assets/caves/scene-halloween-3d.jpg); background-size: cover; background-position: center 25%; background-attachment: fixed; background-color: var(--bg); }
    body[data-cave-theme="christmas"] { background-image: linear-gradient(180deg, rgba(15,28,34,.45), rgba(8,12,14,.85)), url(/assets/caves/scene-christmas-3d.jpg); background-size: cover; background-position: center 25%; background-attachment: fixed; background-color: var(--bg); }
    * { box-sizing: border-box; }
    body { margin: 0; color: var(--text); font: 500 1rem/1.45 system-ui, -apple-system, sans-serif;
      background:
        radial-gradient(120% 55% at 50% 0%, var(--glow), transparent 62%),
        radial-gradient(90% 45% at 50% 108%, var(--glow2), transparent 62%),
        linear-gradient(180deg, var(--bg), #100d0a 135%);
    }
    body::before { content: ""; position: fixed; inset: 0; pointer-events: none; z-index: 0;
      background-image: url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='140' height='140'%3E%3Cfilter id='n'%3E%3CfeTurbulence type='fractalNoise' baseFrequency='0.85' numOctaves='2' stitchTiles='stitch'/%3E%3CfeColorMatrix type='saturate' values='0'/%3E%3C/filter%3E%3Crect width='140' height='140' filter='url(%23n)' opacity='0.055'/%3E%3C/svg%3E");
      box-shadow: inset 0 0 140px rgba(0,0,0,.55);
    }
    main { max-width: 520px; margin: 0 auto; padding: 28px 16px 120px; position: relative; z-index: 1; }
    header { text-align: center; margin-bottom: 20px; }
    .bear { width: 72px; height: 72px; border-radius: 50%; object-fit: cover; box-shadow: 0 0 0 3px var(--card), 0 10px 22px rgba(0,0,0,.5); }
    h1 { font-size: 1.6rem; line-height: 1.2; margin: 12px 0 4px; overflow-wrap: anywhere; }
    .handle { color: var(--gold); font-weight: 700; }
    .lead { color: var(--dim); margin: 6px 0 0; }
    /* The cave is a big scene now: the theme photo fills a tall 4:3 frame,
       and each decoration is placed in it like furniture in a room —
       grounded on the floor, hung from the top, or set on the wall. The
       page itself stays dark so the scene is the cave. The position map
       below is shared with the in-app preview (style.css) — keep the
       two in sync. */
    body[data-cave-theme] { background-image: none; }
    .cave-scene { position: relative; aspect-ratio: 4 / 3; margin-top: 16px; border-radius: 20px; overflow: hidden;
      background: var(--card);
      background-size: cover; background-position: center 30%;
      box-shadow: inset 0 0 0 1px rgba(255,255,255,.07), inset 0 -40px 80px rgba(0,0,0,.45), 0 12px 30px rgba(0,0,0,.35);
    }
    .cave-decor { position: absolute; inset: 0; }
    /* Room tabs under the scene: Living Room + every room the owner has
       earned. Tapping one swaps the scene to that room's 3D picture. */
    .cave-room-tabs { display: flex; flex-wrap: wrap; gap: 8px; margin-top: 12px; }
    .cave-room-tab { border: 1px solid rgba(255,255,255,.18); background: transparent; color: var(--text); border-radius: 999px; padding: 7px 14px; font-size: .85rem; cursor: pointer; }
    .cave-room-tab.on { background: var(--accent); border-color: transparent; color: #1b130b; font-weight: 800; }
    /* The scene is a room, not a row: big pieces take a third each
       (fireplace left, couch centre, bed right), small pieces sit on the
       floor in front of them, and z-index is the depth — the rug is the
       floor (0), wall and back pieces sit behind (1), the furniture
       sits mid-room (2), small floor pieces sit in front (3), and
       hanging lights sit above it all (4). The slight darkening blends
       each photo into the cave's moody light. */
    .cave-decor-item { position: absolute; object-fit: cover; border-radius: 14px; box-shadow: 0 10px 24px rgba(0,0,0,.55), 0 2px 6px rgba(0,0,0,.4); filter: brightness(.92) saturate(1.05); }
    .decor-lights { left: 15%; top: 3%; width: 70%; height: 12%; z-index: 4; border-radius: 999px; }
    .decor-chandelier { left: 37%; top: 0; width: 26%; height: 16%; z-index: 4; }
    .decor-lantern { left: 44%; top: 2%; width: 13%; aspect-ratio: 1; z-index: 4; }
    .decor-shelf { right: 5%; top: 20%; width: 30%; aspect-ratio: 1; z-index: 1; }
    .decor-posters { left: 5%; top: 18%; width: 28%; aspect-ratio: 1; z-index: 1; }
    .decor-trophy { right: 4%; bottom: 30%; width: 25%; aspect-ratio: 1; z-index: 1; }
    .decor-plant { left: 30%; bottom: 2%; width: 12%; aspect-ratio: 1; z-index: 3; }
    .decor-fireplace { left: 2%; bottom: 10%; width: 30%; aspect-ratio: 1; z-index: 1; }
    .decor-throne { left: 35%; bottom: 12%; width: 30%; aspect-ratio: 1; z-index: 1; }
    .decor-barcart { right: 4%; bottom: 4%; width: 24%; aspect-ratio: 1; z-index: 2; }
    .decor-campfire { left: 69%; bottom: 2%; width: 16%; aspect-ratio: 1; z-index: 3; }
    .decor-crystal { left: 86%; bottom: 1%; width: 12%; aspect-ratio: 1; z-index: 3; }
    .decor-candle { left: 62%; bottom: 1%; width: 9%; aspect-ratio: 1; z-index: 3; }
    .decor-honeypot { left: 17%; bottom: 1%; width: 11%; aspect-ratio: 1; z-index: 3; }
    .decor-mushroom { left: 3%; bottom: 1%; width: 12%; aspect-ratio: 1; z-index: 3; }
    .decor-picnic { left: 70%; bottom: 1%; width: 24%; height: 12%; z-index: 3; }
    .decor-rug { left: 15%; bottom: 0; width: 70%; height: 8%; z-index: 0; }
    .furn-couch { left: 35%; bottom: 6%; width: 30%; aspect-ratio: 4 / 3; z-index: 2; }
    .furn-bed { right: 2%; bottom: 6%; width: 30%; aspect-ratio: 4 / 3; z-index: 2; }
    .furn-table { left: 40%; bottom: 1%; width: 20%; aspect-ratio: 4 / 3; z-index: 3; }
    .furn-lamp { right: 7%; bottom: 32%; width: 14%; aspect-ratio: 1; z-index: 4; }
    .furn-fridge { right: 2%; bottom: 5%; width: 20%; aspect-ratio: 3 / 4; z-index: 2; }
    .furn-sink { left: 3%; bottom: 4%; width: 22%; aspect-ratio: 4 / 3; z-index: 2; }
    .cave-caption { display: flex; justify-content: space-between; align-items: baseline; gap: 10px; margin-top: 10px; }
    .cave-theme { color: var(--dim); font-size: .85rem; }
    .cave-points { color: var(--gold); font-weight: 800; font-size: .9rem; text-shadow: 0 2px 8px rgba(0,0,0,.5); }
    .cave-vote { text-align: center; margin-top: 14px; }
    .cave-vote button { border: 0; border-radius: 999px; padding: 10px 18px; background: var(--accent); color: #1b130b; font-weight: 800; font-size: .95rem; cursor: pointer; }
    .cave-vote-count { color: var(--dim); font-size: .82rem; margin-top: 6px; }
    /* Leave a gift: a visitor picks one small gift for the cave owner —
       a food for their pantry or a decor piece for their cave. One gift
       per visitor per day, free, no account needed. */
    .cave-gift { text-align: center; margin-top: 14px; }
    .cave-gift h2 { font-size: 1rem; margin: 0 0 4px; }
    .cave-gift p { color: var(--dim); font-size: .85rem; margin: 0 0 10px; }
    .cave-gift-row { display: flex; flex-wrap: wrap; gap: 8px; justify-content: center; }
    .cave-gift-chip { border: 1px solid rgba(255,255,255,.14); background: var(--card); color: var(--text); border-radius: 999px; padding: 5px 12px 5px 5px; font-size: .85rem; cursor: pointer; display: inline-flex; align-items: center; gap: 6px; }
    .cave-gift-chip img { width: 28px; height: 28px; object-fit: cover; border-radius: 8px; }
    .cave-gift-chip:disabled { opacity: .55; cursor: default; }
    .cave-gift-note { color: var(--dim); font-size: .82rem; margin-top: 8px; }
    .spots { display: grid; gap: 10px; }
    .spot { display: flex; gap: 12px; align-items: center; background: var(--card); border-radius: 14px; padding: 12px; }
    .ph { width: 56px; height: 56px; flex-shrink: 0; border-radius: 10px; background: rgba(255,255,255,.06); display: grid; place-items: center; font-size: 1.6rem; overflow: hidden; }
    .ph img { width: 100%; height: 100%; object-fit: cover; }
    .body { min-width: 0; flex: 1; }
    .name { font-weight: 800; overflow-wrap: anywhere; }
    .meta { font-size: .8rem; color: var(--dim); }
    .stars { color: var(--gold); letter-spacing: 1px; }
    .get { font-size: .84rem; margin-top: 3px; }
    .get b { color: var(--gold); }
    .skip { font-size: .8rem; color: var(--dim); }
    .empty { background: var(--card); border-radius: 14px; padding: 16px; text-align: center; color: var(--dim); }
    .cta { position: fixed; left: 0; right: 0; bottom: 0; padding: 12px 16px calc(12px + env(safe-area-inset-bottom, 0px)); background: linear-gradient(transparent, var(--bg) 30%); }
    .cta a { display: block; max-width: 520px; margin: 0 auto; padding: 16px; border-radius: 16px; background: var(--accent); color: #1b130b; font-weight: 800; font-size: 1.05rem; text-align: center; text-decoration: none; }
    .cta small { display: block; text-align: center; color: var(--dim); font-size: .78rem; margin-top: 6px; }
    .home { display: block; text-align: center; margin-top: 24px; color: var(--gold); }
    .cave-home-row { text-align: left; margin-bottom: 8px; }
    .cave-home { display: inline-block; padding: 10px 18px; border-radius: 999px; background: var(--accent); color: #1b130b; font-weight: 800; font-size: 1rem; text-decoration: none; box-shadow: 0 6px 16px rgba(0,0,0,.4); }
  </style>
</head>
<body data-cave-theme="${esc(theme)}">
${body}
</body>
</html>`);
}

function notFound (res) {
  return page(res, 404, {
    title: 'Feed The Bear',
    description: 'Save the places you want to eat and what to order there.',
    body: `<main><header><img class="bear" src="/feedbear-sm.jpg" alt="" /><h1>This page isn't here</h1>
      <p class="lead">The username may have changed, or its page isn't public.</p></header>
      <a class="home" href="/">What is Feed The Bear?</a></main>`,
  });
}

module.exports = async function handler (req, res) {
  if (req.method !== 'GET') { res.setHeader('Allow', 'GET'); return res.status(405).send('Method not allowed'); }
  const handle = String(req.query?.h || '').trim().replace(/^@/, '').toLowerCase();
  if (!HANDLE_RE.test(handle)) return notFound(res);
  const ip = String(req.headers?.['x-forwarded-for'] || '').split(',')[0].trim() || 'unknown';
  try {
    if (await overLimit(`creator:${ip}`, 60, 600)) {
      res.setHeader('Retry-After', '600');
      return res.status(429).send('Slow down a little and try again soon.');
    }
    const db = getAdmin().firestore();
    const ref = db.doc(`handles/${handle}`);
    const h = (await ref.get()).data();
    if (!h?.public || !h.uid || !h.id) return notFound(res);
    const profile = (await db.doc(`profiles/${h.id}`).get()).data();
    if (!profile || profile.uid !== h.uid) return notFound(res);
    // Counted for the creator ("120 visits"). Approximate is fine.
    ref.set({ ...h, views: (Number(h.views) || 0) + 1 }).catch(() => {});

    const name = str(profile.u || h.u || handle, 30);
    const picks = cleanPicks(profile.profile?.picks);
    const orders = picks.reduce((n, p) => n + p.g.length, 0);
    // The cave (theme + decorations) rides in the live profile — but that
    // doc is published with a full overwrite from whatever the phone had
    // at the time, so one publish from a device that hadn't loaded the
    // saved cave yet wipes it back to the cozy default (and the points
    // with it), and the page then shows the default until a good publish
    // lands. The profile under users/{uid}/meta/profile is the source of
    // truth: it is merge-written, keyed by the stable uid (not the share
    // id, which can change), and it carries the saved cave, the points
    // total, and the photo. Read it and let it win whenever the live
    // profile has fallen back to the default. A failed read must never
    // break the page: live-only is the fallback.
    let saved = {};
    try { saved = (await db.doc(`users/${h.uid}/meta/profile`).get()).data() || {}; } catch { saved = {}; }
    const liveCave = normalizeCave(profile.profile?.cave);
    const savedCave = normalizeCave(saved.cave);
    const isDefaultCave = c => c.theme === 'cozy' && c.decor.length === 2 && c.decor[0] === 'lights' && c.decor[1] === 'plant' && !(c.furniture && c.furniture.length);
    const cave = !isDefaultCave(savedCave) ? savedCave : liveCave;
    // Add-on rooms: the union of the saved profile (source of truth) and
    // the live profile publish — rooms are only ever added, never removed,
    // so the union is safe when one publish is stale. Unknown ids drop out.
    const rooms = [...new Set([
      ...(Array.isArray(saved.caveRooms) ? saved.caveRooms : []),
      ...(Array.isArray(profile.profile?.rooms) ? profile.profile.rooms : []),
    ].map(x => String(x)).filter(id => CAVE_ROOMS[id]))];
    // 3D-scene themes show just the one scene image — pasting decor or
    // furniture on top would rebuild the collage. Graded shop themes
    // still show the placed pieces.
    const is3dScene = CAVE_3D_SCENES.has(cave.theme);
    const decorRow = is3dScene ? '' : cave.decor.map(id => `<img class="cave-decor-item decor-${id}" src="/assets/caves/${CAVE_DECOR_PHOTOS[id]}" alt="${esc(CAVE_DECOR_LABELS[id])}" onerror="this.remove()" />`).join('');
    const furnitureRow = is3dScene ? '' : (cave.furniture || []).map(id => `<img class="cave-decor-item furn-${id}" src="/assets/caves/${CAVE_FURNITURE_PHOTOS[id]}" alt="${esc(CAVE_FURNITURE_LABELS[id])}" onerror="this.remove()" />`).join('');
    const livePts = Math.max(0, Math.floor(Number(profile.profile?.pts) || 0));
    const savedPts = Math.max(0, Math.floor(Number(saved.pts) || 0));
    const cavePts = livePts > 0 ? livePts : savedPts;
    const pointsRow = cavePts > 0 ? `<span class="cave-points">${cavePts} cave point${cavePts === 1 ? '' : 's'}</span>` : '';
    // The header shows the creator's own photo when the saved profile has
    // one (a compressed data URL or an https link); otherwise the bear.
    const photoSrc = (() => {
      const p = String(saved.photo || '');
      if (/^https:\/\//i.test(p) && p.length <= 300) return p;
      if (/^data:image\/(jpeg|png|webp|gif);base64,[A-Za-z0-9+/=]+$/.test(p) && p.length <= 300000) return p;
      return '/feedbear-sm.jpg';
    })();
    const voteBox = `<div class="cave-vote">
  <button type="button" id="cave-vote-btn" data-share="${esc(h.id)}">Love this cave?</button>
  <div id="cave-vote-count" class="cave-vote-count"></div>
</div>
<script>
(function () {
  // The cave owner viewing their own page: no vote button, no gift
  // section, no follow CTA — you can't vote for, gift, or follow your
  // own cave. The page is server-rendered and doesn't know who the
  // viewer is, so the signed-in uid comes from localStorage (the same
  // keys the app uses) and the owner uid is embedded in the page.
  var ownerUid = ${JSON.stringify(h.uid)};
  window.__ftbOwnerUid = ownerUid;
  function signedInUid () {
    try { return localStorage.getItem('ftb_data_owner_v1') || localStorage.getItem('ftb_uid_v1') || ''; } catch (e) { return ''; }
  }
  window.__ftbSignedInUid = signedInUid;
  function isOwner () { var uid = signedInUid(); return !!uid && uid === ownerUid; }
  window.__ftbIsOwner = isOwner;
  // +2 cave points for loving a cave (once per cave per day, only if
  // you're signed into the app on this device). Verified server-side
  // against the vote itself (api/cave-points.js). The gift script below
  // reuses this.
  window.awardCavePoints = function (action, shareId, voterId) {
    try {
      var uid = signedInUid();
      if (!uid) return;
      fetch('/api/cave-points', { method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: action, share: shareId, voter: voterId, uid: uid }) }).catch(function () {});
    } catch (e) { /* private mode */ }
  };
  var btn = document.getElementById('cave-vote-btn');
  var count = document.getElementById('cave-vote-count');
  if (!btn || !count) return;
  var share = btn.getAttribute('data-share');
  var voter = 'anon';
  try {
    voter = localStorage.getItem('ftb_voter_id') || '';
    if (!voter) {
      voter = Array.from(crypto.getRandomValues(new Uint8Array(12)), function (b) { return b.toString(16).padStart(2, '0'); }).join('');
      localStorage.setItem('ftb_voter_id', voter);
    }
  } catch (e) { voter = 'anon'; }
  var voted = false;
  // The owner sees no vote button at all — hide it right away, before
  // the count loads, so it never flashes.
  if (isOwner()) { btn.style.display = 'none'; count.textContent = 'This is your cave'; }
  function render (state) {
    voted = !!state.voted;
    var n = Number(state.count) || 0;
    if (isOwner()) {
      btn.style.display = 'none';
      count.textContent = n === 0 ? 'This is your cave' : 'This is your cave — ' + n + (n === 1 ? ' person loves' : ' people love') + ' this cave';
      return;
    }
    count.textContent = n === 1 ? '1 person loves this cave' : n + ' people love this cave';
    btn.textContent = voted ? 'You love this cave — tap to undo' : 'Love this cave?';
  }
  function load () {
    fetch('/api/cave-vote?share=' + encodeURIComponent(share) + '&voter=' + encodeURIComponent(voter))
      .then(function (r) { return r.json(); }).then(render).catch(function () { if (!isOwner()) count.textContent = ''; });
  }
  btn.addEventListener('click', function () {
    var wasVote = !voted;
    fetch('/api/cave-vote', { method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ action: voted ? 'unvote' : 'vote', share: share, voter: voter, uid: signedInUid() }) })
      .then(function (r) { return r.json(); }).then(function (d) { render(d); if (wasVote && d.voted) awardCavePoints('vote', share, voter); }).catch(function () {});
  });
  load();
})();
</script>`;
    // Leave a gift: a visitor picks one small gift for the cave owner —
    // a food for their pantry or a decor piece for their cave. One gift
    // per visitor per day, free, no account needed (api/cave-gift.js).
    const GIFT_OPTIONS = [
      { kind: 'food', id: 'pie', label: 'Pie', img: '/assets/food/pie.jpg' },
      { kind: 'food', id: 'taco', label: 'Taco', img: '/assets/food/tacos.jpg' },
      { kind: 'food', id: 'donut', label: 'Donut', img: '/assets/food/donut.jpg' },
      { kind: 'food', id: 'pizza', label: 'Pizza', img: '/assets/food/pizza.jpg' },
      { kind: 'decor', id: 'lantern', label: 'Lantern glow', img: '/assets/caves/decor-lantern.jpg' },
      { kind: 'decor', id: 'honeypot', label: 'Honey pot', img: '/assets/caves/decor-honeypot.jpg' },
    ];
    const giftBox = `<div class="cave-gift">
  <h2>Leave a gift</h2>
  <p>Pick one small gift for ${esc(name)} — a food for their pantry or a decor piece for their cave. One gift a day, free.</p>
  <div class="cave-gift-row">${GIFT_OPTIONS.map(g => `<button type="button" class="cave-gift-chip" data-gift-kind="${g.kind}" data-gift-id="${g.id}"><img src="${g.img}" alt="" loading="lazy" onerror="this.style.display='none'" />${esc(g.label)}</button>`).join('')}</div>
  <div id="cave-gift-note" class="cave-gift-note"></div>
</div>
<script>
(function () {
  var chips = document.querySelectorAll('.cave-gift-chip');
  var note = document.getElementById('cave-gift-note');
  if (!chips.length || !note) return;
  var share = ${JSON.stringify(h.id)};
  var voter = 'anon';
  try {
    voter = localStorage.getItem('ftb_voter_id') || '';
    if (!voter) {
      voter = Array.from(crypto.getRandomValues(new Uint8Array(12)), function (b) { return b.toString(16).padStart(2, '0'); }).join('');
      localStorage.setItem('ftb_voter_id', voter);
    }
  } catch (e) { voter = 'anon'; }
  function disable (msg) {
    chips.forEach(function (c) { c.disabled = true; });
    if (msg) note.textContent = msg;
  }
  // The owner can't gift their own cave — gifts come from visitors.
  if (typeof window.__ftbIsOwner === 'function' && window.__ftbIsOwner()) { disable('This is your cave — gifts come from your visitors.'); return; }
  fetch('/api/cave-gift?share=' + encodeURIComponent(share) + '&voter=' + encodeURIComponent(voter))
    .then(function (r) { return r.json(); })
    .then(function (d) { if (d.giftedToday) disable('You already left a gift today — come back tomorrow.'); })
    .catch(function () {});
  chips.forEach(function (chip) {
    chip.addEventListener('click', function () {
      var kind = chip.getAttribute('data-gift-kind');
      var id = chip.getAttribute('data-gift-id');
      fetch('/api/cave-gift', { method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ share: share, voter: voter, uid: (typeof window.__ftbSignedInUid === 'function' ? window.__ftbSignedInUid() : ''), gift: { kind: kind, id: id } }) })
        .then(function (r) { return r.json().then(function (d) { return { status: r.status, d: d }; }); })
        .then(function (res) {
          if (res.status === 200 && res.d.ok) { disable('Gift sent — thanks for making their day!'); if (typeof window.awardCavePoints === 'function') window.awardCavePoints('giftGiven', share, voter); }
          else if (res.d && res.d.error) note.textContent = res.d.error;
          else note.textContent = 'That did not go through. Try again in a moment.';
        })
        .catch(function () { note.textContent = 'That did not go through. Try again in a moment.'; });
    });
  });
})();
</script>`;
    // Room tabs: Living Room (the theme scene) plus every room the owner
    // has earned. Tapping one swaps the scene to that room's 3D picture
    // and the caption to the room's name. No rooms, no tabs.
    const roomTabs = rooms.length ? `<div class="cave-room-tabs"><button type="button" class="cave-room-tab on" data-room="">Living Room</button>${rooms.map(id => `<button type="button" class="cave-room-tab" data-room="${id}">${esc(CAVE_ROOMS[id].label)}</button>`).join('')}</div>
<script>
// The caption sits below the tabs in the page, so wait for the whole
// document before wiring the tabs up — running at parse time would find
// no caption and bail out before attaching anything.
document.addEventListener('DOMContentLoaded', function () {
  var tabs = document.querySelectorAll('.cave-room-tab');
  var label = document.getElementById('cave-caption-label');
  var mainLabel = ${JSON.stringify(CAVE_THEME_LABELS[cave.theme] || 'Cozy Cave')};
  var roomLabels = ${JSON.stringify(Object.fromEntries(rooms.map(id => [id, CAVE_ROOMS[id].label])))};
  if (!tabs.length) return;
  tabs.forEach(function (tab) {
    tab.addEventListener('click', function () {
      var room = tab.getAttribute('data-room');
      if (room) document.body.setAttribute('data-cave-room', room);
      else document.body.removeAttribute('data-cave-room');
      tabs.forEach(function (t) { t.classList.toggle('on', t === tab); });
      if (label) label.textContent = room ? roomLabels[room] : mainLabel;
    });
  });
});
</script>` : '';
    // The app's own profile-link format, so tapping Join follows them with these spots.
    const link = { v: 2, id: str(h.id, 40), u: name, picks, w: [], ts: Date.now() };
    const hash = Buffer.from(JSON.stringify(link), 'utf8').toString('base64');
    const ref2 = /^[A-Za-z0-9]{10,64}$/.test(h.uid) ? `&ref=${encodeURIComponent(h.uid)}` : '';
    const join = `/app.html?accept=1${ref2}&src=${encodeURIComponent(handle)}#profile=${hash}`;

    const spots = picks.length
      ? picks.map(p => `<div class="spot">
          <div class="ph">${p.p ? `<img src="${esc(p.p)}" alt="" loading="lazy" />` : emojiFor(p.c)}</div>
          <div class="body">
            <div class="name">${esc(p.n)}</div>
            <div class="meta">${esc([p.c, p.a].filter(Boolean).join(' · '))}${p.r ? ` <span class="stars">${'★'.repeat(p.r)}</span>` : ''}</div>
            ${p.g.length ? `<div class="get"><b>Get:</b> ${p.g.map(esc).join(', ')}</div>` : ''}
            ${p.s.length ? `<div class="skip">Skip: ${p.s.map(esc).join(', ')}</div>` : ''}
          </div>
        </div>`).join('')
      : `<div class="empty">${esc(name)} is just getting started. Follow along and their spots show up as they add them.</div>`;

    const description = picks.length
      ? `${picks.length} spots${orders ? ` and ${orders} go-to orders` : ''} from ${name}. Save them to your own list on Feed The Bear, free.`
      : `Follow ${name} on Feed The Bear to see where they eat and what they order.`;
    return page(res, 200, {
      title: `${name}'s food spots`,
      description,
      url: `${SITE}/@${handle}`,
      theme: cave.theme,
      body: `<main>
  <div class="cave-home-row"><a class="cave-home" href="/app.html">Home</a></div>
  <header>
    <img class="bear" src="${esc(photoSrc)}" alt="" />
    <h1>${esc(name)}'s food spots</h1>
    <div class="handle">@${esc(handle)}</div>
    <div class="cave-scene"><div class="cave-decor" aria-hidden="true">${decorRow}${furnitureRow}</div></div>
    ${roomTabs}
    <div class="cave-caption"><span class="cave-theme" id="cave-caption-label">${esc(CAVE_THEME_LABELS[cave.theme])}</span>${pointsRow}</div>
    <p class="lead">Where ${esc(name)} eats and exactly what to order.</p>
  </header>
  ${voteBox}
  ${giftBox}
  <section class="spots">${spots}</section>
  <a class="home" href="/">What is Feed The Bear?</a>
</main>
<div class="cta">
  <a href="${esc(join)}">Follow ${esc(name)} &amp; save these spots</a>
  <small>Free · You also get 30 days of Grizzly free</small>
</div>
<script>
// You can't follow your own cave: hide the follow CTA when the viewer
// is the owner (same localStorage uid check as the vote/gift scripts).
(function () {
  try {
    var owner = window.__ftbOwnerUid || ${JSON.stringify(h.uid)};
    var uid = localStorage.getItem('ftb_data_owner_v1') || localStorage.getItem('ftb_uid_v1') || '';
    if (owner && uid && uid === owner) {
      var cta = document.querySelector('.cta');
      if (cta) cta.style.display = 'none';
    }
  } catch (e) { /* private mode */ }
})();
</script>`,
    });
  } catch (err) {
    console.error('[FTB] creator page error:', err.message);
    return notFound(res);
  }
};
