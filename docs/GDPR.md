# Data protection (GDPR) guide

This system collects personal data of event participants, so the organizer acts as the **data controller**. This page
explains what the software does for you, what you still have to do yourself, and how to handle requests.
It is a practical guide, not legal advice: check it against your own situation (and your country's rules) before
the first event.

## What the software does

| Requirement | How it is handled |
|---|---|
| Information to participants (Art. 13) | A privacy notice is generated from **Event setup** and served at `/privacy`. The booking form shows a short statement (purpose, no other use, deletion date, controller, contact) and requires the participant to confirm they have read the notice. You can link to your own notice instead (**Own privacy notice URL**). |
| Purpose limitation and minimization | Only the fields needed to organize the event are collected. Phone, dietary requirements, T-shirt size and free text are optional. The form warns against entering sensitive details in free text. |
| Special category data (Art. 9) | Dietary requirements can reveal health or religion. The field is optional and states that filling it in is explicit consent for catering use only. |
| Consent for publication | The public "Who's coming?" page lists only callsign and first name, and only for people who **opt in** (the box is unticked by default). Admins can change it per booking (**Publish consent**). |
| Storage limitation (Art. 5(1)(e)) | **Event setup** holds the last event day and the retention period (default 30 days). The admin panel shows the deadline and warns in a banner when it is close or passed. A **retention hold** pauses the reminders while a dispute or other matter is open. |
| Right of access / portability (Art. 15, 20) | **Export data (JSON)** in the booking edit dialog downloads everything stored about that booking, including related log entries. |
| Right to erasure (Art. 17) | **Erase data…** in the booking edit dialog deletes the booking, removes related log entries and, if you choose, emails the person first that their data is being erased. |
| Erasure of the whole event | **Event shutdown** (admin panel, "Data protection and event shutdown") erases all bookings and logs, closes registration, physically removes the deleted rows and verifies the result. |
| Security of processing (Art. 32) | Admin and report areas need a login; sessions use signed HttpOnly cookies (`Secure` over HTTPS); login attempts are throttled; the database port is not published; responses are sent with `Cache-Control: no-store`; admin pages cannot be framed; the app does not log email addresses. |
| Transparency about cookies | Visitors get no cookies. The pages load no fonts, scripts or images from other sites (earlier versions loaded Google Fonts, which sent visitors' IP addresses to Google; that is removed). Only logged-in organizers get one session cookie. If you set logo URLs in Event setup that point to another site, the visitor's browser contacts that site: host the logos on your own server. |
| Accountability (Art. 5(2)) | The time a participant confirmed the notice is stored (`privacy_ack_at`). Shutdowns leave a record without personal data (date, counts, verified yes/no). |

## What you must still do

1. **Fill in the privacy fields** in Event setup: data controller, privacy contact email, last day of the event, retention days.
2. **Read the generated notice at `/privacy`** and edit your setup so it is true. In particular check who else receives data (hotel, caterer) and where the server and email provider are located. If you need different wording, host your own notice and set its URL.
3. **Sign data processing agreements** with your hosting and email providers if they process the data for you, and check transfers outside the EU/EEA.
4. **Use HTTPS.** Admin accounts need a password (12+ characters) and a second factor. Keep the server updated.
5. **Limit admin access** to people who need it. Every admin account sees all personal data: give the booking admin role to staff and the event setup role only to one or two people, and delete accounts when someone leaves the team.
6. **Keep backups on the same schedule.** The app cannot delete database backups, dumps, exported CSV/XLSX files or print-outs. Delete them when you run the shutdown.
7. **Record the processing** if your country requires a record of processing activities (Art. 30) and prepare for data breaches: a breach that puts people at risk must be reported to the supervisory authority within 72 hours (Art. 33). The software has no breach tooling.
8. **Do not use the data for anything else**, for example marketing for another event, without a new legal basis or consent.

## Handling requests from participants

Requests normally arrive by email to the privacy contact. Verify that the request comes from the person (for example by replying to the email address on the booking). Answer within one month.

| Request | What to do |
|---|---|
| "What do you have about me?" / "Send me my data" | Open the booking, **Export data (JSON)**, send the file to the booking's email address. |
| "Correct my data" | Edit the booking. Untick **Send change notification email** if you do not want to notify. |
| "Delete my data" | **Erase data…**. If the person is the primary booker of a shared room or spot, move or erase the roommates first. Choose to send the final notice. |
| "Remove me from the public list" / withdraw consent | Edit the booking and untick **Publish consent**. |
| "Stop processing" / objection | Decide whether the data is still needed for the event. If not, erase it. If you must keep it (for example an open dispute), tell the person why. |

Erasing a booking removes that person's row and every log entry that mentions their callsign, booking reference or email. Roommates' data stays untouched.
If a person asked for deletion while a matter is open, you may keep only what the matter needs; set a retention hold in Event setup and write the reason.

## Retention schedule

Personal data is stored to organize the event and deleted **no later than 30 days after the event** (configurable), or as soon as any open matter (for example a payment dispute or complaint) has been settled.
The admin panel computes the deadline from **Last day of the event** + **Retention after the event (days)**:

- more than 7 days left: status OK;
- 7 days or fewer: amber banner at the top of the admin panel;
- passed: red banner;
- **Retention hold** set: reminders pause and Event shutdown refuses to run until the hold is cleared.

Nothing is deleted automatically. This is deliberate, so that data needed for an open matter is never lost by surprise. Run the shutdown yourself.

## Event shutdown

Use it once the event is over. It:

1. optionally emails every registrant a final "your data is being erased" notice (one email per address; failures are listed once on screen, not stored);
2. deletes all bookings and all log entries in one transaction;
3. closes registration and clears the bypass token;
4. runs `VACUUM FULL` so the deleted rows are removed from the database files;
5. verifies that the tables are empty and registration is closed, and shows the result;
6. stores a record without personal data (`LAST_SHUTDOWN`: time, number of bookings, notices sent, verified yes/no) and one log line.

It needs the typed phrase `ERASE ALL DATA`. If the event has not ended yet, an extra tick box is required. It cannot be undone.
After it, delete what the app cannot reach: backups and dumps, exported files, print-outs, sent mail and the SMTP provider's logs.
The event setup, room types, structure and prices are kept so you can reuse the installation. Enter new dates before reopening registration.

Backups are outside the application's reach. If you keep database backups, make sure they are rotated within your retention period.

## Data inventory

| Table / field | Personal data | Purpose |
|---|---|---|
| `bookings` | callsign, name, email, phone, country | identify and contact the participant |
| | type, room, nights, extra nights, meals, price | accommodation, catering, fees |
| | dietary, shirt size, free text | catering and planning (optional) |
| | `publish_consent` | public participant list (opt-in) |
| | `privacy_ack_at` | proof that the notice was shown and confirmed |
| | `currency`, `display_currency`, `display_rate` | currency of the price and the guest's chosen indicative currency (no personal data on its own) |
| | room number, organizer comment, status | organizing and check-in |
| `api_keys`, `api_idempotency` | none (key names and hashes; stored answers to booking requests, 24 hours) | access for other systems |
| `webhooks`, `webhook_deliveries` | queued messages contain the booking data until delivered (up to 7 days if delivery keeps failing) | notifying other systems chosen by the organizer |
| `event_log` | callsign / booking reference, event type | security and troubleshooting; removed when the person is erased |
| `settings`, `event_config`, `room_types`, `event_structure`, `currency_rates` | none about participants (organizer contact details only) | configuration |

Optional **webhooks** send booking data to addresses the organizer enters (choose *no personal data* where possible); the organizer is responsible for those receivers (see [API.md](API.md), section Privacy). Erasing a booking deletes queued messages about it and sends a `booking.erased` message with the reference only, and event shutdown switches all webhooks and API keys off.

The only other outgoing connection that is not an email is the optional **Fetch ECB rates** button in the admin panel (see
[CURRENCIES.md](CURRENCIES.md)). It downloads public exchange rates from the European Central Bank and sends no personal data.
