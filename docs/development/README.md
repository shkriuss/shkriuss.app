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
- [Emulator tests](emulator-tests.md): the plan for instrumented tests on
  an emulator. Not set up yet.
- [Working with Claude](working-with-claude.md): who can do what, and how a
  change gets from a session to `main`.
- [Cloud environment](cloud-environment.md): the Claude Code cloud
  environment `android`.
- [Prompts](PROMPTS.md): ready-to-paste prompts for every phase.

What else belongs here, as each part is built:

- Design system: the tokens and the `Shk*` components.
