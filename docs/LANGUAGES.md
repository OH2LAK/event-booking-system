# Languages (multi-language support)

One event can be offered in several languages at the same time. The guest chooses the language; the choice is
remembered on the booking so that every later email to that guest is sent in the same language.

Built-in languages (all texts are translated in each): English (`en`), Finnish (`fi`), Swedish (`sv`), Norwegian (`no`, Bokmål),
Danish (`da`), Icelandic (`is`), Estonian (`et`), Latvian (`lv`), Lithuanian (`lt`), Polish (`pl`), German (`de`),
Spanish (`es`), Portuguese (`pt`), Italian (`it`), French (`fr`), Dutch (`nl`), Greek (`el`), Ukrainian (`uk`), Czech (`cs`) and Hungarian (`hu`).
The first six cover the Nordic countries; the others cover the Baltic states, Central and Southern Europe and Ukraine.
Russian and Belarusian are deliberately not included. Norwegian browsers that report
`nb` or `nn` get `no`.

The built-in translations were machine-drafted for this project and have **not** been reviewed by native speakers.
Before a real event, have the privacy notice and the emails checked in each language you enable (see below for how to correct texts).

## Turn it on

1. Open the setup page (`/?setup=1`), **Event setup**, group **Languages**.
2. **Enabled languages**: comma-separated codes, for example `en,fi,sv` or `en,fi,sv,no,da,is,et,lv,lt,pl,de,es,pt,it,fr,nl,el,uk,cs,hu` for all. **Default language**: one of the enabled codes.
3. Save. When more than one language is enabled, a language switcher appears at the top of the booking pages,
   the public list and the privacy notice. With only one language enabled nothing changes for guests.

The language is chosen in this order: `?lang=xx` in the address, then the browser's `Accept-Language` header, then the
default language. The site sets no cookie for this and does not store anything about visitors.
Links such as `https://booking.example.org/?lang=fi` can be shared or printed.

## What is translated

| Part | How |
|---|---|
| Booking form, public list, form messages, price lines | Built-in texts, editable in **Translations** |
| Privacy notice (`/privacy`) and the privacy footer in emails | Built-in texts, editable. **Have the translations checked** by a native speaker or your legal adviser before you rely on them |
| Emails to guests (confirmation, room notices, accommodation change, booking update, erasure notice) | In the language stored on the booking |
| Server error messages shown on the form (for example "Callsign already has a booking") | Built-in texts, editable |
| Event content you typed yourself (event name, location, dates, check-in text, announcement, day labels, extra nights, meal package texts, room type names, camper/tent information, price disclaimer) | Entered per language in **Translations -> Event content** |

Not translated: the admin panel and the `/report` tool (organizers), and emails sent to the organizer. They stay in English
(the report keeps its Finnish/English hotel labels).

## Translations card (setup page)

* **Language** selects what you edit. Languages that are not enabled are marked.
* **Event content** lists everything you typed in Event setup, Event structure and Room types, with the original text above
  an empty box. Leave the box empty to show the original text. The default language never needs this: guests see exactly
  what you typed there.
* **Interface texts** lists all built-in texts with the English source above. The box starts with the built-in
  translation; change it and press **Save translations**. Emptying a box returns to the built-in text.
  "N missing" counts texts that have no translation in that language (they fall back to the default language, then English).
* Keep `{placeholders}` exactly as in the English text (for example `{ref}`, `{n}`, `{date}`). The card refuses to save
  when they differ. `<` and `>` are removed from all texts, so HTML cannot be injected. In privacy notice texts `*word*`
  makes the word bold.

Overrides are stored in the database (table `translations`) and survive upgrades; the built-in texts are in `src/locales/*.json`.

## How a text is chosen

1. override for the guest's language (database)
2. built-in text for the guest's language
3. the same text in the default language
4. English
5. the key itself (a bug if you ever see it; please report it)

## Editing translations on GitHub

Short version below; the full guide is in [`src/locales/README.md`](../src/locales/README.md).

