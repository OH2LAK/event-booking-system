# Nordic VUSHF 2026 — Hotel Booking System

A Google Apps Script web application for managing hotel room, camper van, tent and day visitor bookings for the **Nordic VUSHF Meeting 2026**, hosted by [RATS – Radio Amateur Technology Society of Finland](https://rats.fi) at Hotelli Martinhovi, Raisio, 15–17 May 2026.

Built to be reusable for similar amateur radio events.

---

## What It Does

A single `.gs` file (~4000 lines) that serves as both the backend and frontend for a complete event booking system. It runs entirely on Google's infrastructure — no servers, no hosting costs, no external dependencies beyond Google Workspace.

### Booking Types

| Type | Description |
|------|-------------|
| 🏨 Hotel room | Single, double, triple, quad, or 7-person rooms — primary booker holds the room, others join via reference |
| 🚐 Camper van | Camper spot with electricity — primary booker reserves the spot, co-travellers join at no extra spot cost |
| ⛺ Tent | Tent pitch on hotel grounds |
| 🛏️ Single bed | Organizer-assigned bed in shared room (admin-controlled, hidden until enabled) |
| 🎫 Day visitor | Friday and/or Saturday attendance without accommodation |

### Add-ons

- **Full board meal package** — Friday BBQ dinner + Saturday lunch + Saturday Ham Dinner
- **Thursday extra night** — optional arrival night, priced at half the room rate
- **Individual meal selection** — à la carte for day visitors and non-full-board guests
- **T-shirt size selection**
- **Dietary requirements**

### Key Features

**Public booking flow**
- Availability display (rooms by type, camper spots, tent spots)
- Room/camper join system — share a booking reference or direct link so roommates pay their own share
- Real-time price calculation in the browser
- GDPR publish consent (controls appearance on the public "Who's coming?" list)
- Confirmation email to guest with join link (for primary bookers), booking summary, and payment instructions
- Notification email to organizer on each new booking

**Admin panel** (password-protected)
- Live booking table with sortable columns (click any header)
- Per room-type occupancy stats — shows full vs. partially filled shared rooms
- Edit any booking field inline
- Change accommodation type for any booking
- Change room role (primary ↔ joiner)
- Room number assignment
- Free-text organizer comments
- Staff/organizer badge
- Export to CSV
- Configurable settings (all stored in Script Properties, survives redeployment):
  - Registration open/closed with closing date
  - Announcement banner
  - Prices (room prices per type, camper, tent, single bed, full board, meeting fee)
  - Room counts and capacity overrides
  - Camper van and tent spot limits
  - Info texts for camper and tent guests
  - Price disclaimer

**Who's Coming page**
- Public list of confirmed guests who have given publish consent
- Callsign, name, country, type badges

---

## Architecture

| Component | Technology |
|-----------|------------|
| Backend | Google Apps Script (V8 runtime) |
| Frontend | Vanilla HTML/CSS/JS, served by `doGet()` |
| Database | Google Sheets (one row per booking) |
| Email | GmailApp (sent from the deploying account) |
| Config | Script Properties (persistent key-value store) |
| Routing | URL parameter `?page=admin`, `?page=whoscming`, `?join=REF` |

The entire application is one file. There are no npm packages, no build steps, no external APIs.

### Google Sheets Schema

One sheet, one row per booking. Columns in order:

```
Timestamp, BookingRef, Callsign, Name, Email, Phone, Country,
Type, RoomId, RoomRef, IsPrimaryBooker, ThuExtraNight, FullBoard,
Dietary, ShirtSize, TotalPrice, PriceBreakdown, Status,
RoomNumber, OrgComment, PublishConsent, SoloRoom, DayVisitorDays,
IsOrganizer, FreeText
```

### Room Join System

- Primary booker holds the room and pays the room's per-person share
- Joiners find the booking via reference code or direct link (`?join=REF`)
- Joiners pay only their own meeting fee and any add-ons
- If a primary cancels, joiners are flagged `NEEDS_ATTENTION` for admin follow-up
- Camper van joiners pay no spot fee — only meeting fee and add-ons

### Booking References

Format: `CALLSIGN-N` where N is a sequential counter per callsign (e.g. `OH2LAK-7`). Generated server-side at submission.

### Status Values

| Status | Meaning |
|--------|---------|
| `CONFIRMED` | Normal booking, counts toward capacity |
| `NEEDS_ATTENTION` | Counts toward capacity, highlighted in admin (e.g. orphaned joiners) |
| `CANCELLED` | Does not count toward capacity, hidden from public views |

---

## Getting Started

### Prerequisites

- A Google account with Google Drive and Gmail access
- A Google Sheet (blank is fine — the app creates its own structure on first booking)

### Setup

**1. Create a new Google Apps Script project**

Go to [script.google.com](https://script.google.com), create a new project, and replace the contents of `Code.gs` with the contents of `NordicVUSHF2026_Booking.gs`.

**2. Edit the CONFIG block**

At the top of the file, update the `CONFIG` object (around line 30):

```javascript
const CONFIG = {
  SHEET_ID:           'YOUR_GOOGLE_SHEET_ID',
  SHEET_NAME:         'Bookings',
  WEBAPP_URL:         'https://script.google.com/macros/s/YOUR_DEPLOYMENT_ID/exec',
  FRIENDLY_URL:       'https://your-friendly-domain.example',   // or same as WEBAPP_URL
  REPLY_TO_EMAIL:     'your-organizer@example.com',
  EMAIL_SENDER_NAME:  'Your Event Name Booking System',
  ADMIN_PASSWORD:     'choose-a-strong-password',
  ORGANIZER:          'Your Organization Name',
  // ... room definitions, prices, etc.
```

Key things to set:
- `SHEET_ID` — the ID from your Google Sheet URL
- `WEBAPP_URL` — fill in after deploying (step 4)
- `REPLY_TO_EMAIL` — where organizer notifications go
- `ADMIN_PASSWORD` — used to access the admin panel
- `ROOMS` — adjust room types, capacities and prices for your venue

**3. Configure Rooms**

Edit the `ROOMS` array to match your venue:

```javascript
ROOMS: [
  { id: "2S", type: "double", persons: 2, floor: "upstairs", window: true,
    count: 20, price_eur: 270, note_en: "Double room, upstairs" },
  // ...
]
```

**4. Deploy as Web App**

- Click **Deploy → New deployment**
- Type: **Web app**
- Execute as: **Me**
- Who has access: **Anyone** (required for public booking page)
- Click **Deploy** and copy the URL
- Paste the URL into `CONFIG.WEBAPP_URL`
- Redeploy with the URL filled in

**5. Open the booking page**

Navigate to your deployment URL. The booking page should appear.

### Admin Panel

Append `?page=admin` to the URL, e.g.:
```
https://script.google.com/macros/s/YOUR_ID/exec?page=admin
```

Log in with the password set in `CONFIG.ADMIN_PASSWORD`.

### Redeploying After Changes

After editing the script, always create a **new deployment version** (Deploy → Manage deployments → Edit → New version). Reusing an existing version does not always update the served HTML.

---

## Configuration Reference

Most settings can be changed live from the admin panel under ⚙️ Settings without redeploying. Settings are saved to Script Properties and survive redeployment.

| Setting | Description |
|---------|-------------|
| Registration open | Toggle to close bookings with an optional closing date |
| Announcement banner | Shown on the booking front page — leave empty to hide |
| Camper van info text | Shown when camper van is selected and in confirmation emails |
| Tent info text | Shown when tent is selected and in confirmation emails |
| Price disclaimer | Shown on booking page and in confirmation emails |
| Room prices | Per room type, overrides CONFIG values |
| Room counts | Per room type capacity override |
| Camper van / tent spots | Total capacity |
| Full board price | Meal package price |
| Meeting fee | Weekend and single-day rates |
| Single bed price | For organizer-assigned beds |
| Camper van price | Per night |

---

## Email Notifications

| Trigger | Recipients |
|---------|-----------|
| New booking | Guest (confirmation + join instructions if primary), organizer |
| Joiner joins a room/camper | Primary booker (room notice) |
| Room becomes full | Primary booker (full room summary) |
| Primary booker cancels | All joiners flagged NEEDS_ATTENTION + email notice |
| Accommodation change (admin) | Guest |

---

## Customising for Another Event

1. Update `CONFIG` — name, dates, sheet ID, email, admin password
2. Update `ROOMS` — room types and capacities for your venue
3. Update `FULL_BOARD_INCLUDES_EN` — meal package contents
4. Search for `rats.fi` and `Martinhovi` to find hardcoded venue/org references
5. Update logo URLs in the HTML (search for `rats.fi/wp-content`)
6. Review the `PAYMENT` section in confirmation email body for accepted payment methods

---

## Security Notes

Before making this repository public:

- Replace `ADMIN_PASSWORD` in CONFIG with a placeholder value
- Replace `SHEET_ID` with a placeholder
- Replace `REPLY_TO_EMAIL` and any real email addresses
- Replace `WEBAPP_URL` and `FRIENDLY_URL` with placeholders
- Review `CONFIG.ROOMS` prices — remove real pricing if preferred

The admin panel uses a simple password stored in the script. For a production system with sensitive data, consider adding Google account–based authentication.

---

## Limitations

- **Google Apps Script quotas** — email sending is subject to [GAS quotas](https://developers.google.com/apps-script/guides/services/quotas) (100 emails/day for free accounts, 1500/day for Workspace)
- **Cold start** — first load after inactivity may take 3–5 seconds
- **No real-time updates** — admin panel does not auto-refresh; use the Refresh button
- **Single-file architecture** — the entire app is one `.gs` file; splitting requires [clasp](https://github.com/google/clasp)
- **Sheets as database** — works well up to a few hundred rows; for larger events, consider migrating to a proper database

---

## License

MIT — free to use, adapt, and redistribute with attribution. Pull requests welcome.

---

*Built with Google Apps Script for Nordic VUSHF Meeting 2026 by RATS – Radio Amateur Technology Society of Finland.*
*73 de OH2LAK*
