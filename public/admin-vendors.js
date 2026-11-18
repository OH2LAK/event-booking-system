// "Vendor spaces" card for the setup page: flea market tables, trunk sales, booths and similar spaces.
// They are catalog entries of kind "vendor" in the same table as the extras (saved separately with saveAddons(list, 'vendor')).
(function () {
  var host, rows = [], days = [], modules = {};
  function esc(s) { return String(s == null ? '' : s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;'); }
  var cell = 'padding:0.3rem;border:1.5px solid #d1d5db;border-radius:3px;box-sizing:border-box;width:100%';
  var lab = 'display:block;font-size:0.72rem;font-weight:600;margin-bottom:0.15rem';
  var TYPES = [['table', 'Table'], ['trunk', 'Trunk sale'], ['booth', 'Booth'], ['other', 'Other']];
  var PRICINGS = [['item', 'Per item (price x quantity)'], ['metre', 'Per metre (quantity = metres)'], ['day', 'Per day (price x quantity x event days)']];

  function sel(name, options, value) {
    return '<select name="' + name + '" style="' + cell + '">' + options.map(function (o) { return '<option value="' + esc(o[0]) + '"' + (o[0] === value ? ' selected' : '') + '>' + esc(o[1]) + '</option>'; }).join('') + '</select>';
  }
  function field(label, html, w) { return '<div style="flex:1 1 ' + (w || '9rem') + '"><label style="' + lab + '">' + esc(label) + '</label>' + html + '</div>'; }
  function inp(name, value, extra) { return '<input name="' + name + '" value="' + esc(value) + '" style="' + cell + '" ' + (extra || '') + '>'; }

  function readForm() {
    var out = [];
    host.querySelectorAll('[data-row]').forEach(function (box) {
      var g = function (n) { return box.querySelector('[name=' + n + ']'); };
      out.push({
        kind: 'vendor', id: g('id').value, name: g('name').value, description: g('description').value, space_type: g('space_type').value,
        day_key: g('day_key').value, starts: g('starts').value, ends: g('ends').value, size: g('size').value, power: g('power').value, location: g('location').value,
        price: g('price').value, pricing: g('pricing').value, unit: g('unit').value, max_qty: g('max_qty').value, capacity: g('capacity').value,
        closes: g('closes').value, prompt: g('prompt').value, prompt_required: g('prompt_required').checked, enabled: g('enabled').checked
      });
    });
    return out;
  }
  function keep() { rows = readForm().map(function (r, i) { r._existing = !!(rows[i] && rows[i]._existing); return r; }); }
  function open() { host.querySelector('details').open = true; }

  function render() {
    var dayOpts = [['', 'All event days']].concat(days.map(function (d) { return [d.key, d.label]; }));
    var cur = (window.CUR && CUR.native) || 'EUR';
    var html = '<details style="background:var(--surface,#fff);border:1.5px solid var(--border,#d0d7de);border-radius:6px;padding:0.75rem 1rem;margin:1rem 0">'
      + '<summary style="cursor:pointer;font-weight:700;font-size:1rem">🛒 Vendor spaces (flea market, trunk sales, booths)</summary>'
      + (modules.vendors ? '' : '<p style="margin:0.75rem 0;padding:0.5rem 0.75rem;border:1.5px solid #f0a500;border-radius:4px;font-size:0.85rem">The vendor spaces module is switched <strong>off</strong>. Spaces you define here stay hidden from guests until you switch it on in <em>Event setup</em> (Event profile and modules).</p>')
      + '<p style="margin:0.75rem 0;color:var(--muted,#57606a);font-size:0.85rem">Spaces that sellers and exhibitors can reserve. Each space has a price, optional day and times, details such as size, power and location, and a question the booker answers (for example "What will you sell or show?"). '
      + 'Guests can reserve spaces on their own (vendor registration, no accommodation) or add them to a normal booking. The vendor is the contact person; they can also list names who need an entry ticket. '
      + '<strong>Id</strong> is a short code (letters, digits, "-"; fixed once saved) and must differ from the ids of your extras. <strong>Capacity</strong> is the total number of units (0 = unlimited). '
      + 'With <strong>per metre</strong> pricing the quantity is the number of metres. Existing bookings keep what they chose; use "Recalculate prices" after changing a price. Names, descriptions and questions can be translated in the Translations card.</p>';
    rows.forEach(function (r, i) {
      html += '<div data-row="' + i + '" style="border:1px solid var(--border,#d0d7de);border-radius:6px;padding:0.6rem 0.75rem;margin:0.6rem 0">'
        + '<div style="display:flex;flex-wrap:wrap;gap:0.5rem 0.75rem">'
        + field('Id', inp('id', r.id, 'maxlength="12"' + (r._existing ? ' readonly' : '')), '6rem')
        + field('Name', inp('name', r.name, 'maxlength="60"'), '12rem')
        + field('Type', sel('space_type', TYPES, r.space_type || 'table'), '8rem')
        + field('Day', sel('day_key', dayOpts, r.day_key || ''), '10rem')
        + field('Starts', inp('starts', r.starts, 'type="time"'), '6.5rem')
        + field('Ends', inp('ends', r.ends, 'type="time"'), '6.5rem')
        + '</div><div style="display:flex;flex-wrap:wrap;gap:0.5rem 0.75rem;margin-top:0.4rem">'
        + field('Description', inp('description', r.description, 'maxlength="200"'), '16rem')
        + field('Size', inp('size', r.size, 'maxlength="60" placeholder="e.g. 2 x 1 m"'), '8rem')
        + field('Power', inp('power', r.power, 'maxlength="60" placeholder="e.g. 230 V, 1 socket"'), '9rem')
        + field('Location', inp('location', r.location, 'maxlength="80" placeholder="e.g. Hall B"'), '9rem')
        + '</div><div style="display:flex;flex-wrap:wrap;gap:0.5rem 0.75rem;margin-top:0.4rem">'
        + field('Price (' + cur + ')', inp('price', r.price, 'type="number" min="0" step="0.01"'), '6rem')
        + field('Pricing', sel('pricing', PRICINGS, r.pricing || 'item'), '14rem')
        + field('Unit label', inp('unit', r.unit, 'maxlength="20" placeholder="table, metre ..."'), '7rem')
        + field('Max per booking', inp('max_qty', r.max_qty, 'type="number" min="1" max="100"'), '6rem')
        + field('Capacity', inp('capacity', r.capacity, 'type="number" min="0"'), '5.5rem')
        + field('Sign-up closes', inp('closes', r.closes, 'type="date"'), '9rem')
        + '</div><div style="display:flex;flex-wrap:wrap;gap:0.5rem 0.75rem;margin-top:0.4rem;align-items:flex-end">'
        + field('Question to the booker', inp('prompt', r.prompt, 'maxlength="120" placeholder="What will you sell or show?"'), '18rem')
        + '<label style="font-size:0.8rem;white-space:nowrap"><input name="prompt_required" type="checkbox"' + (r.prompt_required ? ' checked' : '') + '> Answer required</label>'
        + '<label style="font-size:0.8rem;white-space:nowrap"><input name="enabled" type="checkbox"' + (r.enabled ? ' checked' : '') + '> On</label>'
        + '<span style="margin-left:auto;white-space:nowrap"><button type="button" data-up="' + i + '" title="Move up">↑</button> <button type="button" data-del="' + i + '" title="Delete">✕</button></span>'
        + '</div></div>';
    });
    html += '<div style="margin-top:0.75rem"><button type="button" id="vd-add" style="padding:0.4rem 0.9rem">+ Add vendor space</button> '
      + '<button type="button" id="vd-save" style="padding:0.4rem 1.2rem;border:0;border-radius:4px;background:var(--accent,#b45309);color:#fff;font-weight:600;cursor:pointer">Save vendor spaces</button> '
      + '<span id="vd-msg" style="margin-left:0.75rem;font-size:0.85rem"></span></div></details>';
    host.innerHTML = html;
    host.querySelector('#vd-add').onclick = function () {
      keep(); rows.push({ id: '', name: '', description: '', space_type: 'table', day_key: '', starts: '', ends: '', size: '', power: '', location: '', price: 0, pricing: 'item', unit: '', max_qty: 1, capacity: 0, closes: '', prompt: '', prompt_required: false, enabled: true }); render(); open();
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
    host.querySelector('#vd-save').onclick = save;
  }

  function save() {
    var msg = host.querySelector('#vd-msg');
    msg.style.color = 'var(--muted,#57606a)'; msg.textContent = 'Saving...';
    rpc.run
      .withSuccessHandler(function (r) {
        if (r && r.success) { msg.style.color = '#3fb950'; msg.textContent = '✓ Saved. Reloading...'; setTimeout(function () { location.reload(); }, 600); }
        else { msg.style.color = '#f85149'; msg.textContent = (r && r.error) || 'Save failed'; }
      })
      .withFailureHandler(function (e) { msg.style.color = '#f85149'; msg.textContent = 'Error: ' + e.message; })
      .saveAddons(readForm(), 'vendor');
  }

  window.initVendors = function () {
    host = document.getElementById('vendors-card');
    if (!host) return;
    rpc.run
      .withSuccessHandler(function (d) {
        if (!d || !d.success) return;
        days = d.days || []; modules = d.modules || {};
        rows = d.addons.filter(function (a) { return a.kind === 'vendor'; }).map(function (a) {
          return { id: a.id, name: a.name, description: a.description, space_type: a.space_type, day_key: a.day_key, starts: a.starts, ends: a.ends, size: a.size, power: a.power, location: a.location,
            price: a.price, pricing: a.pricing, unit: a.unit, max_qty: a.max_qty, capacity: a.capacity, closes: a.closes || '', prompt: a.prompt, prompt_required: a.prompt_required, enabled: a.enabled, _existing: true };
        });
        // Hide the card for events that neither use the module nor have spaces defined
        if (!modules.vendors && !rows.length) { host.innerHTML = '<p style="margin:1rem 0;font-size:0.85rem;color:var(--muted,#57606a)">🛒 Vendor spaces are off. Switch on <em>Vendor spaces</em> in Event setup (Event profile and modules) to offer flea market tables, trunk sales or booths.</p>'; return; }
        render();
      })
      .withFailureHandler(function (e) { host.textContent = 'Could not load vendor spaces: ' + e.message; })
      .getAddons();
  };
})();
