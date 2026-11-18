// "API and webhooks" card for the setup page: API keys with permissions, and webhooks to other systems.
(function () {
  var host, state = null, shown = '';
  function esc(s) { return String(s == null ? '' : s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;'); }
  var inp = 'padding:0.35rem;border:1.5px solid #d1d5db;border-radius:3px;box-sizing:border-box';
  var btn = 'padding:0.35rem 0.8rem;border:0;border-radius:4px;background:var(--accent,#b45309);color:#fff;font-weight:600;cursor:pointer';
  var btn2 = 'padding:0.25rem 0.6rem;border:1px solid #d1d5db;border-radius:4px;background:#fff;color:#111;cursor:pointer;font-size:0.8rem';
  var SCOPE_TEXT = { 'stats': 'Counts and availability (no personal data)', 'bookings:read': 'Read bookings and export them (personal data)', 'bookings:write': 'Create, change and cancel bookings' };
  var EVENT_TEXT = { 'booking.created': 'Booking created', 'booking.updated': 'Booking changed', 'booking.cancelled': 'Booking cancelled', 'booking.paid': 'Booking paid', 'booking.erased': 'Booking erased (personal data deleted)' };
  function fmt(d) { return d ? String(d).replace('T', ' ').slice(0, 16) : '-'; }
  function run(method, args, ok) {
    var h = rpc.run.withSuccessHandler(function (r) { ok(r); }).withFailureHandler(function (e) { msg('Error: ' + e.message, true); });
    h[method].apply(h, args);
  }
  function msg(t, bad) { var m = host.querySelector('#api-msg'); if (m) { m.style.color = bad ? '#f85149' : '#3fb950'; m.textContent = t; } }
  function open() { var d = host.querySelector('details'); if (d) d.open = true; }
  function reload() { run('getApiOverview', [], function (d) { if (d && d.success) { state = d; render(); open(); } }); }

  function secretBox() {
    if (!shown) return '';
    return '<div style="margin:0.75rem 0;padding:0.75rem;border:2px solid #f0a500;border-radius:6px;background:#fffbeb;color:#111">'
      + '<strong>Copy it now. It is shown only once.</strong><br><code id="api-secret" style="word-break:break-all;font-size:0.9rem">' + esc(shown) + '</code> '
      + '<button type="button" id="api-copy" style="' + btn2 + '">Copy</button></div>';
  }

  function render() {
    var s = state, html = '<details style="background:var(--surface,#fff);border:1.5px solid var(--border,#d0d7de);border-radius:6px;padding:0.75rem 1rem;margin:1rem 0">'
      + '<summary style="cursor:pointer;font-weight:700;font-size:1rem">🔌 API and webhooks (connect other systems)</summary>'
      + '<p style="margin:0.75rem 0;color:var(--muted,#57606a);font-size:0.85rem">Other systems (accounting, a club register, your own website) can read counts and bookings, export data and make bookings through the API, '
      + 'and get a signed message (webhook) when a booking changes. Documentation: <code>docs/API.md</code> in the project, and the machine-readable description at <a href="/api/v1/openapi.json" target="_blank">/api/v1/openapi.json</a>.</p>'
      + '<p style="margin:0.5rem 0;font-size:0.85rem"><strong>Status:</strong> ' + (s.enabled ? '<span style="color:#3fb950">API is ON</span>' : '<span style="color:#f85149">API is OFF</span> — switch it on in <em>Event setup</em> (group Integrations) before keys can be used.')
      + ' Address: <code>' + esc(s.baseUrl) + '</code></p><div id="api-msg" style="margin:0.4rem 0;font-size:0.85rem"></div>' + secretBox();

    // ---- keys ----
    html += '<h3 style="margin:1rem 0 0.4rem;font-size:0.95rem">API keys</h3>';
    html += '<div style="overflow-x:auto"><table style="width:100%;border-collapse:collapse;font-size:0.82rem"><thead><tr style="text-align:left"><th>Name</th><th>Key starts with</th><th>Permissions</th><th>Created</th><th>Expires</th><th>Last used</th><th>Requests</th><th></th></tr></thead><tbody>';
    if (!s.keys.length) html += '<tr><td colspan="8" style="padding:0.4rem;color:var(--muted,#57606a)">No keys yet.</td></tr>';
    s.keys.forEach(function (k) {
      var dead = k.revokedAt || (k.expiresAt && new Date(k.expiresAt) < new Date());
      html += '<tr style="' + (dead ? 'opacity:0.5' : '') + '"><td>' + esc(k.name) + '</td><td><code>' + esc(k.prefix) + '…</code></td><td>' + esc(k.scopes.join(', ')) + '</td><td>' + fmt(k.createdAt) + '</td><td>' + (k.expiresAt ? fmt(k.expiresAt) : 'never') + '</td><td>' + fmt(k.lastUsedAt) + '</td><td>' + k.requests + '</td><td>'
        + (k.revokedAt ? 'revoked' : (dead ? 'expired' : '<button type="button" data-revoke="' + k.id + '" style="' + btn2 + '">Revoke</button>')) + '</td></tr>';
    });
    html += '</tbody></table></div>';
    html += '<div style="margin-top:0.6rem;padding:0.6rem;border:1px dashed #d1d5db;border-radius:6px"><strong style="font-size:0.85rem">Create a key</strong><div style="display:flex;flex-wrap:wrap;gap:0.6rem;align-items:center;margin-top:0.4rem">'
      + '<input id="k-name" placeholder="Name, e.g. accounting" maxlength="60" style="' + inp + ';width:14rem">'
      + '<input id="k-days" type="number" min="1" max="3650" placeholder="Valid days (empty = no expiry)" style="' + inp + ';width:14rem"></div><div style="margin-top:0.4rem;font-size:0.85rem">';
    s.scopes.forEach(function (sc) { html += '<label style="display:block"><input type="checkbox" data-scope="' + sc + '"' + (sc === 'stats' ? ' checked' : '') + '> <strong>' + sc + '</strong> — ' + esc(SCOPE_TEXT[sc] || '') + '</label>'; });
    html += '</div><button type="button" id="k-create" style="' + btn + ';margin-top:0.5rem">Create key</button>'
      + '<div style="font-size:0.78rem;color:var(--muted,#57606a);margin-top:0.4rem">Give each system its own key with only the permissions it needs. A key cannot be shown again; if it is lost, revoke it and create a new one.</div></div>';

    // ---- webhooks ----
    var w = s.webhooks;
    html += '<h3 style="margin:1.2rem 0 0.4rem;font-size:0.95rem">Webhooks</h3>';
    html += '<div style="overflow-x:auto"><table style="width:100%;border-collapse:collapse;font-size:0.82rem"><thead><tr style="text-align:left"><th>Name</th><th>Address</th><th>Events</th><th>Data</th><th>Last result</th><th>Waiting</th><th></th></tr></thead><tbody>';
    if (!w.hooks.length) html += '<tr><td colspan="7" style="padding:0.4rem;color:var(--muted,#57606a)">No webhooks yet.</td></tr>';
    w.hooks.forEach(function (h) {
      html += '<tr style="' + (h.enabled ? '' : 'opacity:0.55') + '"><td>' + esc(h.name) + (h.enabled ? '' : ' (off)') + '</td><td style="word-break:break-all">' + esc(h.url) + '</td><td>' + esc(h.events.join(', ')) + '</td><td>' + esc(h.payload) + '</td><td>' + esc(h.lastStatus || '-') + (h.failures ? ' <span style="color:#f85149">(' + h.failures + ' failed in a row)</span>' : '') + '</td><td>' + h.pending + '</td><td style="white-space:nowrap">'
        + '<button type="button" data-test="' + h.id + '" style="' + btn2 + '">Send test</button> <button type="button" data-toggle="' + h.id + '" style="' + btn2 + '">' + (h.enabled ? 'Turn off' : 'Turn on') + '</button> '
        + '<button type="button" data-rotate="' + h.id + '" style="' + btn2 + '">New secret</button> <button type="button" data-log="' + h.id + '" style="' + btn2 + '">Log</button> <button type="button" data-delhook="' + h.id + '" style="' + btn2 + '">Delete</button></td></tr>';
    });
    html += '</tbody></table></div><div id="api-log"></div>';
    html += '<div style="margin-top:0.6rem;padding:0.6rem;border:1px dashed #d1d5db;border-radius:6px"><strong style="font-size:0.85rem">Add a webhook</strong><div style="display:flex;flex-wrap:wrap;gap:0.6rem;margin-top:0.4rem">'
      + '<input id="w-name" placeholder="Name" maxlength="60" style="' + inp + ';width:12rem"><input id="w-url" placeholder="https://example.com/hook" maxlength="300" style="' + inp + ';flex:1;min-width:16rem">'
      + '<select id="w-payload" style="' + inp + '"><option value="full">Send full booking data</option><option value="minimal">Send no personal data</option></select></div><div style="margin-top:0.4rem;font-size:0.85rem">';
    w.events.forEach(function (e) { html += '<label style="margin-right:1rem;white-space:nowrap"><input type="checkbox" data-event="' + e + '" checked> ' + esc(EVENT_TEXT[e] || e) + '</label>'; });
    html += '</div><button type="button" id="w-create" style="' + btn + ';margin-top:0.5rem">Add webhook</button>'
      + '<div style="font-size:0.78rem;color:var(--muted,#57606a);margin-top:0.4rem">The address must be https. Every message is signed with a secret that is shown once; the receiver must check the signature. Failed deliveries are retried for about nine hours. '
      + 'Full booking data contains personal data: only send it to systems you are allowed to give it to.</div></div></details>';
    host.innerHTML = html;
    wire();
  }

  function wire() {
    var q = function (sel) { return host.querySelectorAll(sel); };
    var copy = host.querySelector('#api-copy');
    if (copy) copy.onclick = function () { var t = host.querySelector('#api-secret').textContent; if (navigator.clipboard) navigator.clipboard.writeText(t); copy.textContent = 'Copied'; };
    host.querySelector('#k-create').onclick = function () {
      var scopes = []; q('[data-scope]').forEach(function (c) { if (c.checked) scopes.push(c.getAttribute('data-scope')); });
      run('createApiKey', [host.querySelector('#k-name').value, scopes, host.querySelector('#k-days').value], function (r) {
        if (r && r.success) { shown = r.key; reload(); } else msg((r && r.error) || 'Failed', true);
      });
    };
    q('[data-revoke]').forEach(function (b) { b.onclick = function () { if (confirm('Revoke this key? Systems using it stop working immediately.')) run('revokeApiKey', [+b.getAttribute('data-revoke')], function (r) { shown = ''; if (r && r.success) reload(); else msg((r && r.error) || 'Failed', true); }); }; });
    host.querySelector('#w-create').onclick = function () {
      var ev = []; q('[data-event]').forEach(function (c) { if (c.checked) ev.push(c.getAttribute('data-event')); });
      run('createWebhook', [{ name: host.querySelector('#w-name').value, url: host.querySelector('#w-url').value, events: ev, payload: host.querySelector('#w-payload').value }], function (r) {
        if (r && r.success) { shown = r.secret; reload(); } else msg((r && r.error) || 'Failed', true);
      });
    };
    function hook(id) { return state.webhooks.hooks.filter(function (h) { return h.id === id; })[0]; }
    q('[data-test]').forEach(function (b) { b.onclick = function () { msg('Sending...', false); run('testWebhook', [+b.getAttribute('data-test')], function (r) { msg(r && r.ok ? 'Test delivered (HTTP ' + r.code + ').' : 'Test failed: ' + ((r && (r.error || r.code)) || 'no answer'), !(r && r.ok)); reload(); }); }; });
    q('[data-toggle]').forEach(function (b) { b.onclick = function () { var h = hook(+b.getAttribute('data-toggle')); run('updateWebhook', [h.id, { name: h.name, url: h.url, events: h.events, payload: h.payload, enabled: !h.enabled }], function () { shown = ''; reload(); }); }; });
    q('[data-rotate]').forEach(function (b) { b.onclick = function () { if (!confirm('Create a new secret? The receiver must be updated with it.')) return; var h = hook(+b.getAttribute('data-rotate')); run('updateWebhook', [h.id, { name: h.name, url: h.url, events: h.events, payload: h.payload, enabled: h.enabled, rotateSecret: true }], function (r) { if (r && r.success) { shown = r.secret; reload(); } else msg((r && r.error) || 'Failed', true); }); }; });
    q('[data-delhook]').forEach(function (b) { b.onclick = function () { if (confirm('Delete this webhook and its queued messages?')) run('deleteWebhook', [+b.getAttribute('data-delhook')], function () { shown = ''; reload(); }); }; });
    q('[data-log]').forEach(function (b) { b.onclick = function () {
      run('getWebhookDeliveries', [+b.getAttribute('data-log')], function (r) {
        var t = '<table style="width:100%;border-collapse:collapse;font-size:0.78rem;margin-top:0.5rem"><tr style="text-align:left"><th>Time</th><th>Event</th><th>Booking</th><th>Status</th><th>Tries</th><th>Answer</th></tr>';
        ((r && r.deliveries) || []).forEach(function (d) { t += '<tr><td>' + fmt(d.created_at) + '</td><td>' + esc(d.event) + '</td><td>' + esc(d.booking_ref) + '</td><td>' + esc(d.status) + '</td><td>' + d.attempts + '</td><td>' + esc(d.last_error || (d.last_code ? 'HTTP ' + d.last_code : '')) + '</td></tr>'; });
        host.querySelector('#api-log').innerHTML = t + '</table>';
      });
    }; });
  }

  window.initApi = function () {
    host = document.getElementById('api-card');
    if (!host) return;
    rpc.run.withSuccessHandler(function (d) { if (d && d.success) { state = d; render(); } })
      .withFailureHandler(function (e) { host.textContent = 'Could not load the API settings: ' + e.message; }).getApiOverview();
  };
})();
