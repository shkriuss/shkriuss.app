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

Script helpers, imported from TypeScript: `@shkriuss/ui/numbers`
(`parseDecimal`, for amounts typed with a point or a comma),
`@shkriuss/ui/locale` (`DATE_LOCALE`: format dates and times with it, so
weekdays and months are in English like the rest of the page, even on a
phone set to another language), `@shkriuss/ui/text` (`compareText`, for
sorting lists alphabetically),
`@shkriuss/ui/worker` (`startWorker`, for heavy work), `@shkriuss/ui/qr-code`,
`@shkriuss/ui/service-worker`, `@shkriuss/ui/sync-controls` and
`@shkriuss/ui/push-controls`.

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
  a toggle button with `aria-pressed="true"` looks like `--primary`),
  `.card` (`--link`), `.badge`, `.notice` (`--danger`), `.dialog`,
  `.app-icon`, `.code-text` (a key or link to copy or write down, in a
  monospace box) and `.qr-code`.
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
`.github/workflows/new-app.yml`. A unit test checks the two lists match.
