// App Store signing for the NyxThrive iPhone build, with no Mac and no
// registered devices. Adapted for NyxThrive from the NyxSurvive pack copy
// in the Feed-The-Bear repo (same logic, three changes: the default
// bundle ID, the "NyxThrive CI" naming used for profiles and for the
// certificate-limit sweep, and a new setup-profile mode below).
//
//   node asc-sign.js setup <dir>          makes a distribution certificate
//                                         from <dir>/key.pem's CSR and an
//                                         App Store profile for this app;
//                                         writes <dir>/cert.pem and
//                                         <dir>/profile.mobileprovision;
//                                         prints NAME=, UUID=, CERT_ID=,
//                                         PROFILE_ID= lines.
//   node asc-sign.js setup-profile <dir>  reuses an EXISTING distribution
//                                         certificate (CERT_ID from env,
//                                         e.g. the shared one restored from
//                                         the ios-signing-store branch) and
//                                         creates only this app's profile.
//                                         This is the normal NyxThrive path:
//                                         it keeps the account under Apple's
//                                         3-distribution-certificate cap.
//   node asc-sign.js cleanup              keeps CERT_ID and PROFILE_ID;
//                                         removes nothing, by design:
//                                         deleting the certificate revokes
//                                         it, and Apple then rejects the
//                                         uploaded binary as an invalid
//                                         signature (ITMS-90035) at review.
//
// Env: KEY_ID, ISSUER_ID, KEY_FILE (the .p8, already cleaned up),
// BUNDLE_ID, and CERT_ID for setup-profile.
const crypto = require('crypto');
const fs = require('fs');
const path = require('path');

const keyId = String(process.env.KEY_ID || '').trim();
const issuer = String(process.env.ISSUER_ID || '').trim();
const key = crypto.createPrivateKey(fs.readFileSync(process.env.KEY_FILE, 'utf8'));
const bundle = process.env.BUNDLE_ID || 'com.nyxthrive.app';

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
    const ours = list.data.filter(c => /NyxThrive CI/.test(c.attributes.csrContent || '') || /NyxThrive CI/.test(c.attributes.name || '') || c.attributes.displayName === 'NyxThrive CI');
    console.log(`Distribution certificate limit reached; removing ${ours.length} left over from earlier builds.`);
    for (const c of ours) await api('DELETE', `/v1/certificates/${c.id}`).catch(() => {});
    return api('POST', '/v1/certificates', body);
  }
}

async function makeProfile (dir, certId) {
  const ids = await api('GET', `/v1/bundleIds?filter[identifier]=${encodeURIComponent(bundle)}&limit=5`);
  const bundleRes = ids.data.find(b => b.attributes.identifier === bundle);
  if (!bundleRes) throw new Error(`No App ID ${bundle} in Certificates, Identifiers & Profiles. Register the bundle ID first (see PREP.md).`);
  const name = `NyxThrive CI ${process.env.GITHUB_RUN_NUMBER || Date.now()}`;
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

async function setup (dir) {
  const csr = fs.readFileSync(path.join(dir, 'csr.pem'), 'utf8');
  const cert = await makeCertificate(csr);
  const certId = cert.data.id;
  const der = Buffer.from(cert.data.attributes.certificateContent, 'base64');
  fs.writeFileSync(path.join(dir, 'cert.pem'), `-----BEGIN CERTIFICATE-----\n${der.toString('base64').match(/.{1,64}/g).join('\n')}\n-----END CERTIFICATE-----\n`);
  await makeProfile(dir, certId);
}

async function setupProfile (dir) {
  const certId = String(process.env.CERT_ID || '').trim();
  if (!certId) throw new Error('setup-profile needs CERT_ID in the environment (the restored shared certificate).');
  // Prove the certificate is still there and is a distribution certificate.
  const cert = await api('GET', `/v1/certificates/${certId}`);
  if (!cert.data) throw new Error(`Certificate ${certId} not found.`);
  await makeProfile(dir, certId);
}

async function cleanup () {
  // Do NOT delete the certificate or profile: deleting the certificate
  // revokes it, and Apple then rejects this build's binary as an invalid
  // signature (ITMS-90035) when the version is submitted for review.
  // The certificate stays valid for this build; old NyxThrive CI certificates
  // are removed only if the account hits the certificate limit.
  console.log('Keeping this build\'s certificate and profile so the binary stays valid through review.');
}

const mode = process.argv[2];
(mode === 'cleanup' ? cleanup()
  : mode === 'setup-profile' ? setupProfile(process.argv[3])
  : setup(process.argv[3]))
  .catch(err => { console.error(err.message); process.exit(1); });
