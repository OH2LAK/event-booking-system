'use strict';
// HTML pages. The pages call rpc.run.<method>(...); /rpc-shim.js maps those calls to POST /api/rpc/<method>.
const { CONFIG, VERSION } = require('./config');
const privacy = require('./privacy');
const i18n = require('./i18n');
const currency = require('./currency');

const esc = v => String(v === undefined || v === null ? '' : v)
  .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&#39;');

// Logos from the event setup (up to two). Style strings carry the page-specific sizes.
function logos(style1, style2) {
  const one = (url, alt, style) => (url ? `<img src="${esc(url)}" alt="${esc(alt)}" style="${style}">` : '');
  return one(CONFIG.LOGO1_URL, CONFIG.EVENT_SHORT, style1) + (CONFIG.LOGO1_URL && CONFIG.LOGO2_URL ? '\n    ' : '') + one(CONFIG.LOGO2_URL, CONFIG.ORGANIZER_SHORT, style2);
}
// Back link to the event's home page (hidden when no URL is configured).
const homeStyle = () => (CONFIG.HOME_URL ? '' : 'display:none;');

function getClientConfigJson_(joinRef, settings, lang) {
  const s = settings;
  const cfg = {
    INITIAL_JOIN: joinRef || '',
    ROOMS: i18n.localizedRooms(lang),
    LANG: lang,
    LANG_QS: i18n.qsLang(lang),
    CAMPER_VAN_SPOTS: settings.CAMPER_VAN_SPOTS,
    CAMPER_VAN_PRICE_PER_NIGHT: s.CAMPER_VAN_PRICE_PER_NIGHT,
    CAMPING_NIGHTS: CONFIG.CAMPING_NIGHTS,
    TENT_SPOTS: settings.TENT_SPOTS,
    TENT_PRICE_WEEKEND: s.TENT_PRICE_WEEKEND,
    TENT_ENABLED: s.TENT_ENABLED,
    FULL_BOARD_PRICE: s.FULL_BOARD_PRICE,
    STRUCTURE: i18n.localizedStructure(lang),
    ALLOW_SOLO_DOUBLE: s.ALLOW_SOLO_DOUBLE,
    ALLOW_SINGLE_BED_BOOKING: s.ALLOW_SINGLE_BED_BOOKING,
    SINGLE_BED_PRICE: s.SINGLE_BED_PRICE,
    ROOM_PRICES: s.ROOM_PRICES,
    WEBAPP_URL: CONFIG.FRIENDLY_URL,
    FRIENDLY_URL: CONFIG.FRIENDLY_URL,
    CAMPER_INFO: s.CAMPER_INFO,
    TENT_INFO: s.TENT_INFO,
    REGISTRATION_CLOSES: s.REGISTRATION_CLOSES,
    PRICE_DISCLAIMER: s.PRICE_DISCLAIMER,
    MEETING_FEE_WEEKEND: s.MEETING_FEE_WEEKEND,
    MEETING_FEE_DAY: s.MEETING_FEE_DAY,
    CURRENCY: currency.publicInfo(),
  };
  return JSON.stringify(cfg);
}

function buildBookingPage(joinRef, bypassToken, settings, lang, sw) {
  lang = lang || i18n.defaultLang(); sw = sw || '';
  // Join links always work — joiner should be able to join even if registration is closed
  const validBypass = (joinRef && joinRef.length > 0)
    || (settings.BYPASS_TOKEN && bypassToken && bypassToken === settings.BYPASS_TOKEN);
  if (!validBypass) {
    if (!settings.REGISTRATION_OPEN) {
      return buildRegistrationClosedPage(settings, lang, sw);
    }
    if (settings.REGISTRATION_CLOSES) {
      var deadline = new Date(settings.REGISTRATION_CLOSES + 'T23:59:59');
      if (new Date() > deadline) {
        return buildRegistrationClosedPage(settings, lang, sw);
      }
    }
  }
  return buildBookingPageHtml_(joinRef, settings, bypassToken, lang, sw);
}

function buildRegistrationClosedPage(settings, lang, sw) {
  const t = (k, v) => i18n.t(lang, k, v);
  const te = (k, v) => esc(t(k, v));
  const EV = k => esc(i18n.ev(lang, k));
  settings = i18n.localizedSettings(lang, settings);
  const STRUCT = i18n.localizedStructure(lang);
  sw = sw || '';
  return `<!DOCTYPE html>
<html lang="${lang}">
<head>
<script src="/rpc-shim.js"></script>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<title>${EV('EVENT_NAME')} — ${te('form.registration')}</title>
<style>
  :root{--bg:#f0f2f5;--surface:#fff;--border:#d0d7de;--accent:#b45309;--accent2:#1d6fa5;--text:#1c2128;--muted:#57606a;--danger:#cf222e;--mono:'Share Tech Mono',monospace;--sans:'Barlow',sans-serif;}
  *{box-sizing:border-box;margin:0;padding:0}
  body{background:var(--bg);color:var(--text);font-family:var(--sans);font-size:17px;min-height:100vh;display:flex;align-items:center;justify-content:center;padding:2rem}
  .box{background:var(--surface);border:1px solid var(--border);border-radius:8px;padding:2.5rem;max-width:560px;width:100%;text-align:center;box-shadow:0 2px 8px rgba(0,0,0,.08)}
  .logos{display:flex;align-items:center;justify-content:center;gap:1.25rem;margin-bottom:1.5rem}
  h1{font-size:1.4rem;margin-bottom:0.5rem}
  h1 span{color:var(--accent)}
  .badge{font-family:var(--mono);font-size:0.7rem;color:var(--accent);letter-spacing:0.2em;text-transform:uppercase;margin-bottom:1.25rem}
  .closed-icon{font-size:3rem;margin-bottom:1rem}
  .msg{font-size:1.1rem;margin-bottom:1.5rem;line-height:1.6}
  .contact{background:var(--bg);border:1px solid var(--border);border-radius:6px;padding:1rem 1.5rem;font-family:var(--mono);font-size:1rem;color:var(--accent2)}
  .closes{margin-top:1.25rem;font-size:0.85rem;color:var(--muted);font-family:var(--mono)}
</style>
</head>
<body>
<div class="box">
  ${sw}
  <div class="logos">
    ${logos('height:55px;width:auto;', 'height:45px;width:auto;')}
  </div>
  <div class="badge">${EV('EVENT_NAME')} · ${esc(CONFIG.ORGANIZER_SHORT)} · ${esc(CONFIG.LOCATION_SHORT)}</div>
  <div class="closed-icon">🔒</div>
  <div class="msg">${te('form.closedMsg')}</div>
  ${settings.CLOSED_MESSAGE ? `<div style="margin-bottom:1rem;background:var(--bg);border:1px solid var(--border);border-radius:6px;padding:0.9rem 1.25rem;font-size:0.95rem;line-height:1.6;text-align:left">${settings.CLOSED_MESSAGE}</div>` : ''}
  <div style="margin-bottom:0.5rem">${te('form.closedContact')}</div>
  <div class="contact">${CONFIG.REPLY_TO_EMAIL}</div>
  ${settings.REGISTRATION_CLOSES ? '<div class="closes">' + te('form.registrationClosed', {date: settings.REGISTRATION_CLOSES}) + '</div>' : ''}
</div>
</body>
</html>`;
}

