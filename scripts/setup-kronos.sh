#!/usr/bin/env bash
# Installs the pinned official Kronos source into a local virtualenv.
# Uses python3 only (no `python` on PATH required) and does not touch the system interpreter.
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
TARGET_DIR="${ROOT_DIR}/external/Kronos"
UPSTREAM_COMMIT="67b630e67f6a18c9e9be918d9b4337c960db1e9a"
VENV_DIR="${ROOT_DIR}/.venv"
# pandas 2.2.2 (upstream pin) has no Python 3.13 wheel and fails to build without a compiler.
# 2.2.3 is the next patch and publishes wheels for 3.13 and earlier supported versions.
PANDAS_VERSION="2.2.3"
TORCH_VARIANT="${KRONOS_TORCH:-cpu}"

if ! command -v python3 >/dev/null 2>&1; then
  echo "python3 was not found. Install Python 3.10 or newer and rerun this script." >&2
  exit 1
fi

mkdir -p "${ROOT_DIR}/external"
if [[ ! -d "${TARGET_DIR}/.git" ]]; then
  git clone https://github.com/shiyu-coder/Kronos.git "${TARGET_DIR}"
fi

git -C "${TARGET_DIR}" fetch origin master
git -C "${TARGET_DIR}" checkout --detach "${UPSTREAM_COMMIT}"

if [[ ! -x "${VENV_DIR}/bin/python" ]]; then
  if ! python3 -m venv "${VENV_DIR}"; then
    echo "Could not create the virtualenv at ${VENV_DIR}." >&2
    echo "On Debian/Ubuntu the venv module is a separate package. Install it and rerun:" >&2
    echo "  sudo apt install python3-venv" >&2
    exit 1
  fi
fi

PY="${VENV_DIR}/bin/python"
"${PY}" -m pip install --upgrade pip

if [[ "${TORCH_VARIANT}" == "cpu" ]]; then
  "${PY}" -m pip install torch --index-url https://download.pytorch.org/whl/cpu
elif [[ "${TORCH_VARIANT}" == "default" ]]; then
  "${PY}" -m pip install torch
else
  echo "KRONOS_TORCH must be 'cpu' or 'default' (got '${TORCH_VARIANT}')." >&2
  exit 1
fi

REQ_FILTERED="$(mktemp)"
grep -Ev '^[[:space:]]*(#|$)' "${TARGET_DIR}/requirements.txt" \
  | grep -Ev '^[[:space:]]*(pandas|torch)([=<>~![:space:]]|$)' \
  > "${REQ_FILTERED}" || true
if [[ -s "${REQ_FILTERED}" ]]; then
  "${PY}" -m pip install -r "${REQ_FILTERED}" "pandas==${PANDAS_VERSION}"
else
  "${PY}" -m pip install "pandas==${PANDAS_VERSION}"
fi
rm -f "${REQ_FILTERED}"

ENV_FILE="${ROOT_DIR}/.env"
if [[ ! -f "${ENV_FILE}" ]]; then
  cp "${ROOT_DIR}/.env.example" "${ENV_FILE}"
fi

set_env() {
  local key="$1"
  local value="$2"
  local tmp
  tmp="$(mktemp)"
  awk -v k="${key}" -v v="${value}" '
    BEGIN { found = 0 }
    $0 ~ "^" k "=" { print k "=" v; found = 1; next }
    { print }
    END { if (!found) print k "=" v }
  ' "${ENV_FILE}" > "${tmp}"
  mv "${tmp}" "${ENV_FILE}"
}

set_env KRONOS_PYTHON_PATH "${PY}"
set_env KRONOS_REPO_PATH "${TARGET_DIR}"
if [[ "${TORCH_VARIANT}" == "cpu" ]]; then
  set_env KRONOS_DEVICE cpu
fi

echo "Official Kronos source pinned at ${UPSTREAM_COMMIT}"
echo "Virtualenv: ${PY}"
echo "pandas pin override: ${PANDAS_VERSION} (upstream requirements.txt asks for 2.2.2)"
"${PY}" - <<'PY'
import pandas
import torch
print(f"torch {torch.__version__} cuda_available={torch.cuda.is_available()}")
print(f"pandas {pandas.__version__}")
PY
echo "Pretrained weights download from Hugging Face on the first worker start."
echo "KRONOS_PYTHON_PATH and KRONOS_DEVICE were written to .env"
