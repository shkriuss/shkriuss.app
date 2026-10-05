# @shkriuss/i18n

The UI's text and formats (architecture §10). The UI is in English. Its text lives in typed message modules ([ADR 0012](../../docs/decisions/0012-typed-messages.md)), and its formats follow the device's regional settings, through the browser's `Intl`.

| Module        | What it does                                                                                          |
| ------------- | ----------------------------------------------------------------------------------------------------- |
| `messages.ts` | `defineMessages()`: a message module, whose messages are functions from typed inputs to text          |
| `format.ts`   | `createFormat()`: numbers, sizes in bytes, dates, times, relative times, lists and plurals for the UI |
| `locale.ts`   | The device's locale, and the English locale that the UI formats with on that device                   |

## Messages

Every package or app with UI text has a message module. Its messages are TypeScript functions, so a missing message, or one called with the wrong inputs, is a type error. There is no compiler and no dependency.

```ts
import { defineMessages } from "@shkriuss/i18n";

export const messages = defineMessages((format) => ({
  title: () => "Notes",
  count: (count: number) => format.plural(count, { one: "# note", other: "# notes" }),
  lastBackup: (made: Date, now: Date) => `Last backup ${format.relative(made, now)}`,
}));

const m = messages(format);
m.count(1234); // "1,234 notes", or "1.234 notes" on a device in Germany
```

- **Formats:** a message module gets the UI's formats, and writes every number, date and list with them.
- **Plurals:** `format.plural()` picks the English form for a count with `Intl.PluralRules`; `#` stands for the count.
- **Text only from messages:** oxlint's `react/jsx-no-literals` refuses text written into JSX, and strings in the attributes that people read or hear, such as `aria-label`, `alt`, `title`, `label` and `placeholder`. Class names, ids and links stay strings.
- **Cheap to call:** a module gives the same frozen messages for the same formats, so components can call it on every render.

## English with the device's region

Formats that contain words, such as "Oct", "yesterday" or "and", must be English, but a device set to German or to Germany expects "5 Oct 2026, 14:30" and "1.234,5". So the UI formats with English for the device's region: `en-DE` for `de-DE`, `en-GB` for `en-GB`, `en-CA` for `fr-CA`.

Browsers have English formats for many regions, but not for all, and newer browsers have them for more: Georgia and Japan gained them with Unicode's CLDR 48. For a region without them, the UI formats with `en` and keeps the device's choice of a 12-hour or 24-hour clock: "Oct 5, 2026, 16:30". Dates always name the month, so that "5/10" can never be read the wrong way round.

```ts
import { createFormat } from "@shkriuss/i18n";

const format = createFormat(); // the device's locale and time zone
format.dateTime(backup.made); // "5 Oct 2026, 14:30"
format.relative(backup.made, new Date()); // "yesterday"
format.bytes(file.size); // "1.2 MB"
format.list(["12 new", "3 updated", "1 deleted"], "units"); // "12 new, 3 updated, 1 deleted"
```

- **Relative times** count calendar days in the device's time zone, so "yesterday" is always the day before today. Up to a minute is "now"; then minutes, hours, days up to 6, weeks up to 3, months up to 11, then years.
- **Sizes** use units of 1,000, as phones show them: "999 bytes", "1 kB", "1.2 MB". An amount that rounds to 1,000 moves to the next unit, so 999,950 bytes are "1 MB".
- **Tests** pass the device's locale and a time zone. For a region without English formats they use AA, a private-use region, because which regions have them depends on the browser's Unicode data. The platform end-to-end tests check the formats with each browser's own data.
