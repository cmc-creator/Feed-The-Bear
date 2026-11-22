// App Store signing helpers for the NyxHICSlab iPhone build.
// Adapted from the NyxSurvive pack's asc-sign.js (same house pattern),
// with one structural change: NyxHICSlab does NOT mint certificates.
// The account is at Apple's 3-distribution-certificate cap, and the
// shared certificate saved on the ios-signing-store branch signs this
// app too. What NyxHICSlab needs is only its own App Store profile
// (profiles are per bundle ID), which the "profile" mode below makes
// against the EXISTING shared certificate.
//
//   node asc-sign.js profile <dir>  uses the certificate CERT_ID (env,
//                                   the shared one restored from the
//                                   signing store) and writes only
//                                   <dir>/profile.mobileprovision;
//                                   prints NAME=, UUID=, CERT_ID=,
//                                   PROFILE_ID= lines
//   node asc-sign.js setup  <dir>   the original full mode (makes a
//                                   certificate from <dir>/csr.pem plus
//                                   a profile). Kept for parity with
//                                   the sister packs; the NyxHICSlab
//                                   workflow never calls it, because
//                                   minting would hit the certificate
//                                   cap. Its 409 fallback removes only
//                                   leftover "NyxHICSlab CI" certs.
//   node asc-sign.js cleanup        keeps CERT_ID and PROFILE_ID (from
//                                   env); removes nothing, by design:
//                                   deleting a certificate revokes it
//                                   and Apple then rejects the uploaded
//                                   binary as an invalid signature
//                                   (ITMS-90035) at review time.
//
// Env: KEY_ID, ISSUER_ID, KEY_FILE (the .p8, already cleaned up),
// BUNDLE_ID, and CERT_ID for profile mode.
const crypto = require('crypto');
const fs = require('fs');
const path = require('path');

const keyId = String(process.env.KEY_ID || '').trim();
const issuer = String(process.env.ISSUER_ID || '').trim();
const key = crypto.createPrivateKey(fs.readFileSync(process.env.KEY_FILE, 'utf8'));
const bundle = process.env.BUNDLE_ID || 'com.nyxcollective.nyxhicslab';

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
    const ours = list.data.filter(c => /NyxHICSlab CI/.test(c.attributes.csrContent || '') || /NyxHICSlab CI/.test(c.attributes.name || '') || c.attributes.displayName === 'NyxHICSlab CI');
    console.log(`Distribution certificate limit reached; removing ${ours.length} left over from earlier builds.`);
    for (const c of ours) await api('DELETE', `/v1/certificates/${c.id}`).catch(() => {});
    return api('POST', '/v1/certificates', body);
  }
}

async function makeProfile (dir, certId) {
  const ids = await api('GET', `/v1/bundleIds?filter[identifier]=${encodeURIComponent(bundle)}&limit=5`);
  const bundleRes = ids.data.find(b => b.attributes.identifier === bundle);
  if (!bundleRes) throw new Error(`No App ID ${bundle} in Certificates, Identifiers & Profiles.`);
  const name = `NyxHICSlab CI ${process.env.GITHUB_RUN_NUMBER || Date.now()}`;
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

// Profile-only mode: the shared certificate already exists (restored
// from the ios-signing-store branch); make just this app's profile.
async function profileOnly (dir) {
  const certId = String(process.env.CERT_ID || '').trim();
  if (!certId) throw new Error('CERT_ID env is not set: profile mode needs the shared certificate ID from the signing store meta.env.');
  // Confirm the certificate is really there before building on it.
  await api('GET', `/v1/certificates/${certId}`);
  await makeProfile(dir, certId);
}

async function setup (dir) {
  const csr = fs.readFileSync(path.join(dir, 'csr.pem'), 'utf8');
  const cert = await makeCertificate(csr);
  const certId = cert.data.id;
  const der = Buffer.from(cert.data.attributes.certificateContent, 'base64');
  fs.writeFileSync(path.join(dir, 'cert.pem'), `-----BEGIN CERTIFICATE-----\n${der.toString('base64').match(/.{1,64}/g).join('\n')}\n-----END CERTIFICATE-----\n`);
  await makeProfile(dir, certId);
}

async function cleanup () {
  // Do NOT delete the certificate or profile: deleting the certificate
  // revokes it, and Apple then rejects this build's binary as an invalid
  // signature (ITMS-90035) when the version is submitted for review.
  console.log('Keeping the shared certificate and this build\'s profile so the binary stays valid through review.');
}

const mode = process.argv[2];
(mode === 'cleanup' ? cleanup()
  : mode === 'profile' ? profileOnly(process.argv[3])
  : setup(process.argv[3]))
  .catch(err => { console.error(err.message); process.exit(1); });
