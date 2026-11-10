# Cloud environment

Claude Code sessions for this project run in the cloud environment named
`android`. It is the fast loop for compiling, unit tests, lint and
screenshots. GitHub Actions stays the authoritative build. Taken from
section 13 of the [plan](../plan/PLAN.md).

## Settings

| Setting | Value |
|---|---|
| Name | `android` |
| Network access | Custom: `dl.google.com`, `keys.openpgp.org` and `pgp.mit.edu`, plus the default list |
| Environment variables | See below |
| Setup script | See below |
| Secrets | None |

Newer versions of the Claude app call the Custom level **Limited**. There,
the three hosts go under **Allowed domains**, with **Allow package managers**
ticked.

Why each allowed domain is there:

- `dl.google.com`: the Android SDK and Google's Maven repository.
- `keys.openpgp.org` and `pgp.mit.edu`: PGP key servers. Gradle asks these,
  and `keyserver.ubuntu.com`, when it writes PGP verification metadata.
  `keyserver.ubuntu.com` is reachable without being listed.

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

This is a copy of the script in the environment's settings. Keep the two
identical.

<!-- SETUP SCRIPT START: keep this copy identical to the environment's setup script. -->

```bash
#!/bin/bash
# shkriuss.app cloud environment setup script.
# Installs the Android SDK and a Gradle mirror setting for cloud sessions.
# It never blocks a session: if it fails, ask Claude to run
#   install-android-sdk
# and to show /var/log/android-sdk-setup.log

cat > /usr/local/bin/install-android-sdk <<'INSTALLER'
#!/bin/bash
set -euo pipefail

export ANDROID_HOME="${ANDROID_HOME:-/opt/android-sdk}"
TOOLS_ZIP="commandlinetools-linux-15859902_latest.zip"
TOOLS_SHA256="4e4c464f145a7512b57d088ac6c278c03c9eea610886b35a5e0804e74eedf583"
PACKAGES=("platform-tools" "platforms;android-37.0" "build-tools;36.0.0")

sdkmanager="$ANDROID_HOME/cmdline-tools/latest/bin/sdkmanager"
if [ ! -x "$sdkmanager" ]; then
  tmp="$(mktemp -d)"
  trap 'rm -rf "$tmp"' EXIT
  curl -fsSL --retry 3 -o "$tmp/tools.zip" \
    "https://dl.google.com/android/repository/$TOOLS_ZIP"
  echo "$TOOLS_SHA256  $tmp/tools.zip" | sha256sum -c -
  unzip -q "$tmp/tools.zip" -d "$tmp"
  mkdir -p "$ANDROID_HOME/cmdline-tools"
  rm -rf "$ANDROID_HOME/cmdline-tools/latest"
  mv "$tmp/cmdline-tools" "$ANDROID_HOME/cmdline-tools/latest"
fi

# sdkmanager is a Java program. Tell it about the proxy if Java was not told.
proxy_args=()
if [ -n "${HTTPS_PROXY:-}" ] && [[ "${JAVA_TOOL_OPTIONS:-}" != *proxyHost* ]]; then
  hostport="${HTTPS_PROXY#*://}"
  hostport="${hostport##*@}"
  hostport="${hostport%%/*}"
  proxy_args=(--proxy=http "--proxy_host=${hostport%:*}" "--proxy_port=${hostport##*:}")
fi

set +o pipefail
yes | "$sdkmanager" "${proxy_args[@]}" --licenses > /dev/null
set -o pipefail
"$sdkmanager" "${proxy_args[@]}" "${PACKAGES[@]}" > /dev/null

# Cloud sessions only: ask Google's public mirror of Maven Central first.
# Maven Central limits how often the shared cloud address may download.
# The project's dependency verification still checks every file.
mkdir -p "$HOME/.gradle/init.d"
cat > "$HOME/.gradle/init.d/cloud-mirror.init.gradle.kts" <<'GRADLE'
val centralMirror = "https://maven-central.storage-download.googleapis.com/maven2/"

beforeSettings {
    pluginManagement {
        repositories {
            maven { name = "MavenCentralMirror"; url = uri(centralMirror) }
        }
    }
    dependencyResolutionManagement {
        repositories {
            maven { name = "MavenCentralMirror"; url = uri(centralMirror) }
        }
    }
}

allprojects {
    tasks.withType<Test>().configureEach {
        // Robolectric downloads Android images itself when tests run.
        systemProperty("robolectric.dependency.repo.url", centralMirror)
        systemProperty("robolectric.dependency.repo.id", "MavenCentralMirror")
    }
}
GRADLE

echo "Android SDK ready in $ANDROID_HOME"
INSTALLER
chmod +x /usr/local/bin/install-android-sdk

if install-android-sdk > /var/log/android-sdk-setup.log 2>&1; then
  echo "Android SDK installed."
else
  echo "Android SDK setup failed. See /var/log/android-sdk-setup.log"
fi
exit 0
```

<!-- SETUP SCRIPT END -->

## What Phase 0, step 3 found

- The packages the setup script installs are the right ones:
  `platforms;android-37.0` for compile SDK 37, and `build-tools;36.0.0`,
  which the build pins. See [build.md](build.md).
- Robolectric now runs offline. Gradle downloads its Android image and
  checks it. The two Robolectric lines in the init script are no longer
  used. They do no harm.
- Two hosts are blocked here:
  - `downloads.gradle.org`, where Gradle's `.sha256` files now live. The
    checksums on `services.gradle.org` work instead.
  - `repo.gradle.org`, which Android Lint asks for the newest Gradle
    version. See "Open" in [build.md](build.md#open). Allowing it would make
    lint here behave as it will in GitHub Actions.
- Key server lookups failed now and then while Gradle wrote the
  verification metadata. A second run with `--refresh-keys` worked.
- No build download answered 429. The build fetched every Maven Central
  file through the mirror and never contacted `repo.maven.apache.org`.
  Direct test requests to `repo.maven.apache.org` from the same session did
  answer 429, so the mirror is still needed.

## Open

- `sdkmanager` is deprecated in favour of the Android CLI. Switch the setup
  script when the CLI is ready.
- Whether to remove the two unused Robolectric lines from the init script,
  and whether to allow `repo.gradle.org`. Only the owner can change the
  environment's settings.
