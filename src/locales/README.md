# Translations (`src/locales/`)

Each language is one plain JSON file named after its language code: `en.json`, `fi.json`, `sv.json`, and so on.
A file is a flat list of `"key": "text"` lines in the same order as `en.json` (English is the reference).

```json
{
  "form.registration": "Ilmoittautuminen",
  "form.registrationCloses": "Ilmoittautuminen päättyy: {date}"
}
```

## Languages

| Code | Language | Notes |
|------|----------|-------|
| `en` | English | Reference language, always complete |
| `fi` `sv` `no` `da` `is` `et` `lv` `lt` `pl` `de` `es` `pt` `it` `fr` `nl` `el` `uk` `cs` `hu` | Finnish, Swedish, Norwegian, Danish, Icelandic, Estonian, Latvian, Lithuanian, Polish, German, Spanish, Portuguese, Italian, French, Dutch, Greek, Ukrainian, Czech, Hungarian | Complete. Machine-drafted, need native review (see below) |
| `tlh` `fkv` `fit` | Klingon, Kven, Meänkieli | Hidden, **partial by design**: no `priv.*` and `mail.*` keys, those fall back to the default language |

## How to fix a translation on GitHub

1. Open the language file, click the pencil icon, edit the text.
2. Commit directly or open a pull request.
3. Before merging, run the check (below) or let the reviewer run it.

You only change the text after the colon. Never change the key on the left.

## Rules for the texts

- **Keep placeholders exactly as they are**: `{date}`, `{n}`, `{price}`, `{ref}` and so on. They are replaced with real values.
  The same placeholders must appear in the translation as in English. Word order around them may change.
- **Keep `*bold*` markers in pairs.** `*text*` is shown in bold.
- **Do not use `<` or `>`.** Texts are plain text. HTML is not allowed.
- Use `\n` for a line break and `\"` for a quotation mark inside a text. A raw line break or an unescaped quote breaks the file.
- Keep the file valid JSON: every line ends with a comma except the last one, and the whole file is inside `{ }`.
- Keep technical terms and names that are not translated in the other languages (for example callsign, Visa, Mastercard).

## Key prefixes

| Prefix | Where it is used |
|--------|------------------|
| `form.*` | Booking form (server-rendered page) |
| `pub.*` | Public participant list |
| `js.*` | Texts used by the browser script (dynamic parts of the form) |
| `price.*` | Price breakdown lines in emails and confirmations |
| `priv.*` | Privacy notice. Legal text: have it checked by a native speaker or lawyer |
| `mail.*` | Emails sent to guests |
| `err.*` | Error messages shown to the guest |

## Check your changes

From the project root:

```
npm run check-locales
```

It validates the JSON syntax and reports missing keys, unknown keys (not in `en.json`), empty texts, placeholders that
differ from English, `<` or `>` characters, and unbalanced `*bold*` markers. It exits with an error if something is wrong.
Missing keys are allowed only in the partial languages (`tlh`, `fkv`, `fit`).

The smoke test (`tests/smoke.js`) runs the same kind of checks.

## Review all languages side by side

`docs/translations.csv` has one row per key and one column per language. GitHub shows it as a table, and it opens in
any spreadsheet.

```
npm run export-locales     # JSON files -> docs/translations.csv
npm run import-locales     # edited docs/translations.csv -> JSON files, then runs the check
```

The JSON files are the source of truth. The CSV is a generated view. Do not edit both in the same change, and run
`npm run export-locales` after changing a JSON file so the CSV stays current.

## Adding a language

1. Copy `en.json` to `<code>.json` and translate the values.
2. Add the code and name to `LANGS` in `src/i18n.js` and the code to the `LANGS` list in `scripts/locales.js`.
3. Run `npm run check-locales`.

An admin enables a language in the admin panel under Event setup → Languages.

## Important: database overrides win

The texts in these files are the built-in defaults. An admin can override any text in the admin panel
(Translations card), and overrides are stored in the database (table `translations`). The order is:

1. the admin's override in the database
2. the language file (`<code>.json`)
3. the default language's file
4. `en.json`
5. the key itself (a bug if you see it)

So if you correct a text here but it still shows the old wording, there is probably an override for that key in the
database. Remove or update it in the Translations card. Event-specific content (`content.*`, such as room names) lives
in the database only.

## Quality note

All non-English translations were drafted by an AI assistant and have not been reviewed by native speakers. The privacy
notice (`priv.*`) and the emails (`mail.*`) in particular should be reviewed before real use. Klingon is approximate,
and the Kven and Meänkieli texts are drafts that need review by native speakers.
