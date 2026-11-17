// "Extras" card for the setup page: optional things guests can add (meals, excursions, workshops ...).
(function () {
  var host, rows = [];
  function esc(s) { return String(s == null ? '' : s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;'); }
  var cell = 'padding:0.3rem;border:1.5px solid #d1d5db;border-radius:3px;box-sizing:border-box;width:100%';

  function readForm() {
    var out = [];
    host.querySelectorAll('tr[data-row]').forEach(function (tr) {
      var g = function (n) { return tr.querySelector('[name=' + n + ']'); };
      out.push({ id: g('id').value, name: g('name').value, description: g('description').value, price: g('price').value,
        max_qty: g('max_qty').value, capacity: g('capacity').value, closes: g('closes').value, enabled: g('enabled').checked });
    });
    return out;
  }
  function keep() { rows = readForm().map(function (r, i) { r._existing = !!(rows[i] && rows[i]._existing); return r; }); }
  function open() { host.querySelector('details').open = true; }

  function render() {
    var html = '<details style="background:var(--surface,#fff);border:1.5px solid var(--border,#d0d7de);border-radius:6px;padding:0.75rem 1rem;margin:1rem 0">'
      + '<summary style="cursor:pointer;font-weight:700;font-size:1rem">🍽️ Extras (meals, excursions, workshops)</summary>'
      + '<p style="margin:0.75rem 0;color:var(--muted,#57606a);font-size:0.85rem">Optional things guests can add when they register, each with a price. '
      + '<strong>Id</strong> is a short code (letters, digits, "-"; fixed once saved). <strong>Max per booking</strong> is how many one guest can take. '
      + '<strong>Capacity</strong> is the total available (0 = unlimited). <strong>Sign-up closes</strong> is the last day it can be chosen (empty = as long as registration is open). '
      + 'Untick <em>On</em> to hide an extra without deleting it. Existing bookings keep what they chose; use "Recalculate prices" after changing a price. '
      + 'Names and descriptions can be translated in the Translations card.</p>'
      + '<div style="overflow-x:auto"><table style="width:100%;border-collapse:collapse;font-size:0.85rem"><thead><tr style="text-align:left">'
      + '<th>Id</th><th>Name</th><th>Description</th><th>Price (' + esc((window.CUR && CUR.native) || 'EUR') + ')</th><th>Max per booking</th><th>Capacity</th><th>Sign-up closes</th><th>On</th><th></th></tr></thead><tbody>';
    rows.forEach(function (r, i) {
      html += '<tr data-row="' + i + '">'
        + '<td style="width:6.5rem"><input name="id" value="' + esc(r.id) + '" maxlength="12" style="' + cell + '"' + (r._existing ? ' readonly' : '') + '></td>'
        + '<td><input name="name" value="' + esc(r.name) + '" maxlength="60" style="' + cell + '"></td>'
        + '<td><input name="description" value="' + esc(r.description) + '" maxlength="200" style="' + cell + '"></td>'
        + '<td style="width:5.5rem"><input name="price" type="number" min="0" step="0.01" value="' + esc(r.price) + '" style="' + cell + '"></td>'
        + '<td style="width:4.5rem"><input name="max_qty" type="number" min="1" max="20" value="' + esc(r.max_qty) + '" style="' + cell + '"></td>'
        + '<td style="width:5rem"><input name="capacity" type="number" min="0" value="' + esc(r.capacity) + '" style="' + cell + '"></td>'
        + '<td style="width:9rem"><input name="closes" type="date" value="' + esc(r.closes) + '" style="' + cell + '"></td>'
        + '<td style="width:2.5rem;text-align:center"><input name="enabled" type="checkbox"' + (r.enabled ? ' checked' : '') + '></td>'
        + '<td style="white-space:nowrap"><button type="button" data-up="' + i + '" title="Move up">↑</button> <button type="button" data-del="' + i + '" title="Delete">✕</button></td></tr>';
    });
    html += '</tbody></table></div>'
      + '<div style="margin-top:0.75rem"><button type="button" id="ad-add" style="padding:0.4rem 0.9rem">+ Add extra</button> '
      + '<button type="button" id="ad-save" style="padding:0.4rem 1.2rem;border:0;border-radius:4px;background:var(--accent,#b45309);color:#fff;font-weight:600;cursor:pointer">Save extras</button> '
      + '<span id="ad-msg" style="margin-left:0.75rem;font-size:0.85rem"></span></div></details>';
    host.innerHTML = html;
    host.querySelector('#ad-add').onclick = function () {
      keep(); rows.push({ id: '', name: '', description: '', price: 0, max_qty: 1, capacity: 0, closes: '', enabled: true }); render(); open();
    };
    host.querySelectorAll('[data-del]').forEach(function (b) {
      b.onclick = function () { keep(); rows.splice(+b.getAttribute('data-del'), 1); render(); open(); };
    });
    host.querySelectorAll('[data-up]').forEach(function (b) {
      b.onclick = function () {
        keep(); var i = +b.getAttribute('data-up');
        if (i > 0) { var t = rows[i - 1]; rows[i - 1] = rows[i]; rows[i] = t; }
        render(); open();
      };
    });
    host.querySelector('#ad-save').onclick = save;
  }

  function save() {
    var msg = host.querySelector('#ad-msg');
    msg.style.color = 'var(--muted,#57606a)'; msg.textContent = 'Saving...';
    rpc.run
      .withSuccessHandler(function (r) {
        if (r && r.success) { msg.style.color = '#3fb950'; msg.textContent = '✓ Saved. Reloading...'; setTimeout(function () { location.reload(); }, 600); }
        else { msg.style.color = '#f85149'; msg.textContent = (r && r.error) || 'Save failed'; }
      })
      .withFailureHandler(function (e) { msg.style.color = '#f85149'; msg.textContent = 'Error: ' + e.message; })
      .saveAddons(readForm());
  }

  window.initAddons = function () {
    host = document.getElementById('addons-card');
    if (!host) return;
    rpc.run
      .withSuccessHandler(function (d) {
        if (!d || !d.success) return;
        rows = d.addons.map(function (a) { return { id: a.id, name: a.name, description: a.description, price: a.price, max_qty: a.max_qty, capacity: a.capacity, closes: a.closes || '', enabled: a.enabled, _existing: true }; });
        render();
      })
      .withFailureHandler(function (e) { host.textContent = 'Could not load extras: ' + e.message; })
      .getAddons();
  };
})();
