# Metro dependency-tree recovery

## Reported failure

The build environment reported two installed copies of `metro-core` and `metro-file-map` while validating Expo's Metro toolchain. This check occurs before application bundling; a Metro resolver blockList does not fix the installed dependency tree.

## Repository changes

- `.npmrc` now selects pnpm's supported `node-linker=hoisted` layout instead of individually public-hoisting Metro packages from an isolated store.
- `metro.config.js` delegates to `expo/metro-config` without excluding Metro package sources.
- Babel's misleading blockList recovery comments were removed; the Babel preset is unchanged.

The branded GitHub APK workflow, all five branded EAS profiles, app identities, application logic, database, authentication, AI and marketplace integrations are unchanged. No installed packages, dependency manifests or lockfiles were edited.

## Required verification

These configuration changes apply on a fresh dependency installation, not to an already installed toolchain. A rebuilt environment must install dependencies with the updated `.npmrc`, then start Expo with its cache cleared (`pnpm exec expo start --clear`). Use the existing branded workflow to verify Android separately.

No dependency installation, Jest execution, Metro bundle or Android build was available in this editing session. The reported installed copies could not be inspected, so this change addresses the repository's installation configuration; it does not prove the current platform-managed dependency tree is repaired. A hoisted layout also does not force incompatible package versions to become one version.

If the same pre-bundling mismatch remains after a fresh install, the platform's managed Expo template/toolchain requires repair. Send the exact dependency-tree error to `contact@onspace.ai`. Do not delete individual Metro packages, add forwarding stubs, pin guessed Metro versions, or mask packages with resolver exclusions.
