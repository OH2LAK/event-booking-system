// "Event structure" card for the admin panel: days, extra nights and the meal package.
(function () {
  var host, st;
  function esc(s) { return String(s == null ? '' : s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;'); }
  var cell = 'padding:0.3rem;border:1.5px solid #d1d5db;border-radius:3px;box-sizing:border-box;width:100%';

  function rowsOf(sel, names) {
    var out = [];
    host.querySelectorAll(sel).forEach(function (tr) {
      var o = { key: tr.getAttribute('data-key') || '' };
      names.forEach(function (n) { o[n] = tr.querySelector('[name=' + n + ']').value; });
      out.push(o);
    });
    return out;
  }
  function collect() {
    return {
      days: rowsOf('tr[data-day]', ['label', 'short']),
      accommodation: host.querySelector('#st-mode').value,
      coreNights: host.querySelector('#st-nights').value,
      extraNights: rowsOf('tr[data-extra]', ['label', 'includes']),
      package: { enabled: host.querySelector('#st-pkg-on').checked, sub: host.querySelector('#st-pkg-sub').value, includes: host.querySelector('#st-pkg-inc').value },
    };
  }

  function render(open) {
    var h = '<details' + (open ? ' open' : '') + ' style="background:var(--surface,#fff);border:1.5px solid var(--border,#d0d7de);border-radius:6px;padding:0.75rem 1rem;margin:1rem 0">'
      + '<summary style="cursor:pointer;font-weight:700;font-size:1rem">📅 Event structure (days, extra nights, meals)</summary>'
      + '<p style="margin:0.75rem 0;color:var(--muted,#57606a);font-size:0.85rem">The <strong>event days</strong> are the core period (from first to last day). The room price covers the nights of this period. '
      + '<strong>Extra nights</strong> (before or after, e.g. "Thursday night") can be added by room guests; each costs the room price divided by the nights included. '
      + 'Day visitors choose among the event days. Days or extra nights that already have bookings cannot be removed.</p>'
      + '<h4 style="margin:0.5rem 0">Event days</h4><table style="width:100%;border-collapse:collapse;font-size:0.85rem"><thead><tr style="text-align:left"><th>Label (long)</th><th>Short label</th><th></th></tr></thead><tbody>';
    st.days.forEach(function (d, i) {
      h += '<tr data-day data-key="' + esc(d.key) + '"><td><input name="label" maxlength="60" value="' + esc(d.label) + '" style="' + cell + '" placeholder="e.g. Friday 14 May"></td>'
        + '<td><input name="short" maxlength="40" value="' + esc(d.short) + '" style="' + cell + '" placeholder="e.g. Fri 14.5."></td>'
        + '<td style="white-space:nowrap"><button type="button" data-delday="' + i + '">✕</button></td></tr>';
    });
    h += '</tbody></table><button type="button" id="st-add-day" style="margin:0.4rem 0">+ Add day</button>'
      + '<div style="margin:0.75rem 0"><label style="font-weight:600;font-size:0.85rem">How are rooms booked? </label> '
      + '<select id="st-mode" style="padding:0.3rem"><option value="period"' + (st.accommodation !== 'per_night' ? ' selected' : '') + '>Whole event (one room price for all nights)</option>'
      + '<option value="per_night"' + (st.accommodation === 'per_night' ? ' selected' : '') + '>Per night (guests choose nights; price and availability per night)</option></select>'
      + '<div style="font-size:0.75rem;color:var(--muted,#57606a);margin-top:0.25rem">Per-night mode applies to rooms and single beds. Each event day has one night; camper vans and tents are always for the whole event.</div></div>'
      + '<div style="margin:0.75rem 0"><label style="font-weight:600;font-size:0.85rem">Nights included in the room price </label> '
      + '<input id="st-nights" type="number" min="1" max="14" value="' + esc(st.coreNights) + '" style="width:5rem;' + cell.replace('width:100%', '') + '"> <span id="st-nights-note" style="font-size:0.75rem;color:var(--muted,#57606a)"></span></div>'
      + '<h4 style="margin:0.5rem 0">Extra nights (optional)</h4><table style="width:100%;border-collapse:collapse;font-size:0.85rem"><thead><tr style="text-align:left"><th>Label</th><th>Includes (optional)</th><th></th></tr></thead><tbody>';
    st.extraNights.forEach(function (x, i) {
      h += '<tr data-extra data-key="' + esc(x.key) + '"><td><input name="label" maxlength="60" value="' + esc(x.label) + '" style="' + cell + '" placeholder="e.g. Thursday night"></td>'
        + '<td><input name="includes" maxlength="100" value="' + esc(x.includes) + '" style="' + cell + '" placeholder="e.g. Includes Friday breakfast"></td>'
        + '<td><button type="button" data-delx="' + i + '">✕</button></td></tr>';
    });
    h += '</tbody></table><button type="button" id="st-add-x" style="margin:0.4rem 0">+ Add extra night</button>'
      + '<h4 style="margin:0.75rem 0 0.4rem">Meal package</h4>'
      + '<label style="display:flex;gap:0.4rem;align-items:center"><input type="checkbox" id="st-pkg-on"' + (st.package.enabled ? ' checked' : '') + '> Offer a meal package (the price is set in Pricing)</label>'
      + '<div style="margin-top:0.5rem"><label style="font-size:0.8rem;font-weight:600">One-line summary (booking form)</label><input id="st-pkg-sub" maxlength="120" value="' + esc(st.package.sub) + '" style="' + cell + '"></div>'
      + '<div style="margin-top:0.5rem"><label style="font-size:0.8rem;font-weight:600">Contents, one item per line (emails and reports)</label><textarea id="st-pkg-inc" rows="4" maxlength="900" style="' + cell + '">' + esc(st.package.includes.join('\n')) + '</textarea></div>'
      + '<div style="margin-top:0.75rem"><button type="button" id="st-save" style="padding:0.4rem 1.2rem;border:0;border-radius:4px;background:var(--accent,#b45309);color:#fff;font-weight:600;cursor:pointer">Save event structure</button> '
      + '<span id="st-msg" style="margin-left:0.75rem;font-size:0.85rem"></span></div></details>';
    host.innerHTML = h;
    var keep = function () { var c = collect(); st = { days: c.days, accommodation: c.accommodation, coreNights: c.coreNights, extraNights: c.extraNights, package: { enabled: c.package.enabled, sub: c.package.sub, includes: c.package.includes.split('\n') } }; };
    host.querySelector('#st-add-day').onclick = function () { keep(); st.days.push({ key: '', label: '', short: '' }); render(true); };
    host.querySelector('#st-add-x').onclick = function () { keep(); st.extraNights.push({ key: '', label: '', includes: '' }); render(true); };
    host.querySelectorAll('[data-delday]').forEach(function (b) { b.onclick = function () { keep(); st.days.splice(+b.getAttribute('data-delday'), 1); render(true); }; });
    host.querySelectorAll('[data-delx]').forEach(function (b) { b.onclick = function () { keep(); st.extraNights.splice(+b.getAttribute('data-delx'), 1); render(true); }; });
    var syncMode = function () {
      var pn = host.querySelector('#st-mode').value === 'per_night';
      var inp = host.querySelector('#st-nights');
      inp.disabled = pn;
      if (pn) inp.value = host.querySelectorAll('tr[data-day]').length;
      host.querySelector('#st-nights-note').textContent = pn ? '(equals the number of event days in per-night mode)' : '';
    };
    host.querySelector('#st-mode').onchange = syncMode; syncMode();
    host.querySelector('#st-save').onclick = save;
  }

  function save() {
    var msg = host.querySelector('#st-msg');
    msg.style.color = 'var(--muted,#57606a)'; msg.textContent = 'Saving...';
    rpc.run
      .withSuccessHandler(function (r) {
        if (r && r.success) { msg.style.color = '#15803d'; msg.textContent = '✓ Saved. Reloading...'; setTimeout(function () { location.reload(); }, 600); }
        else { msg.style.color = '#b91c1c'; msg.textContent = (r && r.error) || 'Save failed'; }
      })
      .withFailureHandler(function (e) { msg.style.color = '#b91c1c'; msg.textContent = 'Error: ' + e.message; })
      .saveStructure(collect());
  }

  window.initStructure = function () {
    host = document.getElementById('event-structure');
    if (!host) return;
    rpc.run
      .withSuccessHandler(function (d) { if (d && d.success) { st = d.structure; render(false); } })
      .withFailureHandler(function (e) { host.textContent = 'Could not load event structure: ' + e.message; })
      .getStructure();
  };
})();