function buildBookingPageHtml_(joinRef, settings, bypassToken, lang, sw) {
  const t = (k, v) => i18n.t(lang, k, v);
  const te = (k, v) => esc(t(k, v));
  const EV = k => esc(i18n.ev(lang, k));
  settings = i18n.localizedSettings(lang, settings);
  const STRUCT = i18n.localizedStructure(lang);
  sw = sw || '';
  return `<!DOCTYPE html>
<html lang="${lang}">
<head>
<script src="/rpc-shim.js"></script>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<title>${EV('EVENT_NAME')} — ${te('form.registration')}</title>
<style>
  :root {
    --bg:#f0f2f5; --surface:#ffffff; --border:#d0d7de;
    --accent:#b45309; --accent2:#1d6fa5;
    --text:#1c2128; --muted:#57606a;
    --danger:#cf222e; --success:#1a7f37;
    --mono:'Share Tech Mono',monospace; --sans:'Barlow',sans-serif;
  }
  *,*::before,*::after{box-sizing:border-box;margin:0;padding:0}
  body{background:var(--bg);color:var(--text);font-family:var(--sans);font-size:17px;min-height:100vh}
  .container{max-width:760px;margin:0 auto;padding:2rem 1.25rem 4rem}

  .header{text-align:center;margin-bottom:2.5rem;padding-bottom:1.5rem;border-bottom:2px solid var(--border)}
  .header-badge{font-family:var(--mono);font-size:0.75rem;color:var(--accent);letter-spacing:0.2em;text-transform:uppercase;margin-bottom:1rem}
  .logos{display:flex;align-items:center;justify-content:center;gap:1.5rem;margin-bottom:1rem;flex-wrap:wrap}
  .header .sub{font-size:1rem;color:var(--muted);font-weight:300}
  .header .dates{margin-top:1rem;display:flex;justify-content:center;gap:0.75rem;flex-wrap:wrap}
  .date-pill{font-family:var(--mono);font-size:0.8rem;padding:0.3rem 0.9rem;border:2px solid var(--accent);color:var(--accent);border-radius:3px;font-weight:600}

  .avail-bar{background:var(--surface);border:1px solid var(--border);border-radius:6px;padding:1.1rem 1.4rem;margin-bottom:2rem;box-shadow:0 1px 3px rgba(0,0,0,.06)}
  .avail-bar h3{font-family:var(--mono);font-size:0.85rem;color:var(--muted);letter-spacing:0.12em;text-transform:uppercase;margin-bottom:0.75rem}
  .avail-grid{display:flex;flex-wrap:wrap;gap:0.5rem}
  .avail-item{font-family:var(--mono);font-size:1rem;padding:0.3rem 0.75rem;background:var(--bg);border:1px solid var(--border);border-radius:3px;display:flex;gap:0.6rem;align-items:center}
  .avail-item .count{color:var(--accent2);font-weight:600}
  .avail-item.full{opacity:0.5}
  .avail-item.full .count{color:var(--danger);font-weight:600}

  .landing{display:grid;grid-template-columns:repeat(2,1fr);gap:1rem;margin-bottom:2rem}
  .choice-card{background:var(--surface);border:2px solid var(--border);border-radius:8px;padding:1.75rem 1.25rem;text-align:center;cursor:pointer;transition:border-color .15s,box-shadow .15s;box-shadow:0 1px 3px rgba(0,0,0,.06)}
  .choice-card:hover{border-color:var(--accent2);box-shadow:0 4px 12px rgba(0,0,0,.1)}
  .choice-card.selected{border-color:var(--accent);box-shadow:0 0 0 3px rgba(180,83,9,.15)}
  .choice-icon{font-size:2.2rem;margin-bottom:0.75rem}
  .choice-title{font-size:1.1rem;font-weight:700;margin-bottom:0.3rem}
  .choice-desc{font-size:0.88rem;color:var(--muted);line-height:1.4}

  .card{background:var(--surface);border:1px solid var(--border);border-radius:6px;padding:1.75rem;margin-bottom:1.5rem;box-shadow:0 1px 3px rgba(0,0,0,.06)}
  .card h2{font-size:1.1rem;font-weight:700;margin-bottom:1.25rem;padding-bottom:0.6rem;border-bottom:1px solid var(--border)}
  .section{display:none}
  .section.visible{display:block}

  .field{margin-bottom:1.1rem}
  .field label{display:block;font-size:0.9rem;font-weight:600;margin-bottom:0.4rem}
  .field input,.field select,.field textarea{width:100%;background:#f8fafc;border:1px solid var(--border);color:var(--text);padding:0.7rem 0.85rem;font-family:var(--sans);font-size:1rem;border-radius:3px;outline:none;transition:border-color .15s}
  .field input:focus,.field select:focus,.field textarea:focus{border-color:var(--accent2);background:#fff}
  .field textarea{min-height:70px;resize:vertical}
  .field .hint{font-size:0.8rem;color:var(--muted);margin-top:0.3rem}
  .row2{display:grid;grid-template-columns:1fr 1fr;gap:1rem}
  @media(max-width:500px){.row2{grid-template-columns:1fr}}

  .options{display:flex;flex-direction:column;gap:0.5rem}
  .radio-option,.check-option{display:flex;align-items:flex-start;gap:0.75rem;padding:0.75rem 1rem;border:1px solid var(--border);border-radius:4px;cursor:pointer;transition:border-color .12s,background .12s;background:var(--bg)}
  .radio-option:hover,.check-option:hover{border-color:var(--accent2);background:rgba(29,111,165,.04)}
  .radio-option input,.check-option input{margin-top:3px;flex-shrink:0;width:16px;height:16px}
  .radio-option .opt-label,.check-option .opt-label{font-weight:600;font-size:0.95rem}
  .radio-option .opt-sub,.check-option .opt-sub{font-size:0.82rem;color:var(--muted);margin-top:0.15rem}
  .radio-option.selected,.check-option.selected{border-color:var(--accent);background:rgba(180,83,9,.04)}
  .check-option.disabled-meal{opacity:0.45;pointer-events:none;cursor:not-allowed}

  .warn-box{background:#fffbeb;border:1px solid #d97706;border-radius:3px;padding:0.75rem 1rem;font-size:0.9rem;color:#92400e;margin-bottom:1rem}
  .info-box{background:#eff6ff;border:1px solid #93c5fd;border-radius:3px;padding:0.75rem 1rem;font-size:0.9rem;color:#1d4ed8;margin-bottom:1rem}

  .price-box{background:#fffbeb;border:2px solid var(--accent);border-radius:3px;padding:1rem;margin-top:1rem}
  .price-row{display:flex;justify-content:space-between;font-size:0.95rem;padding:0.25rem 0;color:var(--text)}
  .price-row.total{font-size:1.15rem;font-weight:700;color:var(--accent);padding-top:0.6rem;margin-top:0.3rem;border-top:2px solid var(--border);font-family:var(--mono)}

  .submit-btn{width:100%;padding:1rem;background:var(--accent);color:#fff;border:none;font-family:var(--sans);font-size:1.05rem;font-weight:700;letter-spacing:0.04em;border-radius:4px;cursor:pointer;transition:background .15s}
  .submit-btn:hover{background:#92400e}
  .submit-btn:disabled{opacity:0.6;cursor:not-allowed}
  .back-btn{background:none;border:1px solid var(--border);color:var(--muted);font-family:var(--sans);font-size:0.9rem;padding:0.5rem 1.1rem;border-radius:4px;cursor:pointer;margin-bottom:1.25rem}
  .back-btn:hover{border-color:var(--accent2);color:var(--accent2)}

  .msg{padding:0.75rem 1rem;border-radius:3px;margin-top:1rem;font-size:0.95rem;display:none}
  .msg.visible{display:block}
  .msg.error{background:#fff0f0;border:1px solid var(--danger);color:var(--danger)}
  .msg.success{background:#f0faf4;border:1px solid var(--success);color:var(--success)}

  .success-screen{display:none;text-align:center;padding:2rem 1rem}
  .success-icon{font-size:3rem;margin-bottom:1rem}
  .success-ref{font-family:var(--mono);font-size:1.5rem;color:var(--accent);margin:1rem 0;padding:0.75rem 1.25rem;border:2px solid var(--accent);background:#fffbeb;display:inline-block;letter-spacing:0.1em;border-radius:4px}

  #loading{display:none;position:fixed;inset:0;background:rgba(240,242,245,.88);z-index:100;align-items:center;justify-content:center;flex-direction:column;gap:1rem}
  #loading.visible{display:flex}
  .spinner{width:36px;height:36px;border:3px solid var(--border);border-top-color:var(--accent);border-radius:50%;animation:spin .7s linear infinite}
  @keyframes spin{to{transform:rotate(360deg)}}

  .footer{text-align:center;margin-top:3rem;font-size:0.8rem;color:var(--muted);font-family:var(--mono)}

  @media(max-width:600px){
    body{font-size:18px}
    .container{padding:0.5rem 0.5rem 2rem}
    .header{margin-bottom:1rem;padding-bottom:0.75rem}
    .logos img{max-height:70px!important}
    .header .sub{font-size:1rem}
    .date-pill{font-size:0.78rem;padding:0.25rem 0.6rem}
    .avail-bar{padding:0.85rem 1rem}
    .avail-item{font-size:0.95rem;padding:0.25rem 0.5rem}
    .landing{grid-template-columns:1fr;gap:0.5rem;margin-bottom:1rem}
    .choice-card{padding:0.85rem 0.9rem;display:flex;align-items:center;text-align:left;gap:0.85rem}
    .choice-icon{font-size:1.8rem;margin-bottom:0;flex-shrink:0}
    .choice-title{font-size:1.1rem;margin-bottom:0.1rem}
    .choice-desc{font-size:0.95rem}
    .card{padding:0.9rem 0.85rem;margin-bottom:0.75rem}
    .card h2{font-size:1.1rem;margin-bottom:0.75rem}
    .radio-option,.check-option{padding:0.6rem 0.65rem}
    .radio-option .opt-label,.check-option .opt-label{font-size:1rem}
    .radio-option .opt-sub,.check-option .opt-sub{font-size:0.9rem}
    .row2{grid-template-columns:1fr}
    .field input,.field select,.field textarea{font-size:16px}
    .price-box{padding:0.75rem}
    .price-row{font-size:1rem}
    .price-row.total{font-size:1.15rem}
    .submit-btn{font-size:1.1rem;padding:1rem}
    .back-btn{font-size:0.95rem;padding:0.5rem 1rem;margin-bottom:0.75rem}
    .success-screen{padding:1.25rem 0.5rem}
    .success-ref{font-size:1.2rem;padding:0.5rem 1rem}
  }
</style>
</head>
<body>
<div id="loading"><div class="spinner"></div><div style="color:var(--muted);font-family:var(--mono);font-size:.9rem">${te('form.processing')}</div></div>

<div class="container">
  ${sw}
  <div class="header">
    <div class="header-badge">${te('form.registration')}</div>
    <div class="logos">
      ${logos('max-height:110px;width:auto;', 'max-height:90px;width:auto;')}
    </div>
    <div class="sub">${EV('ORGANIZER')}<br>${EV('LOCATION')}</div>
    ${settings.REGISTRATION_CLOSES ? '<div style="margin-top:0.75rem;font-family:var(--mono);font-size:0.78rem;color:var(--muted)">' + te('form.registrationCloses', {date: settings.REGISTRATION_CLOSES}) + '</div>' : ''}
    <div style="margin-top:0.9rem"><a href="${esc(CONFIG.HOME_URL)}" style="${homeStyle()}font-size:0.85rem;color:var(--muted);text-decoration:none;border-bottom:1px solid var(--border)">← ${EV('HOME_LABEL')}</a></div>
  </div>

  ${settings.ANNOUNCEMENT ? '<div id="announcement-banner" style="background:#fffbeb;border:1.5px solid var(--accent);border-radius:6px;padding:0.85rem 1.1rem;margin-bottom:1.5rem;font-size:0.95rem;color:var(--text);white-space:pre-line">' + settings.ANNOUNCEMENT + '</div>' : ''}

  <div class="avail-bar">
    <h3>${te('form.availability')}</h3>
    <div class="avail-grid" id="avail-grid"><div style="color:var(--muted);font-family:var(--mono);font-size:.85rem">${te('form.loading')}</div></div>
  </div>

  <div id="landing-section">
    <div class="landing">
      <div class="choice-card" id="card-new" onclick="selectMode('new')">
        <div class="choice-icon">🏨 🚐</div>
        <div class="choice-title">${te('form.bookAcc')}</div>
        <div class="choice-desc">${te('form.bookAccDesc')}</div>
      </div>
      <div class="choice-card" id="card-join" onclick="selectMode('join')">
        <div class="choice-icon">🔑</div>
        <div class="choice-title">${te('form.joinTitle')}</div>
        <div class="choice-desc">${te('form.joinDesc')}</div>
      </div>
      <div class="choice-card" id="card-dayvisitor" onclick="selectMode('dayvisitor')">
        <div class="choice-icon">🎫</div>
        <div class="choice-title">${te('form.dayVisitor')}</div>
        <div class="choice-desc">${te('form.dayVisitorDesc')}</div>
      </div>
      <div class="choice-card" id="card-who" onclick="openPublicPage()">
        <div class="choice-icon">📋</div>
        <div class="choice-title">${te('form.whoTitle')}</div>
        <div class="choice-desc">${te('form.whoDesc')}</div>
      </div>
    </div>
  </div>

  <div id="form-section" class="section">
    <button class="back-btn" onclick="goBack()">${te('form.back')}</button>

    <div id="acc-type-section" class="card section">
      <h2>${te('form.accType')}</h2>
      <div class="options">
        <label class="radio-option">
          <input type="radio" name="acc-type" value="room" onchange="onTypeChange()">
          <div><div class="opt-label">${te('form.hotelRoom')}</div>
          <div class="opt-sub">${te('form.hotelRoomSub', {n: STRUCT.coreNights})}</div></div>
        </label>
        <label class="radio-option">
          <input type="radio" name="acc-type" value="camper" onchange="onTypeChange()">
          <div><div class="opt-label">${te('form.camperSpot')}</div>
          <div class="opt-sub">${te('form.camperSub', {n: STRUCT.coreNights, price: settings.CAMPER_VAN_PRICE_PER_NIGHT * CONFIG.CAMPING_NIGHTS})}</div></div>
        </label>
        <label class="radio-option" id="tent-option" ${!settings.TENT_ENABLED ? 'style="display:none"' : ''}>
          <input type="radio" name="acc-type" value="tent" onchange="onTypeChange()">
          <div><div class="opt-label">${te('form.tentSpot')}</div>
          <div class="opt-sub">${te('form.tentSub', {price: settings.TENT_PRICE_WEEKEND})}</div></div>
        </label>
        <label class="radio-option" id="singlebed-option" style="display:none">
          <input type="radio" name="acc-type" value="singlebed" onchange="onTypeChange()">
          <div><div class="opt-label">${te('form.singleBed')}</div>
          <div class="opt-sub">${te('form.singleBedSub', {n: STRUCT.coreNights, price: settings.SINGLE_BED_PRICE})}</div></div>
        </label>
      </div>
      <div id="camper-info-box" class="info-box" style="display:none;margin-top:1rem">${settings.CAMPER_INFO}</div>
      <div id="tent-info-box" class="info-box" style="display:none;margin-top:1rem">${settings.TENT_INFO}</div>
    </div>

    <div id="nights-section" class="card section" style="display:none">
      <h2>${te('form.nights')}</h2>
      <p style="color:var(--muted);font-size:0.9rem;margin-bottom:0.75rem">${te('form.nightsHelp')}</p>
      ${STRUCT.accommodation === 'per_night' ? STRUCT.days.slice(0, STRUCT.coreNights).map(d => `<label class="check-option">
        <input type="checkbox" name="nt" value="${esc(d.key)}" checked onchange="onNightsChange()">
        <div><div class="opt-label">${te('form.nightOf', {day: d.label})}</div></div>
      </label>`).join('\n') : ''}
    </div>

    <div id="room-type-section" class="card section">
      <h2>${te('form.roomType')}</h2>
      <div class="options" id="room-type-options"></div>
    </div>

    <div id="thu-section" class="card section" style="display:none">
      <h2>${te('form.extraNights')}</h2>
      <p style="color:var(--muted);font-size:0.9rem;margin-bottom:0.75rem">${te('form.extraNightsHelp', {dates: i18n.ev(lang, 'DATES_TEXT')})}</p>
      ${STRUCT.extraNights.map(x => `<label class="check-option">
        <input type="checkbox" name="xn" value="${esc(x.key)}" onchange="onExtraNightChange()">
        <div>
          <div class="opt-label">${te('form.addExtraNight', {label: x.label})}</div>
          <div class="opt-sub" data-xsub="${esc(x.key)}">${te('form.priceBasedOnRoom')}${x.includes ? ' · ' + esc(x.includes) : ''}</div>
        </div>
      </label>`).join('\n')}
    </div>

    <div id="thu-info-join" class="card section" style="display:none">
      <h2>${te('form.extraNight')}</h2>
      <div class="info-box" id="thu-info-join-text">${te('form.joinExtraInfo')}</div>
    </div>

    <div id="join-section" class="card section">
      <h2>${te('form.joinTitle')}</h2>
      <div id="join-ref-entry" style="margin-bottom:1rem">
        <div class="field">
          <label>${te('form.bookingRef')} <span style="font-weight:400;color:var(--muted)">${te('form.bookingRefHint')}</span></label>
          <div style="display:flex;gap:0.5rem;align-items:flex-start">
            <input type="text" id="join-ref-input" placeholder="${te('form.bookingRefPh')}" autocomplete="off" style="text-transform:uppercase;flex:1" oninput="this.value=this.value.toUpperCase()" onkeydown="if(event.key==='Enter')lookupJoinRef()">
            <button onclick="lookupJoinRef()" style="padding:0.55rem 1.1rem;background:var(--accent2);color:#fff;border:none;border-radius:4px;font-family:var(--sans);font-size:0.95rem;font-weight:600;cursor:pointer;white-space:nowrap">${te('form.lookUp')}</button>
          </div>
        </div>
      </div>
      <div id="join-room-info" class="info-box" style="display:none;margin-bottom:0.75rem"></div>
      <div id="join-room-full" class="info-box" style="display:none;background:#fef2f2;border-color:#fca5a5;color:#b91c1c"></div>
    </div>

    <div id="guest-section" class="card section">
      <h2>${te('form.yourDetails')}</h2>
      <div class="row2">
        <div class="field">
          <label>${te('form.callsign')}</label>
          <input type="text" id="callsign" placeholder="OH2LAK" autocomplete="off" style="text-transform:uppercase">
        </div>
        <div class="field">
          <label>${te('form.name')}</label>
          <input type="text" id="name" placeholder="${te('form.namePh')}">
        </div>
      </div>
      <div class="row2">
        <div class="field">
          <label>${te('form.email')}</label>
          <input type="email" id="email" placeholder="you@example.com">
        </div>
        <div class="field">
          <label>${te('form.phone')}</label>
          <input type="tel" id="phone" placeholder="+358 40 123 4567">
        </div>
      </div>
      <div class="field">
        <label>${te('form.country')}</label>
        <input type="text" id="country" placeholder="${te('form.countryPh')}">
      </div>
    </div>

    <div id="dayvisitor-section" class="card section" style="display:none">
      <h2>${te('form.attendDays')}</h2>
      <p style="color:var(--muted);font-size:0.9rem;margin-bottom:1rem">${te('form.attendHelp')}</p>
      <div style="display:flex;flex-direction:column;gap:0.5rem">
        ${STRUCT.days.map(d => `<label class="check-option">
          <input type="checkbox" name="dv-day" value="${esc(d.key)}" onchange="updatePriceDisplay()">
          <div><div class="opt-label">${esc(d.label)}</div>
          <div class="opt-sub">${STRUCT.days.length > 1 ? te('form.meetingFeeDayAll', {day: settings.MEETING_FEE_DAY, all: settings.MEETING_FEE_WEEKEND}) : te('form.meetingFeeDay', {day: settings.MEETING_FEE_DAY})}</div></div>
        </label>`).join('\n')}
      </div>
    </div>

    <div id="addons-section" class="card section">
      <h2>${te('form.addons')}</h2>

      <style>.pkg-off{display:none !important}</style>
      <div id="individual-meals-section" class="${STRUCT.package.enabled ? '' : 'pkg-off'}" style="display:none;margin-bottom:1rem">
        <div style="font-size:0.88rem;font-weight:600;color:var(--text);margin-bottom:0.5rem">${te('form.meals')}</div>
        <div id="full-board-row">
          <label class="check-option">
            <input type="checkbox" id="full-board" onchange="onFullBoardChange()">
            <div>
              <div class="opt-label">${te('form.mealPackage', {price: settings.FULL_BOARD_PRICE})}</div>
              <div class="opt-sub" id="full-board-sub">${esc(STRUCT.package.sub)}</div>
            </div>
          </label>
        </div>
        <hr style="margin:0.9rem 0;border:none;border-top:1px solid var(--border)">
      </div>
      <div class="field" style="margin-top:1rem">
        <label>${te('form.dietary')} <span style="font-weight:400;color:var(--muted)">${te('form.optional')}</span></label>
        <input type="text" id="dietary" placeholder="${te('form.dietaryPh')}">
        <div class="hint">${te('form.dietaryHint')}</div>
      </div>
      <div class="field">
        <label>${te('form.shirt')} <span style="font-weight:400;color:var(--muted)">${te('form.shirtOpt')}</span></label>
        <select id="shirt-size">
          <option value="">${te('form.noPref')}</option>
          <option value="XS">XS</option>
          <option value="S">S</option>
          <option value="M">M</option>
          <option value="L">L</option>
          <option value="XL">XL</option>
          <option value="XXL">XXL</option>
          <option value="3XL">3XL</option>
        </select>
        <div class="hint">${te('form.shirtHint')}</div>
      </div>
      <div class="field">
        <label>${te('form.addInfo')} <span style="font-weight:400;color:var(--muted)">${te('form.optional')}</span></label>
        <textarea id="free-text" rows="3" placeholder="${te('form.addInfoPh')}" style="width:100%;font-family:var(--sans);font-size:0.95rem;padding:0.5rem 0.75rem;border:1.5px solid #d1d5db;border-radius:4px;resize:vertical;box-sizing:border-box"></textarea>
        <div class="hint">${te('form.addInfoHint')}</div>
      </div>
    </div>

    <div class="section" id="gdpr-section">
      <div class="section-title">${te('form.privacy')}</div>
      <div style="background:#f6f8fa;border:1px solid var(--border);border-radius:6px;padding:0.75rem 0.9rem;font-size:0.85rem;color:var(--text);margin-bottom:0.75rem">
        ${esc(privacy.shortText(lang))}
        <div style="margin-top:0.4rem">${te('form.dataController')} <strong>${esc(privacy.controllerName())}</strong>${privacy.contactEmail() ? ' · <a href="mailto:' + esc(privacy.contactEmail()) + '">' + esc(privacy.contactEmail()) + '</a>' : ''}</div>
      </div>
      <label class="check-option">
        <input type="checkbox" id="privacy-ack">
        <div>
          <div class="opt-label">${esc(t('form.ack', {link: '@@LINK@@'})).replace('@@LINK@@', '<a href="' + esc(privacy.noticeUrl(lang)) + '" target="_blank" rel="noopener">' + te('form.privacyNotice') + '</a>')}</div>
        </div>
      </label>
      <label class="check-option">
        <input type="checkbox" id="publish-consent">
        <div>
          <div class="opt-label">${te('form.publish')} <span style="font-weight:400;color:var(--muted)">${te('form.optional')}</span></div>
          <div class="opt-sub" style="color:var(--muted);margin-top:0.25rem">${te('form.publishHint')}</div>
        </div>
      </label>
    </div>

    <div id="price-section" class="section"><div id="price-box"></div><div id="price-disclaimer" style="font-size:0.78rem;color:var(--muted);margin-top:0.5rem;font-style:italic"></div></div>
    <div id="submit-section" class="section">
      <div id="form-msg" class="msg"></div>
      <button class="submit-btn" id="submit-btn" onclick="submitForm()">${te('form.confirm')}</button>
      <p style="text-align:center;font-size:0.8rem;color:var(--muted);margin-top:0.75rem">${te('form.payment')}</p>
    </div>
  </div>

  <div id="success-screen" class="success-screen">
    <div class="success-icon">✅</div>
    <h2 style="margin-bottom:0.5rem">${te('form.successTitle')}</h2>
    <p style="color:var(--muted);margin-bottom:1rem">${te('form.successMsg')}</p>
    <div class="success-ref" id="success-ref"></div>
    <div id="success-join-link" style="display:none;margin-top:1.25rem"></div>
    <div id="success-details" style="margin-top:1.5rem;text-align:left"></div>
    <button onclick="this.textContent=T('js.loading'); this.disabled=true; this.style.opacity='0.6'; hardRefresh();" style="margin-top:2rem;padding:0.8rem 2.5rem;background:var(--accent);color:#fff;border:none;border-radius:4px;font-size:1rem;font-family:var(--sans);font-weight:600;cursor:pointer;letter-spacing:0.05em">${te('form.ready')}</button>
  </div>

  <div class="footer">
    ${EV('EVENT_NAME')} &nbsp;·&nbsp; ${esc(CONFIG.ORGANIZER_SHORT)} &nbsp;·&nbsp; ${EV('DATES_TEXT')}
    <div style="margin-top:0.6rem"><a href="${esc(CONFIG.HOME_URL)}" style="${homeStyle()}color:var(--muted);text-decoration:none;border-bottom:1px solid var(--border);font-size:0.85rem">← ${EV('HOME_LABEL')}</a></div>
  </div>
</div>

<script>
const I18N = ${i18n.safeJson(i18n.dict(lang, 'js.'))};
function T(k, v) { var s = Object.prototype.hasOwnProperty.call(I18N, k) ? I18N[k] : k; if (v) { for (var n in v) { s = s.split('{' + n + '}').join(v[n]); } } return s; }
const CONFIG_CLIENT = ${getClientConfigJson_(joinRef, settings, lang)};
CONFIG_CLIENT.BYPASS_TOKEN = '${bypassToken || ''}';

var displayCur = '';
function M(n) {
  var C = CONFIG_CLIENT.CURRENCY; n = Number(n) || 0;
  var s = C.digits === 0 ? String(Math.round(n)) : (Math.round(n * 100) % 100 === 0 ? String(Math.round(n)) : n.toFixed(2));
  return C.native === 'EUR' ? '\u20AC' + s : s + '\u00a0' + C.native;
}
function approxText(total) {
  var x = displayCur ? CONFIG_CLIENT.CURRENCY.extras.find(function(c){ return c.code === displayCur; }) : null;
  if (!x || !total) return '';
  var v = total * x.rate; v = (x.digits === 0 || v >= 100) ? Math.round(v) : Math.round(v * 100) / 100;
  var r = x.rate; var rs = String(Number(r >= 100 ? r.toFixed(2) : r >= 1 ? r.toFixed(4) : r.toPrecision(4)));
  return T('js.approx', {amt: v.toLocaleString('en').replace(/,/g, '\u00a0') + '\u00a0' + x.code, native: CONFIG_CLIENT.CURRENCY.native, rate: rs, cur: x.code});
}
function curPicker() {
  var ex = CONFIG_CLIENT.CURRENCY.extras;
  if (!ex.length) return '';
  var h = '<div class="price-row" style="border:0"><label for="cur-pick" style="font-size:.85rem">' + T('js.currencyLabel') + '</label><select id="cur-pick" onchange="setDisplayCur(this.value)" style="padding:.25rem">'
    + '<option value="">' + CONFIG_CLIENT.CURRENCY.native + '</option>';
  ex.forEach(function(c){ h += '<option value="' + c.code + '"' + (c.code === displayCur ? ' selected' : '') + '>' + c.code + '</option>'; });
  return h + '</select></div>';
}
function setDisplayCur(v) { displayCur = v; updatePriceDisplay(); }
console.log('%c ${esc(CONFIG.EVENT_SHORT)} Booking System %c v${VERSION} ', 'background:#1d4ed8;color:#fff;font-weight:bold', 'background:#e5e7eb;color:#374151');

let avail = null;
let currentMode = null;
let currentAccType = null;

function selectMode(mode) {
  currentMode = mode;
  ['new','join','dayvisitor','who'].forEach(function(m) {
    const el = document.getElementById('card-' + m);
    if (el) el.classList.toggle('selected', m === mode);
  });
  document.getElementById('landing-section').style.display = 'none';
  document.getElementById('form-section').classList.add('visible');

  if (mode === 'join') {
    show('join-section'); show('guest-section'); show('gdpr-section');
    show('price-section'); show('submit-section');
    hide('acc-type-section'); hide('room-type-section');
    hide('dayvisitor-section');
    document.getElementById('thu-section').style.display = 'none'; hideNights();
    document.getElementById('thu-info-join').style.display = 'none';
    document.getElementById('addons-section').classList.remove('visible');
    document.getElementById('individual-meals-section').style.display = 'none';
    resetExtras();
    updatePriceDisplay();
  } else if (mode === 'dayvisitor') {
    currentAccType = 'dayvisitor';
    hide('acc-type-section'); hide('room-type-section'); hide('join-section'); hide('thu-section'); hideNights();
    document.getElementById('dayvisitor-section').style.display = 'block';
    document.getElementById('individual-meals-section').style.display = 'block';
    document.getElementById('full-board-row').style.display = '';
    updateFullBoardSub();
    show('addons-section'); show('guest-section'); show('gdpr-section');
    show('price-section'); show('submit-section');
    updatePriceDisplay();
  } else {
    currentAccType = null;
    show('acc-type-section');
    hide('join-section'); hide('room-type-section'); hide('guest-section');
    hide('addons-section'); hide('gdpr-section'); hide('price-section'); hide('submit-section');
    document.getElementById('dayvisitor-section').style.display = 'none';
    document.getElementById('individual-meals-section').style.display = 'none';
  }
}

function openPublicPage() {
  window.open(location.pathname + '?public=1' + (CONFIG_CLIENT.LANG_QS ? '&' + CONFIG_CLIENT.LANG_QS : ''), '_blank');
}

function hardRefresh() {
  var base = CONFIG_CLIENT.FRIENDLY_URL || CONFIG_CLIENT.WEBAPP_URL;
  window.location.replace(base + '?t=' + Date.now() + (CONFIG_CLIENT.LANG_QS ? '&' + CONFIG_CLIENT.LANG_QS : ''));
}

function goBack() {
  var btn = event && event.target ? event.target : null;
  if (btn) { btn.textContent = T('js.loading'); btn.disabled = true; btn.style.opacity = '0.6'; }
  hardRefresh();
}

function show(id) { document.getElementById(id).classList.add('visible'); }
function hide(id) { document.getElementById(id).classList.remove('visible'); }

function onTypeChange() {
  const el = document.querySelector('input[name="acc-type"]:checked');
  if (!el) return;
  currentAccType = el.value;
  document.querySelectorAll('.radio-option').forEach(function(o) { o.classList.remove('selected'); });
  el.closest('.radio-option').classList.add('selected');
  const isRoom      = currentAccType === 'room';
  const isSingleBed = currentAccType === 'singlebed';
  const hasRoom     = isRoom || isSingleBed;
  document.getElementById('room-type-section').classList.toggle('visible', isRoom);
  document.getElementById('thu-section').style.display = (hasRoom && CONFIG_CLIENT.STRUCTURE.extraNights.length) ? 'block' : 'none';
  document.getElementById('nights-section').style.display = (hasRoom && perNight()) ? 'block' : 'none';
  if (!hasRoom) resetExtras();
  applyNightAvailability();
  document.getElementById('camper-info-box').style.display = currentAccType === 'camper' ? 'block' : 'none';
  document.getElementById('tent-info-box').style.display   = currentAccType === 'tent'   ? 'block' : 'none';
  document.getElementById('dayvisitor-section').style.display = 'none';
  document.getElementById('individual-meals-section').style.display = 'block';
  document.getElementById('full-board-row').style.display = '';
  updateFullBoardSub();
  show('guest-section'); show('addons-section'); show('gdpr-section'); show('price-section'); show('submit-section');
  updatePriceDisplay();
}

function updateFullBoardSub() {
  var el = document.getElementById('full-board-sub');
  if (!el) return;
  el.textContent = ${JSON.stringify(STRUCT.package.sub)};
}

function onFullBoardChange() {
  updatePriceDisplay();
}

function perNight() { return CONFIG_CLIENT.STRUCTURE.accommodation === 'per_night'; }
function hideNights() { var n = document.getElementById('nights-section'); if (n) n.style.display = 'none'; }
function selectedNights() { return Array.prototype.map.call(document.querySelectorAll('input[name="nt"]:checked'), function(e){ return e.value; }); }
// Room price for the nights the guest stays (whole room price unless fewer core nights are selected)
function roomStayPrice(roomPrice, nightKeys) {
  var n = Math.max(1, CONFIG_CLIENT.STRUCTURE.coreNights);
  var sel = perNight() ? (nightKeys ? nightKeys.length : selectedNights().length) : n;
  return (sel && sel !== n) ? Math.round(roomPrice * sel / n) : roomPrice;
}
function nightLabelOf(k) { var d = (CONFIG_CLIENT.STRUCTURE.days || []).find(function(y){ return y.key === k; }); return d ? T('js.nightOf', {day: d.short}) : extraLabel(k); }
// Per-night availability: a room type is bookable only if it is free on every selected night
function applyNightAvailability() {
  if (!avail || !avail.rooms) return;
  var keys = (perNight() ? selectedNights() : []).concat(selectedExtras());
  (CONFIG_CLIENT.ROOMS || []).forEach(function(r) {
    var a = avail.rooms[r.id]; var radio = document.querySelector('input[name="room-type"][value="' + r.id + '"]');
    if (!a || !radio || !a.perNight) return;
    var checkKeys = keys.length ? keys : (CONFIG_CLIENT.STRUCTURE.days || []).slice(0, CONFIG_CLIENT.STRUCTURE.coreNights).map(function(d){ return d.key; });
    var free = Math.min.apply(null, checkKeys.map(function(k){ return a.perNight[k] === undefined ? 0 : a.perNight[k]; }));
    var full = free <= 0;
    radio.disabled = full;
    if (full && radio.checked) { radio.checked = false; radio.closest('.radio-option').classList.remove('selected'); }
    var tag = radio.closest('.radio-option').querySelector('.full-tag');
    if (tag) tag.textContent = full ? (perNight() ? T('js.fullNights') : T('js.full')) : '';
  });
}
function onNightsChange() { applyNightAvailability(); updatePriceDisplay(); }

function selectedExtras() { return Array.prototype.map.call(document.querySelectorAll('input[name="xn"]:checked'), function(e){ return e.value; }); }
function resetExtras() { document.querySelectorAll('input[name="xn"]').forEach(function(e){ e.checked = false; e.disabled = false; }); }
function extraLabel(k) { var x = (CONFIG_CLIENT.STRUCTURE.extraNights || []).find(function(y){ return y.key === k; }); return x ? x.label : k; }
function extraNightRoomPrice(roomPrice) { return Math.round(roomPrice / Math.max(1, CONFIG_CLIENT.STRUCTURE.coreNights)); }
function selectedVisitorDays() { return Array.prototype.map.call(document.querySelectorAll('input[name="dv-day"]:checked'), function(e){ return e.value; }); }
function dayShort(k) { var d = (CONFIG_CLIENT.STRUCTURE.days || []).find(function(y){ return y.key === k; }); return d ? d.short : k; }

function onExtraNightChange() {
  applyNightAvailability();
  updatePriceDisplay();
}

function renderAvailability(data) {
  const grid = document.getElementById('avail-grid');
  let html = '';
  CONFIG_CLIENT.ROOMS.forEach(function(r) {
    const a = data.rooms[r.id];
    const full = a && a.available <= 0;
    html += '<div class="avail-item' + (full ? ' full' : '') + '"><span>' + r.note_en.replace(/\u26a0\ufe0f /,'') + '</span><span class="count">' + (a ? a.available + '/' + a.total : '?') + '</span></div>';
  });
  html += '<div class="avail-item' + (data.camperSpotsLeft <= 0 ? ' full' : '') + '"><span>' + T('js.camperSpots') + '</span><span class="count">' + data.camperSpotsLeft + '/' + CONFIG_CLIENT.CAMPER_VAN_SPOTS + '</span></div>';
  if (data.tentEnabled) {
    html += '<div class="avail-item' + (data.tentSpotsLeft <= 0 ? ' full' : '') + '"><span>' + T('js.tentSpots') + '</span><span class="count">' + data.tentSpotsLeft + '/' + CONFIG_CLIENT.TENT_SPOTS + '</span></div>';
  }
  grid.innerHTML = html;

  // Show/hide tent option
  var tentOpt = document.getElementById('tent-option');
  if (tentOpt) tentOpt.style.display = data.tentEnabled ? '' : 'none';

  // Show/hide single bed option
  var sbOpt = document.getElementById('singlebed-option');
  if (sbOpt) {
    sbOpt.style.display = (CONFIG_CLIENT.ALLOW_SINGLE_BED_BOOKING && data.singleBedVisible) ? '' : 'none';
  }
}

function renderRoomTypes(data) {
  const container = document.getElementById('room-type-options');
  let html = '';
  CONFIG_CLIENT.ROOMS.forEach(function(r) {
    const a = data.rooms[r.id];
    const full = a && a.available <= 0;
    const isDouble = r.persons === 2;
    const livePrice = (data.prices && data.prices.rooms && data.prices.rooms[r.id] !== undefined) ? data.prices.rooms[r.id] : r.price_eur;
    html += '<label class="radio-option" id="rt-' + r.id + '">'
      + '<input type="radio" name="room-type" value="' + r.id + '"' + (full ? ' disabled' : '') + ' onchange="onRoomTypeChange()">'
      + '<div><div class="opt-label">' + r.note_en + '<span class="full-tag">' + (full ? T('js.full') : '') + '</span></div>'
      + '<div class="opt-sub">' + T(r.persons > 1 ? 'js.roomLinePl' : 'js.roomLine', {price: livePrice, n: r.persons}) + '</div>'
      + (isDouble && CONFIG_CLIENT.ALLOW_SOLO_DOUBLE ? '<div style="margin-top:0.5rem"><label style="display:flex;align-items:center;gap:0.5rem;font-size:0.88rem;cursor:pointer"><input type="checkbox" id="solo-double" onchange="updatePriceDisplay()"> ' + T('js.solo') + '</label></div>' : '')
      + '</div></label>';
  });
  container.innerHTML = html;
  applyNightAvailability();
}

function onRoomTypeChange() {
  document.querySelectorAll('#room-type-options .radio-option').forEach(function(el) { el.classList.remove('selected'); });
  const checked = document.querySelector('input[name="room-type"]:checked');
  if (checked) checked.closest('.radio-option').classList.add('selected');
  // Update extra night sub-labels with room-based prices
  const r = checked ? CONFIG_CLIENT.ROOMS.find(function(x){return x.id===checked.value;}) : null;
  if (r) {
    const livePrice = (CONFIG_CLIENT.ROOM_PRICES && CONFIG_CLIENT.ROOM_PRICES[r.id] !== undefined) ? CONFIG_CLIENT.ROOM_PRICES[r.id] : r.price_eur;
    const nightRoom = extraNightRoomPrice(livePrice);
    const nightPP = r.persons > 1 ? Math.round(nightRoom / r.persons) : nightRoom;
    document.querySelectorAll('[data-xsub]').forEach(function(el) {
      var x = (CONFIG_CLIENT.STRUCTURE.extraNights || []).find(function(y){ return y.key === el.getAttribute('data-xsub'); });
      var txt = T('js.roomNight', {room: nightRoom});
      if (r.persons > 1) txt += ' ' + T('js.perPersonParen', {pp: nightPP});
      if (x && x.includes) txt += ' \u00b7 ' + x.includes;
      el.textContent = txt;
    });
  }
  updatePriceDisplay();
}

function renderOpenRooms(data) {
  // Nothing to render into a dropdown — join is link-based only.
  // If we have a pending join ref, initialise now that avail is loaded.
  if (CONFIG_CLIENT.INITIAL_JOIN) {
    initJoinFromRef(CONFIG_CLIENT.INITIAL_JOIN);
  }
}

function lookupJoinRef() {
  var input = document.getElementById('join-ref-input');
  var ref = input ? input.value.trim().toUpperCase() : '';
  if (!ref) { return; }
  // Reset state
  var infoEl = document.getElementById('join-room-info');
  var fullEl = document.getElementById('join-room-full');
  if (infoEl) { infoEl.style.display = 'none'; infoEl.style.background = ''; infoEl.style.borderColor = ''; infoEl.style.color = ''; }
  if (fullEl) { fullEl.style.display = 'none'; }
  ['guest-section','gdpr-section','addons-section','price-section','submit-section'].forEach(function(id){ hide(id); });
  initJoinFromRef(ref);
}

function initJoinFromRef(ref) {
  var room   = avail && avail.openRooms   ? avail.openRooms.find(function(r){ return r.ref === ref; })   : null;
  var camper = avail && avail.openCampers ? avail.openCampers.find(function(c){ return c.ref === ref; }) : null;
  var infoEl  = document.getElementById('join-room-info');
  var fullEl  = document.getElementById('join-room-full');

  // Keep a synthetic "selected" value so the rest of the flow can read it
  if (!document.getElementById('room-ref-select')) {
    var hidden = document.createElement('input');
    hidden.type = 'hidden'; hidden.id = 'room-ref-select'; hidden.value = ref;
    document.body.appendChild(hidden);
  } else {
    document.getElementById('room-ref-select').value = ref;
  }

  if (!room && !camper) {
    if (infoEl) { infoEl.style.display = 'block'; infoEl.textContent = T('js.refNotFound', {ref: ref}); infoEl.style.background = '#fef2f2'; infoEl.style.borderColor = '#fca5a5'; infoEl.style.color = '#b91c1c'; }
    ['guest-section','gdpr-section','addons-section','price-section','submit-section'].forEach(function(id){ hide(id); });
    return;
  }

  // --- CAMPER JOIN ---
  if (camper) {
    if (infoEl) { infoEl.style.display = 'block'; infoEl.style.background = ''; infoEl.style.borderColor = ''; infoEl.style.color = ''; infoEl.innerHTML = '<strong>' + ref + '</strong> — ' + T('js.camperJoinInfo', {cs: camper.callsign, n: camper.occupants}); }
    document.getElementById('thu-section').style.display = 'none'; hideNights();
    document.getElementById('thu-info-join').style.display = 'none';
    resetExtras();
    document.getElementById('addons-section').classList.add('visible');
    document.getElementById('individual-meals-section').style.display = 'block';
    document.getElementById('full-board-row').style.display = '';
    updateFullBoardSub();
    show('guest-section'); show('gdpr-section'); show('price-section'); show('submit-section');
    updatePriceDisplay();
    return;
  }

  // --- ROOM JOIN ---
  if (room.spotsLeft <= 0) {
    if (infoEl) infoEl.style.display = 'none';
    if (fullEl) { fullEl.style.display = 'block'; fullEl.textContent = T('js.roomFull', {ref: ref, type: room.roomType}); }
    ['guest-section','gdpr-section','addons-section','price-section','submit-section'].forEach(function(id){ hide(id); });
    return;
  }

  // Room has space — show info and form
  var spotsText = T(room.spotsLeft > 1 ? 'js.spotsN' : 'js.spots1', {n: room.spotsLeft});
  var joinExtras = room.extraNights || [];
  var joinNights = (perNight() && room.nights && room.nights.length) ? T('js.nightsList', {list: room.nights.map(nightLabelOf).join(', ')}) : '';
  var thuNote = joinNights + (joinExtras.length ? T('js.extraIncluded', {list: joinExtras.map(extraLabel).join(', ')}) : '');
  if (infoEl) { infoEl.style.display = 'block'; infoEl.style.background = ''; infoEl.style.borderColor = ''; infoEl.style.color = ''; infoEl.innerHTML = '<strong>' + ref + '</strong> — ' + room.roomType + ' · <strong>' + spotsText + '</strong>' + thuNote; }

  // Extra nights are inherited from the room
  document.getElementById('thu-section').style.display = 'none'; hideNights();
  resetExtras();
  if (joinExtras.length) {
    var nightRoom = extraNightRoomPrice(room.roomPrice);
    var nightPP = Math.round(nightRoom / (room.roomPersons || 1));
    var joinInfoEl = document.getElementById('thu-info-join');
    var joinTextEl = document.getElementById('thu-info-join-text');
    var priceNote = ' · ' + T('js.roomNightEach', {room: nightRoom, pp: nightPP});
    if (joinTextEl) joinTextEl.textContent = T('js.joinExtraText', {list: joinExtras.map(extraLabel).join(', ')}) + priceNote;
    if (joinInfoEl) joinInfoEl.style.display = 'block';
    joinExtras.forEach(function(k) { var cb = document.querySelector('input[name="xn"][value="' + k + '"]'); if (cb) { cb.checked = true; cb.disabled = true; } });
  } else {
    document.getElementById('thu-info-join').style.display = 'none';
  }

  document.getElementById('addons-section').classList.add('visible');
  document.getElementById('individual-meals-section').style.display = 'block';
  document.getElementById('full-board-row').style.display = '';
  updateFullBoardSub();
  show('guest-section'); show('gdpr-section'); show('price-section'); show('submit-section');
  updatePriceDisplay();
}
function onJoinRoomSelect() {
  var sel = document.getElementById('room-ref-select');
  if (sel && sel.value) initJoinFromRef(sel.value);
}

function updatePriceDisplay() {
  const box = document.getElementById('price-box');
  let rows = [], total = 0, tbd = false;
  if (currentMode === 'join') {
    const sel = document.getElementById('room-ref-select');
    const ref = sel ? sel.value : '';
    const selRoom   = ref && avail && avail.openRooms   ? avail.openRooms.find(function(r){ return r.ref === ref; })   : null;
    const selCamper = ref && avail && avail.openCampers ? avail.openCampers.find(function(c){ return c.ref === ref; }) : null;
    if (selCamper) {
      rows.push({label:T('js.pCamperShared', {ref: ref}), val:'—'});
      rows.push({label:T('js.pMeetingFull'), val:M(CONFIG_CLIENT.MEETING_FEE_WEEKEND)});
      total += CONFIG_CLIENT.MEETING_FEE_WEEKEND;
      if (document.getElementById('full-board') && document.getElementById('full-board').checked) {
        rows.push({label:T('js.pMeal'), val:M(CONFIG_CLIENT.FULL_BOARD_PRICE)});
        total += CONFIG_CLIENT.FULL_BOARD_PRICE;
      }
    } else if (selRoom) {
      const joinStay = roomStayPrice(selRoom.roomPrice, selRoom.nights || []);
      const joinPP = Math.round(joinStay / (selRoom.roomPersons || 1));
      rows.push({label:T('js.pRoomShare', {type: selRoom.roomType}), val:T('js.pPersonRoom', {pp: joinPP, room: joinStay})});
      total += joinPP;
      (selRoom.extraNights || []).forEach(function(k) {
        const nightRoom = extraNightRoomPrice(selRoom.roomPrice);
        const persons = selRoom.roomPersons || 1;
        const nightPP = Math.round(nightRoom / persons);
        rows.push({label:T('js.pExtraDiv', {label: extraLabel(k), room: nightRoom, n: persons}), val:T('js.pEuroPerPerson', {pp: nightPP})});
        total += nightPP;
      });
      rows.push({label:T('js.pMeetingFull'), val:M(CONFIG_CLIENT.MEETING_FEE_WEEKEND)});
      total += CONFIG_CLIENT.MEETING_FEE_WEEKEND;
      if (document.getElementById('full-board') && document.getElementById('full-board').checked) {
        rows.push({label:T('js.pMeal'), val:M(CONFIG_CLIENT.FULL_BOARD_PRICE)});
        total += CONFIG_CLIENT.FULL_BOARD_PRICE;
      }
    } else {
      rows.push({label:T('js.pJoining'), val:T('js.pEnterRef')});
    }
  } else if (currentAccType === 'room') {
    const rt = document.querySelector('input[name="room-type"]:checked');
    if (rt) {
      const r = CONFIG_CLIENT.ROOMS.find(function(x){return x.id===rt.value;});
      if (r) {
        const livePrice = (CONFIG_CLIENT.ROOM_PRICES && CONFIG_CLIENT.ROOM_PRICES[r.id] !== undefined) ? CONFIG_CLIENT.ROOM_PRICES[r.id] : r.price_eur;
        const soloEl = document.getElementById('solo-double');
        const isSolo = soloEl && soloEl.checked;
        const stayPrice = roomStayPrice(livePrice);
        const pp = isSolo ? stayPrice : Math.round(stayPrice / r.persons);
        const nightsNote = (perNight() && stayPrice !== livePrice) ? ', ' + T('js.pNightsOf', {sel: selectedNights().length, all: CONFIG_CLIENT.STRUCTURE.coreNights}) : '';
        rows.push({label:T(isSolo ? 'js.pRoomSolo' : 'js.pRoom', {desc: r.note_en + nightsNote}), val: isSolo ? M(pp) : T('js.pPersonRoom', {pp: pp, room: stayPrice})});
        total += pp;
      }
    }
    const rt2 = document.querySelector('input[name="room-type"]:checked');
    const r2 = rt2 ? CONFIG_CLIENT.ROOMS.find(function(x){return x.id===rt2.value;}) : null;
    if (r2) {
      selectedExtras().forEach(function(k) {
        const livePrice2 = (CONFIG_CLIENT.ROOM_PRICES && CONFIG_CLIENT.ROOM_PRICES[r2.id] !== undefined) ? CONFIG_CLIENT.ROOM_PRICES[r2.id] : r2.price_eur;
        const nightRoom = extraNightRoomPrice(livePrice2);
        const soloEl2 = document.getElementById('solo-double');
        const isSolo2 = soloEl2 && soloEl2.checked;
        const nightPP = isSolo2 ? nightRoom : Math.round(nightRoom / r2.persons);
        var label = (!isSolo2 && r2.persons > 1) ? T('js.pExtraDiv', {label: extraLabel(k), room: nightRoom, n: r2.persons}) : T('js.pExtraRoomOnly', {label: extraLabel(k), room: nightRoom});
        rows.push({label:label, val:(isSolo2||r2.persons===1) ? M(nightPP) : T('js.pEuroPerPerson', {pp: nightPP})});
        total += nightPP;
      });
    }
  } else if (currentAccType === 'camper') {
    const t = CONFIG_CLIENT.CAMPER_VAN_PRICE_PER_NIGHT * CONFIG_CLIENT.CAMPING_NIGHTS;
    rows.push({label:T('js.pCamper', {n: CONFIG_CLIENT.CAMPING_NIGHTS}), val:M(t)}); total += t;
  } else if (currentAccType === 'tent') {
    rows.push({label:T('js.pTent'), val:M(CONFIG_CLIENT.TENT_PRICE_WEEKEND)});
    total += CONFIG_CLIENT.TENT_PRICE_WEEKEND;
  } else if (currentAccType === 'singlebed') {
    const bedStay = roomStayPrice(CONFIG_CLIENT.SINGLE_BED_PRICE);
    rows.push({label:T('js.pSingleBed'), val:M(bedStay)});
    total += bedStay;
    selectedExtras().forEach(function(k) {
      const nightPrice = extraNightRoomPrice(CONFIG_CLIENT.SINGLE_BED_PRICE);
      rows.push({label:T('js.pExtraPlain', {label: extraLabel(k)}), val:M(nightPrice)});
      total += nightPrice;
    });
  } else if (currentAccType === 'dayvisitor') {
    var dvSel = selectedVisitorDays();
    if (dvSel.length) {
      if (dvSel.length > 1 && dvSel.length === CONFIG_CLIENT.STRUCTURE.days.length) {
        rows.push({label:T('js.pMeetingAll'), val:M(CONFIG_CLIENT.MEETING_FEE_WEEKEND)});
        total += CONFIG_CLIENT.MEETING_FEE_WEEKEND;
      } else {
        dvSel.forEach(function(k) {
          rows.push({label:T('js.pMeetingDay', {day: dayShort(k)}), val:M(CONFIG_CLIENT.MEETING_FEE_DAY)});
          total += CONFIG_CLIENT.MEETING_FEE_DAY;
        });
      }
    }
  }
  if (currentMode !== 'join') {
    const boardEl = document.getElementById('full-board');
    if (boardEl && boardEl.checked) {
      rows.push({label:T('js.pMeal'), val:M(CONFIG_CLIENT.FULL_BOARD_PRICE)});
      total += CONFIG_CLIENT.FULL_BOARD_PRICE;
    }
    // Meeting fee for all non-day-visitor types
    if (currentAccType && currentAccType !== 'dayvisitor' && rows.length > 0) {
      rows.push({label:T('js.pMeetingFull'), val:M(CONFIG_CLIENT.MEETING_FEE_WEEKEND)});
      total += CONFIG_CLIENT.MEETING_FEE_WEEKEND;
    }
  }
  if (!rows.length) { box.innerHTML = ''; return; }
  let html = '<div class="price-box">';
  rows.forEach(function(r) { html += '<div class="price-row"><span>' + r.label + '</span><span>' + r.val + '</span></div>'; });
  html += '<div class="price-row total"><span>' + T('js.total') + '</span><span>' + M(total) + (tbd ? ' + TBD' : '') + '</span></div>'
    + (approxText(total) ? '<div class="price-row" style="font-size:.85rem;color:var(--muted)"><span>' + approxText(total) + '</span></div>' : '') + curPicker() + '</div>';
  box.innerHTML = html;
}

function submitForm() {
  const msg = document.getElementById('form-msg');
  msg.className = 'msg'; msg.textContent = '';
  if (!document.getElementById('privacy-ack').checked) {
    msg.className = 'msg error visible'; msg.textContent = T('js.errAck'); return;
  }
  const data = {
    callsign:    document.getElementById('callsign').value.trim().toUpperCase(),
    name:        document.getElementById('name').value.trim(),
    email:       document.getElementById('email').value.trim(),
    phone:       document.getElementById('phone').value.trim(),
    country:     document.getElementById('country').value.trim(),
    dietary:     document.getElementById('dietary').value.trim(),
    shirtSize:   document.getElementById('shirt-size').value,
    freeText:    document.getElementById('free-text') ? document.getElementById('free-text').value.trim() : '',
    fullBoard:   document.getElementById('full-board').checked,
    privacyAck:     document.getElementById('privacy-ack').checked,
    language:       CONFIG_CLIENT.LANG,
    displayCurrency: displayCur,
    publishConsent: document.getElementById('publish-consent').checked,
    extraNights:    [],
    bypassToken:    CONFIG_CLIENT.BYPASS_TOKEN || '',
  };
  if (currentMode === 'join') {
    const ref = document.getElementById('room-ref-select').value;
    if (!ref) { showError(T('js.errRef')); return; }
    data.roomRef = ref;
    data.joinExisting = true;
    // Detect if joining a camper spot or a room
    const isCamperJoin = avail && avail.openCampers && avail.openCampers.find(function(c){ return c.ref === ref; });
    data.type = isCamperJoin ? 'camper' : 'room';
    data.extraNights = selectedExtras();
  } else {
    data.type = currentAccType; data.joinExisting = false;
    if (currentAccType === 'room') {
      const rt = document.querySelector('input[name="room-type"]:checked');
      if (!rt) { showError(T('js.errRoomType')); return; }
      data.roomId = rt.value;
      if (perNight()) { data.nights = selectedNights(); if (!data.nights.length) { showError(T('js.errNight')); return; } }
      const soloEl = document.getElementById('solo-double');
      data.soloDouble = soloEl ? soloEl.checked : false;
      data.extraNights = selectedExtras();
    } else if (currentAccType === 'singlebed') {
      data.extraNights = selectedExtras();
      if (perNight()) { data.nights = selectedNights(); if (!data.nights.length) { showError(T('js.errNight')); return; } }
    } else if (currentAccType === 'dayvisitor') {
      data.visitorDays = selectedVisitorDays();
      if (!data.visitorDays.length) { showError(T('js.errDays')); return; }
    }
  }
  if (!data.callsign || data.callsign.length < 3) { showError(T('js.errCallsign')); return; }
  if (!data.name)    { showError(T('js.errName')); return; }
  if (!data.email)   { showError(T('js.errEmail')); return; }
  if (!data.country) { showError(T('js.errCountry')); return; }

  document.getElementById('loading').classList.add('visible');
  document.getElementById('submit-btn').disabled = true;

  rpc.run
    .withSuccessHandler(function(result) {
      document.getElementById('loading').classList.remove('visible');
      if (result && result.success) {
        // Keep button disabled — booking complete
        hide('form-section'); document.getElementById('landing-section').style.display = 'none';
        const ss = document.getElementById('success-screen');
        ss.style.display = 'block';
        document.getElementById('success-ref').textContent = result.bookingRef;
        if (data.type === 'room' && !data.joinExisting) {
          const base = CONFIG_CLIENT.FRIENDLY_URL || CONFIG_CLIENT.WEBAPP_URL;
          const joinUrl = base + '?join=' + encodeURIComponent(result.bookingRef) + (CONFIG_CLIENT.LANG_QS ? '&' + CONFIG_CLIENT.LANG_QS : '');
          document.getElementById('success-join-link').style.display = 'block';
          document.getElementById('success-join-link').innerHTML =
            '<div class="info-box" style="text-align:left"><strong>' + T('js.shareLink') + '</strong><br>'
            + '<a href="' + joinUrl + '" style="font-family:var(--mono);font-size:.85rem;word-break:break-all;color:var(--accent2)">' + joinUrl + '</a><br>'
            + '<span style="font-size:.82rem;color:var(--muted)">' + T('js.opensForm') + '</span></div>';
        }
        if (result.price) {
          let html = '<div class="price-box">';
          result.price.breakdown.split(' | ').forEach(function(line) { html += '<div class="price-row"><span>' + line + '</span></div>'; });
          html += '<div class="price-row total"><span>' + T('js.total') + '</span><span>' + M(result.price.total) + '</span></div>'
            + (approxText(result.price.total) ? '<div class="price-row" style="font-size:.85rem;color:var(--muted)"><span>' + approxText(result.price.total) + '</span></div>' : '') + '</div>';
          document.getElementById('success-details').innerHTML = html;
        }
      } else {
        // Known error from server — re-enable button so user can fix and retry
        document.getElementById('submit-btn').disabled = false;
        showError((result && result.error) ? result.error : T('js.errFailed'));
      }
    })
    .withFailureHandler(function(err) {
      document.getElementById('loading').classList.remove('visible');
      document.getElementById('submit-btn').disabled = false;
      showError(T('js.errServer', {msg: err && err.message ? err.message : String(err)}));
    })
    .submitBooking(data);
}

function showError(msg) {
  const el = document.getElementById('form-msg');
  el.textContent = msg; el.className = 'msg error visible';
  el.scrollIntoView({behavior:'smooth',block:'nearest'});
}

window.selectMode = selectMode;
window.openPublicPage = openPublicPage;
window.goBack = goBack;
window.hardRefresh = hardRefresh;
window.lookupJoinRef = lookupJoinRef;
window.onTypeChange = onTypeChange;
window.onRoomTypeChange = onRoomTypeChange;
window.updatePriceDisplay = updatePriceDisplay;

window.submitForm = submitForm;
window.showError = showError;
window.renderAvailability = renderAvailability;
window.renderRoomTypes = renderRoomTypes;
window.renderOpenRooms = renderOpenRooms;
window.onFullBoardChange = onFullBoardChange;
window.onExtraNightChange = onExtraNightChange;
window.updateFullBoardSub = updateFullBoardSub;
window.onJoinRoomSelect = onJoinRoomSelect;
window.initJoinFromRef = initJoinFromRef;
window.onload = function() {
  rpc.run
    .withSuccessHandler(function(data) {
      avail = data;
      // Merge live prices into CONFIG_CLIENT so price display is always current
      if (data.prices) {
        CONFIG_CLIENT.FULL_BOARD_PRICE        = data.prices.fullBoard;
        CONFIG_CLIENT.CAMPER_VAN_PRICE_PER_NIGHT = data.prices.camperPerNight;
        CONFIG_CLIENT.TENT_PRICE_WEEKEND      = data.prices.tentWeekend;
        CONFIG_CLIENT.SINGLE_BED_PRICE        = data.prices.singleBed;
        CONFIG_CLIENT.ROOM_PRICES             = data.prices.rooms;
        CONFIG_CLIENT.MEETING_FEE_WEEKEND     = data.prices.meetingFeeWeekend;
        CONFIG_CLIENT.MEETING_FEE_DAY         = data.prices.meetingFeeDay;
      }
      var disclaimerEl = document.getElementById('price-disclaimer');
      if (disclaimerEl && CONFIG_CLIENT.PRICE_DISCLAIMER) {
        disclaimerEl.textContent = CONFIG_CLIENT.PRICE_DISCLAIMER;
      }
      renderAvailability(data);
      renderRoomTypes(data);
      const joinRef = CONFIG_CLIENT.INITIAL_JOIN || '';
      if (joinRef) {
        selectMode('join');
        setTimeout(function() { var js = document.getElementById('join-section'); if (js) js.scrollIntoView({behavior:'smooth',block:'start'}); }, 300);
      }
      renderOpenRooms(data);  // initialises join form if INITIAL_JOIN is set
    })
    .withFailureHandler(function(err) {
      document.getElementById('avail-grid').innerHTML = '<div style="color:var(--danger)">' + T('js.errGeneric', {msg: err.message}) + '</div>';
    })
    .getAvailability();
};
</script>
</body>
</html>`;
}

