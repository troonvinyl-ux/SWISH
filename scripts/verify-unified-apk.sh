#!/usr/bin/env bash
set -euo pipefail
APK="${1:?APK required}"
SDK="${ANDROID_HOME:-${ANDROID_SDK_ROOT:-}}"
test -n "$SDK"
TOOLS="$(find "$SDK/build-tools" -mindepth 1 -maxdepth 1 -type d | sort -V | tail -1)"
test -s "$APK"
mkdir -p dist
unzip -t "$APK" >/dev/null
"$TOOLS/apksigner" verify --verbose --print-certs "$APK" > dist/unified-signature.txt
"$TOOLS/aapt" dump badging "$APK" > dist/unified-badging.txt
ACTUAL="$(sed -n 's/^Signer #1 certificate SHA-256 digest: //p' dist/unified-signature.txt | tr -d ':[:space:]' | tr '[:upper:]' '[:lower:]')"
EXPECTED="$(printf '%s' "${SWISH_RELEASE_CERT_SHA256:?Original certificate SHA-256 required}" | tr -d ':[:space:]' | tr '[:upper:]' '[:lower:]')"
test -n "$ACTUAL" && test "$ACTUAL" = "$EXPECTED" || { echo 'Original signing certificate mismatch'; exit 1; }
test "$(grep -c '^Signer #[0-9]* certificate SHA-256 digest:' dist/unified-signature.txt)" = 1 || { echo 'Multiple signing certificates require manual original-identity review'; exit 1; }
cp "$APK" dist/swish-unified.apk
sha256sum dist/swish-unified.apk > dist/swish-unified.sha256
export SWISH_VERIFIED_CERT="$ACTUAL"
node --input-type=module <<'NODE'
import fs from 'node:fs';
import crypto from 'node:crypto';
const config=JSON.parse(fs.readFileSync('dist/unified-runtime-config.json','utf8'));
const original=JSON.parse(fs.readFileSync('app.json','utf8')).expo;
const badging=fs.readFileSync('dist/unified-badging.txt','utf8');
if(!badging.includes("package: name='"+original.android.package+"'")) throw Error('APK package changed');
if(!badging.includes("application-label:'SWISH'") || !badging.includes('launchable-activity:')) throw Error('Unified launcher missing');
const strings=fs.readFileSync('android/app/src/main/res/values/strings.xml','utf8');
const runtime=strings.match(/<string name="expo_runtime_version"[^>]*>([^<]+)<\/string>/)?.[1];
if(!runtime) throw Error('Actual generated native runtime was not recorded');
const checksum=crypto.createHash('sha256').update(fs.readFileSync('dist/swish-unified.apk')).digest('hex');
const evidence={platform:'android',sourceSha:process.env.GITHUB_SHA,package:original.android.package,apkSha256:checksum,certificateSha256:process.env.SWISH_VERIFIED_CERT,runtimeVersion:runtime,channel:config.updates.requestHeaders['expo-channel-name'],binaryVerified:true,deviceAcceptance:'NOT TESTED',createdAt:new Date().toISOString()};
fs.writeFileSync('dist/unified-android-evidence.json',JSON.stringify(evidence,null,2));
NODE
