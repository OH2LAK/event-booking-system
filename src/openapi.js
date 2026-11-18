'use strict';
// OpenAPI 3.0 description of the public API. Served at /api/v1/openapi.json; `npm run openapi` writes docs/openapi.json.
const { CONFIG } = require('./config');

const ref = n => ({ $ref: '#/components/schemas/' + n });
const json = schema => ({ 'application/json': { schema } });
const errorResp = d => ({ description: d, content: json(ref('Error')) });
const str = (description, extra) => Object.assign({ type: 'string', description }, extra || {});
const bool = description => ({ type: 'boolean', description });
const int = description => ({ type: 'integer', description });

const TYPES = ['room', 'camper', 'tent', 'singlebed', 'dayvisitor', 'vendor'];
const STATUSES = ['CONFIRMED', 'CHECKED_IN', 'NEEDS_ATTENTION', 'CANCELLED'];
const PAY = ['UNPAID', 'PAID', 'WAIVED'];

function schemas() {
  const extraItem = { type: 'object', properties: { id: str('Extra or vendor space id'), qty: int('Quantity (for a vendor space priced per metre: the number of metres)'), note: str('Vendor spaces: the answer to the space question, e.g. what will be sold or shown') }, required: ['id', 'qty'] };
  return {
    Error: { type: 'object', properties: { error: { type: 'object', properties: { code: str('Stable error code'), message: str('Human readable explanation') } } } },
    Booking: {
      type: 'object',
      properties: {
        ref: str('Booking reference, e.g. OH2ABC-7'), createdAt: str('ISO time', { format: 'date-time' }),
        callsign: str(), name: str(), email: str(), phone: str(), country: str(),
        type: { type: 'string', enum: TYPES }, roomId: str('Room type id'), roomRef: str('Reference of the primary booking of the room or spot'),
        isPrimary: bool('Primary booker of the room/spot'), soloRoom: bool('Booked a shared room alone'),
        extraNights: { type: 'array', items: { type: 'string' } }, nights: { type: 'array', items: { type: 'string' }, description: 'Per-night mode: the core nights booked (empty = all)' },
        visitorDays: { type: 'array', items: { type: 'string' } }, fullBoard: bool('Meal package'), dietary: str(), shirtSize: str(),
        totalPrice: { type: 'number' }, currency: str('ISO currency code'), priceBreakdown: str(),
        status: { type: 'string', enum: STATUSES }, paymentStatus: { type: 'string', enum: PAY }, paidAt: { type: 'string', format: 'date-time', nullable: true },
        roomNumber: str(), orgComment: str(), publishConsent: bool('Callsign and first name may be shown on the public list'), isOrganizer: bool(), freeText: str(), language: str(),
        extras: { type: 'array', items: { type: 'object', properties: { id: str(), name: str(), qty: int(), unitPrice: { type: 'number' }, note: str('Vendor spaces: what the booker will sell or show') } } },
        tickets: { type: 'array', items: { type: 'string' }, description: 'Names that get an entry ticket besides the contact person (vendor bookings)' },
      },
    },
    NewBooking: {
      type: 'object', required: ['callsign', 'name', 'email', 'type', 'privacyAck'],
      properties: {
        callsign: str('3-20 characters: letters, digits, / and -. Optional for type vendor (a handle is generated)'), name: str(), email: str(), phone: str(), country: str(),
        type: { type: 'string', enum: TYPES, description: 'Only the types of the switched-on event modules are accepted (see modules in GET /event). A vendor booking has no accommodation and needs at least one vendor space in extras.' },
        roomId: str('Room type id (type room, new room)'), joinExisting: bool('Join an existing room or camper (needs roomRef)'), roomRef: str('Booking reference to join'),
        soloDouble: bool('Use a shared room alone'), extraNights: { type: 'array', items: { type: 'string' } }, nights: { type: 'array', items: { type: 'string' } },
        visitorDays: { type: 'array', items: { type: 'string' }, description: 'Day visitors: day keys (see GET /event)' },
        fullBoard: bool('Meal package'), dietary: str(), shirtSize: str(), freeText: str(), publishConsent: bool('Default false'),
        extras: { type: 'array', items: extraItem, description: 'Optional extras and vendor spaces (see GET /extras, vendor spaces have kind vendor)' },
        tickets: { type: 'array', items: { type: 'string' }, description: 'Names that get an entry ticket besides the contact person (max 20; used when the booking has a vendor space)' },
        language: str('Language of the confirmation email'), displayCurrency: str('Indicative extra currency'),
        privacyAck: bool('Must be true: confirms the guest has accepted the privacy notice'),
        paymentStatus: { type: 'string', enum: PAY, description: 'Set PAID if the payment was already collected' },
        sendNotifications: bool('false = no emails or SMS from this system (default true)'),
        bypassToken: str('Registration bypass token, if registration is closed'),
      },
    },
    BookingChanges: {
      type: 'object', description: 'Only the fields that are sent are changed. Changes are not subject to capacity checks (the same as in the admin panel); prices are recalculated.',
      properties: {
        callsign: str(), name: str(), email: str(), phone: str(), country: str(), type: { type: 'string', enum: TYPES }, roomId: str(), roomRef: str(), isPrimary: bool(),
        extraNights: { type: 'array', items: { type: 'string' } }, nights: { type: 'array', items: { type: 'string' } }, visitorDays: { type: 'array', items: { type: 'string' } },
        fullBoard: bool(), dietary: str(), status: { type: 'string', enum: STATUSES }, roomNumber: str(), orgComment: str(), publishConsent: bool(), soloRoom: bool(),
        freeText: str(), isOrganizer: bool(), paymentStatus: { type: 'string', enum: PAY }, extras: { type: 'array', items: extraItem },
        sendEmail: bool('Send the guest an update email (default false)'),
      },
    },
    BookingList: { type: 'object', properties: { data: { type: 'array', items: ref('Booking') }, count: int(), nextAfter: { type: 'integer', nullable: true, description: 'Pass as ?after= to get the next page' } } },
    Extra: { type: 'object', properties: { id: str(), name: str(), description: str(), price: { type: 'number' }, maxPerBooking: int(), capacity: { type: 'integer', nullable: true }, taken: int(), left: { type: 'integer', nullable: true }, signUpCloses: { type: 'string', nullable: true }, enabled: bool(), closed: bool(), kind: { type: 'string', enum: ['extra', 'vendor'] },
      vendorSpace: { type: 'object', nullable: true, description: 'Details of a vendor space (kind vendor)', properties: { spaceType: str('table, trunk, booth or other'), day: str('Day key, null = all days'), starts: str(), ends: str(), size: str(), power: str(), location: str(), pricing: str('item, metre or day'), unit: str('Unit label'), unitPrice: { type: 'number', description: 'Price per quantity unit as charged (per-day pricing multiplied by the event days)' }, question: str('Question the booker answers'), questionRequired: bool() } } } },
    Anything: { type: 'object', additionalProperties: true },
  };
}

