'use strict';
const { CONFIG } = require('./config');
const S = require('./structure');

// Pure function: pass in the current settings. Ported from calculatePrice(), generalized to the event structure.
// - A solo-occupied room (soloRoom) is charged the whole room price.
// - Each selected extra night costs (room price / nights included in the room price), shared by the room's persons.
// - Day visitors pay the day fee per selected day, or the full-period fee when they select every day.
function calculatePrice(data, s) {
  let total = 0;
  const lines = [];
  const st = CONFIG.STRUCTURE;
  const extras = S.pickExtras(data.extraNights);
  const nights = Math.max(1, st.coreNights);
  const meetingFee = () => {
    total += s.MEETING_FEE_WEEKEND;
    lines.push(`Meeting fee (full event): €${s.MEETING_FEE_WEEKEND}`);
  };
  const packageLine = () => {
    if (data.fullBoard && st.package.enabled) { total += s.FULL_BOARD_PRICE; lines.push(`Meal package: €${s.FULL_BOARD_PRICE}`); }
  };
  const extraLines = (nightPrice, persons, solo) => {
    extras.forEach(k => {
      const x = S.extraByKey(k);
      const pp = solo || persons <= 1 ? nightPrice : Math.round(nightPrice / persons);
      total += pp;
      lines.push(`Extra night: ${x.label}${x.includes ? ' (' + x.includes + ')' : ''}: €${pp}${solo || persons <= 1 ? '' : '/person'} (room night €${nightPrice})`);
    });
  };

  if (data.type === 'room') {
    const roomCfg = CONFIG.ROOMS.find(r => r.id === data.roomId);
    if (roomCfg) {
      const roomPrice = s.ROOM_PRICES[roomCfg.id] !== undefined ? s.ROOM_PRICES[roomCfg.id] : roomCfg.price_eur;
      const solo = !!data.soloRoom;
      const pricePerPerson = solo ? roomPrice : Math.round(roomPrice / roomCfg.persons);
      total += pricePerPerson;
      lines.push(solo
        ? `Room (${roomCfg.note_en}, solo): €${pricePerPerson}`
        : `Room (${roomCfg.note_en}): €${pricePerPerson}/person (room total €${roomPrice})`);
      extraLines(Math.round(roomPrice / nights), roomCfg.persons, solo);
    }
  } else if (data.type === 'camper') {
    if (!data.joinExisting) {
      const camperTotal = s.CAMPER_VAN_PRICE_PER_NIGHT * nights;
      total += camperTotal;
      lines.push(`Camper van spot (${nights} nights, incl. electricity): €${camperTotal}`);
    } else {
      lines.push('Camper van spot: shared with primary booker (costs split separately)');
    }
    meetingFee(); packageLine();
  } else if (data.type === 'tent') {
    total += s.TENT_PRICE_WEEKEND;
    lines.push(`Tent spot (whole event): €${s.TENT_PRICE_WEEKEND}`);
    meetingFee(); packageLine();
  } else if (data.type === 'singlebed') {
    total += s.SINGLE_BED_PRICE;
    lines.push(`Single bed (organizer-assigned room): €${s.SINGLE_BED_PRICE}`);
    extraLines(Math.round(s.SINGLE_BED_PRICE / nights), 1, false);
  } else if (data.type === 'dayvisitor') {
    const days = S.pickDays(data.visitorDays);
    if (days.length && days.length === st.days.length && days.length > 1) {
      total += s.MEETING_FEE_WEEKEND;
      lines.push(`Meeting fee (all days): €${s.MEETING_FEE_WEEKEND}`);
    } else {
      days.forEach(k => { total += s.MEETING_FEE_DAY; lines.push(`Meeting fee (${S.dayByKey(k).short}): €${s.MEETING_FEE_DAY}`); });
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
