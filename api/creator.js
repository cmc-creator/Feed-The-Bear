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
const CAVE_THEMES = { cozy: '🧸', forest: '🌲', neon: '⚡', pastel: '🌸' };
const CAVE_DECOR = { lights: '✨', rug: '🧶', posters: '🖼️', plant: '🪴', trophy: '🏆', candle: '🕯️' };
const CAVE_THEME_LABELS = { cozy: 'Cozy Den', forest: 'Forest', neon: 'Neon', pastel: 'Pastel' };
function normalizeCave (raw) {
  const src = raw && typeof raw === 'object' ? raw : {};
  const theme = CAVE_THEMES[src.theme || src.t] ? (src.theme || src.t) : 'cozy';
  const list = Array.isArray(src.decor) ? src.decor : (Array.isArray(src.d) ? src.d : null);
  const decor = list === null ? ['lights', 'plant']
    : [...new Set(list.map(x => String(x)).filter(id => CAVE_DECOR[id]))].slice(0, 4);
  return { theme, decor };
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
  <meta name="viewport" content="width=device-width, initial-scale=1.0" />
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
    body[data-cave-theme="cozy"] { --bg: #241a12; --card: #33261a; --accent: #ff8a3d; --gold: #ffd98a; }
    body[data-cave-theme="forest"] { --bg: #122019; --card: #1d2f24; --accent: #7dd87d; --gold: #c9f2b0; }
    body[data-cave-theme="neon"] { --bg: #1c1030; --card: #2a1848; --accent: #ff5da2; --gold: #ffd166; }
    body[data-cave-theme="pastel"] { --bg: #2b2430; --card: #3a3040; --accent: #ffb3d9; --gold: #ffe3a3; }
    * { box-sizing: border-box; }
    body { margin: 0; background: var(--bg); color: var(--text); font: 500 1rem/1.45 system-ui, -apple-system, sans-serif; }
    main { max-width: 520px; margin: 0 auto; padding: 28px 16px 120px; }
    header { text-align: center; margin-bottom: 20px; }
    .bear { width: 72px; height: 72px; border-radius: 50%; object-fit: cover; }
    h1 { font-size: 1.6rem; line-height: 1.2; margin: 12px 0 4px; overflow-wrap: anywhere; }
    .handle { color: var(--gold); font-weight: 700; }
    .lead { color: var(--dim); margin: 6px 0 0; }
    .cave-decor { text-align: center; font-size: 1.35rem; letter-spacing: 8px; margin-top: 12px; }
    .cave-theme { text-align: center; color: var(--dim); font-size: .8rem; margin-top: 4px; }
    .cave-vote { text-align: center; margin-top: 14px; }
    .cave-vote button { border: 0; border-radius: 999px; padding: 10px 18px; background: var(--accent); color: #1b130b; font-weight: 800; font-size: .95rem; cursor: pointer; }
    .cave-vote-count { color: var(--dim); font-size: .82rem; margin-top: 6px; }
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
    // The cave (theme + decorations) rides in the live profile.
    const cave = normalizeCave(profile.profile?.cave);
    const decorRow = cave.decor.map(id => CAVE_DECOR[id]).join(' ');
    const voteBox = `<div class="cave-vote">
  <button type="button" id="cave-vote-btn" data-share="${esc(h.id)}">🐻 Love this cave?</button>
  <div id="cave-vote-count" class="cave-vote-count"></div>
</div>
<script>
(function () {
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
  function render (state) {
    voted = !!state.voted;
    var n = Number(state.count) || 0;
    count.textContent = n === 1 ? '❤️ 1 person loves this cave' : '❤️ ' + n + ' people love this cave';
    btn.textContent = voted ? '❤️ You love this cave — tap to undo' : '🐻 Love this cave?';
  }
  function load () {
    fetch('/api/cave-vote?share=' + encodeURIComponent(share) + '&voter=' + encodeURIComponent(voter))
      .then(function (r) { return r.json(); }).then(render).catch(function () { count.textContent = ''; });
  }
  btn.addEventListener('click', function () {
    fetch('/api/cave-vote', { method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ action: voted ? 'unvote' : 'vote', share: share, voter: voter }) })
      .then(function (r) { return r.json(); }).then(render).catch(function () {});
  });
  load();
})();
</script>`;
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
  <header>
    <img class="bear" src="/feedbear-sm.jpg" alt="" />
    <h1>${esc(name)}'s food spots</h1>
    <div class="handle">@${esc(handle)}</div>
    <div class="cave-decor" aria-hidden="true">${decorRow}</div>
    <div class="cave-theme">${CAVE_THEMES[cave.theme]} ${esc(CAVE_THEME_LABELS[cave.theme])} cave</div>
    <p class="lead">Where ${esc(name)} eats and exactly what to order.</p>
  </header>
  ${voteBox}
  <section class="spots">${spots}</section>
  <a class="home" href="/">What is Feed The Bear?</a>
</main>
<div class="cta">
  <a href="${esc(join)}">Follow ${esc(name)} &amp; save these spots</a>
  <small>Free · You also get 30 days of Grizzly free</small>
</div>`,
    });
  } catch (err) {
    console.error('[FTB] creator page error:', err.message);
    return notFound(res);
  }
};
