// iPhone notifications (api/_push.js): Android tokens go to Firebase, iPhone
// "apns:" tokens straight to Apple with a signed key; dead iPhones are
// reported the same way as dead Android phones. Fake Apple and Firebase.
const crypto = require('crypto');
const http2 = require('http2');
const { check, finish } = require('./lib');

const { privateKey, publicKey } = crypto.generateKeyPairSync('ec', { namedCurve: 'P-256' });
const sent = [];
http2.connect = host => ({
  on () {},
  close () {},
  request (headers) {
    const handlers = {};
    const req = {
      setTimeout () {},
      on (ev, fn) { handlers[ev] = fn; return req; },
      end (body) {
        sent.push({ host, headers, body: JSON.parse(body) });
        const dead = headers[':path'].endsWith('/deadbeef');
        setImmediate(() => {
          handlers.response?.({ ':status': dead ? 410 : 200 });
          if (dead) handlers.data?.(JSON.stringify({ reason: 'Unregistered' }));
          handlers.end?.();
        });
      },
      close () {},
    };
    return req;
  },
});

const fcmSent = [];
const fb = { messaging: () => ({ sendEachForMulticast: async m => { fcmSent.push(m); return { successCount: m.tokens.length, responses: m.tokens.map(() => ({ success: true })) }; } }) };

(async () => {
  const { sendMulticast } = require('../api/_push');

  // Not set up yet: iPhones are skipped, not forgotten.
  let r = await sendMulticast(fb, { tokens: ['apns:abc123'], notification: { title: 'Hi', body: 'There' } });
  check(r.successCount === 0 && r.responses[0].error.code === 'apns/not-configured' && !sent.length, 'no APNs key yet: iPhones are skipped without dropping their tokens');

  process.env.APNS_KEY = privateKey.export({ type: 'pkcs8', format: 'pem' }).replace(/\n/g, '\\n');
  process.env.APNS_KEY_ID = 'KEY1234567';
  process.env.APPLE_TEAM_ID = 'TEAM123456';
  r = await sendMulticast(fb, {
    tokens: ['fcm-token-android-1', 'apns:abc123', 'apns:deadbeef'],
    notification: { title: 'Jo threw a pie at you! 🥧', body: 'Splat!' },
    data: { open: 'foodfight' },
    android: { notification: { tag: 'ff-1' } },
  });
  check(fcmSent.length === 1 && fcmSent[0].tokens.join() === 'fcm-token-android-1', 'Android tokens still go to Firebase');
  check(sent.length === 2 && sent[0].host === 'https://api.push.apple.com' && sent[0].headers[':path'] === '/3/device/abc123', 'iPhone tokens go to Apple');
  check(sent[0].headers['apns-topic'] === 'com.feedthebear.app' && sent[0].headers['apns-collapse-id'] === 'ff-1', 'right app, and repeats replace each other');
  check(sent[0].body.aps.alert.title === 'Jo threw a pie at you! 🥧' && sent[0].body.open === 'foodfight', 'title, text and where a tap opens');
  const [head, claims, sig] = sent[0].headers.authorization.replace('bearer ', '').split('.');
  const ok = crypto.verify('sha256', Buffer.from(`${head}.${claims}`), { key: publicKey, dsaEncoding: 'ieee-p1363' }, Buffer.from(sig, 'base64url'));
  const h = JSON.parse(Buffer.from(head, 'base64url'));
  check(ok && h.kid === 'KEY1234567' && JSON.parse(Buffer.from(claims, 'base64url')).iss === 'TEAM123456', 'signed with the APNs key');
  check(r.successCount === 2 && r.responses[1].success && /registration-token-not-registered/.test(r.responses[2].error.code), 'a deleted iPhone app is reported as dead, like Android');
  finish('apns');
})();
