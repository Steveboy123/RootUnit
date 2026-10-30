#!/usr/bin/env bash
# Legacy entry point retained for old README / shell history.
# Since v0.5.0 this installs a genuine USB-capable receiver, NOT wireless Prodigy/ADB.
set -euo pipefail
DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
exec "$DIR/install-livi-wired.sh" "$@"
