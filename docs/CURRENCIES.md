# Currencies

The event has **one native currency**. Everything that is paid is in it. Guests can additionally look at an
**approximate** conversion in another currency; that is a display aid only.

## Settings (Event setup -> Currency)

| Setting | Meaning |
|---|---|
| Native currency | ISO 4217 code, default `EUR`. Prices (rooms, meals, fees, camper, tent), totals, emails, the report and CSV are in it. |
| Extra currencies | Optional comma-separated codes, e.g. `USD, GBP, SEK`. At most 8. The native currency is removed from the list automatically. |

Changing the native currency does **not** convert existing prices or bookings. Re-enter the prices (Registration
settings, Room types) in the new currency and run **Recalculate prices** if needed. Each booking remembers the native
currency it was made in (`bookings.currency`). Rates saved for another native currency are ignored.

For `EUR` the pages look exactly as before (`€120`). For any other currency the amounts are written with the ISO code
(`1200 SEK`). Currencies without decimals (for example ISK, JPY) are shown without them.

## Exchange rates (Currencies card)

A rate says **how many units of the other currency one unit of the native currency buys** (`1 SEK = 0.0935 USD`).

- **Type it in.** Dot or comma as decimal separator. Rates you save are marked *manual* by default.
- **Fetch ECB rates.** The server downloads the daily reference rates of the European Central Bank
  (`https://www.ecb.europa.eu/stats/eurofxref/eurofxref-daily.xml`) and computes the cross rate against your native
  currency. No API key, and no guest data is sent. Rates marked *manual* are kept, currencies the ECB does not publish
  (and a native currency the ECB does not publish) are reported so you can type them in.

A currency with no usable rate is not offered to guests. There is no automatic refresh: rates only change when an
organizer saves or fetches them.

## What guests see

If at least one extra currency has a rate, a small selector appears below the price on the booking form. Picking `USD` shows
for example `≈ 1.87 USD (indicative: 1 SEK = 0.0935 USD). You pay in SEK.`. The choice is sent with the booking:

- `bookings.display_currency` and `bookings.display_rate` store it, so the rate is **fixed at booking time**.
- The confirmation email, the booking-updated email and the accommodation-change email repeat the approximate total with that rate.
- The stored `total_price` and price breakdown are always in the native currency.

## Developers

- `src/currency.js`: formatting (`fmt`, `fmtSigned`, `fmtApprox`), conversion, rate storage, ECB fetch.
- Catalog texts contain `€` (and forms like `€{price}` or `{pp} €`). `i18n.t` and `i18n.dict` replace them with the native
  currency code when it is not EUR, so translators keep writing `€`.
- The browser script has `M(amount)` and `approxText(total)`; the admin page has its own `M()`.
- Tables: `currency_rates` and the `bookings` columns above (`db/schema.sql`).
- Tests: `node tests/currency.test.js` (unit, no database), the currency block in `tests/smoke.js`.
