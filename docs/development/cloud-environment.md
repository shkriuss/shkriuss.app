# Cloud environment

Claude Code sessions for this project run in the cloud environment named
`android`. It is the fast loop for compiling, unit tests, lint and
screenshots. GitHub Actions stays the authoritative build. Taken from
section 13 of the [plan](../plan/PLAN.md).

## Settings

| Setting | Value |
|---|---|
| Name | `android` |
| Network access | Custom: `dl.google.com` plus the default list |
| Environment variables | See below |
| Setup script | See below |
| Secrets | None |

Newer versions of the Claude app call the Custom level **Limited**. There,
`dl.google.com` goes under **Allowed domains**, with **Allow package
managers** ticked.

Environment variables:

```text
ANDROID_HOME=/opt/android-sdk
BASH_DEFAULT_TIMEOUT_MS=600000
BASH_MAX_TIMEOUT_MS=1800000
```

- `ANDROID_HOME` tells Gradle where the Android SDK is.
- The two timeouts let long Gradle commands run: 10 minutes by default,
  30 minutes at most.

## What it cannot do

- It cannot run an emulator. There is no KVM.
- It holds no keys. Never put a secret in its variables or its setup script.
- Emulator tests, signing and releases run only in GitHub Actions.

## The Maven Central mirror

Maven Central answered "429 Too Many Requests" several times from the shared
cloud address. The setup script adds a cloud-only Gradle init script that
asks Google's public mirror of Maven Central first. That avoided the problem.

The mirror exists only in the cloud environment. Never add it to the
project's own repositories.

## Change the settings from a phone

1. Open a session at claude.ai/code or in the Code tab of the Claude app.
2. Tap the cloud environment menu in the session's title bar.
3. Tap **Edit** for `android`.
4. Change the network access, the variables or the setup script.
5. Save. New sessions use the new settings.
6. If you changed the setup script, update the copy below in a pull request.

The official guide is at
<https://code.claude.com/docs/en/cloud-environments>.

## Check the environment

Steps 1 to 4 of Session 0 in [PROMPTS.md](PROMPTS.md) check the tools, the
Android SDK, a test build and KVM. Use them after a change to the setup
script.

## Setup script

The setup script installs the Android SDK and the cloud-only Gradle init
script for the mirror.

<!-- SETUP SCRIPT START: the owner pastes the current setup script below. -->

```bash
# Open: the owner pastes the setup script here in review.
```

<!-- SETUP SCRIPT END -->

## Open

- `sdkmanager` is deprecated in favour of the Android CLI. Switch the setup
  script when the CLI is ready.
- The exact compile SDK and build tools to install. A test build worked with
  `platforms;android-37.0` and `build-tools;36.0.0`. Phase 0, step 3
  confirms them.
