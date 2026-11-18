// Sign-in for the setup, admin and report pages: password, then a second factor (authenticator app, passkey,
// email code or recovery code). Also first-time setup, invitations, password reset and 2FA enrolment.
// Usage: EbsAuth.mount(element, { mode: 'setup' | 'admin' | 'accept', token, title, onReady })
(function () {
  var css = '.ea{max-width:380px;margin:3rem auto;background:var(--surface,#fff);border:1px solid var(--border,#d0d7de);padding:1.6rem;border-radius:6px;font-family:-apple-system,Segoe UI,sans-serif;color:var(--text,#1f2328);box-sizing:border-box}'
    + '.ea h2{margin:0 0 1rem;font-size:1.1rem}.ea p{font-size:.85rem;line-height:1.45;margin:.5rem 0}.ea label{display:block;font-size:.78rem;margin:.7rem 0 .2rem;color:var(--muted,#57606a)}'
    + '.ea input[type=text],.ea input[type=email],.ea input[type=password]{width:100%;padding:.55rem .65rem;border:1.5px solid var(--border,#d0d7de);border-radius:4px;box-sizing:border-box;font-size:.95rem;background:var(--bg,#fff);color:inherit}'
    + '.ea button{padding:.55rem 1rem;border:0;border-radius:4px;background:var(--accent,#b45309);color:#fff;font-weight:600;cursor:pointer;font-size:.9rem;margin:.6rem .4rem 0 0}'
    + '.ea button.sec{background:none;color:var(--accent,#b45309);border:1.5px solid var(--accent,#b45309)}.ea button.lnk{background:none;color:var(--accent,#b45309);padding:0;font-weight:400;text-decoration:underline;margin:.4rem .8rem 0 0}'
    + '.ea .err{color:#cf222e;font-size:.82rem;min-height:1.2em;margin-top:.6rem}.ea .ok{color:#1a7f37}.ea code{background:rgba(127,127,127,.15);padding:.1rem .3rem;border-radius:3px;word-break:break-all}'
    + '.ea .qr{width:190px;height:190px;margin:.5rem auto;background:#fff;padding:4px;border-radius:4px}.ea .qr svg{width:100%;height:100%}'
    + '.ea .codes{columns:2;font-family:ui-monospace,Menlo,monospace;font-size:.95rem;background:rgba(127,127,127,.12);padding:.7rem;border-radius:4px;margin:.6rem 0}';
  function esc(s) { return String(s == null ? '' : s).replace(/[&<>"]/g, function (c) { return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]; }); }
  function api(path, body) {
    var opt = body === undefined ? { credentials: 'same-origin' } : { method: 'POST', credentials: 'same-origin', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body || {}) };
    return fetch(path, opt).then(function (r) { return r.json().catch(function () { return { ok: false, error: 'Server error' }; }); })
      .catch(function () { return { ok: false, error: 'Network error' }; });
  }
  function b64uToBuf(s) { s = s.replace(/-/g, '+').replace(/_/g, '/'); while (s.length % 4) s += '='; var b = atob(s), a = new Uint8Array(b.length); for (var i = 0; i < b.length; i++) a[i] = b.charCodeAt(i); return a.buffer; }
  function bufToB64u(buf) { var a = new Uint8Array(buf), s = ''; for (var i = 0; i < a.length; i++) s += String.fromCharCode(a[i]); return btoa(s).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, ''); }
  function hasPasskeys() { return !!(window.PublicKeyCredential && navigator.credentials); }

  // ---- WebAuthn browser calls ----
  function createPasskey(options) {
    var pk = JSON.parse(JSON.stringify(options));
    pk.challenge = b64uToBuf(pk.challenge); pk.user.id = b64uToBuf(pk.user.id);
    (pk.excludeCredentials || []).forEach(function (c) { c.id = b64uToBuf(c.id); });
    return navigator.credentials.create({ publicKey: pk }).then(function (c) {
      return { id: c.id, rawId: bufToB64u(c.rawId), type: c.type, clientExtensionResults: c.getClientExtensionResults(), authenticatorAttachment: c.authenticatorAttachment || undefined,
        response: { clientDataJSON: bufToB64u(c.response.clientDataJSON), attestationObject: bufToB64u(c.response.attestationObject), transports: c.response.getTransports ? c.response.getTransports() : [] } };
    });
  }
  function usePasskey(options) {
    var pk = JSON.parse(JSON.stringify(options));
    pk.challenge = b64uToBuf(pk.challenge);
    (pk.allowCredentials || []).forEach(function (c) { c.id = b64uToBuf(c.id); });
    return navigator.credentials.get({ publicKey: pk }).then(function (c) {
      return { id: c.id, rawId: bufToB64u(c.rawId), type: c.type, clientExtensionResults: c.getClientExtensionResults(), authenticatorAttachment: c.authenticatorAttachment || undefined,
        response: { clientDataJSON: bufToB64u(c.response.clientDataJSON), authenticatorData: bufToB64u(c.response.authenticatorData), signature: bufToB64u(c.response.signature), userHandle: c.response.userHandle ? bufToB64u(c.response.userHandle) : undefined } };
    });
  }

  // ---- Reusable enrolment pieces (also used by the account card) ----
  function showRecovery(el, codes, done) {
    el.innerHTML = '<h2>Save your recovery codes</h2><p>Each code works once if you lose your phone or passkey. Store them somewhere safe (a password manager). They are shown only now.</p>'
      + '<div class="codes">' + codes.map(function (c) { return '<div>' + esc(c) + '</div>'; }).join('') + '</div>'
      + '<button class="sec" id="rc-copy">Copy</button><button class="sec" id="rc-dl">Download</button>'
      + '<label style="display:flex;gap:.5rem;align-items:center"><input type="checkbox" id="rc-ok"> I have saved these codes</label>'
      + '<button id="rc-go">Continue</button><div class="err"></div>';
    var text = codes.join('\n');
    el.querySelector('#rc-copy').onclick = function () { if (navigator.clipboard) navigator.clipboard.writeText(text); this.textContent = 'Copied'; };
    el.querySelector('#rc-dl').onclick = function () { var a = document.createElement('a'); a.href = 'data:text/plain;charset=utf-8,' + encodeURIComponent('Recovery codes\n' + text + '\n'); a.download = 'recovery-codes.txt'; a.click(); };
    el.querySelector('#rc-go').onclick = function () { if (!el.querySelector('#rc-ok').checked) { el.querySelector('.err').textContent = 'Tick the box when you have saved the codes.'; return; } done(); };
  }
  function totpFlow(el, done, back) {
    el.innerHTML = '<h2>Authenticator app</h2><p>Scan the QR code with an authenticator app (Aegis, Google or Microsoft Authenticator, 1Password ...), then enter the 6-digit code it shows.</p><div class="err">Loading...</div>';
    api('/api/auth/totp/begin', {}).then(function (r) {
      if (!r.ok) { el.querySelector('.err').textContent = r.error; return; }
      el.innerHTML = '<h2>Authenticator app</h2><p>Scan this QR code, then enter the 6-digit code the app shows.</p><div class="qr">' + r.qr + '</div>'
        + '<p style="font-size:.75rem">Cannot scan? Enter this key by hand: <code>' + esc(r.secret) + '</code></p>'
        + '<label>6-digit code</label><input type="text" id="tp-code" inputmode="numeric" autocomplete="one-time-code" maxlength="7">'
        + '<button id="tp-go">Confirm</button>' + (back ? '<button class="sec" id="tp-back">Back</button>' : '') + '<div class="err"></div>';
      var go = function () { api('/api/auth/totp/confirm', { code: el.querySelector('#tp-code').value }).then(function (x) { if (!x.ok) el.querySelector('.err').textContent = x.error; else done(x); }); };
      el.querySelector('#tp-go').onclick = go;
      el.querySelector('#tp-code').addEventListener('keydown', function (e) { if (e.key === 'Enter') go(); });
      if (back) el.querySelector('#tp-back').onclick = back;
    });
  }
  function passkeyFlow(el, done, back) {
    el.innerHTML = '<h2>Passkey</h2><p>Use your fingerprint, face, screen lock or a security key. You can name it so you recognise it later.</p>'
      + '<label>Name</label><input type="text" id="pk-name" maxlength="40" placeholder="e.g. Work laptop">'
      + '<button id="pk-go">Register passkey</button>' + (back ? '<button class="sec" id="pk-back">Back</button>' : '') + '<div class="err"></div>';
    if (back) el.querySelector('#pk-back').onclick = back;
    el.querySelector('#pk-go').onclick = function () {
      var err = el.querySelector('.err'); err.textContent = '';
      api('/api/auth/passkey/register/options', {}).then(function (r) {
        if (!r.ok) throw new Error(r.error);
        return createPasskey(r.options);
      }).then(function (cred) { return api('/api/auth/passkey/register/verify', { response: cred, name: el.querySelector('#pk-name').value }); })
        .then(function (x) { if (!x.ok) err.textContent = x.error; else done(x); })
        .catch(function (e) { err.textContent = e && e.name === 'NotAllowedError' ? 'Cancelled.' : (e && e.message) || 'Passkey failed'; });
    };
  }
  function emailFlow(el, done, back) {
    el.innerHTML = '<h2>Email code</h2><p>We send a 6-digit code to your account email each time you sign in. Less secure than an app or passkey, but convenient as a backup.</p>'
      + '<button id="em-send">Send me a code</button>' + (back ? '<button class="sec" id="em-back">Back</button>' : '') + '<div id="em-box"></div><div class="err"></div>';
    if (back) el.querySelector('#em-back').onclick = back;
    el.querySelector('#em-send').onclick = function () {
      var err = el.querySelector('.err'); err.textContent = '';
      api('/api/auth/email/enrol/send', {}).then(function (r) {
        if (!r.ok) { err.textContent = r.error; return; }
        el.querySelector('#em-box').innerHTML = '<label>Code from the email</label><input type="text" id="em-code" inputmode="numeric" maxlength="7"><button id="em-go">Confirm</button>';
        el.querySelector('#em-go').onclick = function () { api('/api/auth/email/enrol/confirm', { code: el.querySelector('#em-code').value }).then(function (x) { if (!x.ok) err.textContent = x.error; else done(x); }); };
      });
    };
  }

  function mount(root, opts) {
    opts = opts || {};
    if (!document.getElementById('ea-css')) { var st = document.createElement('style'); st.id = 'ea-css'; st.textContent = css; document.head.appendChild(st); }
    var box = document.createElement('div'); box.className = 'ea'; root.innerHTML = ''; root.appendChild(box);
    var title = opts.title || '';
    var st0 = null;

    function head(t) { return '<h2>🔒 ' + esc(t) + (title ? ' — ' + esc(title) : '') + '</h2>'; }
    function pageName() { return opts.mode === 'setup' ? 'Setup' : 'Admin'; }
    function ready() { box.innerHTML = '<p class="ok">Signed in.</p>'; if (opts.onReady) opts.onReady(); }
    function afterEnrol(x) { if (x.recoveryCodes && x.recoveryCodes.length) showRecovery(box, x.recoveryCodes, ready); else ready(); }
    function route(s) {
      st0 = s;
      if (s.stage === 'ok') {
        if (opts.mode === 'setup' && s.user && s.user.role !== 'setup') return denied();
        return ready();
      }
      if (s.stage === 'mfa') return mfa(s.user.methods, s.user);
      if (s.stage === 'enrol') return enrol(s.user, s.mailEnabled);
      if (opts.mode === 'accept') return accept();
      if (s.bootstrapNeeded) return bootstrap(s);
      login();
    }
    function denied() {
      box.innerHTML = head(pageName()) + '<p>This page needs an event setup account. You are signed in with a booking admin account.</p><button id="d-out">Sign out</button> <a href="/?admin=1" style="font-size:.85rem">Open the booking admin page</a>';
      box.querySelector('#d-out').onclick = function () { api('/api/auth/logout', {}).then(function () { location.reload(); }); };
    }
    function load() { api('/api/auth/state').then(route); }

    function login(msg) {
      box.innerHTML = head(pageName()) + '<label>Email</label><input type="email" id="a-email" autocomplete="username">'
        + '<label>Password</label><input type="password" id="a-pw" autocomplete="current-password">'
        + '<button id="a-go">Sign in</button><button class="lnk" id="a-forgot">Forgot password?</button><div class="err">' + esc(msg || '') + '</div>';
      var go = function () {
        var err = box.querySelector('.err'); err.textContent = 'Checking...';
        api('/api/auth/login', { email: box.querySelector('#a-email').value, password: box.querySelector('#a-pw').value, mode: opts.mode }).then(function (r) {
          if (!r.ok) { err.textContent = r.error; return; }
          if (r.stage === 'ok') return load();
          route({ stage: r.stage, user: { methods: r.methods, email: box.querySelector('#a-email').value }, mailEnabled: r.methods.email });
        });
      };
      box.querySelector('#a-go').onclick = go;
      box.querySelector('#a-pw').addEventListener('keydown', function (e) { if (e.key === 'Enter') go(); });
      box.querySelector('#a-forgot').onclick = forgot;
    }
    function forgot() {
      box.innerHTML = head('Reset password') + '<p>Enter your account email. If it exists and this server can send email, you get a link to choose a new password. Your second factor stays the same.</p>'
        + '<label>Email</label><input type="email" id="f-email"><button id="f-go">Send link</button><button class="sec" id="f-back">Back</button><div class="err"></div>';
      box.querySelector('#f-back').onclick = function () { login(); };
      box.querySelector('#f-go').onclick = function () {
        api('/api/auth/forgot', { email: box.querySelector('#f-email').value }).then(function (r) {
          box.querySelector('.err').className = 'err ok';
          box.querySelector('.err').textContent = r.mailEnabled === false ? 'This server cannot send email. Ask an event setup administrator to send you a new invitation.' : 'If the account exists, a link is on its way.';
        });
      };
    }
    function bootstrap(s) {
      box.innerHTML = head('First-time setup') + '<p>Create the first account. It becomes the event setup administrator. You will then set up two-factor authentication.</p>'
        + '<label>Setup code (' + (s.codeInLog ? 'printed in the server log at startup: docker compose logs app' : 'SETUP_PASSWORD from the server settings, or from your welcome email') + ')</label><input type="password" id="b-code" autocomplete="off">'
        + '<label>Your name</label><input type="text" id="b-name" maxlength="80">'
        + '<label>Email</label><input type="email" id="b-email" value="' + esc(s.ownerEmail || '') + '"' + (s.ownerEmail ? ' readonly' : '') + '>'
        + '<label>New password (at least 12 characters)</label><input type="password" id="b-pw" autocomplete="new-password">'
        + '<label>Repeat password</label><input type="password" id="b-pw2" autocomplete="new-password">'
        + '<button id="b-go">Create account</button><div class="err"></div>';
      box.querySelector('#b-go').onclick = function () {
        var err = box.querySelector('.err');
        if (box.querySelector('#b-pw').value !== box.querySelector('#b-pw2').value) { err.textContent = 'The passwords do not match.'; return; }
        api('/api/auth/bootstrap', { code: box.querySelector('#b-code').value, name: box.querySelector('#b-name').value, email: box.querySelector('#b-email').value, password: box.querySelector('#b-pw').value }).then(function (r) {
          if (!r.ok) err.textContent = r.error; else route({ stage: r.stage, user: { methods: r.methods }, mailEnabled: r.methods.email });
        });
      };
    }
    function accept() {
      api('/api/auth/token-info?token=' + encodeURIComponent(opts.token || '')).then(function (info) {
        if (!info.ok) { box.innerHTML = head('Admin account') + '<p class="err">' + esc(info.error) + '</p>'; return; }
        box.innerHTML = head(info.kind === 'reset' ? 'Choose a new password' : 'Welcome') + '<p>Account: <strong>' + esc(info.email) + '</strong></p>'
          + (info.kind === 'invite' ? '<label>Your name</label><input type="text" id="c-name" maxlength="80" value="' + esc(info.name) + '">' : '')
          + '<label>New password (at least 12 characters)</label><input type="password" id="c-pw" autocomplete="new-password">'
          + '<label>Repeat password</label><input type="password" id="c-pw2" autocomplete="new-password">'
          + '<button id="c-go">Save password</button><div class="err"></div>';
        box.querySelector('#c-go').onclick = function () {
          var err = box.querySelector('.err');
          if (box.querySelector('#c-pw').value !== box.querySelector('#c-pw2').value) { err.textContent = 'The passwords do not match.'; return; }
          api('/api/auth/accept', { token: opts.token, name: box.querySelector('#c-name') ? box.querySelector('#c-name').value : '', password: box.querySelector('#c-pw').value }).then(function (r) {
            if (!r.ok) err.textContent = r.error; else route({ stage: r.stage, user: { methods: r.methods }, mailEnabled: r.methods.email });
          });
        };
      });
    }

    function mfa(m, user) {
      var html = head('Second step') + '<p>Confirm it is you.</p><div id="m-body"></div>';
      box.innerHTML = html;
      var body = box.querySelector('#m-body');
      function codeForm(kind, label, extra) {
        body.innerHTML = '<label>' + label + '</label><input type="text" id="m-code" autocomplete="one-time-code" ' + (kind === 'recovery' ? '' : 'inputmode="numeric" maxlength="7"') + '>'
          + '<button id="m-go">Sign in</button><div id="m-extra">' + (extra || '') + '</div><div class="err"></div>' + links();
        var go = function () {
          api('/api/auth/verify', { method: kind, code: body.querySelector('#m-code').value }).then(function (r) {
            if (!r.ok) { body.querySelector('.err').textContent = r.error; if (/password again/i.test(r.error || '')) setTimeout(function () { location.reload(); }, 1500); return; }
            if (kind === 'recovery') window.alert('Recovery code accepted. ' + (r.recoveryLeft != null ? r.recoveryLeft + ' left. ' : '') + 'Add a new second factor in your account settings.');
            load();
          });
        };
        body.querySelector('#m-go').onclick = go;
        body.querySelector('#m-code').addEventListener('keydown', function (e) { if (e.key === 'Enter') go(); });
        body.querySelector('#m-code').focus();
        wireLinks();
      }
      function links() {
        var l = '<div>';
        if (m.totp) l += '<button class="lnk" data-m="totp">Authenticator app</button>';
        if (m.passkey && hasPasskeys()) l += '<button class="lnk" data-m="passkey">Passkey</button>';
        if (m.email) l += '<button class="lnk" data-m="email">Email code</button>';
        if (m.recovery) l += '<button class="lnk" data-m="recovery">Recovery code</button>';
        return l + '</div>';
      }
      function wireLinks() { body.querySelectorAll('[data-m]').forEach(function (b) { b.onclick = function () { pick(b.getAttribute('data-m')); }; }); }
      function pick(k) {
        if (k === 'totp') codeForm('totp', 'Code from your authenticator app');
        else if (k === 'recovery') codeForm('recovery', 'Recovery code (works once)');
        else if (k === 'email') {
          api('/api/auth/email/send', {}).then(function (r) { codeForm('email', 'Code from the email we just sent', r.ok ? '' : '<p class="err">' + esc(r.error) + '</p>'); });
        } else if (k === 'passkey') {
          body.innerHTML = '<p>Use your passkey when the browser asks.</p><div class="err"></div>' + links(); wireLinks();
          api('/api/auth/passkey/options', {}).then(function (r) { if (!r.ok) throw new Error(r.error); return usePasskey(r.options); })
            .then(function (cred) { return api('/api/auth/passkey/verify', { response: cred }); })
            .then(function (x) { if (!x.ok) body.querySelector('.err').textContent = x.error; else load(); })
            .catch(function (e) { body.querySelector('.err').textContent = e && e.name === 'NotAllowedError' ? 'Cancelled or timed out.' : (e && e.message) || 'Passkey failed'; });
        }
      }
      pick(m.totp ? 'totp' : (m.passkey && hasPasskeys() ? 'passkey' : (m.email ? 'email' : 'recovery')));
    }
    function enrol(user, mailEnabled) {
      function menu() {
        box.innerHTML = head('Set up two-factor authentication') + '<p>Two-factor authentication is required for every admin account. Choose how you want to confirm sign-ins.</p>'
          + '<button id="e-totp" style="display:block;width:100%">Authenticator app (recommended)</button>'
          + (hasPasskeys() ? '<button id="e-pk" class="sec" style="display:block;width:100%">Passkey (fingerprint, face, security key)</button>' : '')
          + (mailEnabled ? '<button id="e-em" class="sec" style="display:block;width:100%">Email code</button>' : '') + '<div class="err"></div>';
        box.querySelector('#e-totp').onclick = function () { totpFlow(box, afterEnrol, menu); };
        if (hasPasskeys()) box.querySelector('#e-pk').onclick = function () { passkeyFlow(box, afterEnrol, menu); };
        if (mailEnabled) box.querySelector('#e-em').onclick = function () { emailFlow(box, afterEnrol, menu); };
      }
      menu();
    }
    load();
  }

  window.EbsAuth = { mount: mount, api: api, esc: esc, showRecovery: showRecovery, totpFlow: totpFlow, passkeyFlow: passkeyFlow, emailFlow: emailFlow, hasPasskeys: hasPasskeys };
})();
