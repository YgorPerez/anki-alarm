#!/usr/bin/env bash
set -euo pipefail
# Explicit update group id: never guess which release was good.
: "${1:?Usage: bash scripts/release/rollback.sh LAST_GOOD_UPDATE_GROUP_ID}"
cd "$(dirname "$0")/../../apps/mobile"
pnpm exec eas update:republish --group "$1" --destination-channel production --platform android --non-interactive