Every language is one plain JSON file: `src/locales/<code>.json` (for example `fi.json`). It is a flat list of
`"key": "text"` lines in the same order as `en.json`, so a fix is a one-line change in a pull request.

1. Open the file on GitHub, click the pencil icon, change the text, commit (or open a pull request).
2. Keep `{placeholders}` (for example `{date}`, `{n}`) exactly as they are and keep the `*bold*` markers in pairs.
   Do not use `<` or `>`. Use `\n` for a line break and `\"` for a quotation mark inside a text.
3. Run `npm run check-locales`. It validates the JSON, finds missing or unknown keys and checks that the placeholders
   match English. The same checks also run in the smoke test.

To see or review all languages side by side, `docs/translations.csv` has one row per key and one column per language
(GitHub shows it as a table). It is generated from the JSON files; the JSON files are the source of truth.

- `npm run export-locales` rewrites `docs/translations.csv` from the JSON files.
- `npm run import-locales` writes an edited `docs/translations.csv` back into the JSON files (spreadsheet round trip)
  and then runs the check. Do not edit both the CSV and the JSON in the same change.

## Add a language (developers)

1. Copy `src/locales/en.json` to `src/locales/<code>.json` and translate the values.
2. Add the code and name to `LANGS` in `src/i18n.js`, and the code to the `LANGS` list in `scripts/locales.js`.
3. Run `npm run check-locales` and the smoke test (against a throwaway database).

Missing keys are allowed only for the hidden partial languages (`tlh`, `fkv`, `fit`); see below.

Key prefixes: `form.*` booking form, `pub.*` public list, `js.*` texts used by the browser script, `price.*` price lines,
`priv.*` privacy notice, `mail.*` emails, `err.*` error messages.

## Things to know

* Price lines are stored in the booking in the event's default language (used by the admin panel and report). The guest
  sees and receives them in their own language, generated again from the same data.
* A guest who books without choosing anything gets the default language (or the `Accept-Language` match).
* Bookings created before this feature have no language and get the default language.
* Currency stays euro. Dates you type (for example "13-16 May 2027") are shown as typed: translate them in Event content.
* The booking pages load no fonts, scripts or images from other sites. If you configure logo URLs in Event setup that point
  to another site, the visitor's browser contacts that site (see [GDPR.md](GDPR.md)); host the logos yourself.

## Hidden extra languages (easter egg)

Three extra codes are registered but deliberately left out of the Event setup help text:

- `tlh` (tlhIngan Hol, Klingon) `fkv` (Kainun kieli, Kven) and `fit` (Meänkieli, spoken in Tornedalen, Sweden).

They are enabled like any other language by typing the code into Event setup → Languages → Enabled languages (for example `en,fi,tlh,fkv,fit`).

They are **partial** catalogs: the booking form, public list, price lines and error messages are translated, but the privacy notice (`priv.*`) and emails (`mail.*`) are intentionally not. Those fall back to the default language through the normal fallback chain, so legal and data-bearing text is never shown in a language that has not been professionally reviewed.

Klingon is a constructed language and the text is approximate. Kven (Norway) and Meänkieli (Sweden) are real, officially recognised minority languages, closely related but distinct; both texts are machine drafts and must be reviewed by a native speaker before real use. Corrections can be made in the Translations card.

### Klingon script (pIqaD)

The `tlh` text is romanised. When the page is shown in `tlh`, a small **pIqaD** button appears (bottom right) if the font file `public/fonts/piqad.woff2` exists. It converts the page text to the Klingon script using the ConScript Unicode Registry code points (U+F8D0–U+F8FF, private use area) and `/piqad.js`. Without the font file the button is not shown and nothing changes. `?script=piqad` switches it on directly.

The font is derived from *Klingon pIqaD HaSta* (Mike Neff / Michael Everson, SIL Open Font License 1.1). Under the OFL a converted copy is a Modified Version: it must keep the licence and copyright notice and must not use the Reserved Font Names, so it is renamed *EBS pIqaD*. Keep the licence text next to it in `public/fonts/`.
