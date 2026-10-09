# @shkriuss/ui

The look that every app shares ([architecture §10](../../docs/architecture.md#10-user-interface)): design tokens, a light and a dark theme, base styles, and accessible components built on [React Aria](https://react-spectrum.adobe.com/react-aria/), on [Tailwind CSS](https://tailwindcss.com) 4 ([ADR 0005](../../docs/decisions/0005-frontend-stack.md)).

| File          | What it is                                                                          |
| ------------- | ----------------------------------------------------------------------------------- |
| `styles.css`  | Tailwind CSS with the design tokens, both themes and the base styles                |
| `index.ts`    | The components, and the contrast ratio                                              |
| `contrast.ts` | The WCAG 2.2 contrast ratio of two colors, which the tests hold every token pair to |

## Use

An app imports the stylesheet from its entry script, before anything else, and adds Tailwind's Vite plugin to its build:

```ts
// src/main.tsx
import "@shkriuss/ui/styles.css";
```

```ts
// vite.config.ts
import { edge } from "@shkriuss/edge";
import tailwindcss from "@tailwindcss/vite";
import react from "@vitejs/plugin-react";
import { defineConfig } from "vite";

export default defineConfig({ plugins: [tailwindcss(), react(), edge()] });
```

Importing it from a script keeps it a module of the build, so `/licenses.txt` lists Tailwind CSS, which the stylesheet inlines. Components use Tailwind's utilities with the tokens' names, such as `text-ink-muted`, `bg-surface` or `border-line-strong`. The build is a single CSS file of the app's own origin, so the Content-Security-Policy's `style-src 'self'` allows it.

## Tokens

**Colors.** Only these exist: the stylesheet removes Tailwind's own palette, so every app uses the same colors.

| Token         | Use                                                | Light     | Dark      |
| ------------- | -------------------------------------------------- | --------- | --------- |
| `canvas`      | The page                                           | `#ffffff` | `#111827` |
| `surface`     | Areas raised from the page                         | `#f3f4f6` | `#1f2937` |
| `ink`         | Text                                               | `#111827` | `#f3f4f6` |
| `ink-muted`   | Secondary text                                     | `#4b5563` | `#9ca3af` |
| `line`        | Lines that only divide                             | `#e5e7eb` | `#374151` |
| `line-strong` | Borders of controls                                | `#6b7280` | `#9ca3af` |
| `accent`      | Links and main actions                             | `#1d4ed8` | `#93c5fd` |
| `accent-ink`  | Text on `accent`                                   | `#ffffff` | `#111827` |
| `danger`      | Errors and destructive actions                     | `#b91c1c` | `#fca5a5` |
| `danger-ink`  | Text on `danger`                                   | `#ffffff` | `#111827` |
| `focus`       | The outline of the element with the keyboard focus | `#1d4ed8` | `#93c5fd` |

- **Themes:** the dark theme follows the device's setting, `prefers-color-scheme`. Both themes set every token, which a test checks.
- **Accent:** each app may set its own `accent`, `accent-ink` and `focus` in both themes. They must keep the contrasts below.
- **Fonts:** the device's system fonts. Nothing is loaded from anywhere else.
- **Other scales:** Tailwind's own sizes, spacing and radii.

**Base styles:**

- **Links** are underlined, so they do not stand out by color alone (WCAG 1.4.1).
- **Focus:** the element that has the keyboard focus gets a 2-pixel outline in `focus` (WCAG 2.4.7).
- **Reduced motion:** when the device asks for it, animations and transitions end at once.
- **`page`:** a utility for a page's content, which keeps it readable in width and clear of the notch and the rounded corners of the screen.

## Components

```tsx
import { Banner, Button, Checkbox, Dialog, FileButton, Link, Select, Switch, TextArea, TextField } from "@shkriuss/ui";

<Button variant="primary" onPress={save}>{m.save()}</Button>
<TextField label={m.name()} description={m.nameHelp()} errorMessage={m.nameMissing()} />
```

| Component    | What it is                                                                                                                 |
| ------------ | -------------------------------------------------------------------------------------------------------------------------- |
| `Button`     | A button: `primary` for the main action, `secondary` (the default), or `danger` for one that deletes                       |
| `Link`       | A link, underlined in the accent color                                                                                     |
| `TextField`  | A text field with its label, an optional description, and an error message while it is invalid                             |
| `TextArea`   | A field for text of several lines, like `TextField`; `spellCheck="false"` turns the browser's spell checker off            |
| `Select`     | A choice of one of a few options, on the browser's own `<select>`, which phones show with their own picker                 |
| `Switch`     | A switch that turns a setting on or off at once                                                                            |
| `Checkbox`   | A checkbox with its label, which ticks something off or back, such as an item of a list                                    |
| `Dialog`     | A modal dialog: it takes the focus, closes with Escape and gives the focus back; the page behind it does not scroll        |
| `FileButton` | A button that lets the user pick a file in the browser's file picker; any type of file, which the app tells by its content |
| `Banner`     | A notice that does not interrupt, such as an update; screen readers read it as it appears in the frame's status region     |

- **Accessible:** React Aria gives them the keyboard, pointer and screen-reader behavior of WCAG 2.2. Buttons, switches, checkboxes and selects are at least 44 by 44 pixels, so that they are easy to tap.
- **Contrast themes:** Windows' contrast themes (forced colors) drop backgrounds and impose their own colors. Filled buttons have a transparent border, which those themes draw, and checkboxes and switches take the themes' colors, so that a ticked box and a switch that is on still show it.
- **Long words,** such as a link in a checkbox's label or in a dialog's title, break rather than widen the page on a narrow phone (WCAG 1.4.10).
- **One look:** components take no `className` or `style`. Apps lay them out with elements around them.
- **Text:** labels and messages come from the app's message module ([ADR 0012](../../docs/decisions/0012-typed-messages.md)).

**Under the Content-Security-Policy.** React Aria works under the production headers, with two adjustments, and the end-to-end tests fail if it adds anything that the policy refuses:

- **Pressable elements:** React Aria adds a stylesheet to the page with `touch-action` for buttons and links. `style-src 'self'` refuses that, so `styles.css` has the same rule, and importing the package adds an element with the stylesheet's id, which tells React Aria it is there.
- **Modal dialogs:** React Aria's modal would add a stylesheet on iOS to keep the page still. `Dialog` uses the browser's `<dialog>` instead, and `styles.css` keeps the page from scrolling while one is open.
- **File picker:** React Aria's `FileTrigger` hides its file input through the element's `style` object, which the policy allows, unlike a `style` attribute.
- **Not yet usable:** number and date fields clear their announcements with `innerHTML`, which Trusted Types refuse, and React Aria's modal popovers, as in `Select`, `Menu` and `ComboBox`, add the iOS stylesheet. Each needs a solution like the two above before an app uses it.

## Tests

- **Contrast** (`tokens.test.ts`): the tests read the tokens from `styles.css`, their only source. In both themes they hold to WCAG 2.2 AA:
  - text in `ink`, `ink-muted`, `accent` and `danger` on `canvas` and `surface`, and `accent-ink` and `danger-ink` on their colors: at least 4.5;
  - `line-strong` and `focus` on `canvas` and `surface`: at least 3.
- **The contrast ratio** (`contrast.test.ts`) is checked against known values, such as 21 for black on white, and the gray that just passes 4.5 on white.
- **In real browsers,** the hub's end-to-end tests check its colors in both themes, the focus outline, and that axe finds no accessibility problem in either theme.
- **Components, in real browsers:** the platform tests ([`tooling/platform-e2e`](../../tooling/platform-e2e)) show every component on one page, under the production headers in Chromium, Firefox and WebKit:
  - axe finds no accessibility problem, in either theme;
  - React Aria adds no stylesheet, and pressable elements still get its `touch-action`;
  - buttons respond to the pointer, Enter and Space, and not while disabled;
  - buttons and switches measure at least 44 by 44 pixels;
  - a text field's label, description and error reach screen readers;
  - a switch turns on and off with the pointer and the keyboard;
  - a dialog takes the focus, keeps the page still, closes with Escape and gives the focus back;
  - a banner is a status that screen readers read.