const filters = [
  ['status', STATUSES], ['type', TYPES], ['paymentStatus', PAY],
].map(([n, e]) => ({ name: n, in: 'query', schema: { type: 'string', enum: e } })).concat([
  { name: 'roomId', in: 'query', schema: { type: 'string' } }, { name: 'callsign', in: 'query', schema: { type: 'string' } },
  { name: 'email', in: 'query', schema: { type: 'string' } }, { name: 'country', in: 'query', schema: { type: 'string' } },
  { name: 'q', in: 'query', description: 'Search callsign, name or reference', schema: { type: 'string' } },
  { name: 'createdSince', in: 'query', description: 'ISO date or time', schema: { type: 'string' } },
  { name: 'activeOnly', in: 'query', description: 'true = leave out cancelled bookings', schema: { type: 'boolean' } },
]);
const refParam = { name: 'ref', in: 'path', required: true, schema: { type: 'string' }, description: 'Booking reference' };
const fmtParam = { name: 'fmt', in: 'path', required: true, schema: { type: 'string', enum: ['csv', 'json'] } };
const std = { 401: errorResp('Missing, invalid, expired or revoked key'), 403: errorResp('API off or the key lacks the permission'), 429: errorResp('Rate limit') };
const op = (summary, scope, extra) => Object.assign({ summary, security: [{ bearer: [] }], 'x-required-scope': scope, responses: Object.assign({}, std) }, extra);

