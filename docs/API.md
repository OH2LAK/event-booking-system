# API and webhooks

Other systems can read counts and bookings, export data, and create, change or cancel bookings through a REST API, and can be told
about changes with signed webhooks. The same description is available to tools as OpenAPI: `GET /api/v1/openapi.json` (a copy is in
[`openapi.json`](openapi.json); import it into Postman, Insomnia or a code generator).

Everything below uses `https://your-event.example.com` as the address of the booking site.

## 1. Switch it on and create a key

1. **Event setup** (`/?setup=1`) → group **Integrations** → *API for other systems* = **On**. It is off by default, and on hosted instances too.
2. Further down the setup page, the **API and webhooks** card: *Create a key*. Give it a name (the system that will use it), choose the
   permissions it needs, and optionally a validity in days.
3. Copy the key now. It looks like `ebk_…` and is **shown only once**; the server keeps just a hash. If it is lost, revoke it and create a new one.

| Permission | Allows |
| --- | --- |
| `stats` | Counts, availability, extras, event details and the extras and accommodation exports. **No personal data.** |
| `bookings:read` | Everything in `stats`, plus listing, reading and exporting bookings (names, email addresses, phone numbers ...). |
| `bookings:write` | Creating, changing and cancelling bookings. It does not allow reading other people's bookings. |

Give every system its own key with only the permissions it needs, and revoke keys that are no longer used. The list shows when each key was last used and how many requests it made. Changes made with a key (and refused attempts) are written to the event log.

## 2. Making requests

Send the key as a bearer token. Bodies are JSON (`Content-Type: application/json`), and so are all answers except CSV exports.

```bash
export BASE=https://your-event.example.com/api/v1
export KEY=ebk_xxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx

curl -H "Authorization: Bearer $KEY" $BASE/ping
curl -H "Authorization: Bearer $KEY" $BASE/stats
```

**Errors** always look like this, with an HTTP status that says what kind of problem it is:

```json
{ "error": { "code": "exists", "message": "A booking for OH2ABC already exists." } }
```

| Status | Meaning |
| --- | --- |
| 400 | The request is malformed (`invalid_json`, `invalid_body`, `unknown_field`, `invalid_parameter`, `no_changes`). |
| 401 | Missing, wrong, expired or revoked key (`invalid_key`). |
| 403 | The API is off (`api_disabled`), the key lacks the permission (`insufficient_scope`), or registration is closed (`registration_closed`). |
| 404 | No such booking or path (`not_found`). |
| 409 | Not possible right now: the callsign already has a booking (`exists`), a room type, camper or tent spots, single beds or an extra is full (`noRooms`, `noRoomsNight`, `roomFullRef`, `noCamper`, `noTent`, `noSingle`, `addonFull`), or `idempotency_conflict`, `request_in_progress`. |
| 422 | The input is not acceptable (for example `privacy`, `email`, `type`, `idempotency_mismatch`). The message explains it. |
| 429 | Too many requests: 300 per minute per key by default (`API_RATE_PER_MINUTE` in `.env`), or too many failed key attempts from one address. |

The error `message` of a refused booking is in the language of the request's `language` field (the event's default if not given), the same text a guest would see.

## 3. Reading data

### Without personal data (`stats`)

| Request | Answer |
| --- | --- |
| `GET /ping` | `{ ok, event, key, scopes, time }`: the key works (any permission). |
| `GET /event` | Name, dates, currency, languages, event mode (`overnight` or `day`), the event `profile` and the `modules` switches (`rooms`, `camping`, `dayvisitor`, `vendors`), days and nights of the event structure, meal package. |
| `GET /availability` | Whether registration is open, free rooms per type (and per night), camper/tent/single-bed spots left, extras with capacity left. |
| `GET /stats` | Bookings by status, type and country; payments (expected, paid, outstanding); extras taken; room inventory and occupancy. |
| `GET /extras` | The extras catalog: price, capacity, how many are taken and left, deadline. Vendor spaces are in the same list with `kind: "vendor"` and a `vendorSpace` object (type, day, times, size, power, location, pricing, unit, unit price, the question to the booker). |

```bash
curl -H "Authorization: Bearer $KEY" $BASE/availability
```

### Bookings (`bookings:read`)

`GET /bookings` lists bookings, oldest first, 50 per page (`limit` up to 200). Filters, all optional and combinable:
`status`, `type`, `paymentStatus`, `roomId`, `callsign`, `email`, `country`, `q` (search callsign, name or reference),
`createdSince` (ISO date or time), `activeOnly=true` (leave out cancelled).

