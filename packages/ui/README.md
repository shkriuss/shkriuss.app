# @shkriuss/ui

The look that every app shares ([architecture §10](../../docs/architecture.md#10-user-interface)): design tokens, a light and a dark theme, and base styles, on [Tailwind CSS](https://tailwindcss.com) 4 ([ADR 0005](../../docs/decisions/0005-frontend-stack.md)). Accessible components built on React Aria come next.

| File          | What it is                                                                          |
| ------------- | ----------------------------------------------------------------------------------- |
| `styles.css`  | Tailwind CSS with the design tokens, both themes and the base styles                |
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

## Tests

- **Contrast** (`tokens.test.ts`): the tests read the tokens from `styles.css`, their only source. In both themes they hold to WCAG 2.2 AA:
  - text in `ink`, `ink-muted`, `accent` and `danger` on `canvas` and `surface`, and `accent-ink` and `danger-ink` on their colors: at least 4.5;
  - `line-strong` and `focus` on `canvas` and `surface`: at least 3.
- **The contrast ratio** (`contrast.test.ts`) is checked against known values, such as 21 for black on white, and the gray that just passes 4.5 on white.
- **In real browsers,** the hub's end-to-end tests check its colors in both themes, the focus outline, and that axe finds no accessibility problem in either theme.
