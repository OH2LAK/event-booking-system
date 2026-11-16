// "Currencies" card for the admin panel: exchange rates for the extra currencies guests can pick.
// All prices and payments stay in the native currency; the rates are only used for an indicative conversion.
(function () {
  var host;
  function esc(s) { return String(s == null ? '' : s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;'); }
  var inp = 'padding:0.35rem;border:1.5px solid #d1d5db;border-radius:3px;';
  var btn = 'padding:0.45rem 1rem;border:0;border-radius:4px;color:#fff;font-weight:600;cursor:pointer;';

  function render(d, note) {
    var html = '<details style="background:var(--surface,#fff);border:1.5px solid var(--border,#d0d7de);border-radius:6px;padding:0.75rem 1rem;margin:1rem 0">'
      + '<summary style="cursor:pointer;font-weight:700;font-size:1rem">💱 Currencies</summary>'
      + '<p style="margin:0.75rem 0;font-size:0.88rem;color:var(--muted,#57606a)">Native currency: <strong>' + esc(d.native) + '</strong> (' + esc(d.nativeName) + '). '
      + 'All prices, totals and payments are in the native currency. Guests can pick one of the extra currencies below to see an <em>approximate</em> conversion (marked with ≈); '
      + 'the amount actually paid is always in ' + esc(d.native) + '. Change the native currency and the list of extra currencies under <strong>Event setup → Currency</strong> and reload this page.</p>';
    if (!d.rates.length) {
      html += '<p style="font-size:0.9rem">No extra currencies are enabled. Add codes such as USD, GBP or SEK in Event setup → Currency → Extra currencies.</p>';
    } else {
      html += '<table style="border-collapse:collapse;font-size:0.9rem;width:100%;max-width:640px"><thead><tr style="text-align:left">'
        + '<th style="padding:0.3rem">Currency</th><th style="padding:0.3rem">1 ' + esc(d.native) + ' =</th><th style="padding:0.3rem" title="A rate you typed in by hand is kept when fetching ECB rates">Keep (manual)</th><th style="padding:0.3rem">Updated</th></tr></thead><tbody>';
      d.rates.forEach(function (r) {
        html += '<tr data-code="' + esc(r.code) + '"><td style="padding:0.3rem"><strong>' + esc(r.code) + '</strong> <span style="color:var(--muted,#57606a);font-size:0.8rem">' + esc(r.name) + '</span></td>'
          + '<td style="padding:0.3rem"><input class="cur-rate" type="text" inputmode="decimal" value="' + esc(r.rate === null ? '' : r.rate) + '" placeholder="rate" style="' + inp + 'width:8rem"> ' + esc(r.code) + '</td>'
          + '<td style="padding:0.3rem"><input class="cur-manual" type="checkbox"' + (r.manual ? ' checked' : '') + '></td>'
          + '<td style="padding:0.3rem;font-size:0.8rem;color:var(--muted,#57606a)">' + (r.rate === null ? (r.stale ? 'old rate for another native currency — not used' : 'no rate — guests cannot pick this currency') : esc(String(r.updated || '').slice(0, 10))) + '</td></tr>';
      });
      html += '</tbody></table>'
        + '<p style="font-size:0.78rem;color:var(--muted,#57606a);margin:0.5rem 0">A currency without a rate is not offered to guests. Use a dot or comma as decimal separator.</p>'
        + '<div><button id="cur-fetch" style="' + btn + 'background:var(--accent2,#1d6fa5)">Fetch ECB rates</button> '
        + '<button id="cur-save" style="' + btn + 'background:var(--accent,#b45309)">Save rates</button> '
        + '<span id="cur-msg" style="margin-left:0.6rem;font-size:0.85rem">' + (note || '') + '</span></div>'
        + '<p style="font-size:0.75rem;color:var(--muted,#57606a);margin-top:0.6rem">Fetching contacts the European Central Bank (daily reference rates) from the server; no guest data is sent. '
        + 'Currencies the ECB does not publish, and rates marked as manual, are left unchanged.</p>';
    }
    html += '</details>';
    host.innerHTML = html;
    var f = document.getElementById('cur-fetch'), s = document.getElementById('cur-save');
    if (f) f.addEventListener('click', fetchRates);
    if (s) s.addEventListener('click', save);
  }
  function msg(text, ok) { var m = document.getElementById('cur-msg'); if (m) { m.style.color = ok ? '#15803d' : '#b91c1c'; m.textContent = text; } }
  function collect() {
    return Array.prototype.map.call(host.querySelectorAll('tbody tr'), function (tr) {
      return { code: tr.getAttribute('data-code'), rate: tr.querySelector('.cur-rate').value, manual: tr.querySelector('.cur-manual').checked };
    });
  }
  function save() {
    msg('Saving...', true);
    google.script.run.withSuccessHandler(function (r) {
      if (r && r.success) render(r, '<span style="color:#15803d">✓ Saved. Reload a booking page to see the changes.</span>'); else msg((r && r.error) || 'Save failed', false);
    }).withFailureHandler(function (e) { msg('Error: ' + e.message, false); }).saveCurrencyRates(collect());
  }
  function fetchRates() {
    msg('Fetching...', true);
    google.script.run.withSuccessHandler(function (r) {
      if (!r || !r.success) { msg((r && r.error) || 'Fetch failed', false); return; }
      var parts = ['ECB rates of ' + (r.ecbDate || 'today') + ': updated ' + (r.updated.join(', ') || 'none')];
      if (r.keptManual.length) parts.push('kept manual: ' + r.keptManual.join(', '));
      if (r.missing.length) parts.push('not published by the ECB (enter by hand): ' + r.missing.join(', '));
      render(r, '<span style="color:#15803d">✓ ' + esc(parts.join(' · ')) + '</span>');
    }).withFailureHandler(function (e) { msg('Error: ' + e.message, false); }).fetchCurrencyRates();
  }
  window.initCurrencies = function () {
    host = document.getElementById('currencies');
    if (!host) return;
    google.script.run.withSuccessHandler(function (d) { if (d && d.success) render(d); })
      .withFailureHandler(function (e) { host.textContent = 'Could not load currencies: ' + e.message; }).getCurrencies();
  };
})();
