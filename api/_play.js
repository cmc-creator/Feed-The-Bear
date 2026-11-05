/* ════════════════════════════════════════════════════════════
   Feed The Bear - Google Play US alternative billing reports
   ════════════════════════════════════════════════════════════
   Grizzly bought inside the Play app is paid with Stripe, and Google requires
   each of those sales reported within 24 hours (Play Developer API,
   externalTransactions). The app gets a token from Google before checkout
   (PlayBillingPlugin.java → firebase.js → create-checkout.js keeps it in
   playCheckouts/{sessionId}); stripe-webhook.js calls in here:

     reportStart   checkout done: the first transaction with that token
                   ($0 for a free trial, otherwise what was charged)
     reportRenewal each later paid invoice, pointing at the first one
     reportRefund  a refunded charge

   Sales on the website, or in the app without a token, aren't reported.
   playSubs/{subId} remembers the first transaction for renewals;
   playTx/{invoiceId} maps invoices to transactions for refunds.
   A report that fails is kept in playPending/{id} and retried on the next
   webhook call, well inside the 24 hours.

   Needs: FIREBASE_SERVICE_ACCOUNT (the same service account signs in to
   Google), with that account invited in Play Console → Users and
   permissions → "View financial data", and the Google Play Android
   Developer API turned on in its Google Cloud project.
   ════════════════════════════════════════════════════════════ */

const crypto = require('crypto');

const PACKAGE = 'com.feedthebear.app';
const API = `https://androidpublisher.googleapis.com/androidpublisher/v3/applications/${PACKAGE}/externalTransactions`;

let _token = { value: '', exp: 0 };

// OAuth access token for the service account (JWT bearer grant).
async function accessToken () {
  if (_token.value && Date.now() < _token.exp - 60000) return _token.value;
  const sa = JSON.parse(process.env.FIREBASE_SERVICE_ACCOUNT || '{}');
  if (!sa.client_email || !sa.private_key) throw new Error('No service account for Google Play');
  const now = Math.floor(Date.now() / 1000);
  const b64 = o => Buffer.from(JSON.stringify(o)).toString('base64url');
  const unsigned = `${b64({ alg: 'RS256', typ: 'JWT' })}.${b64({
    iss: sa.client_email, scope: 'https://www.googleapis.com/auth/androidpublisher',
    aud: 'https://oauth2.googleapis.com/token', iat: now, exp: now + 3600,
  })}`;
  const signature = crypto.createSign('RSA-SHA256').update(unsigned).sign(sa.private_key, 'base64url');
  const resp = await fetch('https://oauth2.googleapis.com/token', {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({ grant_type: 'urn:ietf:params:oauth:grant-type:jwt-bearer', assertion: `${unsigned}.${signature}` }),
  });
  const data = await resp.json();
  if (!resp.ok || !data.access_token) throw new Error(`Google sign-in failed (${resp.status})`);
  _token = { value: data.access_token, exp: Date.now() + (data.expires_in || 3600) * 1000 };
  return _token.value;
}

const money = cents => ({ priceMicros: String(Math.max(0, Math.round(cents || 0)) * 10000), currency: 'USD' });

