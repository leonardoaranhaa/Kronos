#!/usr/bin/env bash
set -euo pipefail
root="$(cd "$(dirname "$0")/.." && pwd)"
out="${1:-$root/dist/crypto-crawling-extension.zip}"
mkdir -p "$(dirname "$out")"
rm -f "$out"
(
  cd "$root/extension"
  zip -r "$out" \
    manifest.json \
    background.js \
    sidepanel.html sidepanel.css sidepanel.js \
    options.html options.css options.js \
    lib \
    README.md \
    -x 'preview/*'
)
echo "$out"
