'use strict';
const { CONFIG } = require('./config');

// Pure function: pass in the current settings. Ported from calculatePrice().
// Fix vs. the Apps Script version: a solo-occupied room (soloRoom) is charged the whole
// room price, matching what the booking page shows the guest.
function calculatePrice(data, s) {
  let total = 0;
  const lines = [];

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
      if (data.thuExtraNight) {
        const thuRoomPrice = Math.round(roomPrice / 2);
        const thuPP = solo ? thuRoomPrice : Math.round(thuRoomPrice / roomCfg.persons);
        total += thuPP;
        lines.push(`Thu extra night (incl. Fri breakfast): €${thuPP}${solo ? '' : '/person'} (room night €${thuRoomPrice})`);
      }
    }
  } else if (data.type === 'camper') {
    if (!data.joinExisting) {
      const camperTotal = s.CAMPER_VAN_PRICE_PER_NIGHT * CONFIG.CAMPING_NIGHTS;
      total += camperTotal;
      lines.push(`Camper van spot (${CONFIG.CAMPING_NIGHTS} nights, incl. electricity): €${camperTotal}`);
    } else {
      lines.push('Camper van spot: shared with primary booker (costs split separately)');
    }
    total += s.MEETING_FEE_WEEKEND;
    lines.push(`Meeting fee (full weekend): €${s.MEETING_FEE_WEEKEND}`);
    if (data.fullBoard) { total += s.FULL_BOARD_PRICE; lines.push(`Full board meal package: €${s.FULL_BOARD_PRICE}`); }
  } else if (data.type === 'tent') {
    total += s.TENT_PRICE_WEEKEND;
    lines.push(`Tent spot (weekend): €${s.TENT_PRICE_WEEKEND}`);
    total += s.MEETING_FEE_WEEKEND;
    lines.push(`Meeting fee (full weekend): €${s.MEETING_FEE_WEEKEND}`);
    if (data.fullBoard) { total += s.FULL_BOARD_PRICE; lines.push(`Full board meal package: €${s.FULL_BOARD_PRICE}`); }
  } else if (data.type === 'singlebed') {
    total += s.SINGLE_BED_PRICE;
    lines.push(`Single bed (organizer-assigned room): €${s.SINGLE_BED_PRICE}`);
    if (data.thuExtraNight) {
      const thuPrice = Math.round(s.SINGLE_BED_PRICE / 2);
      total += thuPrice;
      lines.push(`Thu extra night (incl. Fri breakfast): €${thuPrice}`);
    }
  } else if (data.type === 'dayvisitor') {
    if (data.dayVisitorDays === 'both') {
      total += s.MEETING_FEE_WEEKEND;
      lines.push(`Meeting fee (Fri + Sat): €${s.MEETING_FEE_WEEKEND}`);
    } else {
      const dayLabel = data.dayVisitorDays === 'fri' ? 'Friday' : 'Saturday';
      total += s.MEETING_FEE_DAY;
      lines.push(`Meeting fee (${dayLabel}): €${s.MEETING_FEE_DAY}`);
    }
    if (data.fullBoard) { total += s.FULL_BOARD_PRICE; lines.push(`Full board meal package: €${s.FULL_BOARD_PRICE}`); }
  }

  if (data.type === 'room' || data.type === 'singlebed') {
    if (data.fullBoard) { total += s.FULL_BOARD_PRICE; lines.push(`Full board meal package: €${s.FULL_BOARD_PRICE}`); }
    total += s.MEETING_FEE_WEEKEND;
    lines.push(`Meeting fee (full weekend): €${s.MEETING_FEE_WEEKEND}`);
  }

  return { total, breakdown: lines.join(' | ') };
}

module.exports = { calculatePrice };
