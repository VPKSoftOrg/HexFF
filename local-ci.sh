#!/bin/sh
# Runs the same checks as the CI workflow locally. Stops at the first failure.
# Usage: ./local-ci.sh [--full]
#   --full  build the installers (npm run tauri build) like CI does;
#           by default only the frontend is built (npm run build), which is enough for clippy and the tests.
set -e

step() {
    echo
    echo "==> $*"
    "$@"
}

step npm install
step npm run lint
step npm test
step cargo fmt --all -- --check
if [ "$1" = "--full" ]; then
    step npm run tauri build
else
    step npm run build
fi
step cargo clippy --all-targets -- -D warnings
step cargo test

echo
echo "All checks passed."
