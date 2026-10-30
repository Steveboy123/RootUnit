#!/usr/bin/env bash
# Build RPI-head-unit-v<version>-RootUnit.zip from the COMMITTED files, in the layout the head unit's own updater expects:
# one top-level folder holding package.json (name "rpi-head-unit"), no node_modules, dist, data or .env.
# Use it for a release: Settings -> Software update on the Pi picks the file up from Downloads.
# The name keeps the RPI-head-unit prefix on purpose: a v2 head unit only offers ZIPs with that prefix, so it can update to RootUnit.
set -euo pipefail
cd "$(dirname "$0")/.."

version="$(node -p "require('./package.json').version")"
name="RPI-head-unit-v${version}-RootUnit"
out="${1:-${name}.zip}"

if ! git diff --quiet || ! git diff --cached --quiet; then
  echo "warning: uncommitted changes are NOT in the ZIP (it is built from HEAD)." >&2
fi

git archive --format=zip --prefix="${name}/" -o "$out" HEAD

# The same checks the updater makes: some package.json at most four path segments deep is named rpi-head-unit.
root_entry=""
while IFS= read -r entry; do
  pkg_name="$(unzip -p "$out" "$entry" | node -p "JSON.parse(require('fs').readFileSync(0,'utf8')).name" 2>/dev/null || true)"
  if [[ "$pkg_name" == "rpi-head-unit" ]]; then root_entry="$entry"; break; fi
done < <(unzip -Z1 "$out" | awk -F/ 'NF<=4 && $0 ~ /\/package\.json$/')
[[ -n "$root_entry" ]] || { echo "error: no package.json named rpi-head-unit in the ZIP; the updater would not recognise it." >&2; exit 1; }
if unzip -Z1 "$out" | grep -qE '(^|/)(node_modules|dist|data|data-demo)/|(^|/)\.env$'; then
  echo "error: the ZIP contains build output, data or secrets." >&2
  exit 1
fi

echo "Built $out ($(du -h "$out" | cut -f1), version $version, root $root_entry)"
