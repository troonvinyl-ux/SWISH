#!/usr/bin/env bash
set -euo pipefail
# Respect the repository's actual lockfile; never regenerate it in CI.
if [ -f pnpm-lock.yaml ]; then
  pnpm install --frozen-lockfile --prefer-offline
elif [ -f package-lock.json ]; then
  npm ci
else
  echo 'No supported committed lockfile found. Commit the intended lockfile before building.' >&2
  exit 1
fi
