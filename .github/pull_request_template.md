## What and why

<!-- In plain language: what changes for someone using the apps, and why. -->

## How it was checked

- [ ] CI is green (formatting, lint, types, unit tests, build, size and CSP, browser and accessibility tests)
- [ ] Asked "how could it break?" (two devices, a slow or wrong server, full storage, old data, iPhone), and tests cover the answers
- [ ] Looked at the preview links on a phone, in light and dark mode
- [ ] For a new or changed app: `apps.json` (`dataStored`) still says what the app saves
- [ ] Docs that describe what changed say it now (`CLAUDE.md`, `docs/`, ADR notes, `SECURITY.md`, the audit brief)
