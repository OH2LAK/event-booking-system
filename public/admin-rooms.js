// "Room types" card for the admin panel: add, rename, resize and delete room types.
(function () {
  var host, rows = [];
  function esc(s) { return String(s == null ? '' : s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;'); }
  var cell = 'padding:0.3rem;border:1.5px solid #d1d5db;border-radius:3px;box-sizing:border-box;width:100%';

  function readForm() {
    var out = [];
    host.querySelectorAll('tr[data-row]').forEach(function (tr) {
      var g = function (n) { return tr.querySelector('[name=' + n + ']').value; };
      out.push({ id: g('id'), note_en: g('note_en'), note_fi: g('note_fi'), persons: g('persons'), count: g('count'), price_eur: g('price_eur') });
    });
    return out;
  }

  function render() {
    var html = '<details style="background:var(--surface,#fff);border:1.5px solid var(--border,#d0d7de);border-radius:6px;padding:0.75rem 1rem;margin:1rem 0">'
      + '<summary style="cursor:pointer;font-weight:700;font-size:1rem">🛏️ Room types</summary>'
      + '<p style="margin:0.75rem 0;color:var(--muted,#57606a);font-size:0.85rem">Define the accommodation you offer. <strong>Id</strong> is a short code (letters, digits, "-"; it cannot be changed later). '
      + '<strong>Persons</strong> is the capacity of one room. Room types that already have bookings cannot be deleted (set the count to 0) and their capacity cannot be changed. '
      + 'Single-person types are used for the "single bed" rule; two-person types can allow solo use.</p>'
      + '<div style="overflow-x:auto"><table style="width:100%;border-collapse:collapse;font-size:0.85rem"><thead><tr style="text-align:left">'
      + '<th>Id</th><th>Description (English)</th><th>Description (Finnish, optional)</th><th>Persons</th><th>Count</th><th>Price (' + esc((window.CUR && CUR.native) || 'EUR') + ') / room</th><th></th></tr></thead><tbody>';
    rows.forEach(function (r, i) {
      html += '<tr data-row="' + i + '">'
        + '<td style="width:7rem"><input name="id" value="' + esc(r.id) + '" maxlength="12" style="' + cell + '"' + (r._existing ? ' readonly' : '') + '></td>'
        + '<td><input name="note_en" value="' + esc(r.note_en) + '" maxlength="80" style="' + cell + '"></td>'
        + '<td><input name="note_fi" value="' + esc(r.note_fi) + '" maxlength="80" style="' + cell + '"></td>'
        + '<td style="width:5rem"><input name="persons" type="number" min="1" max="20" value="' + esc(r.persons) + '" style="' + cell + '"></td>'
        + '<td style="width:5rem"><input name="count" type="number" min="0" max="999" value="' + esc(r.count) + '" style="' + cell + '"></td>'
        + '<td style="width:6rem"><input name="price_eur" type="number" min="0" step="0.01" value="' + esc(r.price_eur) + '" style="' + cell + '"></td>'
        + '<td style="white-space:nowrap"><button type="button" data-up="' + i + '" title="Move up">↑</button> <button type="button" data-del="' + i + '" title="Delete">✕</button></td></tr>';
    });
    html += '</tbody></table></div>'
      + '<div style="margin-top:0.75rem"><button type="button" id="rc-add" style="padding:0.4rem 0.9rem">+ Add room type</button> '
      + '<button type="button" id="rc-save" style="padding:0.4rem 1.2rem;border:0;border-radius:4px;background:var(--accent,#b45309);color:#fff;font-weight:600;cursor:pointer">Save room types</button> '
      + '<span id="rc-msg" style="margin-left:0.75rem;font-size:0.85rem"></span></div></details>';
    host.innerHTML = html;
    host.querySelector('#rc-add').onclick = function () {
      rows = readForm().map(function (r, i) { r._existing = !!(rows[i] && rows[i]._existing); return r; });
      rows.push({ id: '', note_en: '', note_fi: '', persons: 2, count: 1, price_eur: 0 });
      render(); host.querySelector('details').open = true;
    };
    host.querySelectorAll('[data-del]').forEach(function (b) {
      b.onclick = function () { keep(); rows.splice(+b.getAttribute('data-del'), 1); render(); host.querySelector('details').open = true; };
    });
    host.querySelectorAll('[data-up]').forEach(function (b) {
      b.onclick = function () {
        keep(); var i = +b.getAttribute('data-up');
        if (i > 0) { var t = rows[i - 1]; rows[i - 1] = rows[i]; rows[i] = t; }
        render(); host.querySelector('details').open = true;
      };
    });
    host.querySelector('#rc-save').onclick = save;
  }
  function keep() { rows = readForm().map(function (r, i) { r._existing = !!(rows[i] && rows[i]._existing); return r; }); }

  function save() {
    var msg = host.querySelector('#rc-msg');
    msg.style.color = 'var(--muted,#57606a)'; msg.textContent = 'Saving...';
    rpc.run
      .withSuccessHandler(function (r) {
        if (r && r.success) { msg.style.color = '#15803d'; msg.textContent = '✓ Saved. Reloading...'; setTimeout(function () { location.reload(); }, 600); }
        else { msg.style.color = '#b91c1c'; msg.textContent = (r && r.error) || 'Save failed'; }
      })
      .withFailureHandler(function (e) { msg.style.color = '#b91c1c'; msg.textContent = 'Error: ' + e.message; })
      .saveRoomCatalog(readForm());
  }

  window.initRoomCatalog = function () {
    host = document.getElementById('room-catalog');
    if (!host) return;
    rpc.run
      .withSuccessHandler(function (d) {
        if (!d || !d.success) return;
        rows = d.rooms.map(function (r) { return { id: r.id, note_en: r.note_en, note_fi: r.note_fi || '', persons: r.persons, count: r.count, price_eur: r.price_eur, _existing: true }; });
        render();
      })
      .withFailureHandler(function (e) { host.textContent = 'Could not load room types: ' + e.message; })
      .getRoomCatalog();
  };
})();
