// "Event setup" card for the admin panel: identity, dates, contact and branding stored in the database.
(function () {
  var host;
  function el(tag, attrs, html) {
    var e = document.createElement(tag);
    Object.keys(attrs || {}).forEach(function (k) { e.setAttribute(k, attrs[k]); });
    if (html !== undefined) e.innerHTML = html;
    return e;
  }
  function esc(s) { return String(s == null ? '' : s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;'); }

  function render(data) {
    var groups = {};
    data.fields.forEach(function (f) { (groups[f.group] = groups[f.group] || []).push(f); });
    var open = data.configured ? '' : ' open';
    var html = '<details' + open + ' style="background:var(--surface,#fff);border:1.5px solid ' + (data.configured ? 'var(--border,#d0d7de)' : '#f85149') + ';border-radius:6px;padding:0.75rem 1rem;margin:1rem 0">'
      + '<summary style="cursor:pointer;font-weight:700;font-size:1rem">🎪 Event setup' + (data.configured ? '' : ' <span style="color:#f85149">— required before the booking page opens</span>') + '</summary>';
    if (!data.configured) {
      html += '<p style="margin:0.75rem 0;color:var(--muted,#57606a);font-size:0.9rem">Welcome! Fill in the details of your event and press <strong>Save event setup</strong>. '
        + 'Until then visitors see a "booking is not open yet" page. You can change everything later. Rooms, prices and registration dates are set further down this panel.</p>';
    }
    Object.keys(groups).forEach(function (g) {
      html += '<fieldset style="border:1px solid var(--border,#d0d7de);border-radius:6px;margin:0.9rem 0;padding:0.6rem 0.9rem"><legend style="font-weight:600;padding:0 0.4rem">' + esc(g) + '</legend>'
        + '<div style="display:grid;grid-template-columns:repeat(auto-fit,minmax(260px,1fr));gap:0.7rem 1rem">';
      groups[g].forEach(function (f) {
        var v = data.values[f.key];
        var id = 'ev-' + f.key;
        var input;
        if (f.type === 'textarea') input = '<textarea id="' + id + '" rows="3" maxlength="' + f.max + '" style="width:100%;box-sizing:border-box;padding:0.4rem;border:1.5px solid #d1d5db;border-radius:3px">' + esc(v) + '</textarea>';
        else if (f.type === 'color') input = '<input type="color" id="' + id + '" value="' + esc(v) + '" style="height:2.2rem;width:4rem;padding:0;border:1.5px solid #d1d5db;border-radius:3px">';
        else input = '<input type="' + ({ email: 'email', date: 'date', number: 'number' }[f.type] || 'text') + '"' + (f.type === 'number' ? ' min="0" max="365"' : '') + ' id="' + id + '" maxlength="' + f.max + '" value="' + esc(v) + '" style="width:100%;box-sizing:border-box;padding:0.4rem;border:1.5px solid #d1d5db;border-radius:3px">';
        html += '<div><label for="' + id + '" style="display:block;font-size:0.8rem;font-weight:600;margin-bottom:0.2rem">' + esc(f.label) + '</label>' + input
          + (f.help ? '<div style="font-size:0.72rem;color:var(--muted,#57606a);margin-top:0.15rem">' + esc(f.help) + '</div>' : '') + '</div>';
      });
      html += '</div></fieldset>';
    });
    html += '<div><button id="ev-save" style="padding:0.5rem 1.2rem;border:0;border-radius:4px;background:var(--accent,#b45309);color:#fff;font-weight:600;cursor:pointer">Save event setup</button>'
      + ' <span id="ev-msg" style="margin-left:0.75rem;font-size:0.85rem"></span></div></details>';
    host.innerHTML = html;
    document.getElementById('ev-save').addEventListener('click', function () { save(data.fields); });
  }

  function save(fields) {
    var msg = document.getElementById('ev-msg');
    var values = {};
    fields.forEach(function (f) { values[f.key] = document.getElementById('ev-' + f.key).value; });
    msg.style.color = 'var(--muted,#57606a)'; msg.textContent = 'Saving...';
    rpc.run
      .withSuccessHandler(function (r) {
        if (r && r.success) { msg.style.color = '#3fb950'; msg.textContent = '✓ Saved. Reload the booking page to see the changes.'; }
        else { msg.style.color = '#f85149'; msg.textContent = (r && r.error) || 'Save failed'; }
      })
      .withFailureHandler(function (e) { msg.style.color = '#f85149'; msg.textContent = 'Error: ' + e.message; })
      .saveEventConfig(values);
  }

  window.initEventSetup = function () {
    host = document.getElementById('event-setup');
    if (!host) return;
    rpc.run
      .withSuccessHandler(function (d) { if (d && d.success) render(d); })
      .withFailureHandler(function (e) { host.textContent = 'Could not load event setup: ' + e.message; })
      .getEventConfig();
  };
})();
