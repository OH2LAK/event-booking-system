// "Data protection and event shutdown" card plus per-booking export/erase helpers for the admin panel.
(function () {
  var host;
  function el(id) { return document.getElementById(id); }
  function esc(s) { return String(s == null ? '' : s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;'); }
  function run(method, args, ok, fail) {
    var r = rpc.run.withSuccessHandler(ok).withFailureHandler(fail || function (e) { alert('Error: ' + e.message); });
    r[method].apply(r, args);
  }

  var STATE = {
    unset: ['#8b949e', 'No event end date is set. Set "Last day of the event" in Event setup to start the retention clock.'],
    ok: ['#3fb950', 'Within the retention period.'],
    due_soon: ['#d29922', 'The retention deadline is close.'],
    overdue: ['#f85149', 'The retention deadline has passed. Erase the data now, or set a retention hold if a matter is still open.'],
    hold: ['#8b949e', 'A retention hold is active. Clear it in Event setup once the matter is closed.']
  };

  function render(d) {
    var rt = d.retention, c = d.counts, st = STATE[rt.state] || STATE.unset;
    var h = '<details style="background:var(--surface,#fff);border:1.5px solid ' + st[0] + ';border-radius:6px;padding:0.75rem 1rem;margin:1rem 0"'
      + (rt.state === 'overdue' || rt.state === 'due_soon' ? ' open' : '') + '>'
      + '<summary style="cursor:pointer;font-weight:700;font-size:1rem">🛡️ Data protection and event shutdown</summary>';
    h += '<div style="margin:0.75rem 0;padding:0.6rem 0.8rem;border-left:4px solid ' + st[0] + ';background:rgba(127,127,127,0.12);color:var(--text,#1c2128);font-size:0.9rem">'
      + '<strong style="color:' + st[0] + '">' + esc(rt.state.replace('_', ' ').toUpperCase()) + '</strong> — ' + esc(st[1])
      + (rt.deleteBy ? '<br>Event ends: <strong>' + esc(rt.endDate) + '</strong> · Erase personal data by: <strong>' + esc(rt.deleteBy) + '</strong> (' + rt.retentionDays + ' days after the event)'
        + (rt.daysLeft !== null ? ' · ' + (rt.daysLeft >= 0 ? rt.daysLeft + ' day(s) left' : Math.abs(rt.daysLeft) + ' day(s) overdue') : '') : '')
      + (rt.hold ? '<br>Hold reason: <strong>' + esc(rt.hold) + '</strong>' : '') + '</div>';
    h += '<p style="font-size:0.88rem;margin:0.5rem 0">Personal data held now: <strong>' + c.bookings + '</strong> booking(s) (' + c.activeBookings + ' active), <strong>' + c.logRows + '</strong> log row(s).'
      + (d.last ? '<br>Last shutdown: ' + esc(d.last.at.slice(0, 10)) + ', ' + d.last.bookingsErased + ' booking(s) erased, ' + (d.last.verified ? 'verified' : '<strong style="color:#f85149">NOT fully verified</strong>') + '.' : '') + '</p>';
    h += '<p style="font-size:0.85rem;color:var(--muted,#57606a);margin:0.5rem 0">To erase <em>one person</em>, open their booking (Edit) and use <strong>Export data</strong> or <strong>Erase data…</strong>. '
      + 'Event shutdown below erases <em>everyone</em> at once and cannot be undone.</p>';
    h += '<fieldset style="border:1px solid #f85149;border-radius:6px;margin:0.9rem 0;padding:0.6rem 0.9rem"><legend style="font-weight:700;color:#f85149;padding:0 0.4rem">Event shutdown</legend>'
      + '<ol style="font-size:0.85rem;margin:0.3rem 0 0.6rem 1.1rem;padding:0;line-height:1.5">'
      + '<li>Download what you still need (without personal data if possible): <a href="/report?view=hotel&fmt=csv" target="_blank" rel="noopener">full CSV export</a>. Delete that file afterwards.</li>'
      + '<li>Make sure no dispute or other open matter needs the data (otherwise set a retention hold in Event setup).</li>'
      + '<li>Run the shutdown. It sends the optional final notice, deletes all bookings and log entries, closes registration, removes deleted rows from the database files and verifies the result.</li>'
      + '<li>Afterwards remove copies the app cannot reach: database backups and dumps, exported CSV/XLSX files, the report print-outs, your mail program\'s sent items and your SMTP provider\'s logs.</li></ol>';
    h += '<label style="display:flex;gap:0.4rem;align-items:center;font-size:0.88rem;margin:0.4rem 0"><input type="checkbox" id="sd-notice"' + (d.emailEnabled ? ' checked' : ' disabled') + '> Send a final "your data is being erased" email to every registrant'
      + (d.emailEnabled ? '' : ' <span style="color:var(--muted,#57606a)">(email is not configured)</span>') + '</label>';
    if (!rt.eventEnded) h += '<label style="display:flex;gap:0.4rem;align-items:center;font-size:0.88rem;margin:0.4rem 0;color:#d29922"><input type="checkbox" id="sd-early"> The event has not ended (or has no end date). I understand and want to erase everything anyway.</label>';
    h += '<div style="margin:0.6rem 0"><label for="sd-confirm" style="display:block;font-size:0.8rem;font-weight:600">Type <code>' + esc(d.confirmPhrase) + '</code> to confirm</label>'
      + '<input id="sd-confirm" type="text" autocomplete="off" style="padding:0.4rem;border:1.5px solid #d1d5db;border-radius:3px;width:16rem"></div>'
      + '<button id="sd-go" style="padding:0.5rem 1.2rem;border:0;border-radius:4px;background:#b91c1c;color:#fff;font-weight:600;cursor:pointer"' + (rt.hold ? ' disabled' : '') + '>Erase all personal data and close the event</button>'
      + ' <span id="sd-msg" style="margin-left:0.75rem;font-size:0.85rem"></span><div id="sd-result"></div></fieldset></details>';
    host.innerHTML = h;
    el('sd-go').addEventListener('click', shutdown);
  }

  function shutdown() {
    var msg = el('sd-msg');
    var opts = { confirm: el('sd-confirm').value, sendNotices: !!(el('sd-notice') && el('sd-notice').checked), acknowledgeEarly: !!(el('sd-early') && el('sd-early').checked) };
    msg.style.color = 'var(--muted,#57606a)'; msg.textContent = 'Working... this can take a while when notices are sent.';
    el('sd-go').disabled = true;
    run('shutdownEvent', [opts], function (r) {
      el('sd-go').disabled = false;
      if (!r || !r.success) { msg.style.color = '#f85149'; msg.textContent = (r && r.error) || 'Failed'; return; }
      msg.style.color = r.verified ? '#3fb950' : '#f85149';
      msg.textContent = r.verified ? '✓ Done and verified.' : 'Finished, but some checks failed. See below.';
      var h = '<table style="border-collapse:collapse;margin:0.7rem 0;font-size:0.85rem"><tr><th style="text-align:left;padding:0.2rem 0.6rem">Check</th><th>Expected</th><th>Actual</th><th></th></tr>';
      r.verification.forEach(function (v) { h += '<tr><td style="padding:0.2rem 0.6rem">' + esc(v.check) + '</td><td style="padding:0.2rem 0.6rem">' + esc(v.expected) + '</td><td style="padding:0.2rem 0.6rem">' + esc(v.actual) + '</td><td>' + (v.ok ? '✅' : '❌') + '</td></tr>'; });
      h += '</table><p style="font-size:0.85rem">Erased ' + r.erased.bookings + ' booking(s) and ' + r.erased.logRows + ' log row(s). Notices sent: ' + r.notices.sent + '.' + (r.notices.note ? ' ' + esc(r.notices.note) : '') + '</p>';
      if (r.notices.failed.length) {
        h += '<p style="font-size:0.85rem;color:#f85149">Notices that could not be sent (shown once, not stored; contact these people yourself if you want to):</p><ul style="font-size:0.85rem">'
          + r.notices.failed.map(function (f) { return '<li>' + esc(f.callsign) + ' — ' + esc(f.email) + '</li>'; }).join('') + '</ul>';
      }
      h += '<p style="font-size:0.85rem">Remember backups, exported files and mail copies (step 4 above).</p>';
      el('sd-result').innerHTML = h;
    }, function (e) { el('sd-go').disabled = false; msg.style.color = '#f85149'; msg.textContent = 'Error: ' + e.message; });
  }

  window.initPrivacy = function () {
    host = el('event-privacy');
    if (!host) return;
    run('getShutdownPreview', [], function (d) { if (d && d.success) render(d); }, function (e) { host.textContent = 'Could not load: ' + e.message; });
  };

  // ---- per-booking tools (buttons in the edit dialog) ----
  window.gdprExport = function (ref) {
    if (!ref) return;
    run('exportBooking', [ref], function (r) {
      if (!r || !r.success) { alert((r && r.error) || 'Export failed'); return; }
      var blob = new Blob([JSON.stringify(r.data, null, 2)], { type: 'application/json' });
      var a = document.createElement('a');
      a.href = URL.createObjectURL(blob); a.download = r.filename;
      document.body.appendChild(a); a.click(); a.remove();
    });
  };
  window.gdprErase = function (ref) {
    if (!ref) return;
    var cs = (el('edit-callsign') && el('edit-callsign').value || '').trim().toUpperCase();
    var typed = window.prompt('This permanently erases ALL personal data of booking ' + ref + ' (the booking row and related log entries). It cannot be undone.\n\nType the callsign ' + cs + ' to confirm:');
    if (typed === null) return;
    if (typed.trim().toUpperCase() !== cs) { alert('The callsign did not match. Nothing was erased.'); return; }
    var notice = window.confirm('Send the person a final email saying that their data is being erased?\n\nOK = send the email first, then erase.\nCancel = erase without sending any email.');
    run('eraseBooking', [ref, { sendNotice: notice }], function (r) {
      if (!r || !r.success) { alert((r && r.error) || 'Erase failed'); return; }
      var m = 'Erased ' + ref + '. Log entries removed: ' + r.logRowsRemoved + '.';
      if (r.notice.requested) m += r.notice.sent ? '\nFinal notice email sent.' : '\nNo notice was sent: ' + r.notice.error;
      alert(m);
      if (window.closeEdit) window.closeEdit();
      if (window.loadAdmin) window.loadAdmin();
      if (window.initPrivacy) window.initPrivacy();
    });
  };
})();
