# @shkriuss/i18n

How the UI writes dates, times, numbers and lists (architecture §10). The UI is in English, and its formats follow the device's regional settings, through the browser's `Intl`.

| Module      | What it does                                                                                 |
| ----------- | -------------------------------------------------------------------------------------------- |
| `locale.ts` | The device's locale, and the English locale that the UI formats with on that device          |
| `format.ts` | `createFormat()`: numbers, sizes in bytes, dates, times, relative times and lists for the UI |

Message catalogs come next.

## English with the device's region

Formats that contain words, such as "Oct", "yesterday" or "and", must be English, but a device set to German or to Germany expects "5 Oct 2026, 14:30" and "1.234,5". So the UI formats with English for the device's region: `en-DE` for `de-DE`, `en-GB` for `en-GB`, `en-CA` for `fr-CA`.

Browsers have English formats for many regions, but not for all, such as Georgia or Japan. There the UI formats with `en` and keeps the device's choice of a 12-hour or 24-hour clock: "Oct 5, 2026, 16:30". Dates always name the month, so that "5/10" can never be read the wrong way round.

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
- **Tests** pass the device's locale and a time zone. The platform end-to-end tests check the formats with each browser's own Unicode data.
