# Rules for AI agents

The rules of this repository are in [CLAUDE.md](CLAUDE.md), and the
rules for some paths are in `.claude/rules/`. Read CLAUDE.md whole
before you do anything here. The rules apply to every agent, whoever
made it.

Only Claude builds here. Other agents review and audit: they read, and
they report. They do not push commits, open pull requests or change
files, unless the owner asks for it in that pull request.

## Code Review Rules

Review the change against CLAUDE.md. Report only faults that matter.
Each finding names the file and the line, says what goes wrong and
when, and names the rule it breaks.

Always report:

1. A broken hard rule of CLAUDE.md. Look hardest for: network use or
   `android.permission.INTERNET` outside `android/app/sync`; WebView or
   code loading; native code; analytics or crash reporting; logging in
   shipped code; a secret in code, docs or logs.
2. A change to an owner-only file (`.github/CODEOWNERS` lists them)
   that the pull request description does not back with the owner's
   sentence asking for exactly that change.
3. A new or changed dependency without an ADR, or without
   `android/gradle/libs.versions.toml` and
   `android/gradle/verification-metadata.xml` in the same pull request.
4. Anything that weakens a check: lint, tests, dependency verification,
   screenshot checks, the APK rules, the token permissions of a
   workflow.
5. Cryptography outside `android/core/crypto`, or a construction that
   `docs/security/crypto-design.md` does not describe. Alarms or
   notifications outside `android/core/notify`.
6. A way to lose or expose the user's data: a database change without
   a migration and its test, a hard delete of a synced record, a
   backup or sync format change without a new version and a reader for
   the old one, a new exported component, a pending intent that is
   mutable or implicit, a permission that
   `docs/security/permissions.md` does not list.
7. New behaviour without a test, or a test that cannot fail.
8. Code that does something else than the app's specification in
   `docs/apps/` or the user guide in `docs/user/` says.

Do not report style, naming, formatting or missing comments. Do not
propose new dependencies or larger rewrites.

Report a fault once. Do not raise again a finding that was answered in
a resolved thread, unless the code it is about has changed since.
