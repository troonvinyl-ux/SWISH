#!/usr/bin/env python3
"""Inspect compiled Android metadata and signing certificate without trusting generated source."""
import hashlib
import json
import os
from pathlib import Path
import sys
from loguru import logger
logger.remove()
from androguard.core.apk import APK

ANDROID = '{http://schemas.android.com/apk/res/android}'


def _runtime_value(raw):
    """Normalize Expo's runtime resource or fingerprint payload to its runtime ID.

    expo-updates may encode a policy runtime as ``file:fingerprint`` in the
    manifest while embedding the computed value as a plain string or JSON
    fingerprint record in the APK assets. Only return explicit runtime/hash
    fields; never substitute a guessed runtime or skip the compatibility gate.
    """
    if isinstance(raw, bytes):
        raw = raw.decode('utf-8', errors='strict')
    value = str(raw or '').strip().strip('"')
    if not value:
        return None
    try:
        record = json.loads(value)
    except (json.JSONDecodeError, TypeError):
        return value
    if isinstance(record, str):
        return record.strip()
    if isinstance(record, dict):
        for key in ('runtimeVersion', 'runtime_version', 'hash'):
            candidate = record.get(key)
            if isinstance(candidate, str) and candidate.strip():
                return candidate.strip()
    return value


def inspect_apk(filename):
    apk = APK(filename)
    resources = apk.get_android_resources()

    def resolve(value):
        if value and value.startswith('@'):
            values = resources.get_resolved_res_configs(int(value[1:], 16))
            unique = {str(item[1]) for item in values}
            if len(unique) != 1:
                raise ValueError('Ambiguous or missing compiled resource')
            return unique.pop()
        return value

    manifest = apk.get_android_manifest_xml()
    application = manifest.find('application')
    metadata = {row.get(ANDROID+'name'): resolve(row.get(ANDROID+'value')) for row in application.findall('meta-data')}
    prefix = 'expo.modules.updates.'
    runtime = _runtime_value(metadata.get(prefix+'EXPO_RUNTIME_VERSION'))
    if runtime and runtime.startswith('file:'):
        # Expo SDK plugins have used a manifest file reference plus an APK
        # asset; look for the canonical asset and its URI basename.
        references = [runtime[5:].lstrip('/'), 'assets/fingerprint']
        runtime = None
        for reference in references:
            asset = reference if reference.startswith('assets/') else 'assets/' + reference
            payload = apk.get_file(asset)
            if payload:
                runtime = _runtime_value(payload)
                if runtime:
                    break
    certs = apk.get_certificates_der_v2() or apk.get_certificates_der_v3()
    return {
        'package': apk.get_package(), 'versionName': apk.get_androidversion_name(),
        'versionCode': int(apk.get_androidversion_code()), 'launchableActivity': apk.get_main_activity(),
        'schemes': sorted({row.get(ANDROID+'scheme') for row in application.iter('data') if row.get(ANDROID+'scheme')}),
        'minSdk': int(apk.get_min_sdk_version()), 'targetSdk': int(apk.get_target_sdk_version()),
        'permissions': sorted(apk.get_permissions()),
        'certificateSha256': hashlib.sha256(certs[0]).hexdigest() if len(certs) == 1 else None,
        'updatesEnabled': metadata.get(prefix+'ENABLED') == 'true',
        'nativeUpdaterPresent': any(b'Lexpo/modules/updates/UpdatesController;' in dex for dex in apk.get_all_dex()),
        'updateUrl': metadata.get(prefix+'EXPO_UPDATE_URL'),
        'channel': json.loads(metadata.get(prefix+'UPDATES_CONFIGURATION_REQUEST_HEADERS_KEY') or '{}').get('expo-channel-name'),
        'runtimeVersion': runtime,
        'antiBrickingEnabled': metadata.get(prefix+'DISABLE_ANTI_BRICKING_MEASURES', 'false') != 'true',
        'hasEmbeddedUpdate': metadata.get(prefix+'HAS_EMBEDDED_UPDATE', 'true') == 'true',
        'checkOnLaunch': metadata.get(prefix+'EXPO_UPDATES_CHECK_ON_LAUNCH'),
        'apkSha256': hashlib.sha256(Path(filename).read_bytes()).hexdigest(),
    }


def verify_binary(actual, config, baseline, expected_cert, expected_runtime):
    expected = {
        'package': baseline['package'], 'versionName': config['version'],
        'versionCode': config['android']['versionCode'], 'certificateSha256': expected_cert,
        'updatesEnabled': True, 'updateUrl': config['updates']['url'],
        'channel': config['updates']['requestHeaders']['expo-channel-name'],
        'runtimeVersion': expected_runtime, 'antiBrickingEnabled': True, 'hasEmbeddedUpdate': True,
        'checkOnLaunch': 'ALWAYS', 'targetSdk': 36, 'nativeUpdaterPresent': True,
    }
    for key, value in expected.items():
        if not value or actual.get(key) != value:
            raise ValueError(f'Compiled APK mismatch: {key} (expected={value!r}, actual={actual.get(key)!r})')
    if not actual['launchableActivity'] or baseline['scheme'] not in actual['schemes']:
        raise ValueError('Original scheme or launcher missing')
    if not baseline['versionCode'] < actual['versionCode'] <= 2100000000:
        raise ValueError('APK versionCode cannot upgrade the installed baseline')
    if actual['minSdk'] > baseline['minSdk'] or actual['minSdk'] < 23:
        raise ValueError('APK minimum SDK incompatible with supported Android devices')
    for permission in ['android.permission.INTERNET', 'android.permission.CAMERA']:
        if permission not in actual['permissions']:
            raise ValueError('Required APK permission missing: '+permission)
    return actual


if __name__ == '__main__':
    actual = inspect_apk(sys.argv[1])
    if len(sys.argv) == 2:
        print(json.dumps(actual, indent=2))
    else:
        config = json.loads(Path(sys.argv[2]).read_text())
        baseline = json.loads(Path('release/android-installed-baseline.json').read_text())
        resolved = json.loads(Path(sys.argv[3]).read_text())
        cert = os.environ.get('SWISH_RELEASE_CERT_SHA256', '').replace(':','').lower().strip()
        verify_binary(actual, config, baseline, cert, resolved['runtimeVersion'])
        actual.update(platform='android', projectId=baseline['expectedProjectId'], sourceSha=os.environ['GITHUB_SHA'],
                      buildRunId=os.environ['GITHUB_RUN_ID'], binaryVerified=True,
                      signingKind='expo-public-testing-only' if cert == baseline['certificateSha256'] else 'owner-release',
                      deviceAcceptance='NOT TESTED')
        Path(sys.argv[4]).write_text(json.dumps(actual, indent=2)+'\n')
