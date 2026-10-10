# ADR 0012: Typed message modules instead of Paraglide JS

- **Status:** Accepted
- **Date:** 2026-10-05

## Context

[ADR 0005](0005-frontend-stack.md) chose Paraglide JS for the UI's text, in English only at launch. When step 1.2 reached `@shkriuss/i18n`, its current version, 2.25.4 (as checked on 2026-10-05; not re-verified on 2026-10-10), turned out to cost more than that choice assumed:

- **Build-time weight:** its compiler loads translation projects through `@inlang/sdk`, which brings in `@lix-js/sdk` (117 MB), `binaryen` (96 MB) and `@bytecodealliance/jco-transpile`. That is more than 220 MB of code that runs with full trust in every install and every build ([threat model](../threat-model.md) T2).
- **Code from a CDN:** its default project settings load its message-format plugin from `cdn.jsdelivr.net` during the build. The lockfile, the release-age delay and the other supply-chain controls of [ADR 0007](0007-security-baseline.md) do not cover that code.

All of this would compile messages in one language. The UI's text is short and in English ([architecture §10](../architecture.md#10-user-interface)). What it needs are typed inputs, plural forms and regional formats, which TypeScript and `Intl` already provide.

## Decision

1. **Messages are TypeScript.** Every package or app with UI text has a message module, defined with `@shkriuss/i18n`. Its messages are functions from typed inputs to strings. There is no compiler, no runtime library and no dependency.
2. **Formats and plurals come from `Intl`.** Messages write numbers, dates, sizes and lists with the formats of `@shkriuss/i18n`: English, with the device's regional conventions. They choose plural forms with `Intl.PluralRules`.
3. **UI text comes only from messages.** Oxlint's `react/jsx-no-literals` refuses text written straight into JSX, so every user-facing string goes through `@shkriuss/i18n` (`CLAUDE.md`, product rule 4). The rule is turned on with the first message module, and the hub's text moves into one then. (Since 2026-10-10, the rule also refuses strings in the attributes that people read or hear, and `pnpm check code` refuses a string at the start of such an attribute's `{…}` expression and a literal `document.title`, which the rule does not see.)
4. **Translations, if ever:** each language would be a module of the same type. TypeScript would hold it to every message and every input, and the app would pick the module for the device's language.

This replaces the "Translations" row of ADR 0005. The rest of ADR 0005 stands.

## Consequences

- UI text needs no build step and no dependency. Messages are code: reviewed, type-checked and tested like code. Bundles leave out the messages an app does not use.
- A missing message, or a message called with the wrong inputs, is a type error.
- There is no translation tooling: no message editor, no extraction and no machine translation. If people who do not write TypeScript ever translate the UI, a new ADR can bring in a compiler then.

## Alternatives considered

- **Paraglide JS, as ADR 0005 decided:** rejected for the weight and the code from a CDN above. Keeping a copy of its plugin in the repository would stop the download, but not the dependencies.
- **Runtime libraries, such as FormatJS or i18next:** they interpret messages in the browser, which puts their library in every app's JavaScript for text that is in English.
- **Lingui:** a compiler with macros and dependencies of its own. It is the same trade as Paraglide, with nothing gained for English.
