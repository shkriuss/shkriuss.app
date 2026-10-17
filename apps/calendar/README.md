# Calendar

Lives at <https://calendar.shkriuss.app>. Its name, description, icon and
colour are in [`packages/registry/apps.json`](../../packages/registry/apps.json).

## What it does

- A month view. Tap a day to see its events; "Today" jumps back. With a
  keyboard: arrow keys move between days, Page Up/Down change month (with
  Shift, year).
- Events have a title, a start and end date, a time (or "All day") and notes.
  They can repeat every day, week, month or year, until a date if you like.
- "Next 7 days" lists what's coming up.
- "Download .ics file" saves your events in the standard calendar format, so
  Google Calendar, Apple Calendar and Outlook can import them.
- Weeks start on the day usual where you live, and times show as 12- or
  24-hour, both from the phone's language and region settings.

Everything is saved in the browser on this device (`shkriuss:calendar`).
Nothing is sent anywhere.

## Where things are

- Page: `src/pages/index.astro`
- Page behaviour: `src/scripts/calendar.ts`
- Rules, as plain functions with unit tests next to them:
  - `src/lib/dates.ts`: date maths without time zones ("2026-10-17", "14:30")
  - `src/lib/events.ts`: checking, saving and repeating events
  - `src/lib/ics.ts`: the .ics file format
- Browser tests: `e2e/` (the shared accessibility, security and offline
  checks run automatically too)
- Build settings: `astro.config.ts` (shared, from `@shkriuss/astro-config`)
- Cloudflare settings: `wrangler.jsonc`

## Good to know

- Times are "floating": 9:00 stays 9:00 even if you travel to another time
  zone, like on a paper calendar.
- Editing a repeating event changes every time it happens.
- Not yet: reminders (notifications) and importing .ics files.

See [docs/adding-an-app.md](../../docs/adding-an-app.md) for the full guide.
