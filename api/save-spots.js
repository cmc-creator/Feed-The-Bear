/* ════════════════════════════════════════════════════════════
   Feed The Bear - Vercel Serverless: Save restaurant spots
   ════════════════════════════════════════════════════════════
   The ONLY way spots reach the cloud. The app (firebase.js
   fbSaveRestaurants / fbDeleteRestaurantsCloud) calls this
   instead of writing Firestore directly, and firestore.rules
   blocks direct client writes to users/{uid}/restaurants, so
   the free-spot limit can't be bypassed from DevTools.

   POST, Authorization: Bearer <Firebase ID token>, JSON body:
     { spots: [restaurant, ...], removeIds: [id, ...] }
   - spots: the full list (or a chunk of it) to save. Each spot
     must have a string id; oversized docs are skipped.
   - removeIds: spot ids to delete from the cloud.
   -> { saved, skipped, removed, limit, plan }

   Free (Cub) accounts may keep at most 25 spots in the cloud.
   Paying Grizzly accounts are unlimited. Accounts that already
   have more than 25 spots keep them (grandfathered) but can't
   grow: the cap is max(existing count, 25) for free accounts.
   Updating a spot you already have always works, so edits and
   re-saves never fail for free accounts at the limit.

   Email accounts created after 2026-11-10 must confirm their inbox before
   spots sync to the cloud (unverified signups keep spots on the device
   until then). Google accounts and older accounts are unaffected.

   Environment variables required (set in Vercel dashboard):
     FIREBASE_SERVICE_ACCOUNT - Stringified JSON service account key
   ════════════════════════════════════════════════════════════ */

const admin = require('firebase-admin');

const FREE_SPOT_LIMIT = 25;
// Email verification (2026-11-10): accounts created after this must confirm
// their inbox before spots sync to the cloud (same cutoff as api/_guard.js).
// Google accounts and confirmed emails carry email_verified; older accounts
// are grandfathered by creation date. The client keeps spots on the device
// until then and retries after verification.
const EMAIL_VERIFY_CUTOFF = Date.parse('2026-11-10T21:00:00Z');
// Firestore rejects documents over 1 MiB; the client trims photos to
// 900 KiB, so anything bigger here is a direct-API caller.
const MAX_DOC_BYTES = 900 * 1024;
const MAX_ID_LEN = 200;

function getAdmin () {
  if (!admin.apps.length) {
    const raw = process.env.FIREBASE_SERVICE_ACCOUNT;
    if (!raw) throw new Error('FIREBASE_SERVICE_ACCOUNT env var is not set');
    admin.initializeApp({ credential: admin.credential.cert(JSON.parse(raw)) });
  }
  return admin;
}

function cleanId (v) {
  return typeof v === 'string' && v.length > 0 && v.length <= MAX_ID_LEN && !v.includes('/') ? v : '';
}

module.exports = async function handler (req, res) {
  res.setHeader('Cache-Control', 'no-store');
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  let uid, decoded;
  try {
    const token = String(req.headers.authorization || '').replace(/^Bearer\s+/i, '');
    decoded = await getAdmin().auth().verifyIdToken(token);
    uid = decoded.uid;
  } catch {
    return res.status(401).json({ error: 'Sign in first' });
  }
  // Unverified email accounts created after verification was added can't sync
  // spots to the cloud. If the record can't be read, don't break the app for
  // a signed-in member.
  if (decoded.email_verified === false) {
    let grandfathered = true;
    try {
      const rec = await getAdmin().auth().getUser(uid);
      const created = Date.parse(rec.metadata.creationTime || '') || 0;
      grandfathered = created < EMAIL_VERIFY_CUTOFF;
    } catch { /* can't tell: fail open */ }
    if (!grandfathered) return res.status(403).json({ error: 'Verify your email to back up your spots. Check your inbox for the link.' });
  }

  const body = typeof req.body === 'string' ? (() => { try { return JSON.parse(req.body); } catch { return {}; } })() : (req.body || {});
  const spots = Array.isArray(body.spots) ? body.spots : [];
  const removeIds = (Array.isArray(body.removeIds) ? body.removeIds : []).map(cleanId).filter(Boolean);
  if (!spots.length && !removeIds.length) return res.status(200).json({ saved: 0, skipped: 0, removed: 0, limit: FREE_SPOT_LIMIT, plan: 'free' });

  try {
    const db = getAdmin().firestore();
    const col = db.collection(`users/${uid}/restaurants`);
    const plan = (await db.doc(`users/${uid}/meta/profile`).get()).data()?.plan === 'grizzly' ? 'grizzly' : 'free';

    // Which spot ids already exist, so edits to them always work.
    const existing = new Set((await col.select().get()).docs.map(d => d.id));
    const cap = plan === 'grizzly' ? Infinity : Math.max(existing.size, FREE_SPOT_LIMIT);
    let count = existing.size;
    let saved = 0;
    let skipped = 0;
    let removed = 0;

    // Write in Firestore batches of 400 (the per-batch limit).
    const batchOf = () => db.batch();
    let batch = batchOf();
    let inBatch = 0;
    const flush = async () => { if (inBatch) { await batch.commit(); batch = batchOf(); inBatch = 0; } };

    for (const spot of spots) {
      const id = cleanId(spot?.id);
      if (!id) { skipped++; continue; }
      const isNew = !existing.has(id);
      if (isNew && count >= cap) { skipped++; continue; }
      let json;
      try { json = JSON.stringify(spot); } catch { skipped++; continue; }
      if (json.length > MAX_DOC_BYTES) { skipped++; continue; }
      batch.set(col.doc(id), spot);
      inBatch++;
      if (isNew) { existing.add(id); count++; }
      saved++;
      if (inBatch >= 400) await flush();
    }
    for (const id of [...new Set(removeIds)]) {
      if (!existing.has(id)) continue;
      batch.delete(col.doc(id));
      inBatch++;
      existing.delete(id);
      count--;
      removed++;
      if (inBatch >= 400) await flush();
    }
    await flush();

    return res.status(200).json({ saved, skipped, removed, limit: plan === 'grizzly' ? null : cap, plan });
  } catch (err) {
    console.error('[FTB] save-spots error:', err.message);
    return res.status(500).json({ error: 'Could not save your spots. Try again.' });
  }
};
