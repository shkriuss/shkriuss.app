# Development

How the project is built, tested and released. Everything here works from a
phone or tablet browser. There is no local build.

Pages:

- [Build](build.md): how the Gradle project is set up and built,
  dependency verification, reproducible builds, and the unit and screenshot
  tests.
- [Continuous integration](ci.md): the GitHub Actions workflows that check
  every pull request, and what to do when one fails.
- [Test a pull request on a phone](test-a-pull-request.md): how to install
  a pull request's preview APK and look at its screenshots, with only a
  browser.
- [Release](release.md): how to run a release from a phone, check and
  publish the draft, and the rehearsal with Catalog.
- [Release checklist](release-checklist.md): what you check for every
  release, with the GrapheneOS checklist. Claude copies it for each
  version.
- [Signing key rehearsal](signing-key-rehearsal.md): how to rehearse
  restoring and rotating the signing key with throwaway keys, in a
  throwaway repository, and how to check the real backup and its two
  copies. With the two workflows to paste, in
  [signing-key-rehearsal/](signing-key-rehearsal/).
- [Hub site](site.md): how the website is built from the docs, checked
  and deployed to Cloudflare, its security headers, and how to set up
  Cloudflare from a phone.
- [Design system](design-system.md): the colour, type, shape and spacing
  tokens in `core/design`, how Material 3 is set up from them, the `Shk*`
  components and when to use each, and their tests.
- [Emulator tests](emulator-tests.md): the instrumented tests that run
  on emulators in CI, how a module gets them, the tests of the hardware
  keys and what they showed, and the steps for the three devices for
  what an emulator cannot check.
- [Third-party material](third-party.md): what others made and the apps
  contain, with the source, the licence and the notice of each. Today the
  recovery word list, and Tink with the libraries it brings.
- [Working with Claude](working-with-claude.md): who can do what, and how a
  change gets from a session to `main`.
- [Cloud environment](cloud-environment.md): the Claude Code cloud
  environment `android`.
- [Prompts](PROMPTS.md): ready-to-paste prompts for every phase.

What else belongs here, as each part is built:

- The other `Shk*` component batches of Phase 1, step 2, added to
  [design-system.md](design-system.md#components) as each is built.
