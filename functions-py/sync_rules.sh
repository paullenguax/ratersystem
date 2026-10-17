#!/usr/bin/env bash
# Refresh the vendored rules from paullenguax/teac at a pinned tag.
# Usage: ./sync_rules.sh <tag>
set -euo pipefail
TAG="${1:?usage: ./sync_rules.sh <tag>}"
HERE="$(cd "$(dirname "$0")" && pwd)"
TMP="$(mktemp -d)"
trap 'rm -rf "$TMP"' EXIT

git clone --depth 1 --branch "$TAG" https://github.com/paullenguax/TEAC "$TMP/teac"
rm -rf "$HERE/teac_rules"
mkdir -p "$HERE/teac_rules"
cp "$TMP/teac/part3/tools/rules_part3.py" "$HERE/teac_rules/"
cp "$TMP/teac/part3/tools/callsigns.py"   "$HERE/teac_rules/"
touch "$HERE/teac_rules/__init__.py"

COMMIT="$(git -C "$TMP/teac" rev-parse --short HEAD)"
printf '%s %s\n' "$TAG" "$COMMIT" > "$HERE/teac_rules/VERSION"
echo "vendored rules at $TAG ($COMMIT)"
echo "record that string on every validation result the app stores."
