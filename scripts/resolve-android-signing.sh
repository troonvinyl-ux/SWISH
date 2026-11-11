#!/usr/bin/env bash
set -euo pipefail
signing_names=(SWISH_RELEASE_KEYSTORE_BASE64 SWISH_KEYSTORE_STORE_PASSWORD SWISH_KEYSTORE_KEY_PASSWORD SWISH_KEYSTORE_KEY_ALIAS SWISH_RELEASE_CERT_SHA256)
present=0
for name in "${signing_names[@]}"; do
  if [ -n "${!name:-}" ]; then present=$((present + 1)); fi
done
if [ "$present" = 0 ] && [ "$SWISH_RELEASE_CHANNEL" = preview-unified ]; then
  # Inspected original APK evidence is committed; the certificate is public/testing-only.
  node --input-type=module -e "import fs from 'node:fs';const b=JSON.parse(fs.readFileSync('release/android-installed-baseline.json','utf8')); if(b.signingKind!=='expo-public-testing-only'||b.certificateSha256!=='fac61745dc0903786fb9ede62a962b399f7348f0bb6f899b8332667591033b9c')throw Error('Original testing certificate evidence required')"
  keyfile="$RUNNER_TEMP/swish-original-testing.keystore"
  curl --fail --location --retry 2 --max-time 60 https://raw.githubusercontent.com/expo/expo/sdk-53/templates/expo-template-bare-minimum/android/app/debug.keystore --output "$keyfile"
  echo "221e0a3106aa4c3ccc154e0a418b55020b3f9ea6e84f92e8749cd9e2f39f5e58  $keyfile" | sha256sum --check
  actual=$(keytool -list -keystore "$keyfile" -storepass android -alias androiddebugkey | sed -n 's/.*SHA-256): //p' | tr -d ':' | tr '[:upper:]' '[:lower:]')
  test "$actual" = fac61745dc0903786fb9ede62a962b399f7348f0bb6f899b8332667591033b9c
  export SWISH_RELEASE_KEYSTORE_BASE64="$(base64 -w 0 "$keyfile")"
  export SWISH_KEYSTORE_STORE_PASSWORD=android SWISH_KEYSTORE_KEY_PASSWORD=android SWISH_KEYSTORE_KEY_ALIAS=androiddebugkey SWISH_RELEASE_CERT_SHA256="$actual"
  echo '::notice::TESTING ONLY: preserving the inspected original APK public Expo certificate.'
fi
node --input-type=module <<'NODE'
import {approvedCertificate,normalizeCertificate} from './scripts/android-release-policy.mjs';
const keys=['SWISH_RELEASE_KEYSTORE_BASE64','SWISH_KEYSTORE_STORE_PASSWORD','SWISH_KEYSTORE_KEY_PASSWORD','SWISH_KEYSTORE_KEY_ALIAS','SWISH_RELEASE_CERT_SHA256'];
const missing=keys.filter(k=>!process.env[k]);
if(missing.length) throw Error('Missing GitHub signing secrets/settings: '+missing.join(', '));
if(approvedCertificate(process.env.SWISH_RELEASE_CHANNEL,process.env.SWISH_RELEASE_CERT_SHA256)!==normalizeCertificate(process.env.SWISH_RELEASE_CERT_SHA256))throw Error('Signing certificate mismatch');
NODE
for name in "${signing_names[@]}"; do printf '%s=%s\n' "$name" "${!name}" >> "$GITHUB_ENV"; done
