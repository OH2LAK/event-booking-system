'use strict';
// Event modules: which parts of the booking offer are switched on. A profile is only a preset of
// these switches (the admin panel applies it); every switch stays editable, so hybrids work.
// EVENT_MODE ('overnight' | 'day') is derived from the modules and kept for backward compatibility.
const { CONFIG } = require('./config');

const NAMES = ['ROOMS', 'CAMPING', 'DAYVISITOR', 'VENDORS'];
const PROFILES = {
  overnight: { label: 'Overnight event', modules: { ROOMS: 'yes', CAMPING: 'yes', DAYVISITOR: 'yes', VENDORS: 'no' } },
  day: { label: 'One-day event', modules: { ROOMS: 'no', CAMPING: 'no', DAYVISITOR: 'yes', VENDORS: 'no' } },
  hamfest: { label: 'Hamfest / fair', modules: { ROOMS: 'no', CAMPING: 'no', DAYVISITOR: 'yes', VENDORS: 'yes' } },
  custom: { label: 'Custom', modules: null },
};

const on = name => CONFIG['MOD_' + name] === 'yes';
const flags = () => ({ rooms: on('ROOMS'), camping: on('CAMPING'), dayvisitor: on('DAYVISITOR'), vendors: on('VENDORS') });
// 'overnight' when guests can book a place to sleep, otherwise 'day'
const modeOf = f => ((f.ROOMS === 'yes' || f.CAMPING === 'yes') ? 'overnight' : 'day');
const accommodation = () => on('ROOMS') || on('CAMPING');

// Which booking types the enabled modules allow. Single beds fill rooms, so they need the rooms module.
function typeAllowed(type) {
  if (type === 'room' || type === 'singlebed') return on('ROOMS');
  if (type === 'camper' || type === 'tent') return on('CAMPING');
  if (type === 'dayvisitor') return on('DAYVISITOR');
  if (type === 'vendor') return on('VENDORS');
  return false;
}

// Modules for a stored/legacy config that only has EVENT_MODE.
function fromLegacyMode(mode) {
  return Object.assign({}, PROFILES[mode === 'day' ? 'day' : 'overnight'].modules);
}

module.exports = { NAMES, PROFILES, on, flags, modeOf, accommodation, typeAllowed, fromLegacyMode };