// POST to Google. Already reported (409) counts as done, so retries are safe.
async function send (url, body) {
  const resp = await fetch(url, {
    method: 'POST',
    headers: { Authorization: `Bearer ${await accessToken()}`, 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
  if (resp.ok || resp.status === 409) return;
  throw new Error(`Google Play report failed (${resp.status}): ${(await resp.text()).slice(0, 200)}`);
}

// Sends now; if Google can't be reached, keeps it for the next webhook call.
async function deliver (db, id, url, body) {
  try {
    await send(url, body);
    await db.doc(`playPending/${id}`).delete().catch(() => {});
  } catch (err) {
    console.error('[FTB] play report:', err.message);
    await db.doc(`playPending/${id}`).set({ url, body, at: new Date().toISOString(), error: err.message.slice(0, 300) });
  }
}

const createUrl = id => `${API}?externalTransactionId=${encodeURIComponent(id)}`;

function transaction ({ preTaxCents, taxCents, time, recurring }) {
  return {
    originalPreTaxAmount: money(preTaxCents),
    originalTaxAmount: money(taxCents),
    transactionTime: new Date(time).toISOString(),
    recurringTransaction: { ...recurring, externalSubscription: { subscriptionType: 'RECURRING' } },
    userTaxAddress: { regionCode: 'US' },
  };
}

// Tax on a Stripe invoice (newer API: total_taxes; older: tax).
function invoiceTax (invoice) {
  if (Array.isArray(invoice?.total_taxes)) return invoice.total_taxes.reduce((n, t) => n + (t.amount || 0), 0);
  return invoice?.tax || 0;
}

// Checkout finished. session: the Stripe Checkout Session; sub: its subscription;
// invoice: its first invoice (null if unknown). Nothing if bought outside the Play app.
async function reportStart (db, { session, sub, invoice }) {
  const saved = await db.doc(`playCheckouts/${session.id}`).get();
  if (!saved.exists || !sub) return;
  const id = `ftb_${sub.id}_start`;
  const trial = sub.status === 'trialing';
  const paid = trial ? 0 : (invoice ? invoice.amount_paid : session.amount_total) || 0;
  const tax = trial ? 0 : invoice ? invoiceTax(invoice) : (session.total_details?.amount_tax || 0);
  await db.doc(`playSubs/${sub.id}`).set({ initialId: id, uid: saved.data().uid || '', firstInvoice: trial ? '' : (invoice?.id || session.invoice || '') });
  if (!trial && (invoice?.id || session.invoice)) await db.doc(`playTx/${invoice?.id || session.invoice}`).set({ id });
  await deliver(db, id, createUrl(id), transaction({
    preTaxCents: paid - tax, taxCents: tax, time: (session.created || Date.now() / 1000) * 1000,
    recurring: { externalTransactionToken: saved.data().token },
  }));
  await db.doc(`playCheckouts/${session.id}`).delete().catch(() => {});
}

// A paid invoice on a Play subscription, after the first one.
async function reportRenewal (db, invoice, subId) {
  if (!subId || !(invoice.amount_paid > 0)) return;
  const play = await db.doc(`playSubs/${subId}`).get();
  if (!play.exists || play.data().firstInvoice === invoice.id) return;
  const id = `ftb_${invoice.id}`;
  await db.doc(`playTx/${invoice.id}`).set({ id });
  const tax = invoiceTax(invoice);
  await deliver(db, id, createUrl(id), transaction({
    preTaxCents: invoice.amount_paid - tax, taxCents: tax,
    time: (invoice.status_transitions?.paid_at || invoice.created || Date.now() / 1000) * 1000,
    recurring: { initialExternalTransactionId: play.data().initialId },
  }));
}

// A refunded Stripe charge on a reported invoice: full or partial.
async function reportRefund (db, charge) {
  const invoiceId = typeof charge.invoice === 'string' ? charge.invoice : charge.invoice?.id;
  if (!invoiceId || !charge.amount_refunded) return;
  const tx = await db.doc(`playTx/${invoiceId}`).get();
  if (!tx.exists) return;
  const full = charge.amount_refunded >= charge.amount;
  const body = {
    refundTime: new Date().toISOString(),
    ...(full ? { fullRefund: {} } : { partialRefund: { refundId: `ftb_${charge.id}_${charge.amount_refunded}`, refundPreTaxAmount: money(charge.amount_refunded) } }),
  };
  const id = `${tx.data().id}_refund_${charge.amount_refunded}`;
  await deliver(db, id, `${API}/${encodeURIComponent(tx.data().id)}:refund`, body);
}

// Retries reports that failed earlier (a few per call).
async function retryPending (db) {
  try {
    const snap = await db.collection('playPending').limit(5).get();
    for (const doc of snap.docs) {
      const { url, body } = doc.data();
      try { await send(url, body); await doc.ref.delete(); } catch (err) { console.warn('[FTB] play retry:', err.message); }
    }
  } catch (err) { console.warn('[FTB] play retry list:', err.message); }
}

module.exports = { reportStart, reportRenewal, reportRefund, retryPending, _test: { transaction, invoiceTax, setFetchToken: v => { _token = v; } } };