function buildPublicPage(lang, sw) {
  lang = lang || i18n.defaultLang();
  const t = (k, v) => i18n.t(lang, k, v);
  const te = (k, v) => esc(t(k, v));
  const EV = k => esc(i18n.ev(lang, k));
  sw = sw || '';
  return `<!DOCTYPE html>
<html lang="${lang}">
<head>
<script src="/rpc-shim.js"></script>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<title>${te('form.whoTitle')} — ${EV('EVENT_NAME')}</title>
<style>
  :root {
    --bg:#f0f2f5; --surface:#ffffff; --border:#d0d7de;
    --accent:#b45309; --accent2:#1d6fa5; --text:#1c2128; --muted:#57606a;
    --success:#1a7f37; --mono:'Share Tech Mono',monospace; --sans:'Barlow',sans-serif;
  }
  *,*::before,*::after{box-sizing:border-box;margin:0;padding:0}
  body{background:var(--bg);color:var(--text);font-family:var(--sans);font-size:17px;min-height:100vh}
  .container{max-width:800px;margin:0 auto;padding:2.5rem 1.5rem 4rem}
  .header{text-align:center;margin-bottom:2.5rem;padding-bottom:1.5rem;border-bottom:2px solid var(--border)}
  .header-badge{font-family:var(--mono);font-size:0.75rem;color:var(--accent);letter-spacing:0.2em;text-transform:uppercase;margin-bottom:0.75rem}
  .header h1{font-size:2rem;font-weight:700;margin-bottom:0.4rem}
  .header h1 span{color:var(--accent)}
  .header .sub{font-size:1rem;color:var(--muted);font-weight:300}
  .header .dates{margin-top:1rem;display:flex;justify-content:center;gap:1rem;flex-wrap:wrap}
  .date-pill{font-family:var(--mono);font-size:0.8rem;padding:0.3rem 0.9rem;border:2px solid var(--accent);color:var(--accent);border-radius:3px;font-weight:600}
  .count-bar{background:var(--surface);border:1px solid var(--border);border-radius:6px;padding:1.25rem 1.5rem;margin-bottom:2rem;display:flex;align-items:center;gap:1rem;box-shadow:0 1px 3px rgba(0,0,0,0.06)}
  .count-num{font-family:var(--mono);font-size:2.5rem;font-weight:700;color:var(--accent);line-height:1}
  .count-label{font-size:1rem;color:var(--muted)}
  .count-label strong{color:var(--text);display:block;font-size:1.1rem}
  .guest-grid{display:grid;grid-template-columns:repeat(auto-fill,minmax(160px,1fr));gap:0.75rem}
  .guest-card{background:var(--surface);border:1px solid var(--border);border-radius:6px;padding:1rem 1.1rem;box-shadow:0 1px 3px rgba(0,0,0,0.05);transition:box-shadow 0.15s,border-color 0.15s}
  .guest-card:hover{box-shadow:0 3px 8px rgba(0,0,0,0.1);border-color:var(--accent2)}
  .guest-callsign{font-family:var(--mono);font-size:1.05rem;font-weight:700;color:var(--accent2);letter-spacing:0.05em}
  .guest-name{font-size:0.95rem;color:var(--muted);margin-top:0.2rem}
  .guest-type{font-size:0.85rem;font-family:var(--mono);margin-top:0.4rem;color:var(--border)}
  .guest-type.camper{color:var(--accent)}
  .guest-type.tent{color:var(--success)}
  .guest-type.hotel{color:var(--accent2)}
  .guest-type.dayvisitor{color:var(--muted)}
  .guest-type.organizer{color:#7c3aed}
  .loading{text-align:center;color:var(--muted);padding:3rem;font-family:var(--mono);font-size:0.9rem}
  .spinner{width:30px;height:30px;border:3px solid var(--border);border-top-color:var(--accent);border-radius:50%;animation:spin 0.7s linear infinite;margin:0 auto 1rem}
  @keyframes spin{to{transform:rotate(360deg)}}
  .footer{text-align:center;margin-top:3rem;font-size:0.78rem;color:var(--muted);font-family:var(--mono)}
  .refresh-btn{display:inline-block;margin-top:1.5rem;padding:0.5rem 1.25rem;background:var(--surface);border:1px solid var(--border);color:var(--text);font-family:var(--sans);font-size:0.9rem;cursor:pointer;border-radius:4px}
  .refresh-btn:hover{border-color:var(--accent2);color:var(--accent2)}
  .updated{font-size:0.75rem;color:var(--muted);font-family:var(--mono);margin-top:0.5rem}
  @media(max-width:600px){
    .container{padding:0.5rem 0.5rem 2rem}
    .guest-grid{grid-template-columns:repeat(auto-fill,minmax(100px,1fr));gap:0.5rem}
    .guest-card{padding:0.5rem 0.6rem}
    .guest-callsign{font-size:0.9rem}
    .guest-name{font-size:0.75rem}
  }
</style>
</head>
<body>
<div class="container">
  ${sw}
  <div class="header">
    <div class="header-badge">${te('pub.participants')}</div>
    <div style="display:flex;align-items:center;justify-content:center;gap:1.5rem;margin-bottom:1rem;flex-wrap:wrap;">
      ${logos('max-height:100px;width:auto;', 'max-height:80px;width:auto;')}
    </div>
    <div class="sub">${EV('ORGANIZER')}<br>${EV('LOCATION')}</div>
  </div>

  <div id="count-bar" class="count-bar" style="display:none">
    <div class="count-num" id="guest-count">0</div>
    <div class="count-label"><strong>${te('pub.registered')}</strong></div>
  </div>

  <div id="loading" class="loading">
    <div class="spinner"></div>
    ${te('pub.loading')}
  </div>

  <div id="guest-grid" class="guest-grid"></div>

  <div style="text-align:center">
    <button class="refresh-btn" onclick="loadGuests()">&#8635; ${te('pub.refresh')}</button>
    <div class="updated" id="updated-time"></div>
    <div style="margin-top:0.75rem">
      <a href="${esc('/' + (i18n.qsLang(lang) ? '?' + i18n.qsLang(lang) : ''))}" style="font-family:var(--sans);font-size:0.85rem;color:var(--muted);text-decoration:none;border-bottom:1px solid var(--border)">${te('pub.back')}</a>
    </div>
  </div>

  <div class="footer">
    ${EV('EVENT_NAME')} &nbsp;&middot;&nbsp; ${esc(CONFIG.ORGANIZER_SHORT)} &nbsp;&middot;&nbsp; ${EV('DATES_TEXT')}
  </div>
</div>
<script>
const I18N = ${i18n.safeJson(i18n.dict(lang, 'js.'))};
function T(k, v) { var s = Object.prototype.hasOwnProperty.call(I18N, k) ? I18N[k] : k; if (v) { for (var n in v) { s = s.split('{' + n + '}').join(v[n]); } } return s; }
function loadGuests() {
  document.getElementById('loading').style.display = 'block';
  document.getElementById('guest-grid').innerHTML = '';
  document.getElementById('count-bar').style.display = 'none';

  rpc.run
    .withSuccessHandler(function(guests) {
      document.getElementById('loading').style.display = 'none';
      document.getElementById('count-bar').style.display = 'flex';
      document.getElementById('guest-count').textContent = guests.length;

      const grid = document.getElementById('guest-grid');
      if (guests.length === 0) {
        grid.innerHTML = '<div style="color:var(--muted);grid-column:1/-1;text-align:center;padding:2rem;font-size:1rem">' + T('js.noRegs') + '</div>';
        return;
      }
      grid.innerHTML = guests.map(function(g) {
        var badge = '';
        if (g.isOrganizer) {
          badge = '<div class="guest-type organizer">' + T('js.staff') + '</div>';
        } else if (g.type === 'camper') {
          badge = '<div class="guest-type camper">' + T('js.camper') + '</div>';
        } else if (g.type === 'tent') {
          badge = '<div class="guest-type tent">' + T('js.tent') + '</div>';
        } else if (g.type === 'dayvisitor') {
          badge = '<div class="guest-type dayvisitor">' + T('js.dayvisitor') + '</div>';
        } else if (g.type === 'room' || g.type === 'singlebed') {
          badge = '<div class="guest-type hotel">' + T('js.hotel') + '</div>';
        }
        return '<div class="guest-card">'
          + '<div class="guest-callsign">' + g.callsign + '</div>'
          + '<div class="guest-name">' + g.firstName + '</div>'
          + badge
          + '</div>';
      }).join('');

      document.getElementById('updated-time').textContent =
        T('js.updated', {time: new Date().toLocaleTimeString()});
    })
    .withFailureHandler(function(err) {
      document.getElementById('loading').style.display = 'none';
      document.getElementById('guest-grid').innerHTML =
        '<div style="color:red;grid-column:1/-1">' + T('js.errGeneric', {msg: err.message}) + '</div>';
    })
    .getPublicGuestList();
}

window.loadGuests = loadGuests;
window.onload = loadGuests;
</script>
</body>
</html>`;
}

