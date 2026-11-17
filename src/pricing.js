'use strict';
const { CONFIG } = require('./config');
const S = require('./structure');
const i18n = require('./i18n');

// Pure function: pass in the current settings.
// - A solo-occupied room (soloRoom) is charged the whole room price.
// - Each selected extra night costs (room price / nights included in the room price), shared by the room's persons.
// - Day visitors pay the day fee per selected day, or the full-period fee when they select every day.
// lang: language of the breakdown lines (default: the event's default language)
function calculatePrice(data, s, lang) {
  lang = lang || i18n.defaultLang();
  const t = (k, v) => i18n.t(lang, k, v);
  const LS = i18n.localizedStructure(lang);
  const LR = i18n.localizedRooms(lang);
  const dayShort = k => (LS.days.find(d => d.key === k) || {}).short || k;
  const extraOf = k => LS.extraNights.find(x => x.key === k) || S.extraByKey(k);
  let total = 0;
  const lines = [];
  const st = CONFIG.STRUCTURE;
  const extras = S.pickExtras(data.extraNights);
  const nights = Math.max(1, st.coreNights);
  // Per-night mode: the guest pays for the selected core nights only (empty selection = all nights)
  const picked = S.mode() === 'per_night' ? S.pickNights(data.nights) : [];
  const stay = picked.length ? picked.length : nights;
  const partial = stay !== nights;
  const meetingFee = () => {
    total += s.MEETING_FEE_WEEKEND;
    lines.push(t('price.meetingFull', { n: s.MEETING_FEE_WEEKEND }));
  };
  const packageLine = () => {
    if (data.fullBoard && st.package.enabled) { total += s.FULL_BOARD_PRICE; lines.push(t('price.meal', { n: s.FULL_BOARD_PRICE })); }
  };
  const extraLines = (nightPrice, persons, solo) => {
    extras.forEach(k => {
      const x = extraOf(k);
      const pp = solo || persons <= 1 ? nightPrice : Math.round(nightPrice / persons);
      total += pp;
      lines.push(t('price.extra', { label: x.label + (x.includes ? ' (' + x.includes + ')' : ''), pp, per: solo || persons <= 1 ? '' : t('price.perPerson'), room: nightPrice }));
    });
  };

  if (data.type === 'room') {
    const roomCfg = LR.find(r => r.id === data.roomId);
    if (roomCfg) {
      const roomPrice = s.ROOM_PRICES[roomCfg.id] !== undefined ? s.ROOM_PRICES[roomCfg.id] : roomCfg.price_eur;
      const solo = !!data.soloRoom;
      const stayPrice = partial ? Math.round(roomPrice * stay / nights) : roomPrice;
      const nightsNote = partial ? t('price.nightsNote', { stay, all: nights }) : '';
      const pricePerPerson = solo ? stayPrice : Math.round(stayPrice / roomCfg.persons);
      total += pricePerPerson;
      lines.push(solo
        ? t('price.roomSolo', { desc: roomCfg.note_en, notes: nightsNote, n: pricePerPerson })
        : t('price.room', { desc: roomCfg.note_en, notes: nightsNote, n: pricePerPerson, total: stayPrice }));
      extraLines(Math.round(roomPrice / nights), roomCfg.persons, solo);
    }
  } else if (data.type === 'camper') {
    if (!data.joinExisting) {
      const camperTotal = s.CAMPER_VAN_PRICE_PER_NIGHT * nights;
      total += camperTotal;
      lines.push(t('price.camper', { nights, n: camperTotal }));
    } else {
      lines.push(t('price.camperShared'));
    }
    meetingFee(); packageLine();
  } else if (data.type === 'tent') {
    total += s.TENT_PRICE_WEEKEND;
    lines.push(t('price.tent', { n: s.TENT_PRICE_WEEKEND }));
    meetingFee(); packageLine();
  } else if (data.type === 'singlebed') {
    const bedPrice = partial ? Math.round(s.SINGLE_BED_PRICE * stay / nights) : s.SINGLE_BED_PRICE;
    total += bedPrice;
    lines.push(t('price.singleBed', { notes: partial ? t('price.nightsNote', { stay, all: nights }) : '', n: bedPrice }));
    extraLines(Math.round(s.SINGLE_BED_PRICE / nights), 1, false);
  } else if (data.type === 'dayvisitor') {
    const days = S.pickDays(data.visitorDays);
    if (days.length && days.length === st.days.length && days.length > 1) {
      total += s.MEETING_FEE_WEEKEND;
      lines.push(t('price.meetingAll', { n: s.MEETING_FEE_WEEKEND }));
    } else {
      days.forEach(k => { total += s.MEETING_FEE_DAY; lines.push(t('price.meetingDay', { day: dayShort(k), n: s.MEETING_FEE_DAY })); });
    }
    packageLine();
  }

  if (data.type === 'room' || data.type === 'singlebed') {
    packageLine();
    meetingFee();
  }

  return { total, breakdown: lines.join(' | ') };
}

module.exports = { calculatePrice };