```bash
curl -H "Authorization: Bearer $KEY" "$BASE/bookings?paymentStatus=UNPAID&activeOnly=true&limit=100"
# the answer has "nextAfter": 118 when there is more; continue with:
curl -H "Authorization: Bearer $KEY" "$BASE/bookings?paymentStatus=UNPAID&activeOnly=true&limit=100&after=118"
```

`GET /bookings/{ref}` returns one booking. A booking looks like this:

```json
{
  "ref": "OH2ABC-7", "createdAt": "2027-03-01T09:12:44.000Z",
  "callsign": "OH2ABC", "name": "Matti Meikäläinen", "email": "matti@example.com", "phone": "", "country": "FI",
  "type": "room", "roomId": "2S-W", "roomRef": "OH2ABC-7", "isPrimary": true, "soloRoom": false,
  "extraNights": [], "nights": [], "visitorDays": [],
  "fullBoard": true, "dietary": "", "shirtSize": "L",
  "totalPrice": 183, "currency": "EUR", "priceBreakdown": "…",
  "status": "CONFIRMED", "paymentStatus": "UNPAID", "paidAt": null,
  "roomNumber": "", "orgComment": "", "publishConsent": true, "isOrganizer": false, "freeText": "", "language": "fi",
  "extras": [ { "id": "dinner", "name": "Saturday dinner", "qty": 2, "unitPrice": 25, "note": "" } ],
  "tickets": []
}
```

`type` is `room`, `camper`, `tent`, `singlebed`, `dayvisitor` or `vendor`; `status` is `CONFIRMED`, `CHECKED_IN`, `NEEDS_ATTENTION` or `CANCELLED`; `paymentStatus` is `UNPAID`, `PAID` or `WAIVED`.

## 4. Exports

One call, the whole result, no paging. Add `.csv` or `.json`. CSV is UTF-8 with a byte-order mark, so Excel opens it correctly; cells that would be run as formulas are neutralised.

| Request | Permission | Content |
| --- | --- | --- |
| `GET /export/bookings.csv` / `.json` | `bookings:read` | All bookings (cancelled too, unless `activeOnly=true`); the same filters as the list. Extras are one column (`dinner x2`). |
| `GET /export/extras.csv` / `.json` | `stats` | Per extra: quantity, number of bookings, revenue (active bookings). |
| `GET /export/accommodation.csv` / `.json` | `stats` | Per room type: rooms, rooms booked, beds, beds used, price, and booked rooms per night; camper, tent and single-bed spots. |

```bash
curl -H "Authorization: Bearer $KEY" -o bookings.csv "$BASE/export/bookings.csv?activeOnly=true"
```

## 5. Creating bookings (`bookings:write`)

`POST /bookings` applies **exactly the rules of the booking form**: registration window, availability, per-night rooms, extras with capacity and deadlines, pricing, the one-booking-per-callsign rule. The answer is `201` with the booking, including its calculated price. By default the guest gets the same confirmation email (and SMS, if enabled) and the organizer gets a notification.

```bash
curl -X POST $BASE/bookings \
  -H "Authorization: Bearer $KEY" -H "Content-Type: application/json" \
  -H "Idempotency-Key: shop-order-1001" \
  -d '{
    "callsign": "OH2ABC", "name": "Matti Meikäläinen", "email": "matti@example.com", "country": "FI",
    "type": "room", "roomId": "2S-W", "fullBoard": true,
    "extras": [ { "id": "dinner", "qty": 2 } ],
    "language": "fi", "publishConsent": true, "privacyAck": true
  }'
```

