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
- **Reminders**: each event can remind you, from "at the start time" to
  "1 week before" (all-day events: at 9:00 on the day or before). Due
  reminders show at the top of the page and, if you turn notifications on,
  as phone notifications. Reminders missed while Calendar was closed show
  when you open it again (up to 12 hours late, and only if the event isn't
  over).
- **Import**: "Import .ics file" reads a calendar file from Google Calendar,
  Apple Calendar, Outlook or this app. You see what will be added (and what
  can't be, and why) before anything changes. Importing the same file twice
  doesn't make copies.
- **Export**: "Download .ics file" saves your events, with their reminders,
  in the standard calendar format for other calendar apps.
- **Holidays and fasts in Georgia**, worked out on the device for 1901–2099
  (nothing is downloaded), each kind shown unless turned off under "Holidays
  and fasts":
  - **Days off**: the public holidays in the Labour Code (Article 30), from
    2024, when 17 May was added. On the month, the date is underlined in
    red. Extra days off the government announces by decree (for example on
    election days) can't be known ahead, so they aren't shown.
  - **Orthodox holidays** of the Georgian Orthodox Church: a ring under the
    date. The Church keeps the old (Julian) calendar, so Christmas is on
    7 January; Easter is worked out the Orthodox way, and Palm Sunday,
    Ascension and Pentecost follow it.
  - **Fasts**: Great Lent and the Apostles', Dormition and Nativity fasts, and
    the one-day fasts: a line along the bottom of each day. Every Wednesday
    and Friday too, if you turn that on (not in the weeks without fasting).
  - They show in the day's list (with their Georgian names) and in "Next 7
    days" (a long fast only on its first day). They aren't events: they
    can't be changed, and they're not in downloaded .ics files.
- Weeks start on the day usual where you live, and times show as 12- or
  24-hour, both from the phone's language and region settings.

Everything is saved in the browser on this device (`shkriuss:calendar` for
events, `shkriuss:calendar-reminders` for when reminders were last checked,
`shkriuss:calendar-holidays` for which holidays and fasts to show).
Imported files are read on the device. Nothing else leaves it, unless the
person turns on sync (a sealed copy on Calendar's server, docs/adr/0010) or
reminders while Calendar is closed (each reminder's time and sealed text on
its notification server, docs/adr/0009).

## Where things are

- Page: `src/pages/index.astro`
- Page behaviour: `src/scripts/`
  - `calendar.ts`: the month, the lists and the event editor
  - `reminder-alerts.ts`: due reminders and notifications
  - `import-dialog.ts`: importing a file
  - `special-days.ts`: holidays and fasts: what to show, and their list items
  - `shared.ts`: small helpers they share
- Rules, as plain functions with unit tests next to them:
  - `src/lib/dates.ts`: date maths without time zones ("2026-10-17", "14:30")
  - `src/lib/events.ts`: checking, saving and repeating events
  - `src/lib/reminders.ts`: when reminders go off and what they're called
  - `src/lib/ics.ts`: writing .ics files
  - `src/lib/ics-import.ts`: reading .ics files
  - `src/lib/holidays.ts`: days off, Orthodox holidays and fasts in Georgia
    (checked against the Labour Code on matsne.gov.ge and the Georgian
    Orthodox Church's 2026 calendar on orthodoxy.ge)
- Browser tests: `e2e/` (the shared accessibility, security and offline
  checks run automatically too)
- Build settings: `astro.config.ts` (shared, from `@shkriuss/astro-config`)
- Cloudflare settings: `wrangler.jsonc`

## Good to know

- Times are "floating": 9:00 stays 9:00 even if you travel to another time
  zone, like on a paper calendar.
- Editing a repeating event changes every time it happens.
- **Reminders while Calendar is closed** (optional, under Notifications):
  Calendar uploads its reminders to its own notification service
  (`src/worker.ts`, `@shkriuss/push`), each one encrypted on the device so
  only that device can read it, with when it's due and the time zone. The
  service then sends them on time through the browser's push service. See
  [ADR 0009](../../docs/adr/0009-push-notifications.md). Without it, a
  reminder may only show when you next open Calendar.
- **Sync between devices** (optional, with a shkriuss account): events are
  locked on the device and kept in sync through Calendar's own server
  (`@shkriuss/sync`). When an event is changed on two devices before they
  sync, both versions are kept: the second becomes its own event, titled
  "… (second version)", with its own reminder. An editor that's open while a
  sync (or another tab) changes its event saves only what was changed in it
  (`editEvent`), so the other change stays. A reminder is part of its
  event, so it syncs too; each device then uploads it to its own notification
  service, the next time Calendar opens there (`e2e/sync.spec.ts` checks
  this). See [ADR 0010](../../docs/adr/0010-account-and-sync.md).
- **Phones without Google services** (like GrapheneOS): use a browser with
  UnifiedPush, such as IronFox with the Sunup app.
- **On iPhone and iPad**, notifications only work after adding Calendar to
  the Home Screen (iOS 16.4 or later).
- **Import limits.** Calendar can't show everything a .ics file can say yet:
  repeats like "every 2 weeks" or "Mondays and Wednesdays", and changes to
  single dates of a repeating event, are listed as not imported. Times with a
  time zone are moved to the phone's time zone.
- **Repeating events from another time zone** keep the time their first date
  has on the phone. When that time zone changes its clocks (summer time) on
  other dates than the phone's, some of the times end up an hour off: a weekly
  9:00 London meeting imported in Tbilisi shows at 12:00 every week, but from
  late October to late March it's really at 13:00. Before anything is added,
  the import says how many events this affects. It also says when a monthly or
  yearly event moved to another day near the end of a month: 22:00 UTC on the
  31st is 02:00 on the 1st in Tbilisi, and Calendar would show it on the 1st
  of every month, also after months without a 31st.
- Data saved before reminders existed (version 1) is upgraded automatically.

See [docs/adding-an-app.md](../../docs/adding-an-app.md) for the full guide.
