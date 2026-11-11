#!/usr/bin/env bash
# Checks that an app's versionCode follows from its versionName, by the rule
# in docs/adr/0021-version-names-and-version-codes.md. Then a newer version
# always has a higher code, so Android installs it as an update:
# 1.0.0-rc.1 < 1.0.0-rc.2 < 1.0.0 < 1.0.1-alpha.1 < 1.0.1.
#
# Used by ci.yml for every app and by release.yml for the app it releases.
# This folder is owner-only, like the workflows (.github/CODEOWNERS).
#
# Usage: check-version-code.sh <versionName> <versionCode>
# Prints the code and exits 0 when they match. Otherwise prints an error
# and exits 1. Never prints an argument before it has been checked.

set -euo pipefail

if [ "$#" -ne 2 ]; then
  echo "::error::Usage: check-version-code.sh <versionName> <versionCode>"
  exit 2
fi
name="$1"
code="$2"

# MAJOR 0-209, MINOR 0-99, PATCH 0-99, then optionally -alpha.N, -beta.N or
# -rc.N with N 1-99. No leading zeros, so the numbers are never read as
# octal below.
pattern='^(0|[1-9][0-9]?|1[0-9]{2}|20[0-9])\.(0|[1-9][0-9]?)\.(0|[1-9][0-9]?)(-(alpha|beta|rc)\.([1-9][0-9]?))?$'
if ! [[ "$name" =~ $pattern ]]; then
  echo "::error::A versionName must look like 1.2.3, 1.2.3-alpha.1, 1.2.3-beta.1 or 1.2.3-rc.1, with MAJOR up to 209, MINOR, PATCH and the last number up to 99 (ADR 0021)."
  exit 1
fi
major="${BASH_REMATCH[1]}"
minor="${BASH_REMATCH[2]}"
patch="${BASH_REMATCH[3]}"
case "${BASH_REMATCH[5]}" in
  alpha) stage=1; number="${BASH_REMATCH[6]}" ;;
  beta) stage=2; number="${BASH_REMATCH[6]}" ;;
  rc) stage=3; number="${BASH_REMATCH[6]}" ;;
  *) stage=9; number=0 ;;
esac
expected=$((major * 10000000 + minor * 100000 + patch * 1000 + stage * 100 + number))

if ! [[ "$code" =~ ^[1-9][0-9]{0,9}$ ]]; then
  echo "::error::versionName $name needs versionCode $expected, but the versionCode is not a plain number (ADR 0021)."
  exit 1
fi
if [ "$code" != "$expected" ]; then
  echo "::error::versionName $name needs versionCode $expected, but it is $code (ADR 0021)."
  exit 1
fi
echo "versionName $name, versionCode $code: they match."
