# Admin guide

For event organizers. The admin panel is at `<site>/?admin=1`; the report and check-in tool is at `<site>/report`. Both use
the same password (`ADMIN_PASSWORD` in `.env`).

## 1. Logging in

1. Open `<site>/?admin=1` and enter the admin password.
2. The session lasts 12 hours. The browser keeps a session cookie, not the password. After reloading the page you log in
   again. **Kirjaudu ulos** (lock button, top right) ends the session.
3. After 10 wrong attempts from the same address, logins are blocked for 15 minutes.
4. A red banner at the top of the panel means a default `change-me-...` value is still in `.env`. Change it (see
   section 8) before the site is public.

The panel does not refresh itself. Use **Refresh** to see bookings made by others.

## 1b. Event setup (first thing to do)

The **Event setup** card at the top of the admin panel holds everything that identifies your event: name, short name,
organizer, location, dates and day labels, check-in/out times, meal package description, contact email and sender name,
logo URLs, accent color and home link. The values are stored in the database (`event_config` table) and used on the booking
page, emails, report tool and CSV file names.

On a fresh install the card opens by itself and visitors see a "booking is not open yet" page until you save it. Required:
event name, short name and organizer. Logo and home URLs must start with `http://` or `https://`; the accent color is a hex value.
Changes apply immediately (reload the booking page).

## 2. Dashboard (top of the page)

Cards computed from the bookings table: total bookings, booked / total rooms per room type (with how many rooms are full
and which are still open, e.g. `OH2ABC-7 (2/3)`), single beds, camper vans, tent spots, day visitors, full-board meals,
Thursday extra nights and estimated revenue (sum of stored prices).

Note: the cards count every row in the table, including `CANCELLED` bookings.

## 3. Registration settings

Change the values and press **Save settings**. Changes take effect immediately.

| Setting | What it does |
| --- | --- |
| Registration open | Switch registration on/off. |
| Registration closes | Date `YYYY-MM-DD`. Registration closes automatically at 23:59 on that date (server time zone, `TZ`). To reopen after the date has passed, move or clear the date. |
| Allow solo double room | Lets one person book a whole double room alone. They pay the full room price and nobody can join. |
| Allow single bed booking | Enables the single-bed option. It is only shown when all single rooms (`1S-W`, `1S-NW`) are full **and** a multi-person room has a free bed that is not marked solo. Also set the number of slots under Pricing. |
| Announcement banner | Highlighted message on the booking page. Empty = hidden. |
| Registration closed message | Text shown on the booking page when registration is closed. |
| Bypass link (secret registration link) | Anyone with the link can register even when registration is closed. **Regenerate** creates a new token and invalidates old links, **Clear** disables it. The full link (`<site>/?bypass=<token>`) is shown below the field. Press **Save settings** after changing it. |
| Camper van info text / Tent info text | Shown when the guest picks that option and included in their confirmation email. |
| Price disclaimer | Shown under prices and in emails. Empty = hidden. |
| Tent spots enabled | Hide/disable tent bookings. |

Join links (`<site>/?join=<booking ref>`) always work, also when registration is closed, so roommates can still join
an existing booking.

## 4. Pricing

Edit and press **Save pricing**: full board per person, camper van per night (2 nights are charged), tent (weekend),
single bed price and number of single-bed slots (0 = off), meeting fee for the full weekend and for a single day, and the
price of each room type (whole room, EUR).

**Existing bookings keep their stored price.** After changing prices, press **Recalculate prices** above the bookings
table to recalculate all active bookings (`CONFIRMED`, `CHECKED_IN`, `NEEDS_ATTENTION`). The guests are not emailed by
this action. Editing a single booking recalculates only that booking.

How prices are built: room price divided by the room's persons per guest (the whole price for a solo room), plus the
meeting fee, plus the meal package if chosen. The Thursday extra night is half the room price, divided the same way.
Individual meals (`meals`) are recorded for catering but are not added to the price.

## 5. Room inventory

Set how many rooms of each type exist, plus the number of camper van and tent spots, then press **Save inventory**.
Lowering a number below what is already booked does not cancel anything; it only stops new bookings.

## 6. The bookings table

Rooms are shown as groups: the primary booker (house icon) with the joiners (arrow) beneath. Camper vans are grouped
the same way. Column headers sort the table; **Clear sort** returns to the grouped view. **Export CSV** downloads
all rows with all fields.

Careful with the CSV: it contains names, emails and phone numbers. Keep it off shared drives and out of Git. Opening
it in a spreadsheet can execute formulas that start with `=`, so open it in a text editor first if in doubt.

Each row has two buttons: one for **Edit booking** and one for **Change accommodation**. Status colors: `CANCELLED` and
`NEEDS_ATTENTION` rows are highlighted.

