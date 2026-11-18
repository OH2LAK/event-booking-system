'use strict';
// Passkeys (WebAuthn) as a second factor, via @simplewebauthn/server. Relying party = the public URL of the site.
const web = require('@simplewebauthn/server');
const { CONFIG } = require('./config');
const adminUsers = require('./adminUsers');

function rp(req) {
  let url = process.env.PUBLIC_URL || '';
  if (!/^https?:\/\//.test(url)) url = `${req.protocol}://${req.get('host')}`;
  const u = new URL(url);
  return { rpID: u.hostname, origin: u.origin, rpName: CONFIG.EVENT_SHORT || 'Event booking' };
}
const b64u = buf => Buffer.from(buf).toString('base64url');
const fromB64u = s => new Uint8Array(Buffer.from(s, 'base64url'));

async function registrationOptions(req, sess) {
  const { rpID, rpName } = rp(req);
  const existing = await adminUsers.passkeys(sess.user.id);
  const opts = await web.generateRegistrationOptions({
    rpName, rpID, userName: sess.user.email, userDisplayName: sess.user.name || sess.user.email,
    userID: new TextEncoder().encode('u' + sess.user.id), attestationType: 'none',
    excludeCredentials: existing.map(c => ({ id: c.cred_id, transports: c.transports ? c.transports.split(',') : undefined })),
    authenticatorSelection: { residentKey: 'discouraged', userVerification: 'preferred' },
  });
  await adminUsers.setMeta(sess.hash, { pkChallenge: opts.challenge, pkPurpose: 'register' });
  return opts;
}
async function verifyRegistration(req, sess, response, name) {
  if (sess.meta.pkPurpose !== 'register' || !sess.meta.pkChallenge) return { error: 'Start again.' };
  const { rpID, origin } = rp(req);
  let v;
  try { v = await web.verifyRegistrationResponse({ response, expectedChallenge: sess.meta.pkChallenge, expectedOrigin: origin, expectedRPID: rpID, requireUserVerification: false }); }
  catch (e) { return { error: 'The passkey could not be verified: ' + e.message }; }
  await adminUsers.setMeta(sess.hash, { pkChallenge: null, pkPurpose: null });
  if (!v.verified || !v.registrationInfo) return { error: 'The passkey could not be verified.' };
  const c = v.registrationInfo.credential;
  await adminUsers.addPasskey(sess.user.id, { credId: c.id, publicKey: b64u(c.publicKey), counter: c.counter, transports: c.transports || (response.response && response.response.transports) || [], name });
  return { ok: true };
}
async function authenticationOptions(req, sess) {
  const { rpID } = rp(req);
  const creds = await adminUsers.passkeys(sess.user.id);
  if (!creds.length) return { error: 'No passkeys registered.' };
  const opts = await web.generateAuthenticationOptions({ rpID, userVerification: 'preferred',
    allowCredentials: creds.map(c => ({ id: c.cred_id, transports: c.transports ? c.transports.split(',') : undefined })) });
  await adminUsers.setMeta(sess.hash, { pkChallenge: opts.challenge, pkPurpose: 'login' });
  return { options: opts };
}
async function verifyAuthentication(req, sess, response) {
  if (sess.meta.pkPurpose !== 'login' || !sess.meta.pkChallenge) return false;
  const { rpID, origin } = rp(req);
  const cred = (await adminUsers.passkeys(sess.user.id)).find(c => c.cred_id === (response && response.id));
  if (!cred) return false;
  try {
    const v = await web.verifyAuthenticationResponse({ response, expectedChallenge: sess.meta.pkChallenge, expectedOrigin: origin, expectedRPID: rpID, requireUserVerification: false,
      credential: { id: cred.cred_id, publicKey: fromB64u(cred.public_key), counter: Number(cred.counter), transports: cred.transports ? cred.transports.split(',') : undefined } });
    await adminUsers.setMeta(sess.hash, { pkChallenge: null, pkPurpose: null });
    if (!v.verified) return false;
    await adminUsers.touchPasskey(cred.cred_id, v.authenticationInfo.newCounter);
    return true;
  } catch (_) { return false; }
}

module.exports = { registrationOptions, verifyRegistration, authenticationOptions, verifyAuthentication, rp };
