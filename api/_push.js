// Sends a notification to a list of phones. Android phones register Firebase
// (FCM) tokens; iPhones register Apple's own token as "apns:<hex>", sent
// straight to Apple with the APNs key (no Firebase SDK in the iPhone app).
// Same answer shape as fb.messaging().sendEachForMulticast, so callers can
// keep dropping dead tokens the same way.
//
// Vercel env for iPhones (Apple Developer → Keys → a key with Apple Push
// Notifications service): APNS_KEY (the .p8 file's text), APNS_KEY_ID,
// APPLE_TEAM_ID. Optional: APNS_TOPIC (default com.feedthebear.app).
const crypto = require('crypto');
const http2 = require('http2');

const DEAD = 'messaging/registration-token-not-registered';
let _jwt = { token: '', at: 0 };

function apnsReady () {
  return !!(process.env.APNS_KEY && process.env.APNS_KEY_ID && process.env.APPLE_TEAM_ID);
}

// Apple wants a short signed token (ES256), reused for up to an hour.
function apnsJwt () {
  if (_jwt.token && Date.now() - _jwt.at < 45 * 60 * 1000) return _jwt.token;
  const b64 = o => Buffer.from(JSON.stringify(o)).toString('base64url');
  const iat = Math.floor(Date.now() / 1000);
  const head = `${b64({ alg: 'ES256', kid: process.env.APNS_KEY_ID })}.${b64({ iss: process.env.APPLE_TEAM_ID, iat })}`;
  const key = String(process.env.APNS_KEY).replace(/\\n/g, '\n');
  const sig = crypto.sign('sha256', Buffer.from(head), { key, dsaEncoding: 'ieee-p1363' }).toString('base64url');
  _jwt = { token: `${head}.${sig}`, at: Date.now() };
  return _jwt.token;
}

function apnsPayload (msg) {
  const { title = '', body = '' } = msg.notification || {};
  return JSON.stringify({ ...(msg.data || {}), aps: { alert: { title, body }, sound: 'default' } });
}

// One HTTP/2 connection to Apple for the batch; each phone gets its own request.
async function sendApns (hexTokens, msg) {
  if (!apnsReady()) return hexTokens.map(() => ({ success: false, error: { code: 'apns/not-configured', message: 'APNs key not set' } }));
  const host = process.env.APNS_SANDBOX ? 'https://api.sandbox.push.apple.com' : 'https://api.push.apple.com';
  const payload = apnsPayload(msg);
  const tag = msg.android?.notification?.tag;
  let session;
  try {
    session = http2.connect(host);
    session.on('error', () => {});
    const jwt = apnsJwt();
    return await Promise.all(hexTokens.map(hex => new Promise(resolve => {
      const headers = {
        ':method': 'POST', ':path': `/3/device/${hex}`,
        authorization: `bearer ${jwt}`,
        'apns-topic': process.env.APNS_TOPIC || 'com.feedthebear.app',
        'apns-push-type': 'alert', 'apns-priority': '10',
        ...(tag ? { 'apns-collapse-id': String(tag).slice(0, 64) } : {}),
      };
      let status = 0;
      let text = '';
      const req = session.request(headers);
      req.setTimeout(10000, () => { req.close(); resolve({ success: false, error: { code: 'apns/timeout', message: 'Apple did not answer' } }); });
      req.on('response', h => { status = h[':status']; });
      req.on('data', c => { text += c; });
      req.on('end', () => {
        if (status === 200) return resolve({ success: true });
        let reason = '';
        try { reason = JSON.parse(text).reason || ''; } catch { /* no body */ }
        const dead = status === 410 || /BadDeviceToken|Unregistered|DeviceTokenNotForTopic/.test(reason);
        resolve({ success: false, error: { code: dead ? DEAD : `apns/${reason || status}`, message: reason || String(status) } });
      });
      req.on('error', err => resolve({ success: false, error: { code: 'apns/network', message: err.message } }));
      req.end(payload);
    })));
  } catch (err) {
    return hexTokens.map(() => ({ success: false, error: { code: 'apns/network', message: err.message } }));
  } finally {
    try { session?.close(); } catch { /* closed */ }
  }
}

async function sendMulticast (fb, msg) {
  const tokens = msg.tokens || [];
  const fcm = [];
  const apple = [];
  tokens.forEach((t, i) => (String(t).startsWith('apns:') ? apple : fcm).push(i));
  const responses = new Array(tokens.length);
  let successCount = 0;
  if (fcm.length) {
    const r = await fb.messaging().sendEachForMulticast({ ...msg, tokens: fcm.map(i => tokens[i]) });
    r.responses.forEach((x, j) => { responses[fcm[j]] = x; });
    successCount += r.successCount || 0;
  }
  if (apple.length) {
    const r = await sendApns(apple.map(i => String(tokens[i]).slice(5)), msg);
    r.forEach((x, j) => { responses[apple[j]] = x; if (x.success) successCount++; });
  }
  return { successCount, failureCount: tokens.length - successCount, responses };
}

module.exports = { sendMulticast, sendApns, apnsReady, apnsPayload };
