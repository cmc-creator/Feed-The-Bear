// Checks the App Store Connect key (GitHub secrets) with Apple before a build,
// and says in plain words what's wrong. Never prints the key itself.
// Env: KEY_ID, ISSUER_ID, KEY_P8. Exits 1 if Apple turns the key down.
const crypto = require('crypto');

const keyId = String(process.env.KEY_ID || '').trim();
const issuer = String(process.env.ISSUER_ID || '').trim();
// Rebuilt from its letters, so lost line breaks or extra spaces don't matter.
const raw = String(process.env.KEY_P8 || '').replace(/\\n/g, '\n');
const letters = raw.replace(/-----(BEGIN|END) PRIVATE KEY-----/g, '').replace(/[^A-Za-z0-9+/=]/g, '');
const p8 = `-----BEGIN PRIVATE KEY-----\n${(letters.match(/.{1,64}/g) || []).join('\n')}\n-----END PRIVATE KEY-----\n`;

const say = m => console.log(`[key check] ${m}`);
say(`Key ID: ${keyId.length} characters (Apple's are 10)${/^[A-Z0-9]{10}$/.test(keyId) ? '' : '  <-- does not look like a Key ID'}`);
say(`Issuer ID: ${issuer.length} characters (Apple's are 36, like 69a6de7e-...)${/^[0-9a-f-]{36}$/i.test(issuer) ? '' : '  <-- does not look like an Issuer ID'}`);
say(`Key file: ${raw.includes('BEGIN PRIVATE KEY') && raw.includes('END PRIVATE KEY') ? 'has the BEGIN and END lines' : 'MISSING the BEGIN/END PRIVATE KEY lines  <-- paste the whole .p8 file'}`);

// The signing step uses this cleaned-up copy.
if (process.env.KEY_OUT) require('fs').writeFileSync(process.env.KEY_OUT, p8, { mode: 0o600 });

let key;
try { key = crypto.createPrivateKey(p8); } catch (err) {
  say(`The key file can't be read (${err.message}). Paste the whole .p8 file again.`);
  process.exit(1);
}

const b64 = o => Buffer.from(JSON.stringify(o)).toString('base64url');
const now = Math.floor(Date.now() / 1000);
const head = `${b64({ alg: 'ES256', kid: keyId, typ: 'JWT' })}.${b64({ iss: issuer, iat: now, exp: now + 600, aud: 'appstoreconnect-v1' })}`;
const jwt = `${head}.${crypto.sign('sha256', Buffer.from(head), { key, dsaEncoding: 'ieee-p1363' }).toString('base64url')}`;

(async () => {
  const r = await fetch('https://api.appstoreconnect.apple.com/v1/apps?filter[bundleId]=com.feedthebear.app&fields[apps]=name,bundleId', { headers: { Authorization: `Bearer ${jwt}` } });
  const body = await r.json().catch(() => ({}));
  if (r.ok) {
    const app = body.data?.[0];
    say(app ? `Apple accepts the key. Found the app: ${app.attributes.name} (${app.attributes.bundleId}).` : 'Apple accepts the key, but no app with bundle ID com.feedthebear.app exists in App Store Connect yet.');
    process.exit(0);
  }
  const why = (body.errors || []).map(e => `${e.status} ${e.code}: ${e.detail || e.title}`).join(' | ');
  say(`Apple said ${r.status}: ${why}`);
  if (r.status === 401) say('That means the Key ID, Issuer ID and key file do not belong together: one is pasted wrong, has an extra space, or the key was revoked. Team Keys need the Issuer ID; check you made a Team key, not an Individual key.');
  if (r.status === 403) say('The key works but lacks permission: make it an Admin key.');
  process.exit(1);
})();
