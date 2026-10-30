#!/usr/bin/env bash
set -euo pipefail
APK="${1:?APK path required}"
NICHE="${2:?Canonical niche required}"
test -s "$APK"
# Reject HTML downloads, malformed ZIP files and missing binary Android content.
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
"$BUILD_TOOLS/aapt" dump badging "$APK" > /tmp/swish-apk-badging.txt
node - "$NICHE" <<'NODE'
const fs = require('node:fs');
const product = require(process.cwd() + '/niche-modules.json').products[process.argv[2]];
if (!product) throw new Error('Unknown niche');
const badging = fs.readFileSync('/tmp/swish-apk-badging.txt', 'utf8');
if (!badging.includes("package: name='" + product.androidPackage + "'")) throw new Error('APK package identity mismatch');
if (!badging.includes("application-label:'" + product.name + "'")) throw new Error('APK app label mismatch');
if (!badging.includes('launchable-activity:')) throw new Error('APK has no launcher activity');
console.log('APK ZIP, signature, package, label and launcher verified for ' + product.id);
NODE
# Device launch, authentication and inventory checks remain separate release gates.