function getAdminConfigJson_(settings) {
  return {
    STRUCTURE: CONFIG.STRUCTURE,
    CAMPER_VAN_SPOTS: settings.CAMPER_VAN_SPOTS,
    TENT_SPOTS: settings.TENT_SPOTS,
    ROOMS: CONFIG.ROOMS.map(function(r) {
      return {
        id: r.id,
        note_en: r.note_en,
        persons: r.persons,
        count: (settings.ROOM_COUNTS && settings.ROOM_COUNTS[r.id] !== undefined) ? settings.ROOM_COUNTS[r.id] : r.count
      };
    })
  };
}

function getSetupPanelHtml() {
  return `
<div id="setup-panel">
  <div style="display:flex;align-items:center;gap:1.25rem;margin-bottom:0.25rem">
    ${logos('height:60px;width:auto;', 'height:50px;width:auto;')}
    <div style="flex:1">
      <h1>${esc(CONFIG.EVENT_SHORT)} — Event Setup</h1>
      <div class="sub" style="margin-bottom:0">Event configuration, currencies, structure, room types, prices, translations and data protection.</div>
    </div>
    <div style="text-align:right;flex-shrink:0">
      <a href="/?admin=1" style="font-size:0.8rem;color:var(--accent2);font-family:var(--mono);text-decoration:none">&larr; Booking admin</a><br>
      <button onclick="fetch('/api/admin/logout',{method:'POST'}).then(function(){location.reload()})" style="margin-top:0.4rem;background:none;border:none;font-size:0.72rem;color:var(--muted);cursor:pointer;font-family:var(--mono)" title="Log out">🔒 Log out</button>
    </div>
  </div>
  <div class="sub"></div>

  <div class="settings-panel">
    <h3 style="font-size:0.85rem;font-family:var(--mono);color:var(--muted);letter-spacing:0.12em;text-transform:uppercase;margin-bottom:0.9rem">💶 Pricing</h3>
    <div style="display:grid;grid-template-columns:repeat(auto-fill,minmax(260px,1fr));gap:0.6rem;margin-bottom:1rem" id="pricing-grid">
      <div class="setting-item">
        <div class="setting-label">Full board meal package (${currency.symbol(currency.native())}/person)</div>
        <input type="number" class="setting-input" id="s-fullboard-price" min="0" style="width:90px">
      </div>
      <div class="setting-item">
        <div class="setting-label">Camper van spot (${currency.symbol(currency.native())}/night)</div>
        <input type="number" class="setting-input" id="s-camper-price" min="0" style="width:90px">
      </div>
      <div class="setting-item">
        <div class="setting-label">Tent spot, whole event (${currency.symbol(currency.native())})</div>
        <input type="number" class="setting-input" id="s-tent-price" min="0" style="width:90px">
      </div>
      <div class="setting-item">
        <div class="setting-label">Single bed, organizer-assigned (${currency.symbol(currency.native())})</div>
        <input type="number" class="setting-input" id="s-singlebed-price" min="0" style="width:90px">
      </div>
      <div class="setting-item">
        <div class="setting-label">Single bed slots available
          <div class="hint">How many single bed bookings to offer (0 = disabled)</div>
        </div>
        <input type="number" class="setting-input" id="s-singlebed-slots" min="0" style="width:90px">
      </div>
      <div class="setting-item">
        <div class="setting-label">Meeting fee — full event (${currency.symbol(currency.native())})</div>
        <input type="number" class="setting-input" id="s-meeting-fee-weekend" min="0" style="width:90px">
      </div>
      <div class="setting-item">
        <div class="setting-label">Meeting fee — single day (${currency.symbol(currency.native())})</div>
        <input type="number" class="setting-input" id="s-meeting-fee-day" min="0" style="width:90px">
      </div>
    </div>
    <div id="room-prices-grid" style="display:grid;grid-template-columns:repeat(auto-fill,minmax(260px,1fr));gap:0.6rem;margin-bottom:1rem"></div>
    <div style="display:flex;align-items:center">
      <button class="btn-settings-save" onclick="savePricing()">Save pricing</button>
      <span class="settings-msg" id="pricing-msg"></span>
    </div>

    <hr class="divider" style="margin-top:1.5rem">
    <h3 style="font-size:0.85rem;font-family:var(--mono);color:var(--muted);letter-spacing:0.12em;text-transform:uppercase;margin-bottom:0.9rem">🏨 Room Inventory</h3>
    <div id="room-counts-grid" style="display:grid;grid-template-columns:repeat(auto-fill,minmax(240px,1fr));gap:0.6rem;margin-bottom:0.6rem"></div>
    <div style="display:grid;grid-template-columns:repeat(auto-fill,minmax(240px,1fr));gap:0.6rem;margin-bottom:1rem">
      <div class="setting-item">
        <div class="setting-label">Camper van spots</div>
        <input type="number" class="setting-input" id="rc-camper" min="0" max="99" style="width:70px;text-align:center">
      </div>
      <div class="setting-item">
        <div class="setting-label">Tent spots</div>
        <input type="number" class="setting-input" id="rc-tent" min="0" max="99" style="width:70px;text-align:center">
      </div>
    </div>
    <div style="display:flex;align-items:center">
      <button class="btn-settings-save" onclick="saveRoomCounts()">Save inventory</button>
      <span class="settings-msg" id="room-counts-msg"></span>
    </div>
  </div>

  <div style="margin:1rem 0 1.5rem 0">
    <button class="export-btn" style="float:none;margin:0" id="recalc-btn" onclick="recalcAllPrices()" title="Recalculate prices for all bookings">🔄 Recalculate prices</button>
    <span style="font-size:0.75rem;color:var(--muted);font-family:var(--mono);margin-left:0.5rem">Use after changing prices: recalculates every active booking.</span>
  </div>
</div>`;
}

