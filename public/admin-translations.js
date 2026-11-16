// "Translations" card of the admin panel: edit the texts shown to guests in each language.
// UI texts are the built-in catalog (overrides are stored in the database); event content (event name,
// day labels, package texts, room notes ...) is entered here for every language except the default one.
(function () {
  var host, DATA = null, LANG = null, TAB = 'content', FILTER = '';
  function el(id) { return document.getElementById(id); }
  function esc(s) { return String(s == null ? '' : s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;'); }
  function run(method, args, ok, fail) {
    var r = google.script.run.withSuccessHandler(ok).withFailureHandler(fail || function (e) { alert('Error: ' + e.message); });
    r[method].apply(r, args);
  }
  var GROUPS = { form: 'Booking form', pub: 'Public list', js: 'Form messages and prices', price: 'Price lines (emails)', priv: 'Privacy notice', mail: 'Emails', err: 'Error messages' };
  function groupOf(key) { return key.split('.')[0]; }
  function ph(s) { return (String(s).match(/\{\w+\}/g) || []).sort().join(','); }

  function load(lang) {
    var m = el('tr-msg'); if (m) { m.style.color = 'var(--muted,#57606a)'; m.textContent = 'Loading...'; }
    run('getTranslations', [lang || LANG || ''], function (d) {
      if (!d || !d.success) { if (m) { m.style.color = '#b91c1c'; m.textContent = (d && d.error) || 'Failed'; } return; }
      DATA = d; LANG = d.lang; render();
    });
  }

  function rowHtml(r, kind) {
    var cur = r.value || (kind === 'ui' ? r.builtin : '');
    var src = kind === 'ui' ? r.en : r.source;
    var label = kind === 'ui' ? r.key : r.label;
    var rows = Math.min(8, Math.max(1, Math.ceil(String(src).length / 70) + (String(src).split('\n').length - 1)));
    return '<div class="tr-row" data-key="' + esc(r.key) + '" data-kind="' + kind + '" style="border-top:1px solid #e5e7eb;padding:0.5rem 0">'
      + '<div style="font-size:0.75rem;color:var(--muted,#57606a)">' + esc(label) + '</div>'
      + '<div style="font-size:0.85rem;white-space:pre-wrap;margin:0.15rem 0 0.3rem">' + esc(src) + '</div>'
      + '<textarea rows="' + rows + '" data-orig="' + esc(cur) + '" style="width:100%;box-sizing:border-box;padding:0.35rem;border:1.5px solid #d1d5db;border-radius:3px;font:inherit;font-size:0.85rem"'
      + ' placeholder="' + esc(kind === 'ui' ? 'Translation' : 'Leave empty to show the original text') + '">' + esc(cur) + '</textarea></div>';
  }

  function render() {
    var d = DATA, h = '<details style="background:var(--surface,#fff);border:1.5px solid #d1d5db;border-radius:6px;padding:0.75rem 1rem;margin:1rem 0"' + (host.dataset.open ? ' open' : '') + '>'
      + '<summary style="cursor:pointer;font-weight:700;font-size:1rem">🌐 Translations</summary>';
    h += '<p style="font-size:0.85rem;color:var(--muted,#57606a);margin:0.6rem 0">Guests choose their language on the booking pages. Enable languages in <em>Event setup &rarr; Languages</em>. '
      + 'Texts you leave unchanged use the built-in translation; anything missing falls back to the default language, then English. Keep <code>{placeholders}</code> exactly as in the English text.</p>';
    h += '<div style="display:flex;flex-wrap:wrap;gap:0.5rem;align-items:center;margin:0.5rem 0"><label style="font-weight:600;font-size:0.85rem" for="tr-lang">Language</label>'
      + '<select id="tr-lang" style="padding:0.35rem;border:1.5px solid #d1d5db;border-radius:3px">'
      + d.languages.map(function (l) { return '<option value="' + l.code + '"' + (l.code === d.lang ? ' selected' : '') + '>' + esc(l.name) + (d.enabled.indexOf(l.code) < 0 ? ' (not enabled)' : '') + (l.code === d.defaultLang ? ' (default)' : '') + '</option>'; }).join('')
      + '</select>'
      + '<button type="button" id="tr-tab-content" style="padding:0.3rem 0.7rem;border:1.5px solid #d1d5db;border-radius:3px;background:' + (TAB === 'content' ? '#e0e7ff' : '#fff') + ';cursor:pointer">Event content</button>'
      + '<button type="button" id="tr-tab-ui" style="padding:0.3rem 0.7rem;border:1.5px solid #d1d5db;border-radius:3px;background:' + (TAB === 'ui' ? '#e0e7ff' : '#fff') + ';cursor:pointer">Interface texts' + (d.missing ? ' (' + d.missing + ' missing)' : '') + '</button>'
      + '<input id="tr-filter" type="search" placeholder="Filter..." value="' + esc(FILTER) + '" style="padding:0.35rem;border:1.5px solid #d1d5db;border-radius:3px;margin-left:auto"></div>';
    var f = FILTER.toLowerCase();
    if (TAB === 'content') {
      if (d.isDefault) h += '<p style="font-size:0.85rem;color:#b45309">This is the default language: guests see the texts exactly as you entered them in Event setup, so there is nothing to translate here. Pick another language.</p>';
      var rows = d.content.filter(function (r) { return !f || (r.label + ' ' + r.source + ' ' + r.value).toLowerCase().indexOf(f) >= 0; });
      h += rows.length ? rows.map(function (r) { return rowHtml(r, 'content'); }).join('') : '<p style="font-size:0.85rem">No event content to translate.</p>';
    } else {
      var last = '';
      d.ui.filter(function (r) { return !f || (r.key + ' ' + r.en + ' ' + r.builtin + ' ' + r.value).toLowerCase().indexOf(f) >= 0; }).forEach(function (r) {
        var g = groupOf(r.key);
        if (g !== last) { h += '<h4 style="margin:0.9rem 0 0.2rem;font-size:0.9rem">' + esc(GROUPS[g] || g) + '</h4>'; last = g; }
        h += rowHtml(r, 'ui');
      });
    }
    h += '<div style="margin-top:0.8rem;position:sticky;bottom:0;background:var(--surface,#fff);padding:0.5rem 0;border-top:1px solid #e5e7eb">'
      + '<button type="button" id="tr-save" style="padding:0.5rem 1.2rem;border:0;border-radius:4px;background:#1d4ed8;color:#fff;font-weight:600;cursor:pointer">Save translations</button>'
      + ' <span id="tr-msg" style="margin-left:0.75rem;font-size:0.85rem"></span></div></details>';
    host.innerHTML = h;
    host.querySelector('details').addEventListener('toggle', function (e) { host.dataset.open = e.target.open ? '1' : ''; });
    el('tr-lang').addEventListener('change', function () { host.dataset.open = '1'; load(this.value); });
    el('tr-tab-content').addEventListener('click', function () { collectKeep(); TAB = 'content'; render(); });
    el('tr-tab-ui').addEventListener('click', function () { collectKeep(); TAB = 'ui'; render(); });
    el('tr-filter').addEventListener('change', function () { collectKeep(); FILTER = this.value; render(); });
    el('tr-save').addEventListener('click', save);
    restoreKept();
  }

  // Unsaved edits survive switching tabs or filtering
  var KEPT = {};
  function collectKeep() {
    host.querySelectorAll('.tr-row').forEach(function (row) {
      var ta = row.querySelector('textarea');
      if (ta.value !== ta.getAttribute('data-orig')) KEPT[row.getAttribute('data-key')] = ta.value; else delete KEPT[row.getAttribute('data-key')];
    });
  }
  function restoreKept() {
    host.querySelectorAll('.tr-row').forEach(function (row) {
      var k = row.getAttribute('data-key'); if (KEPT[k] !== undefined) row.querySelector('textarea').value = KEPT[k];
    });
  }

  function save() {
    collectKeep();
    var msg = el('tr-msg'), map = {}, bad = [], n = 0;
    var en = {}; DATA.ui.forEach(function (r) { en[r.key] = r.en; });
    Object.keys(KEPT).forEach(function (k) {
      if (en[k] !== undefined && KEPT[k].trim() && ph(en[k]) !== ph(KEPT[k])) bad.push(k);
      map[k] = KEPT[k]; n++;
    });
    if (bad.length) { msg.style.color = '#b91c1c'; msg.textContent = 'The {placeholders} differ from the English text in: ' + bad.slice(0, 5).join(', ') + (bad.length > 5 ? ' ...' : ''); return; }
    if (!n) { msg.style.color = 'var(--muted,#57606a)'; msg.textContent = 'Nothing changed.'; return; }
    msg.style.color = 'var(--muted,#57606a)'; msg.textContent = 'Saving...';
    run('saveTranslations', [LANG, map], function (r) {
      if (!r || !r.success) { msg.style.color = '#b91c1c'; msg.textContent = (r && r.error) || 'Failed'; return; }
      KEPT = {}; host.dataset.open = '1'; load(LANG);
      setTimeout(function () { var m = el('tr-msg'); if (m) { m.style.color = '#15803d'; m.textContent = '✓ Saved (' + n + ' text(s)). Reload a booking page to see them.'; } }, 400);
    });
  }

  window.initTranslations = function () {
    host = el('translations'); if (!host) return;
    host.innerHTML = '<div style="font-size:0.85rem;color:var(--muted,#57606a);margin:1rem 0">Loading translations...</div>';
    load('');
  };
})();
