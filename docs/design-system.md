# Design system (`@shkriuss/ui`)

One package styles the hub and every app. Change it once and every site
changes on its next deploy.

## Where things are

| Path                                     | What                                                                                            |
| ---------------------------------------- | ----------------------------------------------------------------------------------------------- |
| `packages/ui/src/styles/tokens.css`      | **Design tokens**: colours (light and dark), fonts, type sizes, spacing, radii, shadows, motion |
| `packages/ui/src/styles/base.css`        | Reset and defaults for plain HTML, focus ring, skip link, `.visually-hidden`                    |
| `packages/ui/src/styles/components.css`  | Layout helpers and component classes                                                            |
| `packages/ui/src/components/*.astro`     | Astro components                                                                                |
| `packages/ui/src/layouts/AppShell.astro` | The page shell every page uses                                                                  |
| `packages/ui/src/icons/index.ts`         | The icon set (24×24, 2px stroke)                                                                |
| `packages/ui/src/icons/colors.ts`        | App icon colours as plain values (kept in sync with tokens by a test)                           |

## Principles

- **System fonts only.** Fast, private, and they look native on every phone.
- **Light and dark** follow the device by default. The footer switch lets
  people pick Light, Dark or System; the choice is saved on the device.
- **Accessible by default:** WCAG 2.2 AA contrast (unit-tested for every
  token pair in both themes), visible focus rings, 44px tap targets,
  reduced motion respected, and semantic HTML in every component.
  - The one exception to 44px: Calendar's days on screens narrower than
    about 340px, where seven columns can't each be 44px wide. They stay 44px
    tall, well above WCAG's 24px minimum.
  - Pages fit a 320px screen, and a 360px one with text at 200%, without
    sideways scrolling (tested on every page, and on apps' pages with things
    in them and their dialogs). For that, rows of fixed widths shrink or
    wrap: `minmax(min(100%, 9rem), 1fr)` in grids, `flex-wrap` in rows, and
    `min-width: 0` on a `<fieldset>` (browsers make it as wide as its
    content otherwise). A word or number that can't fit a line by itself
    (a long amount, "Wednesday" beside a checkbox) breaks rather than going
    past the edge: `overflow-wrap: anywhere`, as `.check` labels do.
  - States shown only by colour (a pressed toggle, a selected day) also get
    a rule for Windows contrast themes (`@media (forced-colors: active)`),
    which replace backgrounds.
  - A page's `<style>` only reaches elements written in that page: style an
    `<Icon>` inside it with `:global(svg)` (a unit test checks this).
  - Text people type can be in any language. Text boxes for it, and the
    elements that show it (names, titles, notes), get `dir="auto"`, so
    Hebrew or Arabic reads right to left with its "!" at its own end. Typed
    text inside a line of the app's own text (a note after a date) goes in
    `typedText()` from `@shkriuss/ui/typed-text`. A unit test checks every
    text box.
