// "My account and security" card (every admin) and "Admin users" card (setup role).
(function () {
  var A = function () { return window.EbsAuth; };
  var esc = function (s) { return A().esc(s); };
  var cardStyle = 'background:var(--surface,#fff);border:1.5px solid var(--border,#d0d7de);border-radius:6px;padding:0.75rem 1rem;margin:1rem 0';
  var inp = 'padding:0.35rem;border:1.5px solid #d1d5db;border-radius:3px;box-sizing:border-box';
  var btn = 'padding:0.35rem 0.8rem;border:1.5px solid var(--accent,#b45309);border-radius:4px;background:none;color:var(--accent,#b45309);cursor:pointer;margin:0.2rem 0.3rem 0.2rem 0';
  var date = function (d) { return d ? new Date(d).toLocaleString() : '-'; };

  // ---------- My account ----------
  window.initAccount = function () {
    var host = document.getElementById('account-card');
    if (!host) return;
    var openState = false;
    function load() {
      A().api('/api/auth/account', {}).then(function (r) { if (r.ok) render(r.account); });
    }
    function render(a) {
      var tw = a.twoFactor;
      var html = '<details ' + (openState ? 'open' : '') + ' style="' + cardStyle + '"><summary style="cursor:pointer;font-weight:700;font-size:1rem">🔐 My account and security <span style="font-weight:400;font-size:.8rem;color:var(--muted,#57606a)">(' + esc(a.email) + ', ' + (a.role === 'setup' ? 'event setup' : 'booking admin') + ')</span></summary>'
        + '<div style="margin:.75rem 0;font-size:.85rem">'
        + '<p style="margin:.2rem 0 .6rem;color:var(--muted,#57606a)">Sensitive changes ask for your password.</p>'
        + '<label>Your password (for the actions below)<br><input type="password" id="ac-pw" autocomplete="current-password" style="' + inp + ';width:16rem"></label>'
        + '<h4 style="margin:1rem 0 .3rem">Second factors</h4>'
        + '<div>Authenticator app: ' + (a.totp ? '<strong>on</strong> <button style="' + btn + '" id="ac-totp-off">Turn off</button>' : 'off <button style="' + btn + '" id="ac-totp-on">Set up</button>') + '</div>'
        + '<div>Passkeys: ' + (a.passkeyList.length ? '' : 'none ')
        + a.passkeyList.map(function (p) { return '<span style="display:inline-block;margin:.15rem .4rem .15rem 0;padding:.15rem .5rem;border:1px solid #d1d5db;border-radius:12px">' + esc(p.name) + ' <a href="#" data-pk="' + p.id + '" title="Remove">✕</a></span>'; }).join('')
        + (A().hasPasskeys() ? ' <button style="' + btn + '" id="ac-pk-on">Add passkey</button>' : '') + '</div>'
        + (a.mailEnabled ? '<div>Email code: ' + (a.emailCode ? '<strong>on</strong> <button style="' + btn + '" id="ac-em-off">Turn off</button>' : 'off <button style="' + btn + '" id="ac-em-on">Turn on</button>') + '</div>' : '')
        + '<div style="margin-top:.4rem">Recovery codes left: <strong>' + a.recoveryLeft + '</strong> <button style="' + btn + '" id="ac-rc">Make new codes</button></div>'
        + '<div id="ac-flow" style="max-width:380px"></div>'
        + '<h4 style="margin:1rem 0 .3rem">Password</h4>'
        + '<input type="password" id="ac-new" placeholder="New password (12+ characters)" autocomplete="new-password" style="' + inp + ';width:16rem"> <button style="' + btn + '" id="ac-pw-go">Change password</button>'
        + '<h4 style="margin:1rem 0 .3rem">Sessions</h4>'
        + '<button style="' + btn + '" id="ac-others">Sign out other devices</button> <button style="' + btn + '" id="ac-out">Sign out</button>'
        + '<div id="ac-msg" style="margin-top:.5rem"></div></div></details>';
      host.innerHTML = html;
      host.querySelector('details').addEventListener('toggle', function () { openState = this.open; });
      var pw = function () { return host.querySelector('#ac-pw').value; };
      var msg = function (t, ok) { var m = host.querySelector('#ac-msg'); m.style.color = ok ? '#1a7f37' : '#cf222e'; m.textContent = t; };
      var act = function (path, extra, okText) {
        A().api(path, Object.assign({ password: pw() }, extra || {})).then(function (r) {
          if (!r.ok) return msg(r.error);
          if (r.recoveryCodes) { A().showRecovery(host.querySelector('#ac-flow'), r.recoveryCodes, function () { host.querySelector('#ac-flow').innerHTML = ''; load(); }); return; }
          msg(okText || 'Done.', true); load();
        });
      };
      var flowDone = function (x) {
        var f = host.querySelector('#ac-flow');
        if (x && x.recoveryCodes) A().showRecovery(f, x.recoveryCodes, function () { f.innerHTML = ''; load(); }); else { f.innerHTML = ''; load(); }
      };
      var on = function (id, fn) { var e = host.querySelector(id); if (e) e.onclick = fn; };
      on('#ac-totp-on', function () { A().totpFlow(host.querySelector('#ac-flow'), flowDone, function () { host.querySelector('#ac-flow').innerHTML = ''; }); });
      on('#ac-pk-on', function () { A().passkeyFlow(host.querySelector('#ac-flow'), flowDone, function () { host.querySelector('#ac-flow').innerHTML = ''; }); });
      on('#ac-em-on', function () { A().emailFlow(host.querySelector('#ac-flow'), flowDone, function () { host.querySelector('#ac-flow').innerHTML = ''; }); });
      on('#ac-totp-off', function () { act('/api/auth/totp/disable'); });
      on('#ac-em-off', function () { act('/api/auth/email/disable'); });
      on('#ac-rc', function () { act('/api/auth/recovery/regenerate'); });
      host.querySelectorAll('[data-pk]').forEach(function (a2) { a2.onclick = function (e) { e.preventDefault(); act('/api/auth/passkey/remove', { id: a2.getAttribute('data-pk') }); }; });
      on('#ac-pw-go', function () {
        A().api('/api/auth/password/change', { current: pw(), next: host.querySelector('#ac-new').value }).then(function (r) { if (!r.ok) msg(r.error); else { msg('Password changed. Other devices were signed out.', true); host.querySelector('#ac-new').value = ''; } });
      });
      on('#ac-others', function () { A().api('/api/auth/logout-others', {}).then(function () { msg('Other devices were signed out.', true); }); });
      on('#ac-out', function () { A().api('/api/auth/logout', {}).then(function () { location.reload(); }); });
    }
    load();
  };

  // ---------- Admin users (setup role) ----------
  window.initUsers = function () {
    var host = document.getElementById('users-card');
    if (!host) return;
    var openState = false, msgText = '', msgOk = true, linkHtml = '';
    function load() { rpc.run.withSuccessHandler(function (r) { if (r && r.success) render(r); }).listAdminUsers(); }
    function status(u) { return u.disabled ? 'Disabled' : (u.pending ? 'Invited' : (u.twoFactor ? 'Active' : '2FA not set up')); }
    function render(d) {
      var rows = d.users.map(function (u) {
        return '<tr data-id="' + u.id + '"><td>' + esc(u.email) + '</td><td>' + esc(u.name) + '</td>'
          + '<td><select data-role>' + ['setup', 'admin'].map(function (r) { return '<option value="' + r + '"' + (u.role === r ? ' selected' : '') + '>' + (r === 'setup' ? 'Event setup' : 'Booking admin') + '</option>'; }).join('') + '</select></td>'
          + '<td>' + status(u) + (u.twoFactor ? ' <span style="color:#57606a;font-size:.75rem">(' + [u.totp ? 'app' : '', u.passkeys ? u.passkeys + ' passkey' : '', u.emailCode ? 'email' : ''].filter(Boolean).join(', ') + ')</span>' : '') + '</td>'
          + '<td>' + esc(date(u.lastLogin)) + '</td>'
          + '<td style="white-space:nowrap">' + (u.pending ? '<button data-act="resend" style="' + btn + '">New invite link</button>' : '')
          + '<button data-act="toggle" style="' + btn + '">' + (u.disabled ? 'Enable' : 'Disable') + '</button>'
          + (u.twoFactor ? '<button data-act="reset2fa" style="' + btn + '">Reset 2FA</button>' : '')
          + '<button data-act="delete" style="' + btn + '">Delete</button></td></tr>';
      }).join('');
      host.innerHTML = '<details ' + (openState ? 'open' : '') + ' style="' + cardStyle + '"><summary style="cursor:pointer;font-weight:700;font-size:1rem">👥 Admin users and two-factor authentication</summary>'
        + '<p style="margin:.75rem 0;color:var(--muted,#57606a);font-size:.85rem">Everyone who administers this event has their own account with a password and a second factor (required). '
        + '<strong>Event setup</strong> accounts can change the event, prices and these users; <strong>Booking admin</strong> accounts handle bookings, check-in and reports. '
        + 'If someone loses their phone, use <em>Reset 2FA</em>: they set up a new second factor at their next sign-in.</p>'
        + '<div style="overflow-x:auto"><table style="width:100%;border-collapse:collapse;font-size:.85rem"><thead><tr style="text-align:left"><th>Email</th><th>Name</th><th>Role</th><th>Status</th><th>Last sign-in</th><th></th></tr></thead><tbody>' + rows + '</tbody></table></div>'
        + '<h4 style="margin:1rem 0 .3rem">Invite someone</h4>'
        + '<input id="u-email" type="email" placeholder="Email" style="' + inp + ';width:15rem"> <input id="u-name" placeholder="Name (optional)" style="' + inp + ';width:12rem"> '
        + '<select id="u-role" style="' + inp + '"><option value="admin">Booking admin</option><option value="setup">Event setup</option></select> '
        + '<button id="u-inv" style="padding:.4rem 1rem;border:0;border-radius:4px;background:var(--accent,#b45309);color:#fff;font-weight:600;cursor:pointer">Create invitation</button>'
        + (d.mailEnabled ? '' : '<p style="font-size:.8rem;color:var(--muted,#57606a)">This server cannot send email: copy the invitation link and send it yourself.</p>')
        + '<div id="u-link" style="margin-top:.5rem;font-size:.85rem">' + linkHtml + '</div>'
        + '<div id="u-msg" style="margin-top:.4rem;font-size:.85rem;color:' + (msgOk ? '#1a7f37' : '#cf222e') + '">' + esc(msgText) + '</div></details>';
      host.querySelector('details').addEventListener('toggle', function () { openState = this.open; });
      function say(t, ok) { msgText = t; msgOk = ok; host.querySelector('#u-msg').style.color = ok ? '#1a7f37' : '#cf222e'; host.querySelector('#u-msg').textContent = t; }
      function res(okText) { return function (r) { if (r && r.success) { msgText = okText; msgOk = true; linkHtml = ''; load(); } else say((r && r.error) || 'Failed', false); }; }
      host.querySelector('#u-inv').onclick = function () {
        rpc.run.withSuccessHandler(function (r) {
          if (!r || !r.success) return say((r && r.error) || 'Failed', false);
          linkHtml = '<strong>Invitation link</strong> (valid 7 days' + (r.mailed ? '; also emailed' : '') + '): <code style="word-break:break-all">' + esc(r.link) + '</code>';
          msgText = 'Invitation created.'; msgOk = true; load();
        }).inviteAdminUser({ email: host.querySelector('#u-email').value, name: host.querySelector('#u-name').value, role: host.querySelector('#u-role').value });
      };
      host.querySelectorAll('tr[data-id]').forEach(function (tr) {
        var id = parseInt(tr.getAttribute('data-id'), 10);
        var u = d.users.find(function (x) { return x.id === id; });
        tr.querySelector('[data-role]').onchange = function () { rpc.run.withSuccessHandler(function (r) { res('Role changed. The person is signed out.')(r); if (!r || !r.success) load(); }).updateAdminUser(id, { role: this.value }); };
        tr.querySelectorAll('[data-act]').forEach(function (b) {
          b.onclick = function () {
            var act = b.getAttribute('data-act');
            if (act === 'toggle') rpc.run.withSuccessHandler(res(u.disabled ? 'Account enabled.' : 'Account disabled.')).updateAdminUser(id, { disabled: !u.disabled });
            else if (act === 'reset2fa') { if (window.confirm('Remove all second factors of ' + u.email + '? They must set up a new one at their next sign-in.')) rpc.run.withSuccessHandler(res('Second factors removed.')).resetAdminTwoFactor(id); }
            else if (act === 'delete') { if (window.confirm('Delete the account ' + u.email + '?')) rpc.run.withSuccessHandler(res('Account deleted.')).deleteAdminUser(id); }
            else if (act === 'resend') rpc.run.withSuccessHandler(function (r) {
              if (!r || !r.success) return say((r && r.error) || 'Failed', false);
              linkHtml = '<strong>New invitation link</strong>' + (r.mailed ? ' (also emailed)' : '') + ': <code style="word-break:break-all">' + esc(r.link) + '</code>'; msgText = ''; load();
            }).resendAdminInvite(id);
          };
        });
      });
    }
    load();
  };
})();