function build() {
  const ok = (d, schema) => ({ 200: { description: d, content: json(schema || ref('Anything')) } });
  const paths = {
    '/ping': { get: op('Check the key', 'any', { responses: Object.assign(ok('The key works'), std) }) },
    '/event': { get: op('Event details and structure', 'stats', { responses: Object.assign(ok('Event'), std) }) },
    '/availability': { get: op('Open capacity and whether registration is open', 'stats', { responses: Object.assign(ok('Availability'), std) }) },
    '/stats': { get: op('Counts and sums: bookings, payments, extras, accommodation', 'stats', { responses: Object.assign(ok('Statistics'), std) }) },
    '/extras': { get: op('Extras catalog with how many are taken', 'stats', { responses: Object.assign(ok('Extras', { type: 'object', properties: { data: { type: 'array', items: ref('Extra') } } }), std) }) },
    '/bookings': {
      get: op('List bookings (oldest first, paged)', 'bookings:read', {
        parameters: filters.concat([{ name: 'limit', in: 'query', schema: { type: 'integer', minimum: 1, maximum: 200, default: 50 } }, { name: 'after', in: 'query', description: 'nextAfter of the previous page', schema: { type: 'integer' } }]),
        responses: Object.assign(ok('Bookings', ref('BookingList')), std),
      }),
      post: op('Create a booking', 'bookings:write', {
        description: 'Applies the same rules as the booking form: pricing, capacity, registration window, extras. Send an Idempotency-Key header so a retry never creates a second booking.',
        parameters: [{ name: 'Idempotency-Key', in: 'header', schema: { type: 'string' }, description: 'Unique per booking attempt; a retry with the same key and body returns the first answer' }],
        requestBody: { required: true, content: json(ref('NewBooking')) },
        responses: Object.assign({ 201: { description: 'Created', content: json(ref('Booking')) }, 400: errorResp('Not a JSON object'), 409: errorResp('Not available (full, callsign already booked ...)'), 422: errorResp('Invalid input') }, std),
      }),
    },
    '/bookings/{ref}': {
      get: op('Get one booking', 'bookings:read', { parameters: [refParam], responses: Object.assign(ok('Booking', ref('Booking')), { 404: errorResp('Not found') }, std) }),
      patch: op('Change a booking', 'bookings:write', { parameters: [refParam], requestBody: { required: true, content: json(ref('BookingChanges')) }, responses: Object.assign(ok('Updated booking', ref('Booking')), { 404: errorResp('Not found'), 422: errorResp('Invalid input') }, std) }),
      delete: op('Cancel a booking', 'bookings:write', { description: 'Sets the status to CANCELLED. The booking stays in the list and its capacity is freed. Erasing personal data is done by the organizer.', parameters: [refParam, { name: 'sendEmail', in: 'query', schema: { type: 'boolean' } }], responses: Object.assign(ok('Cancelled booking', ref('Booking')), { 404: errorResp('Not found') }, std) }),
    },
    '/export/bookings.{fmt}': { get: op('Export all bookings (same filters as the list, no paging)', 'bookings:read', { parameters: [fmtParam].concat(filters), responses: Object.assign({ 200: { description: 'CSV (UTF-8 with BOM, opens in Excel) or JSON', content: { 'text/csv': { schema: { type: 'string' } }, 'application/json': { schema: ref('Anything') } } } }, std) }) },
    '/export/extras.{fmt}': { get: op('Totals per extra (active bookings)', 'stats', { parameters: [fmtParam], responses: Object.assign({ 200: { description: 'CSV or JSON', content: { 'text/csv': { schema: { type: 'string' } }, 'application/json': { schema: ref('Anything') } } } }, std) }) },
    '/export/accommodation.{fmt}': { get: op('Room inventory and occupancy per room type and night', 'stats', { parameters: [fmtParam], responses: Object.assign({ 200: { description: 'CSV or JSON', content: { 'text/csv': { schema: { type: 'string' } }, 'application/json': { schema: ref('Anything') } } } }, std) }) },
  };
  return {
    openapi: '3.0.3',
    info: {
      title: CONFIG.EVENT_SHORT + ' booking API', version: '1.0.0',
      description: 'Read counts and bookings, export data and create or change bookings from other systems. Authenticate with "Authorization: Bearer <api key>". Keys and their permissions are created by the organizer on the setup page; the API must be switched on in Event setup. '
        + 'Webhooks (signed notifications) are described in docs/API.md.',
    },
    servers: [{ url: CONFIG.FRIENDLY_URL.replace(/\/+$/, '') + '/api/v1' }],
    components: { securitySchemes: { bearer: { type: 'http', scheme: 'bearer', description: 'API key (ebk_...)' } }, schemas: schemas() },
    paths,
  };
}

module.exports = { build };