- **CSS first.** Component classes work with plain HTML, so even markup
  created by scripts (Tally's `<template>`) uses the same styles.

## Components

<!-- prettier-ignore -->
```astro
---
import { AppShell, Button, Card, AppIcon, Icon, DataControls } from '@shkriuss/ui';
---
<AppShell title="Settings">  <!-- page shell; leave out title on the home page -->
  <Button variant="primary" icon="plus">Add</Button>
  <Button icon="trash" label="Delete" />          <!-- icon-only buttons need a label -->
  <Button href="/about/">About</Button>           <!-- a link that looks like a button -->
  <Card title="Tally" href="https://tally.shkriuss.app/">Count things.</Card>
  <AppIcon icon="tally" color="indigo" size="lg" />
  <Icon name="info" label="Information" />        <!-- decorative unless it has a label -->
  <DataControls />                                <!-- "Your data": back up / restore / delete (backup={false}: delete only) -->
</AppShell>
```

Also available: `NotFound` (the 404 page), `ThemeSwitch` (already in the
footer), `SyncControls` (sync with the account, for apps with `"sync": true`)
and `PushControls` (notifications while closed, for apps with
`"pushNotifications": true`).

Script helpers, imported from TypeScript: `@shkriuss/ui/dom` (`required`,
for an element the page must have, and `showFieldProblems`, which shows each
of a form's problems next to its field, marks the field, and can focus the
first), `@shkriuss/ui/numbers` (`parseDecimal`, for amounts typed with a
point or a comma, read the way the person's language writes thousands, so
"1,500" is 1500 in English and 1.5 in German, in their own digits too; a
space between digits groups thousands and is checked like a comma, so
"12 50" isn't a number; with `{ cents: true }`, for amounts kept to the
cent, a point or comma that could be either before three digits ("1.500"
in French) isn't read, and `whichAmount` says what to ask;
`parseWhole`, for whole numbers like a mileage; `decimalText`, to fill a
field with a number so it reads back the same; `roundDecimal`; and
`formatMoney` with `CURRENCIES` and `currencyDigits`: number fields are
`type="text"` with `inputmode="decimal"` or `"numeric"`, never
`type="number"`, which reads "120.000" as 120),
`@shkriuss/ui/locale` (`DATE_LOCALE`: format dates and times with it, so
weekdays and months are in English like the rest of the page, even on a
phone set to another language), `@shkriuss/ui/text` (`compareText`, for
sorting lists alphabetically, and `foldText`, for comparing and searching
without minding case, accents or extra spaces: the accents of Latin, Greek
and Cyrillic letters, while the vowel signs of scripts like Hindi or Thai,
which are letters, still count),
`@shkriuss/ui/text-limit` (`watchTextLimit`, for a text box with a
`maxlength`: browsers keep only the start of a paste that's too long, and
ignore typing past the limit, without a word, so it says so under the box
and reads it out; say the limit in the box's hint too, where a paste could
reach it), `@shkriuss/ui/local-reminders` (notifications while the app is
open, with the same texts and the same iPhone and "blocked" cases in every
app; after the page slept, only ones a few minutes late show, and on the
night clocks go forward, ones in the skipped hour go off as the clocks
change; Calendar, which lists reminders on its page and shows the ones
missed while it was closed, uses its parts, `mountNotificationStatus` and
`showNotifications`, with its own words),
`@shkriuss/ui/long-lists` (for lists that
can grow to thousands: `shownCount` draws `PAGE_SIZE` (100) at a time behind
a "Show more" button, always keeping what has focus or was just saved, and
`waitForTyping` draws a search once typing pauses, not at every key),
`@shkriuss/ui/problem` (telling people about a problem the same way in every
app: `showProblem` puts it in the notice at the top of every page, which is
read out at once; `reportSave(store.save(…))` says when saving didn't work,
and why; `focusProblem` goes to a form's first wrong field, or reads its error
out if the person is in it already; `clearProblem` takes the notice away),
`@shkriuss/ui/worker` (`startWorker`, for heavy work; `askWorker` and, in the
worker, `answerQuestions`, to ask it something and wait for the answer; and,
inside a worker of an app with `"webAssembly": true`, `allowThreadScripts`),
`@shkriuss/ui/photos` (`smallerJpeg`, a smaller JPEG copy of a photo, made in
a worker, as Photos and Repairs do), `@shkriuss/ui/busy`
(`setBusy`, below), `@shkriuss/ui/keep-focus` (`keepFocus`, below),
`@shkriuss/ui/qr-code`, `@shkriuss/ui/service-worker`
(`offlineCopySaved`, to wait until the site works offline),
`@shkriuss/ui/sync-controls` and `@shkriuss/ui/push-controls`.

A button that waits for something (saving, the network) is **busy**, not
disabled. Disabling the button someone just pressed throws keyboard and
screen reader focus back to the top of the page. A busy one keeps focus,
looks and reads as unavailable, and ignores presses (also Enter in its form):

```ts
import { setBusy } from '@shkriuss/ui/busy';

setBusy(button, true);
try {
  await save();
} finally {
  setBusy(button, false);
}
```

Use `disabled` only for something that stays unavailable until the person
does something else, like "Continue" until a box is ticked. If a panel with
the focused button is hidden, move focus to what takes its place.

Drawing a list again (`replaceChildren`) removes the control that has
focus, and focus falls back to the top of the page. After the person's own
change, the app puts focus where it makes sense. A list drawn again in the
background (a change in another tab or from another device, or a new day)
goes through `keepFocus`, which puts focus back on the new copy of the same
control, found by its data attributes and its item's (`<li data-id="…">`).
If that item is gone, focus goes to the one after it (or before it), or else
to the control given:

```ts
import { keepFocus } from '@shkriuss/ui/keep-focus';

window.addEventListener('storage', () => keepFocus(reload, addButton));
```

Dialogs need nothing: when one closes after a redraw replaced the control
that opened it, AppShell puts focus on its new copy. An app whose close
handler moves focus itself (Shelf's forms) records `focusSpot()` when the
dialog opens and calls `returnFocus(spot, fallback)` when it closes.

QR codes (for example to open a link on another device) are drawn by a
script, since their content is usually made on the page:

```ts
import { renderQrCode } from '@shkriuss/ui/qr-code';

renderQrCode(element, 'https://…', 'QR code to open this on another device');
```

They're always black on white (`--qr-dark`, `--qr-light`), the way cameras
read them best, in both themes.

## CSS classes

- Layout: `.container` (`.container--wide`), `.stack` (`--sm`, `--lg`),
  `.cluster` (`--between`), `.grid`. Override spacing per element with the
  variables `--stack-gap`, `--cluster-gap`, `--grid-min` and `--grid-gap`.
- Text: `.lead`, `.muted`, `.prose`, `.visually-hidden`.
- Components: `.btn` (`--primary`, `--danger`, `--ghost`, `--icon`, `--lg`;
  a toggle button with `aria-pressed="true"` looks like `--primary`; a
  disabled or busy one, `aria-disabled="true"`, is grey but still readable),
  `.card` (`--link`), `.badge`, `.notice` (`--danger`), `.dialog`,
  `.app-icon`, `.code-text` (a key or link to copy or write down, in a
  monospace box), `.qr-code`, `.progress` (on `<progress>`: how far a
  download or long task has got) and `.disclosure` (on `<details>`: help that
  opens on tap).
- Forms: `.field` / `.field__label` / `.field__hint` / `.field__error`
  (hidden while empty), `.input` (also for `<select>` and `<textarea>`),
  `.field-row` (fields side by side that stack on narrow screens) and
  `.check` (a checkbox with its label).

## Changing the look everywhere

- **Accent colour:** change the `--color-accent*` and `--color-on-accent`
  tokens in `tokens.css`. Run `pnpm test`: the contrast tests tell you if a
  colour is too light or too dark in either theme.
- **Corner roundness, spacing, type scale:** change the matching tokens.
- **A component:** change it in `packages/ui`, never by overriding it in one
  app. If an app needs something new, add it to the design system.

## Adding an icon

Add a line to `packages/ui/src/icons/index.ts` (SVG shapes on a 24×24 grid,
stroke only), then add the same name to the icon list in
`.github/workflows/new-app.yml`, in alphabetical order. A unit test checks the
two lists match.
