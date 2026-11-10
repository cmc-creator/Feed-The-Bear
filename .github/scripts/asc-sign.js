// App Store signing for the iPhone build, with no Mac and no registered devices:
// through the App Store Connect key it makes a distribution certificate and an
// App Store profile for this run, and removes both afterwards (builds already
// sent to Apple are not affected).
//
//   node asc-sign.js setup  <dir>   writes <dir>/key.pem's certificate as
//                                   <dir>/cert.pem and <dir>/profile.mobileprovision;
//                                   prints NAME=, UUID=, CERT_ID=, PROFILE_ID= lines
//   node asc-sign.js cleanup        removes CERT_ID and PROFILE_ID (from env)
//
// Env: KEY_ID, ISSUER_ID, KEY_FILE (the .p8, already cleaned up), BUNDLE_ID.
const crypto = require('crypto');
const fs = require('fs');
const path = require('path');

const keyId = String(process.env.KEY_ID || '').trim();
const issuer = String(process.env.ISSUER_ID || '').trim();
const key = crypto.createPrivateKey(fs.readFileSync(process.env.KEY_FILE, 'utf8'));
const bundle = process.env.BUNDLE_ID || 'com.feedthebear.app';

function jwt () {
  const b64 = o => Buffer.from(JSON.stringify(o)).toString('base64url');
  const now = Math.floor(Date.now() / 1000);
  const head = `${b64({ alg: 'ES256', kid: keyId, typ: 'JWT' })}.${b64({ iss: issuer, iat: now, exp: now + 900, aud: 'appstoreconnect-v1' })}`;
  return `${head}.${crypto.sign('sha256', Buffer.from(head), { key, dsaEncoding: 'ieee-p1363' }).toString('base64url')}`;
}

async function api (method, url, body) {
  const r = await fetch(`https://api.appstoreconnect.apple.com${url}`, {
    method,
    headers: { Authorization: `Bearer ${jwt()}`, 'Content-Type': 'application/json' },
    body: body ? JSON.stringify(body) : undefined,
  });
  const text = await r.text();
  const data = text ? JSON.parse(text) : {};
  if (!r.ok) {
    const why = (data.errors || []).map(e => `${e.code}: ${e.detail || e.title}`).join(' | ');
    throw Object.assign(new Error(`Apple said ${r.status} on ${method} ${url.split('?')[0]}: ${why}`), { status: r.status, data });
  }
  return data;
}

async function makeCertificate (csr) {
  const body = { data: { type: 'certificates', attributes: { certificateType: 'DISTRIBUTION', csrContent: csr } } };
  try {
    return await api('POST', '/v1/certificates', body);
  } catch (err) {
    if (err.status !== 409) throw err;
    // Too many distribution certificates: remove ones these builds left behind.
    const list = await api('GET', '/v1/certificates?filter[certificateType]=DISTRIBUTION&limit=50');
    const ours = list.data.filter(c => /FTB CI/.test(c.attributes.csrContent || '') || /FTB CI/.test(c.attributes.name || '') || c.attributes.displayName === 'FTB CI');
    console.log(`Distribution certificate limit reached; removing ${ours.length} left over from earlier builds.`);
    for (const c of ours) await api('DELETE', `/v1/certificates/${c.id}`).catch(() => {});
    return api('POST', '/v1/certificates', body);
  }
}

async function setup (dir) {
  const csr = fs.readFileSync(path.join(dir, 'csr.pem'), 'utf8');
  const cert = await makeCertificate(csr);
  const certId = cert.data.id;
  const der = Buffer.from(cert.data.attributes.certificateContent, 'base64');
  fs.writeFileSync(path.join(dir, 'cert.pem'), `-----BEGIN CERTIFICATE-----\n${der.toString('base64').match(/.{1,64}/g).join('\n')}\n-----END CERTIFICATE-----\n`);

  const ids = await api('GET', `/v1/bundleIds?filter[identifier]=${encodeURIComponent(bundle)}&limit=5`);
  const bundleRes = ids.data.find(b => b.attributes.identifier === bundle);
  if (!bundleRes) throw new Error(`No App ID ${bundle} in Certificates, Identifiers & Profiles.`);
  const name = `FTB CI ${process.env.GITHUB_RUN_NUMBER || Date.now()}`;
  const prof = await api('POST', '/v1/profiles', { data: {
    type: 'profiles',
    attributes: { name, profileType: 'IOS_APP_STORE' },
    relationships: {
      bundleId: { data: { type: 'bundleIds', id: bundleRes.id } },
      certificates: { data: [{ type: 'certificates', id: certId }] },
    },
  } });
  fs.writeFileSync(path.join(dir, 'profile.mobileprovision'), Buffer.from(prof.data.attributes.profileContent, 'base64'));
  console.log(`NAME=${name}`);
  console.log(`UUID=${prof.data.attributes.uuid}`);
  console.log(`CERT_ID=${certId}`);
  console.log(`PROFILE_ID=${prof.data.id}`);
}

async function cleanup () {
  if (process.env.PROFILE_ID) await api('DELETE', `/v1/profiles/${process.env.PROFILE_ID}`).catch(e => console.log(e.message));
  if (process.env.CERT_ID) await api('DELETE', `/v1/certificates/${process.env.CERT_ID}`).catch(e => console.log(e.message));
  console.log('Removed this build\'s certificate and profile.');
}

(process.argv[2] === 'cleanup' ? cleanup() : setup(process.argv[3]))
  .catch(err => { console.error(err.message); process.exit(1); });
