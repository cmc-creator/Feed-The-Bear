/* ════════════════════════════════════════════════════════════
   Feed The Bear - Vercel Serverless: Cave of the Day
   ════════════════════════════════════════════════════════════
   The daily featured cave for the app home screen: the public cave
   with the most "Love this cave?" votes in the last 24 hours.
   Vote docs carry `at` (ISO, written by api/cave-vote.js); votes
   without it predate the timestamp and count as recent. No votes
   at all today -> Connie's own cave (feedthebear32) is the default,
   so the slot is never empty. Computed on load from the vote data —
   no cron, no stored winner. Short cache (5 min).
     GET  -> { handle, name, theme, themeLabel, scene, points, votes, url }

   Environment: FIREBASE_SERVICE_ACCOUNT (same as verify-session.js)
   ════════════════════════════════════════════════════════════ */

const admin = require('firebase-admin');

const CONNIE_HANDLE = 'feedthebear32';
const CONNIE_NAME = 'Connie';
const DAY_MS = 24 * 60 * 60 * 1000;

// Theme -> scene image (mirrors api/creator.js CAVE_PHOTOS). 3D scenes
// for the base + seasonal themes, the graded photo for shop themes.
const CAVE_SCENES = {
  cozy: 'scene-cozy-3d.jpg', forest: 'scene-forest-3d.jpg', neon: 'scene-neon-3d.jpg',
  pastel: 'scene-pastel-3d.jpg', witchy: 'scene-witchy-3d.jpg', elf: 'scene-elf-3d.jpg',
  cute: 'scene-cute-3d.jpg', mancave: 'scene-mancave-3d.jpg', beach: 'scene-beach-3d.jpg',
  winter: 'scene-winter-3d.jpg', cosmic: 'scene-cosmic-3d.jpg', jungle: 'scene-jungle-3d.jpg',
  den: 'scene-den-3d.jpg', grotto: 'scene-grotto-3d.jpg', lookout: 'scene-lookout-3d.jpg',
  arch: 'scene-arch-3d.jpg', midnight: 'theme-forest.jpg', golden: 'theme-arch.jpg',
  misty: 'theme-grotto.jpg', ember: 'theme-den.jpg', aurora: 'theme-cosmic.jpg',
  royal: 'theme-cozy.jpg', halloween: 'scene-halloween-3d.jpg', christmas: 'scene-christmas-3d.jpg',
};
const CAVE_THEME_LABELS = {
  cozy: 'Cozy Cave', forest: 'Forest Cave', neon: 'Neon Cave', pastel: 'Pastel Cave',
  witchy: 'Witchy Cave', elf: 'Elf Cave', cute: 'Cute Cave', mancave: 'Man Cave',
  beach: 'Beach Cave', winter: 'Winter Cave', cosmic: 'Cosmic Cave', jungle: 'Jungle Cave',
  den: 'Bear Den', grotto: 'Grotto', lookout: 'Mountain Lookout', arch: 'Stone Arch',
  midnight: 'Midnight Den', golden: 'Golden Hour Cave', misty: 'Misty Hollow',
  ember: 'Ember Grotto', aurora: 'Aurora Cave', royal: 'Royal Bear Suite',
  halloween: 'Halloween Cave', christmas: 'Christmas Cave',
};

function getAdmin () {
  if (!admin.apps.length) {
    const raw = process.env.FIREBASE_SERVICE_ACCOUNT;
    if (!raw) throw new Error('FIREBASE_SERVICE_ACCOUNT env var is not set');
    admin.initializeApp({ credential: admin.credential.cert(JSON.parse(raw)) });
  }
  return admin;
}

// The theme from a cave value ({theme} or the short link form {t}).
// Unknown themes fall back to cozy.
function caveThemeOf (cave) {
  const t = cave && (cave.theme || cave.t);
  return CAVE_SCENES[t] ? t : 'cozy';
}

module.exports = async function handler (req, res) {
  if (req.method !== 'GET') { res.setHeader('Allow', 'GET'); return res.status(405).json({ error: 'Method not allowed' }); }
  res.setHeader('Cache-Control', 'public, max-age=300');
  let db;
  try { db = getAdmin().firestore(); } catch (err) {
    console.error('[FTB] cave of the day init failed:', err.message);
    return res.status(503).json({ error: 'Cave of the Day is not available right now.' });
  }

  try {
    const cutoff = Date.now() - DAY_MS;
    const handlesSnap = await db.collection('handles').get();
    const handles = (handlesSnap.docs || [])
      .map(d => ({ handle: d.id, ...(d.data() || {}) }))
      .filter(h => h.public && h.uid && h.id)
      .sort((a, b) => String(a.handle).localeCompare(String(b.handle)));
    if (!handles.length) {
      return res.status(200).json({
        handle: CONNIE_HANDLE, name: CONNIE_NAME, theme: 'forest',
        themeLabel: CAVE_THEME_LABELS.forest, scene: CAVE_SCENES.forest,
        points: 0, votes: 0, url: `/@${CONNIE_HANDLE}`, fallback: true,
      });
    }

    let best = null;
    for (const h of handles) {
      let votes = 0;
      try {
        const votesSnap = await db.collection(`caveVotes/${h.id}/votes`).get();
        votes = (votesSnap.docs || []).filter(d => {
          const at = d.data()?.at;
          if (!at) return true; // pre-timestamp votes are from the last few days
          const t = new Date(at).getTime();
          return Number.isFinite(t) && t >= cutoff;
        }).length;
      } catch { votes = 0; }
      if (!best || votes > best.votes) best = { ...h, votes };
    }

    // Nobody got a vote in the last day: feature Connie's cave.
    const winner = (best && best.votes > 0) ? best
      : (handles.find(h => h.handle === CONNIE_HANDLE) || handles[0]);
    const votes = (best && best.votes > 0) ? best.votes : 0;

    // The winner's cave (same saved-profile fallback as the public page:
    // the live profile can fall back to the cozy default after a stale
    // publish, so the saved profile wins when it is not the default).
    let theme = 'cozy';
    let name = String(winner.u || winner.handle || CONNIE_NAME).slice(0, 30);
    let points = 0;
    try {
      const profile = (await db.doc(`profiles/${winner.id}`).get()).data() || {};
      if (typeof profile.u === 'string' && profile.u.trim()) name = profile.u.trim().slice(0, 30);
      const liveCave = profile.profile?.cave;
      theme = caveThemeOf(liveCave);
      points = Math.max(0, Math.floor(Number(profile.profile?.pts) || 0));
      let saved = {};
      try { saved = (await db.doc(`users/${winner.uid}/meta/profile`).get()).data() || {}; } catch { saved = {}; }
      const savedTheme = caveThemeOf(saved.cave);
      const isDefault = theme === 'cozy'
        && JSON.stringify((liveCave?.d || liveCave?.decor) || []) === JSON.stringify(['lights', 'plant']);
      if (isDefault && savedTheme !== 'cozy') theme = savedTheme;
      points = Math.max(points, Math.max(0, Math.floor(Number(saved.pts) || 0)));
    } catch { /* live-only fallback: cozy theme, handle name */ }

    return res.status(200).json({
      handle: winner.handle, name, theme,
      themeLabel: CAVE_THEME_LABELS[theme] || 'Cozy Cave',
      scene: CAVE_SCENES[theme] || CAVE_SCENES.cozy,
      points, votes, url: `/@${winner.handle}`,
    });
  } catch (err) {
    console.error('[FTB] cave of the day error:', err.message);
    return res.status(500).json({ error: 'That did not work. Please try again.' });
  }
};
