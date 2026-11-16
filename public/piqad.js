// Optional pIqaD (Klingon script) rendering for the hidden "tlh" language.
// Converts the romanised Klingon text on the page to pIqaD code points
// (ConScript Unicode Registry, U+F8D0..U+F8FF) and shows it with a bundled
// font. Only active when <html lang="tlh"> and /fonts/piqad.woff2 exists.
// Without the font file nothing is shown and the page stays romanised.
(function () {
  'use strict';
  // Digraphs first, then single letters. Klingon is case-sensitive (D H I Q S).
  var MAP = { a:0xF8D0, b:0xF8D1, ch:0xF8D2, D:0xF8D3, e:0xF8D4, gh:0xF8D5, H:0xF8D6, I:0xF8D7, j:0xF8D8,
    l:0xF8D9, m:0xF8DA, n:0xF8DB, ng:0xF8DC, o:0xF8DD, p:0xF8DE, q:0xF8DF, Q:0xF8E0, r:0xF8E1, S:0xF8E2,
    t:0xF8E3, tlh:0xF8E4, u:0xF8E5, v:0xF8E6, w:0xF8E7, y:0xF8E8, "'":0xF8E9, "’":0xF8E9 };
  var DIGITS = 0xF8F0; // 0..9 -> U+F8F0..U+F8F9

  function toPiqad(text) {
    var out = '', i = 0;
    while (i < text.length) {
      var c3 = text.substr(i, 3), c2 = text.substr(i, 2), ch = text.charAt(i);
      if (MAP[c3] !== undefined) { out += String.fromCharCode(MAP[c3]); i += 3; }
      else if (MAP[c2] !== undefined) { out += String.fromCharCode(MAP[c2]); i += 2; }
      else if (MAP[ch] !== undefined) { out += String.fromCharCode(MAP[ch]); i++; }
      else if (ch >= '0' && ch <= '9') { out += String.fromCharCode(DIGITS + (ch.charCodeAt(0) - 48)); i++; }
      else { out += ch; i++; } // unknown letters, spaces, punctuation stay as they are
    }
    return out;
  }
  // A text is converted only if every letter in it is a valid romanised Klingon letter.
  // English (admin content, brand names, language names) therefore stays Latin
  // instead of turning into a half-converted mix.
  function isKlingon(text) {
    var rest = text.replace(/tlh|ch|gh|ng/g, '');
    return !/[A-Za-z]/.test(rest.replace(/[abDeHIjlmnopqQrStuvwy]/g, ''));
  }
  if (typeof module !== 'undefined' && module.exports) { module.exports = { toPiqad: toPiqad, isKlingon: isKlingon }; }
  if (typeof document === 'undefined' || document.documentElement.lang !== 'tlh') return;

  var SKIP = { SCRIPT:1, STYLE:1, INPUT:1, TEXTAREA:1, SELECT:1, OPTION:1, CODE:1 };
  var originals = new WeakMap(), on = false, observer = null, busy = false;

  function walk(node, fn) {
    if (node.nodeType === 3) { fn(node); return; }
    if (node.nodeType !== 1 || SKIP[node.tagName]) return;
    for (var c = node.firstChild; c; c = c.nextSibling) walk(c, fn);
  }
  function convert(node) {
    if (!node.nodeValue || !node.nodeValue.trim()) return;
    if (!originals.has(node)) originals.set(node, node.nodeValue);
    var o = originals.get(node);
    var v = isKlingon(o) ? toPiqad(o) : o;
    if (v !== node.nodeValue) node.nodeValue = v;
  }
  function restore(node) { if (originals.has(node)) node.nodeValue = originals.get(node); }

  function apply() {
    busy = true;
    document.documentElement.classList.toggle('piqad', on);
    walk(document.body, on ? convert : restore);
    busy = false;
  }
  function start() {
    var style = document.createElement('style');
    style.textContent = "@font-face{font-family:'EBS pIqaD';src:url('/fonts/piqad.woff2') format('woff2');font-display:swap}" +
      "html.piqad body,html.piqad body *{font-family:'EBS pIqaD',sans-serif !important}" +
      "#piqad-toggle{position:fixed;bottom:12px;right:12px;z-index:9999;font:14px sans-serif;padding:6px 10px;border-radius:6px;border:1px solid #888;background:#fff;color:#222;cursor:pointer}" +
      "html.piqad #piqad-toggle{font-family:sans-serif !important}";
    document.head.appendChild(style);
    var btn = document.createElement('button');
    btn.id = 'piqad-toggle'; btn.type = 'button'; btn.textContent = 'pIqaD';
    btn.onclick = function () { on = !on; btn.textContent = on ? 'Latin' : 'pIqaD'; apply(); };
    document.body.appendChild(btn);
    // Text added later by page scripts (lists, prices, messages) is converted too.
    observer = new MutationObserver(function () { if (on && !busy) { observer.disconnect(); apply(); observe(); } });
    observe();
    if (/[?&]script=piqad\b/.test(location.search)) btn.click();
  }
  function observe() { observer.observe(document.body, { childList: true, subtree: true, characterData: true }); }

  // Show the toggle only if the font file is really available.
  fetch('/fonts/piqad.woff2', { method: 'HEAD' }).then(function (r) {
    if (r.ok) { if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', start); else start(); }
  }).catch(function () {});
})();
