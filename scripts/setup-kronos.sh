#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
TARGET_DIR="${ROOT_DIR}/external/Kronos"
UPSTREAM_COMMIT="67b630e67f6a18c9e9be918d9b4337c960db1e9a"

mkdir -p "${ROOT_DIR}/external"
if [[ ! -d "${TARGET_DIR}/.git" ]]; then
  git clone https://github.com/shiyu-coder/Kronos.git "${TARGET_DIR}"
fi

git -C "${TARGET_DIR}" fetch origin master
git -C "${TARGET_DIR}" checkout --detach "${UPSTREAM_COMMIT}"

python -m pip install -r "${TARGET_DIR}/requirements.txt"

echo "Official Kronos source pinned at ${UPSTREAM_COMMIT}"
echo "Pretrained weights will be fetched from Hugging Face on first worker startup."