function getAdminPanelHtml() {
  return `
<div id="admin-panel">
  <div style="display:flex;align-items:center;gap:1.25rem;margin-bottom:0.25rem">
    ${logos('height:60px;width:auto;', 'height:50px;width:auto;')}
    <div style="flex:1">
      <h1>${esc(CONFIG.EVENT_SHORT)} — Booking Admin</h1>
      <div class="sub" style="margin-bottom:0">${esc(CONFIG.ORGANIZER_SHORT)} · ${esc(CONFIG.LOCATION)} · ${esc(CONFIG.DATES_TEXT)}</div>
    </div>
    <div style="text-align:right;flex-shrink:0">
      <button id="header-refresh-btn" class="export-btn" style="float:none;margin:0 0 0.4rem 0" onclick="loadAdmin()">↺ Refresh</button>
      <div style="font-size:0.75rem;color:var(--muted);font-family:var(--mono)">This page does not auto-refresh</div>
      <div id="header-refresh-ts" style="font-size:0.75rem;color:var(--muted);font-family:var(--mono)"></div>
      <a href="/?setup=1" style="font-size:0.8rem;color:var(--accent2);font-family:var(--mono);text-decoration:none">&#9881; Event setup &rarr;</a><br>
      <button onclick="fetch('/api/admin/logout',{method:'POST'}).then(function(){location.reload()})" style="margin-top:0.4rem;background:none;border:none;font-size:0.72rem;color:var(--muted);cursor:pointer;font-family:var(--mono)" title="Log out">🔒 Log out</button>
    </div>
  </div>
  <div class="sub"></div>

  <div class="stats" id="stats"></div>

  <div class="settings-panel">
    <h3>⚙️ Registration Settings</h3>
    <div class="settings-grid">
      <div class="setting-item">
        <div class="setting-label">Registration open
          <div class="hint">Uncheck to close registration. Deadline date overrides this automatically.</div>
        </div>
        <label class="toggle"><input type="checkbox" id="s-reg-open" checked><span class="toggle-slider"></span></label>
      </div>
      <div id="reg-open-warning" style="display:none;background:#fef3c7;border:1px solid #fcd34d;border-radius:4px;padding:0.6rem 0.85rem;font-size:0.82rem;color:#92400e;margin-bottom:0.5rem">
        &#9888; <strong>Note:</strong> You are opening registration after the set deadline. Remember to close it again when done.
      </div>
      </div>
      <div class="setting-item">
        <div class="setting-label">Registration closes
          <div class="hint">e.g. 2026-04-30 — registration closes automatically at 23:59 local time on this date</div>
        </div>
        <input type="text" class="setting-input" id="s-reg-closes" placeholder="YYYY-MM-DD">
      </div>
      <div class="setting-item">
        <div class="setting-label">Allow solo double room
          <div class="hint">One person books entire double</div>
        </div>
        <label class="toggle"><input type="checkbox" id="s-solo-double"><span class="toggle-slider"></span></label>
      </div>
      <div class="setting-item" style="flex-direction:column;align-items:flex-start;gap:0.6rem">
        <div style="display:flex;align-items:center;justify-content:space-between;width:100%">
          <div class="setting-label">Allow single bed booking
            <div class="hint">Enables the single bed option in the booking form</div>
          </div>
          <label class="toggle"><input type="checkbox" id="s-single-bed"><span class="toggle-slider"></span></label>
        </div>
        <div style="font-size:0.8rem;color:var(--muted);background:var(--bg);border:1px solid var(--border);border-radius:4px;padding:0.6rem 0.75rem;line-height:1.6;width:100%;box-sizing:border-box">
          ℹ️ The single bed option is <strong>only shown to guests</strong> when all conditions are met:<br>
          1. All <strong>single-person rooms</strong> are <strong>fully booked</strong><br>
          2. At least one <strong>multi-person room</strong> has a free bed and is <strong>not marked solo</strong>
        </div>
      </div>
      <div class="setting-item" style="flex-direction:column;align-items:flex-start;gap:0.4rem">
        <div class="setting-label">Announcement banner
          <div class="hint">Shown prominently on the booking front page. Leave empty to hide.</div>
        </div>
        <textarea id="s-announcement" rows="3" style="width:100%;font-family:var(--sans);font-size:0.85rem;padding:0.4rem 0.6rem;border:1.5px solid #d1d5db;border-radius:3px;resize:vertical;box-sizing:border-box" placeholder="e.g. Registration closes Friday 10 April at 23:59"></textarea>
      </div>
      <div class="setting-item" style="flex-direction:column;align-items:flex-start;gap:0.4rem">
        <div class="setting-label">Registration closed message
          <div class="hint">Shown on the booking page when registration is closed. Leave empty to show default text only.</div>
        </div>
        <textarea id="s-closed-message" rows="3" style="width:100%;font-family:var(--sans);font-size:0.85rem;padding:0.4rem 0.6rem;border:1.5px solid #d1d5db;border-radius:3px;resize:vertical;box-sizing:border-box" placeholder="e.g. Registration for ${esc(CONFIG.EVENT_SHORT)} is now closed. Thank you for your interest!"></textarea>
      </div>
      <div class="setting-item" style="flex-direction:column;align-items:flex-start;gap:0.4rem">
        <div class="setting-label">Bypass link (secret registration link)
          <div class="hint">Anyone with this link can register even when registration is closed. Leave empty to disable. Regenerate to invalidate old links.</div>
        </div>
        <div style="display:flex;gap:0.5rem;width:100%;align-items:center">
          <input type="text" id="s-bypass-token" class="setting-input" style="flex:1;font-family:var(--mono);font-size:0.82rem" placeholder="Empty = disabled" readonly>
          <button type="button" id="btn-generate-bypass" class="export-btn" style="white-space:nowrap">↺ Regenerate</button>
          <button type="button" id="btn-clear-bypass" class="export-btn" style="white-space:nowrap">✕ Clear</button>
        </div>
        <div id="bypass-link-display" style="display:none;width:100%;background:#f0fdf4;border:1px solid #86efac;border-radius:4px;padding:0.5rem 0.75rem;font-size:0.78rem;word-break:break-all;font-family:var(--mono);color:#166534"></div>
      </div>
      </div>
      <div class="setting-item" style="flex-direction:column;align-items:flex-start;gap:0.4rem">
        <div class="setting-label">Camper van info text
          <div class="hint">Shown on booking page when camper van is selected, and in confirmation emails to camper guests.</div>
        </div>
        <textarea id="s-camper-info" rows="4" style="width:100%;font-family:var(--sans);font-size:0.85rem;padding:0.4rem 0.6rem;border:1.5px solid #d1d5db;border-radius:3px;resize:vertical;box-sizing:border-box"></textarea>
      </div>
      <div class="setting-item" style="flex-direction:column;align-items:flex-start;gap:0.4rem">
        <div class="setting-label">Tent info text
          <div class="hint">Shown on booking page when tent is selected, and in confirmation emails to tent guests.</div>
        </div>
        <textarea id="s-tent-info" rows="4" style="width:100%;font-family:var(--sans);font-size:0.85rem;padding:0.4rem 0.6rem;border:1.5px solid #d1d5db;border-radius:3px;resize:vertical;box-sizing:border-box"></textarea>
      </div>
      <div class="setting-item" style="flex-direction:column;align-items:flex-start;gap:0.4rem">
        <div class="setting-label">Price disclaimer
          <div class="hint">Shown on booking page and in confirmation emails. Leave empty to hide.</div>
        </div>
        <textarea id="s-price-disclaimer" rows="2" style="width:100%;font-family:var(--sans);font-size:0.85rem;padding:0.4rem 0.6rem;border:1.5px solid #d1d5db;border-radius:3px;resize:vertical;box-sizing:border-box"></textarea>
      </div>
      <div class="setting-item">
        <div class="setting-label">Tent spots enabled
          <div class="hint">Uncheck to hide tent option from guests</div>
        </div>
        <label class="toggle"><input type="checkbox" id="s-tent-enabled" checked><span class="toggle-slider"></span></label>
      </div>
    </div>
    <div style="display:flex;align-items:center">
      <button class="btn-settings-save" onclick="saveSettings()">Save settings</button>
      <span class="settings-msg" id="settings-msg"></span>
    </div>
  </div>

  <div style="margin-top:1.5rem;display:flex;gap:0.5rem;margin-bottom:1rem;align-items:center">
    <button id="table-refresh-btn" class="export-btn" style="float:none;margin:0" onclick="loadAdmin()">↺ Refresh</button>
    <button class="export-btn" style="float:none;margin:0" onclick="exportCSV()">⬇ Export CSV</button>
    <button class="export-btn" style="float:none;margin:0" id="sort-reset-btn" onclick="adminResetSort()" title="Return to default grouped view">✕ Clear sort</button>
    <span id="table-refresh-ts" style="font-size:0.75rem;color:var(--muted);font-family:var(--mono);margin-left:0.5rem"></span>
  </div>
  <div class="table-wrap">
    <table id="bookings-table">
      <thead><tr id="table-head"></tr></thead>
      <tbody id="table-body"></tbody>
    </table>
  </div>
</div>

<div id="edit-modal" onclick="if(event.target===this)closeEdit()">
  <div class="modal-box">
    <h3>✏️ Edit booking: <span id="edit-ref"></span></h3>
    <div class="modal-row2">
      <div class="modal-field">
        <label>Callsign</label>
        <input type="text" id="edit-callsign" style="text-transform:uppercase">
      </div>
      <div class="modal-field">
        <label>Name</label>
        <input type="text" id="edit-name">
      </div>
    </div>
    <div class="modal-row2">
      <div class="modal-field">
        <label>Email</label>
        <input type="email" id="edit-email">
      </div>
      <div class="modal-field">
        <label>Phone</label>
        <input type="tel" id="edit-phone">
      </div>
    </div>
    <div class="modal-row2">
      <div class="modal-field">
        <label>Country</label>
        <input type="text" id="edit-country">
      </div>
      <div class="modal-field">
        <label>Status</label>
        <select id="edit-status">
          <option value="CONFIRMED">CONFIRMED</option>
          <option value="CANCELLED">CANCELLED</option>
          <option value="NEEDS_ATTENTION">NEEDS_ATTENTION</option>
        </select>
      </div>
    </div>
    <div class="modal-field" id="edit-nights-row" style="display:none">
      <label>Nights (room / single bed; all ticked = whole stay)</label>
      <div style="display:flex;flex-wrap:wrap;gap:0.75rem">${CONFIG.STRUCTURE.days.slice(0, CONFIG.STRUCTURE.coreNights).map(d => `<label style="display:flex;align-items:center;gap:0.35rem"><input type="checkbox" name="edit-nt" value="${esc(d.key)}" style="width:auto;margin:0"> ${esc(d.short)}</label>`).join('')}</div>
    </div>
    <div class="modal-field" id="edit-dayvisitor-days-row" style="display:none">
      <label>Day visitor days</label>
      <div id="edit-vd-list" style="display:flex;flex-wrap:wrap;gap:0.75rem">${CONFIG.STRUCTURE.days.map(d => `<label style="display:flex;align-items:center;gap:0.35rem"><input type="checkbox" name="edit-vd" value="${esc(d.key)}" style="width:auto;margin:0"> ${esc(d.short)}</label>`).join('')}</div>
    </div>
    <div class="modal-field">
      <label>Dietary requirements</label>
      <input type="text" id="edit-dietary">
    </div>
    <div class="modal-row2" style="margin-top:0.75rem">
      <div class="modal-field" style="flex-direction:row;align-items:center;gap:0.5rem">
        <input type="checkbox" id="edit-fullboard" style="width:auto;margin:0">
        <label style="margin:0">Meal package</label>
      </div>
      <div class="modal-field" id="edit-xn-list" style="flex-direction:column;align-items:flex-start;gap:0.25rem">${CONFIG.STRUCTURE.extraNights.map(x => `<label style="display:flex;align-items:center;gap:0.35rem;margin:0"><input type="checkbox" name="edit-xn" value="${esc(x.key)}" style="width:auto;margin:0"> Extra night: ${esc(x.label)}</label>`).join('')}</div>
    </div>
    <div class="modal-field" style="flex-direction:row;align-items:center;gap:0.5rem;margin-top:0.5rem">
      <input type="checkbox" id="edit-soloroom" style="width:auto;margin:0">
      <label style="margin:0">Solo room <span class="tag solo" style="font-size:0.7rem">SOLO</span></label>
    </div>
    <div class="modal-field" style="flex-direction:row;align-items:center;gap:0.5rem;margin-top:0.5rem">
      <input type="checkbox" id="edit-publish" style="width:auto;margin:0">
      <label style="margin:0">Publish consent <span style="font-size:0.78rem;color:var(--muted)">(appears on Who's coming?)</span></label>
    </div>
    <div class="modal-field" style="flex-direction:row;align-items:center;gap:0.5rem;margin-top:0.5rem">
      <input type="checkbox" id="edit-isorganizer" style="width:auto;margin:0">
      <label style="margin:0">👷 Staff <span style="font-size:0.78rem;color:#7c3aed">(shows organizer badge on Who's coming?)</span></label>
    </div>
    <hr class="divider">
    <div class="modal-field">
      <label class="org-label">🔒 Room number (organizers only)</label>
      <input type="text" id="edit-roomnum" placeholder="e.g. 214">
    </div>
    <div class="modal-field">
      <label class="org-label">💬 Additional info from booker</label>
      <textarea id="edit-freetext" placeholder="(none)" style="background:#fff;color:#111;border:1.5px solid #d1d5db"></textarea>
    </div>
    <div class="modal-field">
      <label class="org-label">🔒 Organizer comment (internal only)</label>
      <textarea id="edit-orgcomment" placeholder="Internal notes..."></textarea>
    </div>

    <div id="role-change-section" style="display:none;margin-top:1.25rem;border-top:1px solid var(--border);padding-top:1.25rem">
      <div style="font-weight:700;margin-bottom:0.75rem;font-size:0.95rem">🔄 Change role</div>

      <div id="role-joiner-to-primary" style="display:none">
        <div style="font-size:0.88rem;color:var(--muted);margin-bottom:0.6rem">This person is currently a <strong>joiner</strong>. Promote to primary booker by assigning a free room:</div>
        <div class="modal-field">
          <label>Assign room type</label>
          <select id="role-room-select"><option value="">— select room —</option></select>
        </div>
        <button id="btn-promote-to-primary" style="background:#16a34a;color:#fff;border:none;border-radius:4px;padding:0.5rem 1.25rem;font-size:0.9rem;cursor:pointer;margin-top:0.25rem">⬆️ Promote to primary booker</button>
      </div>

      <div id="role-primary-to-joiner" style="display:none">
        <div style="font-size:0.88rem;color:var(--muted);margin-bottom:0.6rem">This person is currently the <strong>primary booker</strong>. Move them as a joiner into another room:</div>
        <div class="modal-field">
          <label>Join room (booking ref)</label>
          <select id="role-target-room-select"><option value="">— select room —</option></select>
        </div>
        <div id="role-joiner-warning" style="display:none;background:#fffbeb;border:1px solid var(--accent);border-radius:4px;padding:0.6rem 0.8rem;font-size:0.85rem;margin-top:0.5rem;color:#92400e"></div>
        <button id="btn-move-to-joiner" style="background:#b45309;color:#fff;border:none;border-radius:4px;padding:0.5rem 1.25rem;font-size:0.9rem;cursor:pointer;margin-top:0.5rem">⬇️ Move to joiner</button>
      </div>

      <div id="role-change-result" style="display:none;margin-top:0.75rem;padding:0.6rem 0.8rem;border-radius:4px;font-size:0.88rem"></div>
    </div>

    <div class="modal-field" style="flex-direction:row;align-items:center;gap:0.5rem;margin-bottom:0.75rem;flex-wrap:wrap">
      <span style="font-size:0.8rem;color:var(--muted)">Data protection:</span>
      <button type="button" class="btn-cancel" style="flex:none;padding:0.3rem 0.7rem;font-size:0.8rem" onclick="gdprExport(document.getElementById('edit-modal')._ref)">Export data (JSON)</button>
      <button type="button" class="btn-cancel" style="flex:none;padding:0.3rem 0.7rem;font-size:0.8rem;color:#b91c1c;border-color:#b91c1c" onclick="gdprErase(document.getElementById('edit-modal')._ref)">Erase data…</button>
    </div>
    <div class="modal-actions">
      <div style="display:flex;align-items:center;gap:0.5rem;margin-bottom:0.75rem">
        <input type="checkbox" id="edit-send-email" style="width:auto;margin:0" checked>
        <label for="edit-send-email" style="margin:0;font-size:0.85rem;color:var(--muted)">Send change notification email to guest</label>
      </div>
      <div style="display:flex;gap:0.75rem">
        <button class="btn-cancel" onclick="closeEdit()">Cancel</button>
        <button class="btn-save" id="edit-save-btn" onclick="saveEdit()">Save</button>
      </div>
    </div>
  </div>
</div>

<div id="acc-change-modal" onclick="if(event.target===this)closeAccChange()" style="display:none;position:fixed;inset:0;background:rgba(0,0,0,0.7);z-index:200;align-items:center;justify-content:center;padding:1rem">
  <div style="background:var(--surface);border-radius:8px;padding:1.5rem;max-width:520px;width:100%;max-height:90vh;overflow-y:auto;box-shadow:0 8px 32px rgba(0,0,0,0.3)">
    <h3 style="margin-bottom:0.25rem">🛏️ Change accommodation</h3>
    <div id="acc-change-who" style="font-family:var(--mono);font-size:0.85rem;color:var(--muted);margin-bottom:1.25rem"></div>

    <div style="background:var(--bg);border:1px solid var(--border);border-radius:4px;padding:0.75rem;margin-bottom:1rem;font-size:0.88rem">
      <div style="font-weight:600;margin-bottom:0.2rem">Current</div>
      <div id="acc-current-desc" style="color:var(--muted)"></div>
      <div id="acc-current-price" style="font-family:var(--mono);margin-top:0.2rem"></div>
    </div>

    <div class="modal-field">
      <label>New accommodation type</label>
      <select id="acc-new-type" onchange="onAccTypeChange()">
        <option value="room">🏨 Hotel room</option>
        <option value="camper">🚐 Camper van spot</option>
        <option value="tent">⛺ Tent</option>
        <option value="singlebed">🛏️ Single bed (organizer-assigned)</option>
        <option value="dayvisitor">🎫 Day visitor</option>
      </select>
    </div>

    <div id="acc-room-picker" style="display:none">
      <div class="modal-field">
        <label>Room type</label>
        <select id="acc-new-room-id" onchange="onAccRoomChange()">
        </select>
      </div>
    </div>

    <div id="acc-new-info" style="background:var(--bg);border:1px solid var(--border);border-radius:4px;padding:0.75rem;margin-top:0.75rem;font-size:0.88rem;display:none">
      <div style="font-weight:600;margin-bottom:0.4rem">New accommodation</div>
      <div id="acc-new-desc" style="color:var(--muted);margin-bottom:0.2rem"></div>
      <div id="acc-new-capacity" style="color:var(--muted);margin-bottom:0.2rem"></div>
      <div id="acc-new-price" style="font-family:var(--mono);margin-top:0.2rem"></div>
      <div id="acc-price-diff" style="font-family:var(--mono);font-weight:600;margin-top:0.2rem"></div>
    </div>

    <div id="acc-warning" style="display:none;background:#fff7ed;border:1px solid #fed7aa;border-radius:4px;padding:0.6rem 0.75rem;margin-top:0.75rem;font-size:0.85rem;color:#92400e"></div>

    <div style="flex-direction:row;align-items:center;gap:0.5rem;margin-top:1rem;display:flex">
      <input type="checkbox" id="acc-send-email" style="width:auto;margin:0" checked>
      <label style="margin:0;font-size:0.9rem">Send change notification email to guest</label>
    </div>

    <div id="acc-save-msg" style="display:none;margin-top:0.75rem;font-size:0.85rem;padding:0.5rem 0.75rem;border-radius:4px"></div>

    <div style="display:flex;gap:0.75rem;margin-top:1.25rem">
      <button class="btn-cancel" onclick="closeAccChange()">Cancel</button>
      <button class="btn-save" id="acc-save-btn" onclick="saveAccChange()">Save change</button>
    </div>
  </div>
</div>`;
}