### 6.1 Edit booking

Opens a form for one booking. Editable: callsign, name, email, phone, country, status (`CONFIRMED`, `CANCELLED`,
`NEEDS_ATTENTION`), day-visitor days, dietary requirements, full board, Thursday extra night, solo room, publish consent,
staff flag, room number, additional information, organizer comment.

- **Send change notification email to guest** (ticked by default): emails the guest the updated services and total.
- Changing full board, Thursday night, solo room (or the booking type/room) **recalculates that booking's price**.
- **Room number** is copied to everyone in the same room. It is for organizers only and is not shown to guests.
- **Organizer comment** is internal only.
- **Staff** shows an organizer badge on the public "Who's coming?" page; **Publish consent** controls whether the guest
  appears there at all (callsign and first name only).
- Setting the status to **CANCELLED** on a room's primary booker flags every other active person in that room as
  `NEEDS_ATTENTION`, writes a note in their organizer comment and emails them asking them to contact the organizers.
  Reassign them (see Change role) or cancel them too.
- A callsign can only have one active booking. Reusing a callsign that already has one gives an error.

**Change role** (room and single-bed bookings only):
- *Joiner -> primary booker*: pick a free room type. The person becomes the holder of a new room and the price is
  recalculated. Fails when no room of that type is left.
- *Primary booker -> joiner*: pick another room (by booking reference) with a free bed. The person moves in; anyone who
  was in their old room is flagged `NEEDS_ATTENTION` so you can reassign them. The dialog warns about this.

### 6.2 Change accommodation

Moves a guest to another type: hotel room (choose room type), camper van, tent, single bed or day visitor. The dialog shows
the current and the new accommodation with capacity and the price difference. It refuses when no room of the chosen type is
left, or when the room's current joiners would not fit the new type. Tick **Send change notification email to guest** to
email the old/new accommodation, the price difference and the new breakdown (organizers are in BCC). The price is
recalculated.

## 7. Report and check-in tool (`/report`)

Log in with the same password. Top buttons:

| Button | Use |
| --- | --- |
| Hotellilista (hotel list) | Guests grouped by room, with room numbers, extra nights and meals. Print or save as PDF for the hotel before the event. |
| Sisäänkirjautuminen (check-in) | Search a guest by callsign/name/booking reference and open a printable confirmation slip with what they owe at arrival. The button **Tee sisäänkirjaus ja tulosta vahvistus** (check in and print) sets the status to `CHECKED_IN` and opens the slip; **Tulosta vahvistus** only prints the slip without checking in. |
| Yhteenveto (summary) | Totals and meal counts for catering. |
| CSV | Download of the guest list (spreadsheet formulas are neutralized). |
| PDF | Opens the browser's print dialog; choose **Save as PDF**. |

Payment is taken at the venue (cash, Visa, Mastercard).

## 8. Operations

**Change the admin password (or another secret).** Edit `.env`, then re-create the container so it reads the file:
`docker compose up -d` (native install: restart `node src/server.js` with the new environment). Existing admin sessions
become invalid when `SESSION_SECRET` changes.

**Typical tasks**

| Task | How |
| --- | --- |
| Open/close registration | Registration settings: toggle and/or set the closing date, Save settings. |
| Let a late guest register | Give them the bypass link (Regenerate first if the old one was shared widely). |
| Raise a price | Pricing: change and Save pricing, then Recalculate prices. |
| Add rooms | Room inventory: raise the number, Save inventory. |
| Guest cancels | Edit booking: status `CANCELLED`. If it was a room's primary booker, deal with the flagged roommates. |
| Guest wants another room or a camper van | Change accommodation. |
| Assign hotel room numbers | Edit booking on any occupant: enter the room number; the whole room gets it. |
| Mark organizers | Edit booking: tick **Staff**. |
| Remove someone from the public list | Edit booking: untick **Publish consent**. |

**Troubleshooting**

| Symptom | Likely cause |
| --- | --- |
| "Not logged in" / the panel stops loading | Session expired (12 h) or `SESSION_SECRET` changed. Log in again. |
| Guests do not get emails | `SMTP_HOST` is empty or wrong. With SMTP disabled the app only writes the emails to its log. Failures are recorded in the `event_log` table (`email_failed`). The booking itself is saved either way. |
| Registration closed earlier or later than expected | Check the closing date and the `TZ` setting. |
| Prices look old | Existing bookings keep their stored price; run Recalculate prices. |
| Numbers in the dashboard are too high | Cancelled bookings are counted (see section 2). |

Logs: `docker compose logs -f app` (Docker) or the terminal running Node. For the database structure, backups and
queries see [DATABASE.md](DATABASE.md).
