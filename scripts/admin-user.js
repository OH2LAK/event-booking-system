#!/usr/bin/env node
'use strict';
// Emergency tool for whoever runs the server (needs DATABASE_URL, i.e. access to the database).
//   node scripts/admin-user.js list
//   node scripts/admin-user.js reset-2fa <email>        remove all second factors; the person enrols again at the next sign-in
//   node scripts/admin-user.js invite <email> [setup|admin]   print a one-time link (valid 7 days) to create or recover an account
//   node scripts/admin-user.js unlock <email>           clear a lockout after too many wrong passwords
// Docker: docker compose exec app node scripts/admin-user.js list   (copy this file into the image first if it is not there)
const adminUsers = require('../src/adminUsers');
const db = require('../src/db');

(async () => {
  const [cmd, a, b] = process.argv.slice(2);
  if (cmd === 'list') {
    for (const u of await adminUsers.list()) console.log(`${u.email}\t${u.role}\t${u.disabled ? 'disabled' : (u.pending ? 'invited' : 'active')}\t2fa=${u.twoFactor ? 'yes' : 'NO'}\tlast=${u.lastLogin ? new Date(u.lastLogin).toISOString() : '-'}`);
  } else if (cmd === 'reset-2fa' && a) {
    const u = await adminUsers.byEmail(a); if (!u) throw new Error('No such account');
    await adminUsers.resetTwoFactor(u.id); console.log('Second factors removed for ' + u.email);
  } else if (cmd === 'unlock' && a) {
    const u = await adminUsers.byEmail(a); if (!u) throw new Error('No such account');
    await db.query('UPDATE admin_users SET failed_logins=0, locked_until=NULL WHERE id=$1', [u.id]); console.log('Unlocked ' + u.email);
  } else if (cmd === 'invite' && a) {
    let u = await adminUsers.byEmail(a), token;
    if (u) {
      // existing account: a reset link (password + the account keeps its second factors)
      const r = await adminUsers.requestReset(u.email) || await adminUsers.newInviteToken(u.id);
      if (r.error) throw new Error(r.error);
      token = r.token;
    } else {
      const r = await adminUsers.invite({ email: a, name: '', role: b === 'setup' ? 'setup' : 'admin' });
      if (r.error) throw new Error(r.error);
      token = r.token;
    }
    console.log((adminUsers.baseUrl() || 'https://YOUR-SITE') + '/auth/accept?token=' + token);
  } else {
    console.log('Usage: node scripts/admin-user.js list | reset-2fa <email> | unlock <email> | invite <email> [setup|admin]');
    process.exitCode = 1;
  }
  await db.pool.end();
})().catch(e => { console.error(e.message); process.exit(1); });