function buildAdminPage(settings, mode) {
  mode = mode === 'setup' ? 'setup' : 'admin';
  const heading = mode === 'setup' ? 'Setup' : 'Admin';
  return `<!DOCTYPE html>
<html lang="en">
<head>
<script src="/rpc-shim.js"></script>
<script>window.CUR = ${i18n.safeJson(currency.publicInfo())};</script>
<script src="/admin-event.js"></script>
<script src="/admin-currency.js"></script>
<script src="/admin-rooms.js"></script>
<script src="/admin-structure.js"></script>
<script src="/admin-privacy.js"></script>
<script src="/admin-translations.js"></script>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<title>${heading} — ${esc(CONFIG.EVENT_SHORT)}</title>
<style>
  :root {
    --bg:#0d1117;--surface:#161b22;--border:#30363d;
    --accent:#f0a500;--accent2:#58a6ff;--text:#e6edf3;--muted:#8b949e;
    --danger:#f85149;--success:#3fb950;
    --mono:'Share Tech Mono',monospace;--sans:'Barlow',sans-serif;
  }
  *{box-sizing:border-box;margin:0;padding:0}
  body{background:var(--bg);color:var(--text);font-family:var(--sans);font-size:14px;padding:2rem 1rem}
  h1{font-size:1.4rem;margin-bottom:0.25rem}
  h1 span{color:var(--accent)}
  .sub{color:var(--muted);font-size:0.8rem;margin-bottom:2rem}
  .login-box{max-width:360px;margin:4rem auto;background:var(--surface);border:1px solid var(--border);padding:2rem;border-radius:4px}
  .login-box h2{margin-bottom:1.5rem;font-size:1.1rem}
  input[type=password]{width:100%;background:var(--bg);border:1px solid var(--border);color:var(--text);padding:0.6rem 0.75rem;font-family:var(--mono);border-radius:3px;margin-bottom:1rem;outline:none}
  input[type=password]:focus{border-color:var(--accent2)}
  .btn{padding:0.6rem 1.25rem;background:var(--accent);color:#000;border:none;font-weight:700;cursor:pointer;border-radius:3px;font-family:var(--sans)}
  .btn:hover{background:#ffc107}
  .stats{display:grid;grid-template-columns:repeat(auto-fill,minmax(160px,1fr));gap:1rem;margin-bottom:2rem}
  .stat{background:var(--surface);border:1px solid var(--border);padding:1rem;border-radius:3px}
  .stat .label{font-size:0.7rem;text-transform:uppercase;letter-spacing:0.1em;color:var(--muted);margin-bottom:0.4rem}
  .stat .value{font-family:var(--mono);font-size:1.5rem;color:var(--accent)}
  table{width:100%;border-collapse:collapse;font-size:0.8rem}
  th{background:var(--surface);padding:0.5rem 0.75rem;text-align:left;font-size:0.65rem;letter-spacing:0.1em;text-transform:uppercase;color:var(--muted);border-bottom:1px solid var(--border)}
  td{padding:0.45rem 0.75rem;border-bottom:1px solid rgba(48,54,61,0.5);vertical-align:top}
  tr:hover td{background:rgba(88,166,255,0.03)}
  .tag{display:inline-block;padding:0.15rem 0.4rem;border-radius:2px;font-size:0.65rem;font-family:var(--mono)}
  .tag.room{background:rgba(88,166,255,0.15);color:var(--accent2)}
  .tag.camper{background:rgba(240,165,0,0.15);color:var(--accent)}
  .tag.tent{background:rgba(63,185,80,0.15);color:var(--success)}
  .tag.yes{background:rgba(63,185,80,0.15);color:var(--success)}
  .tag.no{background:rgba(48,54,61,0.5);color:var(--muted)}
  .tag.solo{background:rgba(139,92,246,0.2);color:#a78bfa;font-weight:700;letter-spacing:0.05em}
  .tag.primary{background:rgba(180,83,9,0.15);color:var(--accent);font-weight:700;letter-spacing:0.05em}
  .tag.joiner{background:rgba(88,166,255,0.12);color:var(--accent2);letter-spacing:0.05em}
  .tag.tag-camper{background:rgba(240,165,0,0.18);color:var(--accent);font-weight:700;letter-spacing:0.05em}
  .tag.dayvisitor{background:rgba(63,185,80,0.15);color:var(--success);font-weight:700;letter-spacing:0.05em}
  .tag.status-CONFIRMED{background:rgba(63,185,80,0.15);color:var(--success)}
  .tag.status-CANCELLED{background:rgba(248,81,73,0.15);color:var(--danger)}
  .tag.status-NEEDS_ATTENTION{background:rgba(240,165,0,0.25);color:var(--accent)}
  tr.status-cancelled td{opacity:0.45;text-decoration:line-through}
  tr.status-attention td{background:rgba(240,165,0,0.08);}
  tr.status-attention td{background:rgba(240,165,0,0.07)}
  tr.status-attention{outline:1px solid rgba(240,165,0,0.4)}
  .err{color:var(--danger);padding:1rem}
  .table-wrap{overflow-x:auto}
  .settings-panel{background:var(--surface);border:1px solid var(--border);border-radius:6px;padding:1.5rem;margin-bottom:2rem}
  .settings-panel h3{font-family:var(--mono);font-size:0.85rem;color:var(--accent);letter-spacing:0.1em;text-transform:uppercase;margin-bottom:1.25rem}
  .settings-grid{display:grid;grid-template-columns:repeat(auto-fill,minmax(280px,1fr));gap:1rem;margin-bottom:1.25rem}
  .setting-item{display:flex;align-items:center;justify-content:space-between;gap:1rem;padding:0.6rem 0.75rem;background:var(--bg);border:1px solid var(--border);border-radius:4px}
  .setting-label{font-size:0.82rem;line-height:1.4}
  .setting-label .hint{font-size:0.72rem;color:var(--muted);margin-top:0.15rem}
  .toggle{position:relative;display:inline-block;width:40px;height:22px;flex-shrink:0}
  .toggle input{opacity:0;width:0;height:0}
  .toggle-slider{position:absolute;inset:0;background:var(--border);border-radius:22px;cursor:pointer;transition:0.2s}
  .toggle-slider:before{content:"";position:absolute;width:16px;height:16px;left:3px;bottom:3px;background:#fff;border-radius:50%;transition:0.2s}
  .toggle input:checked + .toggle-slider{background:var(--success)}
  .toggle input:checked + .toggle-slider:before{transform:translateX(18px)}
  .setting-input{background:var(--bg);border:1px solid var(--border);color:var(--text);padding:0.35rem 0.6rem;font-family:var(--mono);font-size:0.85rem;border-radius:3px;width:130px;outline:none}
  .setting-input:focus{border-color:var(--accent2)}
  .btn-settings-save{padding:0.5rem 1.25rem;background:var(--accent);color:#000;border:none;font-weight:700;cursor:pointer;border-radius:3px;font-family:var(--sans);font-size:0.9rem}
  .btn-settings-save:hover{background:#ffc107}
  .settings-msg{font-size:0.82rem;margin-left:1rem;color:var(--success)}
  .export-btn{float:right;margin-bottom:1rem;padding:0.4rem 0.9rem;background:var(--surface);border:1px solid var(--border);color:var(--text);font-size:0.8rem;cursor:pointer;border-radius:3px;font-family:var(--sans)}
  .export-btn:hover{border-color:var(--accent2)}
  .edit-btn{background:none;border:1px solid var(--border);color:var(--muted);padding:0.2rem 0.5rem;cursor:pointer;border-radius:3px;font-size:0.8rem}
  .edit-btn:hover{border-color:var(--accent2);color:var(--accent2)}
  .org-field{font-size:0.8rem}
  #edit-modal{display:none;position:fixed;inset:0;background:rgba(0,0,0,0.7);z-index:200;align-items:center;justify-content:center;padding:1rem}
  .modal-box{background:var(--surface);border:1px solid var(--border);border-radius:6px;padding:2rem;width:100%;max-width:520px;max-height:90vh;overflow-y:auto}
  .modal-box h3{font-size:1rem;margin-bottom:1.25rem;color:var(--accent);font-family:var(--mono)}
  .modal-field{margin-bottom:0.9rem}
  .modal-field label{display:block;font-size:0.72rem;text-transform:uppercase;letter-spacing:0.08em;color:var(--muted);margin-bottom:0.3rem}
  .modal-field input,.modal-field select,.modal-field textarea{width:100%;background:var(--bg);border:1px solid var(--border);color:var(--text);padding:0.5rem 0.65rem;font-family:var(--sans);font-size:0.9rem;border-radius:3px;outline:none}
  .modal-field input:focus,.modal-field select:focus,.modal-field textarea:focus{border-color:var(--accent2)}
  .modal-field textarea{min-height:60px;resize:vertical}
  .modal-field .org-label{font-size:0.65rem;color:var(--accent);text-transform:uppercase;letter-spacing:0.1em}
  .modal-row2{display:grid;grid-template-columns:1fr 1fr;gap:0.75rem}
  .modal-actions{display:flex;gap:0.75rem;justify-content:flex-end;margin-top:1.5rem;padding-top:1rem;border-top:1px solid var(--border)}
  .btn-cancel{padding:0.5rem 1rem;background:none;border:1px solid var(--border);color:var(--muted);cursor:pointer;border-radius:3px;font-family:var(--sans)}
  .btn-save{padding:0.5rem 1.25rem;background:var(--accent);color:#000;border:none;font-weight:700;cursor:pointer;border-radius:3px;font-family:var(--sans)}
  .btn-save:hover{background:#ffc107}
  .divider{border:none;border-top:1px solid var(--border);margin:1rem 0}
  @media(max-width:700px){
    body{font-size:14px}
    .stats{grid-template-columns:repeat(auto-fill,minmax(120px,1fr));gap:0.6rem}
    .stat{padding:0.75rem}
    .stat .value{font-size:1.2rem}
    .settings-grid{grid-template-columns:1fr}
    .export-btn{float:none;display:block;width:100%;margin-bottom:0.75rem;text-align:center}
    .table-wrap{overflow-x:auto;-webkit-overflow-scrolling:touch}
    table{min-width:600px;font-size:0.75rem}
    th,td{padding:0.35rem 0.5rem;white-space:nowrap}
    #edit-modal{align-items:flex-end;padding:0}
    .modal-box{max-width:100%;width:100%;max-height:92vh;border-radius:10px 10px 0 0;padding:1.25rem 1rem}
    .modal-row2{grid-template-columns:1fr}
    .login-box{margin:1.5rem auto;padding:1.25rem 1rem}
  }
</style>
</head>
<body>

<div class="login-box" id="login-box">
  <h2>🔒 ${heading} — ${esc(CONFIG.EVENT_SHORT)}</h2>
  <input type="password" id="admin-pw" placeholder="Password">
  <button class="btn" id="login-btn">Login</button>
  <div style="color:var(--danger);font-size:0.8rem;margin-top:0.75rem" id="pw-err"></div>
</div>


<script>
function M(n) { var C = window.CUR || { native: 'EUR', digits: 2 }; n = Number(n) || 0; var s = C.digits === 0 ? String(Math.round(n)) : (Math.round(n * 100) % 100 === 0 ? String(Math.round(n)) : n.toFixed(2)); return C.native === 'EUR' ? '\u20AC' + s : s + '\u00a0' + C.native; }
var PAGE_MODE = '${mode}';
let adminPw = '';
var currentAdminData = null;
let allRows = [];
let allHeaders = [];
const CONFIG_ADMIN = ${JSON.stringify(getAdminConfigJson_(settings))};
console.log('%c ${esc(CONFIG.EVENT_SHORT)} Admin %c v${VERSION} ', 'background:#7c3aed;color:#fff;font-weight:bold', 'background:#e5e7eb;color:#374151');

window.exportCSV = exportCSV;
window.openEdit = openEdit;
window.closeEdit = closeEdit;
window.saveEdit = saveEdit;
window.loadAdmin = loadAdmin;
window.openAccChange = openAccChange;
window.closeAccChange = closeAccChange;
window.saveAccChange = saveAccChange;
window.onAccTypeChange = onAccTypeChange;
window.onAccRoomChange = onAccRoomChange;
window.doRoleChange = doRoleChange;

function doRoleChange(newRole) {
  var ref = document.getElementById('edit-modal')._ref;
  var pw = adminPw;
  var params = { newRole: newRole };
  var resultBox = document.getElementById('role-change-result');

  console.log('doRoleChange called', newRole, 'ref:', ref, 'pw set:', !!pw);

  if (newRole === 'primary') {
    params.targetRoomId = document.getElementById('role-room-select').value;
    console.log('targetRoomId:', params.targetRoomId);
    if (!params.targetRoomId) { alert('Please select a room type.'); return; }
  } else {
    params.targetRoomRef = document.getElementById('role-target-room-select').value;
    console.log('targetRoomRef:', params.targetRoomRef);
    if (!params.targetRoomRef) { alert('Please select a target room.'); return; }
  }

  resultBox.style.display = 'none';
  console.log('Calling changeRole server function...');
  rpc.run
    .withSuccessHandler(function(res) {
      if (!res.success) {
        resultBox.style.cssText = 'display:block;background:rgba(248,81,73,0.1);border:1px solid var(--danger);border-radius:4px;padding:0.6rem 0.8rem;font-size:0.88rem;color:var(--danger)';
        resultBox.textContent = '❌ ' + res.error;
      } else {
        resultBox.style.cssText = 'display:block;background:rgba(22,163,74,0.1);border:1px solid #16a34a;border-radius:4px;padding:0.6rem 0.8rem;font-size:0.88rem;color:#16a34a';
        resultBox.textContent = '✅ ' + res.message;
        setTimeout(function() { closeEdit(); loadAdmin(); }, 1500);
      }
    })
    .withFailureHandler(function(err) {
      resultBox.style.cssText = 'display:block;background:rgba(248,81,73,0.1);border:1px solid var(--danger);border-radius:4px;padding:0.6rem 0.8rem;font-size:0.88rem;color:var(--danger)';
      resultBox.textContent = '❌ Server error: ' + err.message;
    })
    .changeRole(pw, ref, params);
}
window.saveSettings = saveSettings;
window.savePricing = savePricing;
window.saveRoomCounts = saveRoomCounts;
window.loadSettings = loadSettings;

function isDeadlinePassed() {
  var el = document.getElementById('s-reg-closes');
  if (!el || !el.value.trim()) return false;
  return new Date() > new Date(el.value.trim() + 'T23:59:59');
}
function checkRegDeadlineWarning() {
  var w = document.getElementById('reg-open-warning');
  if (!w) return;
  w.style.display = (document.getElementById('s-reg-open').checked && isDeadlinePassed()) ? 'block' : 'none';
}
function onRegOpenChange() { checkRegDeadlineWarning(); }
function generateBypassToken() {
  var chars = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789';
  var t = '';
  for (var i = 0; i < 24; i++) t += chars.charAt(Math.floor(Math.random() * chars.length));
  document.getElementById('s-bypass-token').value = t;
  updateBypassLinkDisplay();
}
function clearBypassToken() {
  document.getElementById('s-bypass-token').value = '';
  updateBypassLinkDisplay();
}
function updateBypassLinkDisplay() {
  var t = document.getElementById('s-bypass-token').value.trim();
  var d = document.getElementById('bypass-link-display');
  if (!d) return;
  if (t) {
    var base = (typeof CONFIG_CLIENT !== 'undefined' && CONFIG_CLIENT.FRIENDLY_URL) ? CONFIG_CLIENT.FRIENDLY_URL : window.location.href.split('?')[0];
    d.style.display = 'block';
    d.textContent = base + '?bypass=' + t;
  } else { d.style.display = 'none'; }
}
window.isDeadlinePassed        = isDeadlinePassed;
window.checkRegDeadlineWarning = checkRegDeadlineWarning;
window.onRegOpenChange         = onRegOpenChange;
window.generateBypassToken     = generateBypassToken;
window.clearBypassToken        = clearBypassToken;
window.updateBypassLinkDisplay = updateBypassLinkDisplay;

function recalcAllPrices() {
  var btn = document.getElementById('recalc-btn');
  if (btn) { btn.disabled = true; btn.textContent = '⏳ Recalculating...'; }
  rpc.run
    .withSuccessHandler(function(result) {
      if (btn) { btn.disabled = false; btn.textContent = '🔄 Recalculate prices'; }
      if (result.success) {
        alert('Done! Updated ' + result.updated + ' bookings.');
        loadAdmin();
      } else {
        alert('Error: ' + result.error);
      }
    })
    .withFailureHandler(function(err) {
      if (btn) { btn.disabled = false; btn.textContent = '🔄 Recalculate prices'; }
      alert('Error: ' + err.message);
    })
    .recalcAllPrices(adminPw);
}
window.recalcAllPrices = recalcAllPrices;
document.addEventListener('DOMContentLoaded', function() {
  document.getElementById('login-btn').addEventListener('click', doLogin);
  document.getElementById('admin-pw').addEventListener('keydown', function(e) { if(e.key==='Enter') doLogin(); });
  // Auto-login if password saved
  var saved = null; // sessions are cookie based; the password is never stored in the browser
  if (saved) {
    document.getElementById('admin-pw').value = saved;
    doLogin();
  }
  document.addEventListener('change', function(e) {
    if (e.target.id === 's-reg-open') onRegOpenChange();
  });
  document.addEventListener('click', function(e) {
    if (e.target.id === 'btn-promote-to-primary') { doRoleChange('primary'); return; }
    if (e.target.id === 'btn-move-to-joiner')     { doRoleChange('joiner');  return; }
    if (e.target.id === 'btn-generate-bypass')    { generateBypassToken();   return; }
    if (e.target.id === 'btn-clear-bypass')       { clearBypassToken();      return; }
    if (e.target.classList.contains('edit-btn') && !e.target.classList.contains('acc-btn')) {
      var ref = e.target.getAttribute('data-ref');
      if (ref) openEdit(ref);
    }
    if (e.target.classList.contains('acc-btn')) {
      var ref = e.target.getAttribute('data-ref');
      if (ref) openAccChange(ref);
    }
  });
});

var accChangeRef = null;
var accChangeData = null; // cached admin row data

function openAccChange(ref) {
  accChangeRef = ref;
  // Find row data from current table — rows are objects keyed by header name
  var rows = currentAdminData ? currentAdminData.rows : [];
  var obj = rows.find(function(r) { return r['BookingRef'] === ref; });
  if (!obj) { alert('Row data not found — try refreshing'); return; }
  accChangeData = obj;

  // Populate current info
  document.getElementById('acc-change-who').textContent = obj['Callsign'] + ' — ' + obj['Name'] + ' (' + ref + ')';
  var curType = obj['Type'] || '';
  var curRoomId = obj['RoomId'] || '';
  var curRoomCfg = CONFIG_CLIENT.ROOMS ? CONFIG_CLIENT.ROOMS.find(function(r){ return r.id === curRoomId; }) : null;
  var curDesc = curType === 'room' ? (curRoomCfg ? curRoomCfg.note_en : curRoomId) :
                curType === 'camper' ? 'Camper van spot' :
                curType === 'tent' ? 'Tent' :
                curType === 'singlebed' ? 'Single bed (organizer-assigned)' :
                curType === 'dayvisitor' ? 'Day visitor' : curType;
  document.getElementById('acc-current-desc').textContent = curDesc;
  document.getElementById('acc-current-price').textContent = M(obj['TotalPrice'] || 0);

  // Set selector to current type
  document.getElementById('acc-new-type').value = curType;
  document.getElementById('acc-save-msg').style.display = 'none';
  document.getElementById('acc-warning').style.display = 'none';
  onAccTypeChange();

  var modal = document.getElementById('acc-change-modal');
  modal.style.display = 'flex';
}

function closeAccChange() {
  document.getElementById('acc-change-modal').style.display = 'none';
  accChangeRef = null;
  accChangeData = null;
}

function onAccTypeChange() {
  var type = document.getElementById('acc-new-type').value;
  var roomPicker = document.getElementById('acc-room-picker');
  var roomSel = document.getElementById('acc-new-room-id');

  if (type === 'room') {
    roomPicker.style.display = 'block';
    // Populate room options with availability
    var avail = window._adminAvail || {};
    var bookedByType = avail.bookedByType || {};
    roomSel.innerHTML = (CONFIG_CLIENT.ROOMS || []).map(function(r) {
      var booked = bookedByType[r.id] || 0;
      var free = r.count - booked;
      var livePrice = (CONFIG_CLIENT.ROOM_PRICES && CONFIG_CLIENT.ROOM_PRICES[r.id] !== undefined) ? CONFIG_CLIENT.ROOM_PRICES[r.id] : r.price_eur;
      var pricePerPerson = Math.round(livePrice / r.persons);
      var label = r.note_en + ' — ' + M(pricePerPerson) + '/p · ' + free + '/' + r.count + ' free';
      return '<option value="' + r.id + '"' + (free <= 0 ? ' style="color:var(--muted)"' : '') + '>' + label + '</option>';
    }).join('');
    onAccRoomChange();
  } else {
    roomPicker.style.display = 'none';
    updateAccNewInfo(type, null);
  }
}

function onAccRoomChange() {
  var roomId = document.getElementById('acc-new-room-id').value;
  var roomCfg = (CONFIG_CLIENT.ROOMS || []).find(function(r){ return r.id === roomId; });
  updateAccNewInfo('room', roomCfg);
}

function updateAccNewInfo(type, roomCfg) {
  var infoEl = document.getElementById('acc-new-info');
  var descEl = document.getElementById('acc-new-desc');
  var capEl  = document.getElementById('acc-new-capacity');
  var priceEl = document.getElementById('acc-new-price');
  var diffEl  = document.getElementById('acc-price-diff');
  var warnEl  = document.getElementById('acc-warning');

  infoEl.style.display = 'block';
  warnEl.style.display = 'none';

  var newDesc = type === 'room' ? (roomCfg ? roomCfg.note_en : '') :
                type === 'camper' ? 'Camper van spot' :
                type === 'tent' ? 'Tent' :
                type === 'singlebed' ? 'Single bed (organizer-assigned)' :
                type === 'dayvisitor' ? 'Day visitor' : type;
  descEl.textContent = newDesc;

  if (type === 'room' && roomCfg) {
    var avail = window._adminAvail || {};
    var bookedByType = avail.bookedByType || {};
    var booked = bookedByType[roomCfg.id] || 0;
    var free = roomCfg.count - booked;
    capEl.textContent = 'Capacity: ' + roomCfg.persons + ' persons · ' + free + ' of ' + roomCfg.count + ' rooms free';
    capEl.style.color = free <= 0 ? 'var(--danger)' : 'var(--muted)';
    if (free <= 0) {
      warnEl.style.display = 'block';
      warnEl.textContent = '⚠️ No rooms of this type available.';
    }
    var livePrice = (CONFIG_CLIENT.ROOM_PRICES && CONFIG_CLIENT.ROOM_PRICES[roomCfg.id] !== undefined) ? CONFIG_CLIENT.ROOM_PRICES[roomCfg.id] : roomCfg.price_eur;
    var pp = Math.round(livePrice / roomCfg.persons);
    priceEl.textContent = M(pp) + '/person (room total ' + M(livePrice) + ')';
  } else {
    capEl.textContent = '';
    priceEl.textContent = '';
  }

  // Check if current booking has joiners — warn if room type might not fit
  if (accChangeData && type === 'room' && roomCfg) {
    var joiners = (currentAdminData ? currentAdminData.rows : []).filter(function(r) {
      return r['RoomRef'] === accChangeRef && r['IsPrimaryBooker'] !== 'YES' && r['BookingRef'] !== accChangeRef;
    });
    if (joiners.length > 0 && joiners.length + 1 > roomCfg.persons) {
      warnEl.style.display = 'block';
      warnEl.textContent = '⚠️ Room has ' + joiners.length + ' joiner(s) — new room type only fits ' + roomCfg.persons + ' person(s) total. Move cannot be completed.';
    } else if (joiners.length > 0) {
      warnEl.style.display = 'block';
      warnEl.textContent = 'ℹ️ This booking has ' + joiners.length + ' joiner(s) who will remain in the same room group.';
      warnEl.style.background = '#eff6ff'; warnEl.style.borderColor = '#bfdbfe'; warnEl.style.color = '#1e40af';
    }
  }

  // Price diff vs current
  var curPrice = accChangeData ? parseFloat(accChangeData['TotalPrice']) || 0 : 0;
  diffEl.textContent = '';
  diffEl.style.color = 'var(--muted)';
}

function saveAccChange() {
  if (!accChangeRef) return;
  var type = document.getElementById('acc-new-type').value;
  var roomId = type === 'room' ? document.getElementById('acc-new-room-id').value : '';
  var sendEmail = document.getElementById('acc-send-email').checked;
  var btn = document.getElementById('acc-save-btn');
  var msgEl = document.getElementById('acc-save-msg');

  btn.disabled = true; btn.textContent = 'Saving...';
  msgEl.style.display = 'none';

  rpc.run
    .withSuccessHandler(function(result) {
      btn.disabled = false; btn.textContent = 'Save change';
      if (result.success) {
        msgEl.style.display = 'block';
        msgEl.style.background = '#f0fdf4'; msgEl.style.border = '1px solid #86efac'; msgEl.style.color = '#166534';
        var emailNote = sendEmail ? ' · notification sent' : '';
        msgEl.textContent = '✓ Saved — ' + M(result.oldPrice) + ' → ' + M(result.newPrice) + emailNote;
        setTimeout(function() { closeAccChange(); loadAdmin(adminPw); }, 1500);
      } else {
        msgEl.style.display = 'block';
        msgEl.style.background = '#fef2f2'; msgEl.style.border = '1px solid #fca5a5'; msgEl.style.color = '#b91c1c';
        msgEl.textContent = '✗ ' + result.error;
      }
    })
    .withFailureHandler(function(err) {
      btn.disabled = false; btn.textContent = 'Save change';
      msgEl.style.display = 'block';
      msgEl.style.background = '#fef2f2'; msgEl.style.border = '1px solid #fca5a5'; msgEl.style.color = '#b91c1c';
      msgEl.textContent = '✗ ' + err.message;
    })
    .changeAccommodation(adminPw, accChangeRef, { newType: type, newRoomId: roomId, sendEmail: sendEmail });
}

function doLogin() {
  const pw = document.getElementById('admin-pw').value;
  if (!pw) { document.getElementById('pw-err').textContent = 'Enter password'; return; }
  document.getElementById('pw-err').textContent = 'Checking...';
  rpc.run
    .withSuccessHandler(function(ok) {
      if (ok) {
        adminPw = pw;
        // Fetch admin panel HTML from server and inject before loading data
        rpc.run
          .withSuccessHandler(function(html) {
            if (!html) { document.getElementById('pw-err').textContent = 'Panel load failed'; return; }
            document.body.innerHTML = html;
            if (PAGE_MODE === 'setup') {
              loadSettings();
              if (window.initEventSetup) window.initEventSetup();
              if (window.initCurrencies) window.initCurrencies();
              if (window.initStructure) window.initStructure();
              if (window.initRoomCatalog) window.initRoomCatalog();
              if (window.initPrivacy) window.initPrivacy();
              if (window.initTranslations) window.initTranslations();
            } else {
              loadAdmin();
            }
          })
          .withFailureHandler(function(err) {
            document.getElementById('pw-err').textContent = 'Error: ' + err.message;
          })
          .getAdminPanelHtml(pw, PAGE_MODE);
      } else {
        document.getElementById('pw-err').textContent = PAGE_MODE === 'setup' ? 'Wrong password (the setup password is required here)' : 'Wrong password';
      }
    })
    .withFailureHandler(function(err) {
      document.getElementById('pw-err').textContent = 'Error: ' + err.message;
    })
    .checkAdminPassword(pw, PAGE_MODE);
}

function loadAdmin() {
  if (PAGE_MODE === 'setup') return;
  // Set both refresh buttons to loading state
  ['header-refresh-btn','table-refresh-btn'].forEach(function(id) {
    var btn = document.getElementById(id);
    if (btn) { btn.textContent = '↺ Loading...'; btn.disabled = true; btn.style.opacity = '0.6'; }
  });

  function resetBtns() {
    ['header-refresh-btn','table-refresh-btn'].forEach(function(id) {
      var btn = document.getElementById(id);
      if (btn) { btn.textContent = '↺ Refresh'; btn.disabled = false; btn.style.opacity = ''; }
    });
  }

  rpc.run
    .withFailureHandler(function(err) {
      resetBtns();
      document.body.innerHTML += '<div style="color:red;padding:1rem">Admin load error: ' + (err.message||err) + '</div>';
    })
    .withSuccessHandler(function(result) {
      resetBtns();
      if (!result) {
        document.body.innerHTML += '<div class="err">Admin data error: server returned null.</div>';
        return;
      }
      if (!result.success) {
        document.body.innerHTML += '<div class="err">Admin data error: ' + (result.error || 'unknown error') + '</div>';
        return;
      }
      try {
        allRows = result.rows;
        allHeaders = result.headers;
        currentAdminData = { rows: result.rows, headers: result.headers };
        if (result.rooms) window.CONFIG_CLIENT = window.CONFIG_CLIENT || {};
        if (result.rooms) { window.CONFIG_CLIENT.ROOMS = result.rooms; window.CONFIG_CLIENT.ROOM_PRICES = result.roomPrices || {}; }
        if (result.bookedByType) window._adminAvail = { bookedByType: result.bookedByType };
        renderAdmin(result);
        loadSettings();
        var ts = document.getElementById('table-refresh-ts');
        var hts = document.getElementById('header-refresh-ts');
        var tsText = 'Updated ' + new Date().toLocaleTimeString();
        if (ts) ts.textContent = tsText;
        if (hts) hts.textContent = tsText;
      } catch(renderErr) {
        document.body.innerHTML += '<div class="err">renderAdmin error: ' + renderErr.message + '</div>';
      }
    })
    .getAdminData(adminPw);
}

function renderAdmin(data) {
  const rows = data.rows;
  const rooms      = rows.filter(function(r){return r.Type==='room'}).length;
  const campers    = rows.filter(function(r){return r.Type==='camper' && r.IsPrimaryBooker==='YES'}).length;
  const tents      = rows.filter(function(r){return r.Type==='tent'}).length;
  const singlebeds = rows.filter(function(r){return r.Type==='singlebed'}).length;
  const dayvisitors= rows.filter(function(r){return r.Type==='dayvisitor'}).length;
  const meals      = rows.filter(function(r){return r.FullBoard==='YES'}).length;
  const total      = rows.reduce(function(s,r){return s+(parseFloat(r.TotalPrice)||0)},0);

  // Per room-type stats
  var roomStats = [];
  (CONFIG_ADMIN.ROOMS || []).forEach(function(rc) {
    var primaries = rows.filter(function(r){ return r.Type==='room' && r.RoomId===rc.id && r.IsPrimaryBooker==='YES'; });
    var bookedRooms = primaries.length;
    var totalCap = rc.count;
    if (bookedRooms === 0 && totalCap === 0) return;
    var full = [], partial = [];
    if (rc.persons > 1) {
      primaries.forEach(function(p) {
        var joiners = rows.filter(function(r){ return r.RoomRef===p.BookingRef && r.IsPrimaryBooker!=='YES'; }).length;
        var occupants = 1 + joiners;
        if (occupants >= rc.persons) full.push(p.BookingRef);
        else partial.push({ref: p.BookingRef, occupants: occupants, cap: rc.persons});
      });
    }
    var detail = bookedRooms + ' / ' + totalCap;
    var sub = '';
    if (rc.persons > 1 && bookedRooms > 0) {
      var parts = [];
      if (full.length)    parts.push('<span style="color:var(--danger)">' + full.length + ' full</span>');
      if (partial.length) parts.push('<span style="color:#b45309">' + partial.length + ' open</span>');
      if (parts.length) sub = '<div style="font-size:0.75rem;margin-top:0.2rem;line-height:1.4">' + parts.join(' · ') + '</div>';
      if (partial.length) {
        sub += '<div style="font-size:0.72rem;color:var(--muted);margin-top:0.15rem">' +
          partial.map(function(p){ return p.ref+' ('+p.occupants+'/'+p.cap+')'; }).join(', ') +
          '</div>';
      }
    }
    roomStats.push({id: rc.id, label: rc.note_en, detail: detail, sub: sub});
  });

  var statsHtml = [
    {l:'Total bookings', v:rows.length},
  ].map(function(s){
    return '<div class="stat"><div class="label">'+s.l+'</div><div class="value">'+s.v+'</div></div>';
  }).join('');

  // Room type breakdown
  statsHtml += roomStats.map(function(s){
    return '<div class="stat"><div class="label" style="font-size:0.75rem">'+s.label+'</div><div class="value" style="font-size:1rem">'+s.detail+'</div>'+s.sub+'</div>';
  }).join('');

  statsHtml += [
    {l:'Single beds',       v:singlebeds},
    {l:'Camper van',        v:campers+' / '+CONFIG_ADMIN.CAMPER_VAN_SPOTS},
    {l:'Tent spots',        v:tents+' / '+CONFIG_ADMIN.TENT_SPOTS},
    {l:'Day visitors',      v:dayvisitors},
    {l:'Meal packages',     v:meals},
  ].concat((CONFIG_ADMIN.STRUCTURE.extraNights || []).map(function(x){
    return {l:'Extra night: '+x.label, v:rows.filter(function(r){return (r.ExtraNights||'').split(',').indexOf(x.key)>=0 && r.Status!=='CANCELLED';}).length};
  })).concat([
    {l:'Revenue (est.)',    v:M(total)},
  ]).map(function(s){
    return '<div class="stat"><div class="label">'+s.l+'</div><div class="value">'+s.v+'</div></div>';
  }).join('');

  document.getElementById('stats').innerHTML = statsHtml;

  const showCols = ['_guest','Email','Country','_room','Nights','ExtraNights','FullBoard','VisitorDays','Dietary','FreeText','TotalPrice','_status','OrgComment'].filter(function(h){ return h !== 'Nights' || CONFIG_ADMIN.STRUCTURE.accommodation === 'per_night'; });

  // Sort state
  if (!window._adminSort) window._adminSort = { col: null, dir: 1 };

  function buildHead() {
    var s = window._adminSort;
    var typeArrow = s.col === '_type' ? (s.dir === 1 ? ' ▲' : ' ▼') : ' <span style="opacity:0.25">⇅</span>';
    document.getElementById('table-head').innerHTML =
      '<th style="cursor:default"></th>' +
      '<th style="cursor:pointer;user-select:none;white-space:nowrap" data-sortcol="_type" title="Sort by type">Type' + typeArrow + '</th>' +
      showCols.map(function(h) {
        var label = h === '_guest'       ? 'Callsign / Name / Ref'
                  : h === '_room'        ? 'Room / №'
                  : h === '_status'      ? 'Status'
                  : h === 'Nights'       ? 'Nights'
                  : h === 'ExtraNights'  ? 'Extra nights'
                  : h === 'FullBoard'    ? 'FB'
                  : h === 'VisitorDays'  ? 'Days'
                  : h;
        var sortable = h[0] !== '_';
        if (!sortable) return '<th style="white-space:nowrap">' + label + '</th>';
        var arrow = s.col === h ? (s.dir === 1 ? ' ▲' : ' ▼') : ' <span style="opacity:0.25">⇅</span>';
        return '<th style="cursor:pointer;user-select:none;white-space:nowrap" data-sortcol="'+h+'">' + label + arrow + '</th>';
      }).join('');
    // Attach click handlers after innerHTML set
    document.getElementById('table-head').querySelectorAll('th[data-sortcol]').forEach(function(th) {
      th.addEventListener('click', function(){ adminSort(th.getAttribute('data-sortcol')); });
    });
  }

  window.adminSort = function(col) {
    var s = window._adminSort;
    if (s.col === col) { s.dir *= -1; } else { s.col = col; s.dir = 1; }
    buildHead();
    renderAdminRows(rows, showCols);
    document.getElementById('sort-reset-btn').style.opacity = '1';
    document.getElementById('sort-reset-btn').style.pointerEvents = 'auto';
  };

  window.adminResetSort = function() {
    window._adminSort = { col: null, dir: 1 };
    buildHead();
    renderAdminRows(rows, showCols);
    document.getElementById('sort-reset-btn').style.opacity = '0.35';
    document.getElementById('sort-reset-btn').style.pointerEvents = 'none';
  };

  // Hide clear-sort button initially (no sort active)
  var resetBtn = document.getElementById('sort-reset-btn');
  if (resetBtn) { resetBtn.style.opacity = '0.35'; resetBtn.style.pointerEvents = 'none'; }

  buildHead();

  function statusClass(s) {
    if (s==='CANCELLED') return 'status-cancelled';
    if (s==='NEEDS_ATTENTION') return 'status-attention';
    return '';
  }

  function renderRow(r, role) {
    const ref = r['BookingRef'] || '';
    const sc = statusClass(r['Status']);
    const staffBadge = r['IsOrganizer'] === 'YES' ? ' <span class="tag" style="background:rgba(124,58,237,0.15);color:#7c3aed;font-weight:700">👷 STAFF</span>' : '';
    let roleCell = '';
    if (role === 'primary' && r['Type'] === 'camper')
      roleCell = '<td><span style="font-size:1.1rem">🚐</span> <span class="tag tag-camper">PRIMARY</span>' + staffBadge + '</td>';
    else if (role === 'child' && r['Type'] === 'camper')
      roleCell = '<td style="padding-left:0.75rem"><span style="font-size:1rem;color:var(--muted)">↳</span> <span class="tag tag-camper">JOINER</span>' + staffBadge + '</td>';
    else if (role === 'primary')
      roleCell = '<td><span style="font-size:1.1rem">🏠</span> <span class="tag primary">PRIMARY BOOKER</span>' + staffBadge + '</td>';
    else if (role === 'child')
      roleCell = '<td style="padding-left:0.75rem"><span style="font-size:1rem;color:var(--muted)">↳</span> <span class="tag joiner">JOINER</span>' + staffBadge + '</td>';
    else if (r['Type'] === 'room')
      roleCell = '<td><span style="font-size:1.1rem">🏨</span> <span class="tag primary">HOTEL</span>' + staffBadge + '</td>';
    else if (r['Type'] === 'camper')
      roleCell = '<td><span style="font-size:1.1rem">🚐</span> <span class="tag tag-camper">CAMPER</span>' + staffBadge + '</td>';
    else if (r['Type'] === 'tent')
      roleCell = '<td><span style="font-size:1.1rem">⛺</span> <span class="tag tent">TENT</span>' + staffBadge + '</td>';
    else if (r['Type'] === 'dayvisitor')
      roleCell = '<td><span style="font-size:1.1rem">🎫</span> <span class="tag dayvisitor">DAY VISITOR</span>' + staffBadge + '</td>';
    else if (r['Type'] === 'singlebed')
      roleCell = '<td><span style="font-size:1.1rem">🛏️</span> <span class="tag joiner">SINGLE BED</span>' + staffBadge + '</td>';
    else
      roleCell = '<td>' + staffBadge + '</td>';
    return '<tr id="row-'+ref+'" class="'+sc+'"><td style="white-space:nowrap;text-align:center;padding:0.25rem 0.3rem"><button class="edit-btn" data-ref="'+ref+'" title="Edit booking" style="display:block;margin:0 auto 2px auto">\u270F\uFE0F</button><button class="edit-btn acc-btn" data-ref="'+ref+'" title="Change accommodation" style="display:block;margin:0 auto">\uD83D\uDECF\uFE0F</button></td>' + roleCell + showCols.map(function(h) {
      if (h === '_guest') {
        var cs = r['Callsign'] || '';
        var nm = r['Name'] || '';
        var bref = r['BookingRef'] || '';
        return '<td><span style="font-weight:700;font-family:var(--mono)">' + cs + '</span><br><span style="font-size:0.8rem;color:var(--muted)">' + nm + '</span><br><span style="font-size:0.72rem;color:var(--muted);font-family:var(--mono)">' + bref + '</span></td>';
      }
      if (h === '_room') {
        var rid = r['RoomId'] || '';
        if (r['SoloRoom'] === 'YES') rid += ' <span class="tag solo">SOLO</span>';
        var rnum = r['RoomNumber'] || '';
        var rnumHtml = '<span class="org-field room-num" data-ref="'+ref+'">' + (rnum || '<em style="opacity:0.4">&mdash;</em>') + '</span>';
        return '<td>' + rid + (rid ? '<br>' : '') + '<span style="font-size:0.8rem;color:var(--muted)">' + rnumHtml + '</span></td>';
      }
      if (h === '_status') {
        var st = r['Status'] || '';
        var pc = r['PublishConsent'] === 'YES'
          ? '<span style="color:var(--success);font-weight:600;font-size:0.78rem">\u2713 pub</span>'
          : '<span style="color:var(--danger);font-weight:600;font-size:0.78rem">\u2717 pub</span>';
        return '<td><span class="tag status-'+st+'" style="display:block;margin-bottom:2px">'+st+'</span>' + pc + '</td>';
      }
      let v = r[h] !== undefined ? r[h] : '';
      if (h==='FullBoard') v = v==='YES' ? '✓' : '';
      if (h==='Nights') v = (v||'').split(',').filter(Boolean).map(function(k){ var d=(CONFIG_ADMIN.STRUCTURE.days||[]).find(function(y){return y.key===k;}); return d ? d.short : k; }).join(' + ');
      if (h==='ExtraNights') v = (v||'').split(',').filter(Boolean).map(function(k){ var x=(CONFIG_ADMIN.STRUCTURE.extraNights||[]).find(function(y){return y.key===k;}); return x ? x.label : k; }).join(', ');
      if (h==='VisitorDays') v = (v||'').split(',').filter(Boolean).map(function(k){ var d=(CONFIG_ADMIN.STRUCTURE.days||[]).find(function(y){return y.key===k;}); return d ? d.short : k; }).join(' + ');
      if (h==='OrgComment') v = '<span class="org-field org-comment" data-ref="'+ref+'">' + (v || '<em style="opacity:0.4">&mdash;</em>') + '</span>';
      return '<td>'+v+'</td>';
    }).join('') + '</tr>';
  }

  window.renderAdminRows = function(rows, showCols) {
    var s = window._adminSort;
    var html = '';

    // Helper: render a primary room booking with its joiners beneath
    function renderGroup(primary) {
      var h = renderRow(primary, 'primary');
      rows.filter(function(r){
        return r.RoomRef === primary.BookingRef && r.IsPrimaryBooker !== 'YES';
      }).forEach(function(child){ h += renderRow(child, 'child'); });
      return h;
    }

    if (!s.col) {
      // Default grouped view
      var primaries = rows.filter(function(r){ return r.Type==='room' && r.IsPrimaryBooker==='YES'; });
      primaries.forEach(function(p){ html += renderGroup(p); });
      rows.filter(function(r){
        return r.Type==='room' && r.IsPrimaryBooker!=='YES' &&
               !primaries.find(function(p){ return p.BookingRef===r.RoomRef; });
      }).forEach(function(r){ html += renderRow(r, 'orphan'); });
      // Camper primaries with joiners beneath
      var camperPrimaries = rows.filter(function(r){ return r.Type==='camper' && r.IsPrimaryBooker==='YES'; });
      camperPrimaries.forEach(function(p){ html += renderGroup(p); });
      // Orphan camper joiners (primary not found)
      rows.filter(function(r){
        return r.Type==='camper' && r.IsPrimaryBooker!=='YES' &&
               !camperPrimaries.find(function(p){ return p.BookingRef===r.RoomRef; });
      }).forEach(function(r){ html += renderRow(r, 'orphan'); });
      ['singlebed','tent','dayvisitor'].forEach(function(t){
        rows.filter(function(r){ return r.Type===t; })
            .forEach(function(r){ html += renderRow(r, 'other'); });
      });

    } else if (s.col === '_type') {
      // Two-level type sort: groups ordered by type, joiners stay under their primary
      var typeOrder = s.dir === 1
        ? ['room','singlebed','camper','tent','dayvisitor']
        : ['dayvisitor','tent','camper','singlebed','room'];
      typeOrder.forEach(function(t) {
        if (t === 'room') {
          var primaries = rows.filter(function(r){ return r.Type==='room' && r.IsPrimaryBooker==='YES'; });
          primaries.forEach(function(p){ html += renderGroup(p); });
          rows.filter(function(r){
            return r.Type==='room' && r.IsPrimaryBooker!=='YES' &&
                   !primaries.find(function(p){ return p.BookingRef===r.RoomRef; });
          }).forEach(function(r){ html += renderRow(r, 'orphan'); });
        } else if (t === 'camper') {
          var camperPrimaries = rows.filter(function(r){ return r.Type==='camper' && r.IsPrimaryBooker==='YES'; });
          camperPrimaries.forEach(function(p){ html += renderGroup(p); });
          rows.filter(function(r){
            return r.Type==='camper' && r.IsPrimaryBooker!=='YES' &&
                   !camperPrimaries.find(function(p){ return p.BookingRef===r.RoomRef; });
          }).forEach(function(r){ html += renderRow(r, 'orphan'); });
        } else {
          rows.filter(function(r){ return r.Type===t; })
              .forEach(function(r){ html += renderRow(r, 'other'); });
        }
      });

    } else {
      // Sorted flat view by field
      var sorted = rows.slice().sort(function(a, b) {
        var av = (a[s.col] || '').toString().toLowerCase();
        var bv = (b[s.col] || '').toString().toLowerCase();
        if (s.col === 'TotalPrice') {
          av = parseFloat(a[s.col]) || 0;
          bv = parseFloat(b[s.col]) || 0;
          return (av - bv) * s.dir;
        }
        if (av < bv) return -1 * s.dir;
        if (av > bv) return  1 * s.dir;
        return 0;
      });
      sorted.forEach(function(r) {
        var role = (r.Type === 'room' || r.Type === 'camper')
          ? (r.IsPrimaryBooker === 'YES' ? 'primary' : 'child')
          : 'other';
        html += renderRow(r, role);
      });
    }
    document.getElementById('table-body').innerHTML = html;
  };

  renderAdminRows(rows, showCols);
}

function openEdit(ref) {
  const row = allRows.find(function(r){ return r['BookingRef'] === ref; });
  if (!row) return;
  const modal = document.getElementById('edit-modal');
  document.getElementById('edit-ref').textContent = ref;
  document.getElementById('edit-callsign').value  = row.Callsign  || '';
  document.getElementById('edit-name').value      = row.Name      || '';
  document.getElementById('edit-email').value     = row.Email     || '';
  document.getElementById('edit-phone').value     = row.Phone     || '';
  document.getElementById('edit-country').value   = row.Country   || '';
  document.getElementById('edit-dietary').value      = row.Dietary    || '';
  document.getElementById('edit-status').value       = row.Status     || 'CONFIRMED';
  document.getElementById('edit-fullboard').checked  = row.FullBoard  === 'YES';
  document.querySelectorAll('input[name="edit-xn"]').forEach(function(cb){ cb.checked = (row.ExtraNights||'').split(',').indexOf(cb.value) >= 0; });
  var ntSel = (row.Nights||'').split(',').filter(Boolean);
  document.querySelectorAll('input[name="edit-nt"]').forEach(function(cb){ cb.checked = ntSel.length === 0 || ntSel.indexOf(cb.value) >= 0; });
  document.getElementById('edit-nights-row').style.display = (CONFIG_ADMIN.STRUCTURE.accommodation === 'per_night' && (row.Type === 'room' || row.Type === 'singlebed')) ? '' : 'none';
  document.getElementById('edit-soloroom').checked   = row.SoloRoom   === 'YES';
  document.getElementById('edit-publish').checked    = row.PublishConsent === 'YES';
  document.querySelectorAll('input[name="edit-vd"]').forEach(function(cb){ cb.checked = (row.VisitorDays||'').split(',').indexOf(cb.value) >= 0; });
  document.getElementById('edit-dayvisitor-days-row').style.display = row.Type === 'dayvisitor' ? '' : 'none';
  document.getElementById('edit-isorganizer').checked = row.IsOrganizer === 'YES';
  document.getElementById('edit-roomnum').value      = row.RoomNumber || '';
  document.getElementById('edit-freetext').value     = row.FreeText   || '';
  document.getElementById('edit-orgcomment').value   = row.OrgComment || '';
  modal.style.display = 'flex';
  modal._ref = ref;

  // Role change section — only for room/singlebed
  var type = row.Type || '';
  var isPrimary = row.IsPrimaryBooker === 'YES';
  var roleSection = document.getElementById('role-change-section');
  var j2p = document.getElementById('role-joiner-to-primary');
  var p2j = document.getElementById('role-primary-to-joiner');
  document.getElementById('role-change-result').style.display = 'none';

  if (type === 'room' || type === 'singlebed') {
    roleSection.style.display = 'block';
    j2p.style.display = isPrimary ? 'none' : 'block';
    p2j.style.display = isPrimary ? 'block' : 'none';

    if (!isPrimary) {
      // Populate free rooms for joiner→primary
      var avail = window._adminAvail || {};
      var roomSel = document.getElementById('role-room-select');
      roomSel.innerHTML = '<option value="">— select room —</option>';
      (CONFIG_ADMIN.ROOMS || []).forEach(function(r) {
        var a = avail.rooms ? avail.rooms[r.id] : null;
        var free = a ? (a.total - a.booked) : 0;
        if (free > 0) {
          var opt = document.createElement('option');
          opt.value = r.id;
          opt.textContent = r.note_en + ' — ' + free + ' free';
          roomSel.appendChild(opt);
        }
      });
    } else {
      // Populate rooms with space for primary→joiner
      var targetSel = document.getElementById('role-target-room-select');
      targetSel.innerHTML = '<option value="">— select room —</option>';
      allRows.forEach(function(r) {
        if (r.IsPrimaryBooker !== 'YES') return;
        if (r.BookingRef === ref) return;
        if (r.Status === 'CANCELLED') return;
        var roomCfg = (CONFIG_ADMIN.ROOMS || []).find(function(rc){ return rc.id === r.RoomId; });
        if (!roomCfg) return;
        var occupants = allRows.filter(function(x){
          return (x.BookingRef === r.BookingRef || x.RoomRef === r.BookingRef) && x.Status !== 'CANCELLED';
        }).length;
        var free = roomCfg.persons - occupants;
        if (free > 0) {
          var opt = document.createElement('option');
          opt.value = r.BookingRef;
          opt.textContent = r.BookingRef + ' (' + (r.Callsign||'?') + ') — ' + roomCfg.note_en + ' — ' + free + ' spot(s) free';
          targetSel.appendChild(opt);
        }
      });

      // Warn about existing joiners
      var joinerCount = allRows.filter(function(r){
        return r.RoomRef === ref && r.IsPrimaryBooker !== 'YES' && r.Status !== 'CANCELLED';
      }).length;
      var warn = document.getElementById('role-joiner-warning');
      if (joinerCount > 0) {
        warn.style.display = 'block';
        warn.textContent = '⚠️ This room has ' + joinerCount + ' joiner(s). They will be flagged as NEEDS_ATTENTION if you proceed.';
      } else {
        warn.style.display = 'none';
      }
    }
  } else {
    roleSection.style.display = 'none';
  }
}

function closeEdit() {
  document.getElementById('edit-modal').style.display = 'none';
}

function saveEdit() {
  const ref = document.getElementById('edit-modal')._ref;
  const fields = {
    Callsign:      document.getElementById('edit-callsign').value.trim().toUpperCase(),
    Name:          document.getElementById('edit-name').value.trim(),
    Email:         document.getElementById('edit-email').value.trim(),
    Phone:         document.getElementById('edit-phone').value.trim(),
    Country:       document.getElementById('edit-country').value.trim(),
    Dietary:       document.getElementById('edit-dietary').value.trim(),
    Status:        document.getElementById('edit-status').value,
    FullBoard:     document.getElementById('edit-fullboard').checked ? 'YES' : 'NO',
    Nights:        Array.prototype.map.call(document.querySelectorAll('input[name="edit-nt"]:checked'), function(c){return c.value;}).join(','),
    ExtraNights:   Array.prototype.map.call(document.querySelectorAll('input[name="edit-xn"]:checked'), function(c){return c.value;}).join(','),
    SoloRoom:      document.getElementById('edit-soloroom').checked  ? 'YES' : 'NO',
    PublishConsent: document.getElementById('edit-publish').checked   ? 'YES' : 'NO',
    VisitorDays:   Array.prototype.map.call(document.querySelectorAll('input[name="edit-vd"]:checked'), function(c){return c.value;}).join(','),
    IsOrganizer:   document.getElementById('edit-isorganizer').checked ? 'YES' : 'NO',
    RoomNumber:    document.getElementById('edit-roomnum').value.trim(),
    FreeText:      document.getElementById('edit-freetext').value.trim(),
    OrgComment:    document.getElementById('edit-orgcomment').value.trim(),
  };
  const saveBtn = document.getElementById('edit-save-btn');
  saveBtn.disabled = true;
  saveBtn.textContent = 'Saving...';
  rpc.run
    .withSuccessHandler(function(result) {
      saveBtn.disabled = false;
      saveBtn.textContent = 'Save';
      if (result.success) {
        if (result.cascadedCount > 0) {
          alert('Saved. Primary booker cancelled — ' + result.cascadedCount + ' roommate(s) flagged as NEEDS_ATTENTION and notified by email.');
        }
        closeEdit();
        loadAdmin();
      } else {
        alert('Error: ' + result.error);
      }
    })
    .withFailureHandler(function(e) {
      saveBtn.disabled = false;
      saveBtn.textContent = 'Save';
      alert('Error: ' + e.message);
    })
    .updateBooking(adminPw, ref, fields, document.getElementById('edit-send-email').checked);
}

function gid(id) { return document.getElementById(id) || { style: {}, dataset: {} }; }
function loadSettings() {
  rpc.run
    .withSuccessHandler(function(result) {
      if (!result || !result.success) return;
      const s = result.settings;
      gid('s-reg-open').checked     = s.REGISTRATION_OPEN;
      gid('s-reg-closes').value     = s.REGISTRATION_CLOSES || '';
      // Show warning if deadline has passed
      if (document.getElementById('s-reg-open')) checkRegDeadlineWarning();
      gid('s-solo-double').checked = s.ALLOW_SOLO_DOUBLE;
      gid('s-single-bed').checked  = s.ALLOW_SINGLE_BED_BOOKING;
      gid('s-tent-enabled').checked = s.TENT_ENABLED !== false;
      gid('s-announcement').value    = s.ANNOUNCEMENT    || '';
      gid('s-camper-info').value      = s.CAMPER_INFO      || '';
      gid('s-tent-info').value        = s.TENT_INFO        || '';
      gid('s-closed-message').value   = s.CLOSED_MESSAGE   || '';
      gid('s-bypass-token').value     = s.BYPASS_TOKEN     || '';
      if (document.getElementById('s-bypass-token')) updateBypassLinkDisplay();
      gid('s-price-disclaimer').value = s.PRICE_DISCLAIMER || '';
      // Pricing fields
      gid('s-fullboard-price').value = s.FULL_BOARD_PRICE || '';
      gid('s-camper-price').value    = s.CAMPER_VAN_PRICE_PER_NIGHT || '';
      gid('s-tent-price').value      = s.TENT_PRICE_WEEKEND || '';
      gid('s-singlebed-price').value = s.SINGLE_BED_PRICE || '';
      gid('s-singlebed-slots').value = s.SINGLE_BED_SLOTS !== undefined ? s.SINGLE_BED_SLOTS : 0;
      gid('s-meeting-fee-weekend').value = s.MEETING_FEE_WEEKEND || '';
      gid('s-meeting-fee-day').value = s.MEETING_FEE_DAY || '';
      renderRoomPricesGrid(s.ROOM_PRICES || {});
      renderRoomCountsGrid(s.ROOM_COUNTS || {});
      var camperEl = gid('rc-camper');
      var tentEl = gid('rc-tent');
      if (camperEl) camperEl.value = s.CAMPER_VAN_SPOTS !== undefined ? s.CAMPER_VAN_SPOTS : '';
      if (tentEl)   tentEl.value   = s.TENT_SPOTS       !== undefined ? s.TENT_SPOTS       : '';
    })
    .withFailureHandler(function(e) { console.error('loadSettings:', e.message); })
    .getAdminSettings(adminPw);
}

function renderRoomPricesGrid(prices) {
  var grid = document.getElementById('room-prices-grid');
  if (!grid) return;
  grid.innerHTML = '';
  roomDefs().forEach(function(r) {
    var val = prices[r.id] !== undefined ? prices[r.id] : '';
    var item = document.createElement('div');
    item.className = 'setting-item';
    item.innerHTML =
      '<div class="setting-label" style="flex:1">Room price: ' + r.label +
      '</div>' +
      '<input type="number" class="setting-input" id="rp-' + r.id + '" ' +
        'value="' + val + '" min="0" placeholder="default" style="width:90px;text-align:center">';
    grid.appendChild(item);
  });
}

function savePricing() {
  var msg = document.getElementById('pricing-msg');
  msg.textContent = 'Saving...';
  msg.style.color = 'var(--muted)';
  var roomPrices = {};
  roomDefs().forEach(function(r) {
    var el = document.getElementById('rp-' + r.id);
    if (el && el.value.trim() !== '') roomPrices[r.id] = el.value.trim();
  });
  var settings = {
    FULL_BOARD_PRICE:           document.getElementById('s-fullboard-price').value.trim(),
    CAMPER_VAN_PRICE_PER_NIGHT: document.getElementById('s-camper-price').value.trim(),
    TENT_PRICE_WEEKEND:         document.getElementById('s-tent-price').value.trim(),
    SINGLE_BED_PRICE:           document.getElementById('s-singlebed-price').value.trim(),
    SINGLE_BED_SLOTS:           document.getElementById('s-singlebed-slots').value.trim(),
    MEETING_FEE_WEEKEND:        document.getElementById('s-meeting-fee-weekend').value.trim(),
    MEETING_FEE_DAY:            document.getElementById('s-meeting-fee-day').value.trim(),
    ROOM_PRICES:                roomPrices,
  };
  rpc.run
    .withSuccessHandler(function(result) {
      if (result && result.success) {
        msg.textContent = '\u2713 Saved';
        msg.style.color = 'var(--success)';
        setTimeout(function(){ msg.textContent = ''; }, 3000);
      } else {
        msg.textContent = 'Error: ' + (result ? result.error : 'unknown');
        msg.style.color = 'var(--danger)';
      }
    })
    .withFailureHandler(function(e) {
      msg.textContent = 'Error: ' + e.message;
      msg.style.color = 'var(--danger)';
    })
    .saveAdminSettings(adminPw, settings);
}

function roomDefs() {
  return (CONFIG_ADMIN.ROOMS || []).map(function(r) {
    return { id: r.id, label: r.note_en + ' (' + r.id + ')', default: r.count };
  });
}

function renderRoomCountsGrid(counts) {
  var grid = document.getElementById('room-counts-grid');
  if (!grid) return;
  grid.innerHTML = '';
  roomDefs().forEach(function(r) {
    var val = counts[r.id] !== undefined ? counts[r.id] : r.default;
    var item = document.createElement('div');
    item.className = 'setting-item';
    item.innerHTML =
      '<div class="setting-label" style="flex:1">' + r.label + '</div>' +
      '<input type="number" class="setting-input" id="rc-' + r.id + '" ' +
        'value="' + val + '" min="0" max="99" style="width:70px;text-align:center">';
    grid.appendChild(item);
  });
}

function saveRoomCounts() {
  var counts = {};
  roomDefs().forEach(function(r) {
    var el = document.getElementById('rc-' + r.id);
    if (el) counts[r.id] = el.value.trim();
  });
  var camperEl = document.getElementById('rc-camper');
  var tentEl = document.getElementById('rc-tent');
  var msg = document.getElementById('room-counts-msg');
  msg.textContent = 'Saving...';
  msg.style.color = 'var(--muted)';
  rpc.run
    .withSuccessHandler(function(result) {
      if (result && result.success) {
        msg.textContent = '\u2713 Saved';
        msg.style.color = 'var(--success)';
        setTimeout(function(){ msg.textContent = ''; }, 3000);
        loadAdmin();
      } else {
        msg.textContent = 'Error: ' + (result ? result.error : 'unknown');
        msg.style.color = 'var(--danger)';
      }
    })
    .withFailureHandler(function(e) {
      msg.textContent = 'Error: ' + e.message;
      msg.style.color = 'var(--danger)';
    })
    .saveAdminSettings(adminPw, {
      ROOM_COUNTS: counts,
      CAMPER_VAN_SPOTS: camperEl ? camperEl.value.trim() : '',
      TENT_SPOTS: tentEl ? tentEl.value.trim() : '',
    });
}

function saveSettings() {
  var regOpen = document.getElementById('s-reg-open').checked;
  if (regOpen && isDeadlinePassed()) {
    if (!confirm('Registration deadline has passed! You are opening registration after the set deadline. Remember to close it when done. Continue?')) return;
  }
  const settings = {
    REGISTRATION_OPEN:        regOpen,
    REGISTRATION_CLOSES:      document.getElementById('s-reg-closes').value.trim(),
    ALLOW_SOLO_DOUBLE:        document.getElementById('s-solo-double').checked,
    ALLOW_SINGLE_BED_BOOKING: document.getElementById('s-single-bed').checked,
    TENT_ENABLED:             document.getElementById('s-tent-enabled').checked,
    ANNOUNCEMENT:             document.getElementById('s-announcement').value,
    CLOSED_MESSAGE:           document.getElementById('s-closed-message').value,
    BYPASS_TOKEN:             document.getElementById('s-bypass-token').value.trim(),
    CAMPER_INFO:              document.getElementById('s-camper-info').value,
    TENT_INFO:                document.getElementById('s-tent-info').value,
    PRICE_DISCLAIMER:         document.getElementById('s-price-disclaimer').value,
  };
  const msg = document.getElementById('settings-msg');
  msg.textContent = 'Saving...';
  msg.style.color = 'var(--muted)';
  rpc.run
    .withSuccessHandler(function(result) {
      if (result && result.success) {
        msg.textContent = '\u2713 Saved';
        msg.style.color = 'var(--success)';
        setTimeout(function(){ msg.textContent = ''; }, 3000);
      } else {
        msg.textContent = 'Error: ' + (result ? result.error : 'unknown');
        msg.style.color = 'var(--danger)';
      }
    })
    .withFailureHandler(function(e) {
      msg.textContent = 'Error: ' + e.message;
      msg.style.color = 'var(--danger)';
    })
    .saveAdminSettings(adminPw, settings);
}

function exportCSV() {
  if (!allRows.length) return;
  const cols = Object.keys(allRows[0]);
  const lines = [cols.join(',')].concat(allRows.map(function(r){
    return cols.map(function(c){ return '"'+(r[c]||'').toString().replace(/"/g,'""')+'"'; }).join(',');
  }));
  const blob = new Blob([lines.join(String.fromCharCode(10))], {type:'text/csv'});
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = '${CONFIG.SLUG}_bookings.csv';
  a.click();
}
<\/script>
</body>
</html>`;
}

module.exports = { buildBookingPage, buildPublicPage, buildAdminPage, getAdminPanelHtml, getSetupPanelHtml };
