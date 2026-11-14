#!/usr/bin/env bash
set -euo pipefail
APK="${1:?APK required}"
SDK="${ANDROID_HOME:-${ANDROID_SDK_ROOT:-}}"
test -n "$SDK"
TOOLS="$(find "$SDK/build-tools" -mindepth 1 -maxdepth 1 -type d | sort -V | tail -1)"
test -s "$APK"
mkdir -p dist
unzip -t "$APK" >/dev/null
"$TOOLS/apksigner" verify --verbose --print-certs "$APK" > dist/unified-signature.txt 2>&1
"$TOOLS/aapt" dump badging "$APK" > dist/unified-badging.txt
# Android build-tools has used both `SHA-256` and `SHA256`, and some releases
# indent the certificate diagnostics. Parse the verifier's certificate line,
# rather than accepting a missing certificate or changing the expected identity.
ACTUAL="$(awk '
  tolower($0) ~ /^[[:space:]]*signer #[0-9]+ certificate sha-?256 digest:/ {
    value=$0
    sub(/^[^:]*:[[:space:]]*/, "", value)
    gsub(/[:[:space:]]/, "", value)
    print tolower(value)
    exit
  }
' dist/unified-signature.txt)"
EXPECTED="$(printf '%s' "${SWISH_RELEASE_CERT_SHA256:?Original certificate SHA-256 required}" | tr -d ':[:space:]' | tr '[:upper:]' '[:lower:]')"
if [ -z "$ACTUAL" ] || [ "$ACTUAL" != "$EXPECTED" ]; then
  echo "Original signing certificate mismatch: expected=$EXPECTED actual=${ACTUAL:-unavailable}"
  echo 'Signer diagnostics (public certificate fingerprints only):'
  grep -Ei '^[[:space:]]*Signer #[0-9]+ certificate SHA-?256 digest:' dist/unified-signature.txt || true
  exit 1
fi
test "$(grep -Eic '^[[:space:]]*Signer #[0-9]+ certificate SHA-?256 digest:' dist/unified-signature.txt)" = 1 || { echo 'Multiple signing certificates require manual original-identity review'; exit 1; }
cp "$APK" dist/swish-unified.apk
sha256sum dist/swish-unified.apk > dist/swish-unified.sha256
export SWISH_VERIFIED_CERT="$ACTUAL"
"${SWISH_APK_PYTHON:?APK inspector Python required}" scripts/inspect-unified-apk.py "$APK" dist/unified-runtime-config.json dist/unified-android-runtime.json dist/unified-android-evidence.json
