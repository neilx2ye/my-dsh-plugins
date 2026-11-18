#!/usr/bin/env bash
# Pack every plugin in this monorepo into out/*.tgz, for a local release or CI.
# A plugin is any top-level directory whose package.json declares dsh.bundle.
set -euo pipefail
cd "$(dirname "$0")/.."

rm -rf out
mkdir -p out

packed=0
for dir in */; do
  pkg="${dir%/}"
  [ -f "$pkg/package.json" ] || continue
  node -e "process.exit(require('./$pkg/package.json').dsh?.bundle ? 0 : 1)" 2>/dev/null || continue
  npm pack "./$pkg" --pack-destination out
  packed=$((packed + 1))
done

if [ "$packed" -eq 0 ]; then
  echo "no plugin packages found" >&2
  exit 1
fi

echo
ls -lh out