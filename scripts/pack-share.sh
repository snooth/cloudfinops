#!/usr/bin/env bash
# Chuck a shareable zip together — source only, no secrets, no node_modules.
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
STAMP="$(date +%Y%m%d-%H%M%S)"
VERSION="$(node -p "require('${ROOT}/package.json').version" 2>/dev/null || echo '1.0.4')"
OUT_DIR="${ROOT}/releases"
NAME="Cloud-FinOps-share-v${VERSION}-${STAMP}"
STAGE="$(mktemp -d)/${NAME}"

mkdir -p "${OUT_DIR}" "${STAGE}"

echo "Staging ${NAME}…"

# Copy the bits people need to run it
rsync -a \
  --exclude node_modules \
  --exclude .git \
  --exclude .run \
  --exclude logs \
  --exclude client/dist \
  --exclude releases \
  --exclude .env \
  --exclude .DS_Store \
  --exclude '._*' \
  --exclude server/data/tenants \
  --exclude server/data/sessions.json \
  --exclude server/data/admin-auth.json \
  --exclude server/data/azure-retail-catalog.json.gz \
  --exclude server/data/azure-retail-catalog-meta.json \
  --exclude 'server/data/*.pre-tenancy.bak' \
  --exclude server/data/backups \
  --exclude server/data/staging \
  "${ROOT}/" "${STAGE}/"

# Make sure .env.example is there; never ship a real .env
rm -f "${STAGE}/.env"
test -f "${STAGE}/.env.example"

(
  cd "$(dirname "${STAGE}")"
  zip -qr "${OUT_DIR}/${NAME}.zip" "${NAME}"
)

rm -rf "$(dirname "${STAGE}")"

SIZE="$(du -h "${OUT_DIR}/${NAME}.zip" | awk '{print $1}')"
echo "Done: ${OUT_DIR}/${NAME}.zip (${SIZE})"
echo "Hand them SHARE.md inside the zip for run instructions."