| Field | |
| --- | --- |
| `callsign`, `name`, `email`, `type`, `privacyAck` | Required (`callsign` is optional for `type: "vendor"`: a vendor-only booking without accommodation, which needs at least one vendor space in `extras`). Only the booking types of the switched-on event modules are accepted.  `privacyAck: true` states that the guest has accepted the privacy notice (`/privacy`); **the calling system is responsible for showing it**. |
| `phone`, `country`, `dietary`, `shirtSize`, `freeText` | Optional text. |
| `roomId` | Room type id (`type: "room"`). Ids are in `GET /availability`. |
| `joinExisting`, `roomRef` | Join an existing room or camper van booking by its reference. |
| `soloDouble` | Use a multi-person room alone (if the organizer allows it). |
| `extraNights`, `nights`, `visitorDays` | Lists of keys from `GET /event` (extra nights, per-night mode nights, days for day visitors). |
| `fullBoard` | The meal package. |
| `extras` | `[ { "id": "dinner", "qty": 2 } ]`, see `GET /extras`. Vendor spaces use the same list and take a `note` (the answer to the space's question, required when the space says so); with per-metre pricing `qty` is the number of metres. |
| `tickets` | `["Name One", "Name Two"]`: names that get an entry ticket besides the contact person (max 20). Kept only when the booking has a vendor space. |
| `publishConsent` | May the callsign and first name appear on the public "Who's coming?" list. **Defaults to `false`.** |
| `language` | Language of the confirmation email (a code enabled for the event). |
| `paymentStatus` | `PAID` if the payment was already collected elsewhere, `WAIVED`, or `UNPAID`. Default: `UNPAID` (or `WAIVED` when the price is 0). |
| `sendNotifications` | `false` = this system sends no email or SMS for this booking. Default `true`. |
| `displayCurrency`, `bypassToken` | As in the form. |

A one-day event only accepts `type: "dayvisitor"`.

**Idempotency.** Always send an `Idempotency-Key` (any unique string up to 100 characters, for example your order number). If a request times out and you send it again with the same key and body, you get the first answer back (header `Idempotent-Replayed: true`) and no second booking. The same key with a different body is refused with 422. Keys are remembered for 24 hours; failed requests are not remembered and can simply be retried.

## 6. Changing and cancelling (`bookings:write`)

`PATCH /bookings/{ref}` changes only the fields that are sent. Changeable: `callsign`, `name`, `email`, `phone`, `country`, `type`, `roomId`, `roomRef`, `isPrimary`, `extraNights`, `nights`, `visitorDays`, `fullBoard`, `dietary`, `status`, `roomNumber`, `orgComment`, `publishConsent`, `soloRoom`, `freeText`, `isOrganizer`, `paymentStatus`, `extras`, `tickets`. Anything else is refused. Prices are recalculated when something that affects the price changes. Like in the admin panel, a change is **not** checked against capacity: the caller decides. `"sendEmail": true` also sends the guest an update email (default: no).

```bash
# mark as paid
curl -X PATCH $BASE/bookings/OH2ABC-7 -H "Authorization: Bearer $KEY" -H "Content-Type: application/json" \
  -d '{ "paymentStatus": "PAID" }'
# change the extras
curl -X PATCH $BASE/bookings/OH2ABC-7 -H "Authorization: Bearer $KEY" -H "Content-Type: application/json" \
  -d '{ "extras": [ { "id": "dinner", "qty": 1 } ] }'
```

`DELETE /bookings/{ref}` **cancels** the booking: its status becomes `CANCELLED`, the capacity is free again and the callsign can book again. It stays in lists. Cancelling twice is harmless. Add `?sendEmail=true` to notify the guest. The API cannot erase personal data; the organizer does that in the booking admin (data protection).

## 7. Webhooks

A webhook is a message the booking system sends to your address when something happens, so your system does not have to keep asking. Create them in the **API and webhooks** card (setup page): name, address, which events, and whether to send the full booking or no personal data. The signing secret (`whsec_…`) is shown once.

| Event | When |
| --- | --- |
| `booking.created` | A booking was made (booking form or API). |
| `booking.updated` | Something was changed (booking admin or API). A change that only marks the booking paid or cancelled sends `booking.paid` / `booking.cancelled` instead. |
| `booking.cancelled` | The status became `CANCELLED`. |
| `booking.paid` | The payment status became `PAID`. |
| `booking.erased` | A booking's personal data was erased. Contains only the reference: **delete your copy.** |

There is also `webhook.test`, sent by the *Send test* button.

```json
{
  "id": "0b6a9e2e-6d3f-4c0e-9d36-3b9a3a1f0a55",
  "type": "booking.paid",
  "createdAt": "2027-03-02T10:00:03.120Z",
  "event": { "name": "Example Meet", "url": "https://your-event.example.com" },
  "data": { "booking": { "ref": "OH2ABC-7", "…": "same fields as GET /bookings/{ref}" }, "changed": ["paymentStatus"] }
}
```

With *no personal data* `data.booking` has only `ref`, `type`, `status`, `paymentStatus`, `totalPrice` and `currency`; fetch details with the API if you are allowed to. `data.changed` lists the changed fields (not for `booking.created`). For `booking.erased`, `data` is `{ "ref": "…" }`.

**Verifying the signature.** Every request has these headers:

```
X-Webhook-Id: <delivery id, the same as "id" in the body>
X-Webhook-Event: booking.paid
X-Webhook-Timestamp: 1772445603
X-Webhook-Signature: t=1772445603,v1=<hex>
```

`v1` is `HMAC-SHA256(secret, "<timestamp>.<raw request body>")` as lowercase hex. Check it against the **raw body bytes**, compare in constant time, and reject timestamps older than a few minutes. Node.js:

```js
const crypto = require('crypto');
function valid(rawBody, header, secret) {
  const m = /^t=(\d+),v1=([0-9a-f]{64})$/.exec(header || '');
  if (!m || Math.abs(Date.now() / 1000 - Number(m[1])) > 300) return false;
  const expected = crypto.createHmac('sha256', secret).update(m[1] + '.' + rawBody).digest('hex');
  return crypto.timingSafeEqual(Buffer.from(expected), Buffer.from(m[2]));
}
```

Python:

```python
import hmac, hashlib, re, time
def valid(raw_body: bytes, header: str, secret: str) -> bool:
    m = re.fullmatch(r"t=(\d+),v1=([0-9a-f]{64})", header or "")
    if not m or abs(time.time() - int(m[1])) > 300:
        return False
    expected = hmac.new(secret.encode(), m[1].encode() + b"." + raw_body, hashlib.sha256).hexdigest()
    return hmac.compare_digest(expected, m[2])
```

**Delivery.** Answer with any `2xx` within 8 seconds. Anything else (or no answer) is retried after 1 minute, 5 minutes, 30 minutes, 2 hours and 6 hours, then given up (about nine hours in total), so a short outage loses nothing. A delivery can arrive more than once and in a different order than the events happened: use the `id` to ignore repeats, and `GET /bookings/{ref}` when you need the current state. Redirects are not followed. The delivery log in the card shows status and errors. *New secret* replaces the secret (update the receiver first or accept a short gap).

**Security rules for addresses.** Webhook addresses must start with `https://` and must not point to private or internal networks (so a webhook cannot be used to reach other services). Private installations that really need a receiver on their own network can set `API_WEBHOOK_ALLOW_PRIVATE=1` in `.env`; this also allows `http://`.

## 8. Privacy

* Ticket names of vendor bookings are personal data of third parties supplied by the booker; they are part of the booking (`tickets`) and are erased with it.
* Only keys with `bookings:read` (or `bookings:write` for what they send and change) see personal data. Use `stats` where counts are enough.
* Webhooks with *full booking data* send personal data to the address you entered: only use receivers you are allowed to give it to, and record them in your privacy documentation. Queued messages hold personal data until delivered; the stored copy is removed after a successful delivery (failed ones after 7 days).
* When a booking is erased, queued messages about it are deleted and `booking.erased` is sent so other systems can delete their copy.
* **Event shutdown** (setup page) revokes all API keys, switches all webhooks off and deletes the delivery queue, together with the bookings.

## 9. Hosted events

On events hosted by Finskas Networks the API is **off** until the organizer switches it on in Event setup, and works like on a self-hosted installation. Use the event's own address (`https://<name>.hamradio-events.com` or its own domain) as the base address.

## 10. Examples

**Daily payment list for accounting** (CSV of unpaid bookings, for example from a cron job):

```bash
curl -s -H "Authorization: Bearer $KEY" "$BASE/export/bookings.csv?paymentStatus=UNPAID&activeOnly=true" -o unpaid.csv
```

**Show free places on your club's web page:**

```bash
curl -s -H "Authorization: Bearer $STATS_KEY" $BASE/availability | jq '.rooms[] | {name, free}'
```

**Mark bookings paid when the bank payment arrives** (for example from a payment script, keyed by the booking reference in the payment message):

```bash
curl -X PATCH $BASE/bookings/$REF -H "Authorization: Bearer $KEY" -H "Content-Type: application/json" -d '{"paymentStatus":"PAID"}'
```

## Notes for developers

* Code: `src/api.js` (routes), `src/apiModel.js` (data shapes, exports), `src/apiKeys.js` (keys), `src/webhooks.js` (queue and delivery), `src/openapi.js` (description). `npm run openapi` regenerates `docs/openapi.json`.
* Tables: `api_keys`, `api_idempotency`, `webhooks`, `webhook_deliveries` (see [DATABASE.md](DATABASE.md)).
* Test: `API_WEBHOOK_ALLOW_PRIVATE=1` on the server, then `BASE_URL=… SETUP_PASSWORD=… node tests/api.js` (fresh database: the test creates its own admin accounts with 2FA) (creates test bookings; with `SMOKE_ALLOW_SHUTDOWN=1` it also tests the event shutdown, so use a throwaway database).
* The API is meant for servers. It sends no CORS headers, so a key placed in a web page's JavaScript would be public: never do that.
