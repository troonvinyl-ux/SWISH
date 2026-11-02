#!/usr/bin/env bash
set -euo pipefail
APK="${1:?APK path required}"
EXPECTED_PACKAGE="com.swish.inventory"
EXPECTED_LABEL="SWISH Master Admin"
test -s "$APK"
python3 - "$APK" <<'PY'
import sys, zipfile
with zipfile.ZipFile(sys.argv[1]) as apk:
    if apk.testzip() is not None: raise SystemExit('APK ZIP integrity check failed')
    names = set(apk.namelist())
    if 'AndroidManifest.xml' not in names or 'classes.dex' not in names: raise SystemExit('Not an Android APK')
    if apk.read('AndroidManifest.xml')[:4] != bytes([3, 0, 8, 0]): raise SystemExit('Android manifest is not binary AXML')
PY
SDK="${ANDROID_HOME:-${ANDROID_SDK_ROOT:-}}"
test -n "$SDK"
BUILD_TOOLS="$(find "$SDK/build-tools" -mindepth 1 -maxdepth 1 -type d | sort -V | tail -1)"
"$BUILD_TOOLS/apksigner" verify --verbose "$APK"
"$BUILD_TOOLS/aapt" dump badging "$APK" > /tmp/swish-master-apk-badging.txt
node - "$EXPECTED_PACKAGE" "$EXPECTED_LABEL" <<'NODE'
const fs = require('node:fs');
const [pkg, label] = process.argv.slice(2);
const badging = fs.readFileSync('/tmp/swish-master-apk-badging.txt', 'utf8');
if (!badging.includes("package: name='" + pkg + "'")) throw new Error('Master Admin package identity mismatch');
if (!badging.includes("application-label:'" + label + "'")) throw new Error('Master Admin app label mismatch');
if (!badging.includes("targetSdkVersion:'36'")) throw new Error('Master Admin APK must target Android 16 (API 36)');
if (!badging.includes('launchable-activity:')) throw new Error('Master Admin APK has no launcher activity');
console.log('APK ZIP, signature, package, label and launcher verified for Master Admin');
NODE
