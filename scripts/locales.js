#!/usr/bin/env node
'use strict';
// Translation helper.
//   node scripts/locales.js check            validate src/locales/*.json (used in CI / before commit)
//   node scripts/locales.js export [file]    write all translations to one CSV (default docs/translations.csv)
//   node scripts/locales.js import [file]    read the CSV back into the per-language JSON files
const fs = require('fs');
const path = require('path');

const DIR = path.join(__dirname, '..', 'src', 'locales');
const LANGS = ['en', 'fi', 'sv', 'no', 'da', 'is', 'et', 'lv', 'lt', 'pl', 'de', 'tlh', 'fkv', 'fit']; // en first = key order
const PARTIAL = ['tlh', 'fkv', 'fit']; // hidden languages: no priv.* / mail.* keys on purpose
const file = l => path.join(DIR, l + '.json');
const load = l => JSON.parse(fs.readFileSync(file(l), 'utf8'));
const ph = t => (String(t).match(/\{\w+\}/g) || []).sort().join(',');
const bold = t => (String(t).match(/\*/g) || []).length % 2;

function save(l, obj, order) {
  const out = {};
  for (const k of order) if (obj[k] !== undefined) out[k] = obj[k];
  for (const k of Object.keys(obj)) if (out[k] === undefined) out[k] = obj[k];
  fs.writeFileSync(file(l), JSON.stringify(out, null, 2) + '\n');
}

function check() {
  const en = load('en');
  const errors = [], warnings = [];
  for (const l of LANGS) {
    let c;
    try { c = load(l); } catch (e) { errors.push(`${l}.json: invalid JSON (${e.message})`); continue; }
    let missing = 0;
    for (const k of Object.keys(en)) {
      if (c[k] === undefined) { if (!PARTIAL.includes(l)) { missing++; errors.push(`${l}: missing key ${k}`); } continue; }
      if (typeof c[k] !== 'string' || c[k].trim() === '') errors.push(`${l}: empty or non-text value for ${k}`);
      else {
        if (ph(c[k]) !== ph(en[k])) errors.push(`${l}: placeholders differ in ${k} (en: ${ph(en[k]) || 'none'}, ${l}: ${ph(c[k]) || 'none'})`);
        if (/[<>]/.test(c[k])) errors.push(`${l}: "<" or ">" not allowed in ${k}`);
        if (bold(c[k]) !== bold(en[k])) warnings.push(`${l}: unbalanced *bold* markers in ${k}`);
      }
    }
    for (const k of Object.keys(c)) if (en[k] === undefined) errors.push(`${l}: unknown key ${k} (not in en.json)`);
    if (PARTIAL.includes(l) && Object.keys(c).some(k => /^(priv|mail)\./.test(k))) errors.push(`${l}: partial language must not contain priv.* or mail.* keys`);
    console.log(`${l.padEnd(4)} ${String(Object.keys(c).length).padStart(3)} / ${Object.keys(en).length} keys${PARTIAL.includes(l) ? '  (partial by design)' : ''}${missing ? '  MISSING ' + missing : ''}`);
  }
  warnings.forEach(w => console.log('warning:', w));
  errors.forEach(e => console.error('ERROR:', e));
  if (errors.length) { console.error(errors.length + ' problem(s)'); process.exit(1); }
  console.log('OK');
}

// ---- CSV (RFC 4180: quotes doubled, newlines allowed inside quotes) ----
const q = v => '"' + String(v === undefined ? '' : v).replace(/"/g, '""') + '"';
function parseCsv(text) {
  const rows = []; let row = [], cur = '', inQ = false;
  for (let i = 0; i < text.length; i++) {
    const ch = text[i];
    if (inQ) { if (ch === '"') { if (text[i + 1] === '"') { cur += '"'; i++; } else inQ = false; } else cur += ch; }
    else if (ch === '"') inQ = true;
    else if (ch === ',') { row.push(cur); cur = ''; }
    else if (ch === '\n' || ch === '\r') { if (ch === '\r' && text[i + 1] === '\n') i++; row.push(cur); cur = ''; if (row.some(x => x !== '')) rows.push(row); row = []; }
    else cur += ch;
  }
  if (cur !== '' || row.length) { row.push(cur); if (row.some(x => x !== '')) rows.push(row); }
  return rows;
}
function exportCsv(out) {
  out = out || path.join(__dirname, '..', 'docs', 'translations.csv');
  const cat = {}; LANGS.forEach(l => cat[l] = load(l));
  const lines = [['key'].concat(LANGS).map(q).join(',')];
  for (const k of Object.keys(cat.en)) lines.push([k].concat(LANGS.map(l => cat[l][k])).map(q).join(','));
  fs.writeFileSync(out, lines.join('\n') + '\n');
  console.log('wrote', out, '(' + (lines.length - 1) + ' keys x ' + LANGS.length + ' languages)');
}
function importCsv(inp) {
  inp = inp || path.join(__dirname, '..', 'docs', 'translations.csv');
  const rows = parseCsv(fs.readFileSync(inp, 'utf8'));
  const head = rows.shift();
  const order = Object.keys(load('en'));
  for (let c = 1; c < head.length; c++) {
    const l = head[c];
    if (!LANGS.includes(l)) { console.error('unknown language column', l); process.exit(1); }
    const obj = {};
    for (const r of rows) if (r[c] !== undefined && r[c] !== '') obj[r[0]] = r[c];
    save(l, obj, order);
  }
  console.log('imported', head.length - 1, 'languages from', inp);
  check();
}

const [cmd, arg] = process.argv.slice(2);
if (cmd === 'check') check();
else if (cmd === 'export') exportCsv(arg);
else if (cmd === 'import') importCsv(arg);
else { console.log('usage: node scripts/locales.js check | export [file] | import [file]'); process.exit(cmd ? 1 : 0); }
