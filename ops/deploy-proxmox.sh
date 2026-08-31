#!/usr/bin/env bash
set -Eeuo pipefail

readonly EXPECTED_SHA="${1:-}"
readonly SOURCE_DIR="/opt/actions-runner/cotransmeq-app/_work/cotransmeq-app/cotransmeq-app"
readonly BUILD_ENV="/etc/cotransmeq/frontend-build.env"
readonly RUNTIME_ENV="/etc/cotransmeq/frontend-runtime.env"
readonly COMPOSE_FILE="${SOURCE_DIR}/compose.proxmox.yml"
readonly CONTAINER="frontend-cotransmeq"
readonly PRODUCTION_IMAGE="frontend-cotransmeq:production"
readonly RELEASE_IMAGE="frontend-cotransmeq:${EXPECTED_SHA}"

if [[ ! "${EXPECTED_SHA}" =~ ^[0-9a-f]{40}$ ]]; then
	echo "El commit recibido no es un SHA completo válido." >&2
	exit 64
fi

if [[ "$(git -C "${SOURCE_DIR}" rev-parse HEAD)" != "${EXPECTED_SHA}" ]]; then
	echo "El checkout del runner no coincide con el commit solicitado." >&2
	exit 65
fi

exec 9>/run/lock/deploy-cotransmeq-app.lock
flock -n 9 || {
	echo "Ya existe otro despliegue de cotransmeq-app en ejecución." >&2
	exit 75
}

set -a
# shellcheck source=/dev/null
source "${BUILD_ENV}"
set +a

previous_image="$(docker inspect "${CONTAINER}" --format '{{.Image}}')"

docker build \
	--build-arg "VITE_API_URL=${VITE_API_URL}" \
	--build-arg "VITE_SOCKET_URL=${VITE_SOCKET_URL}" \
	--build-arg "VITE_MAPBOX_ACCESS_TOKEN=${VITE_MAPBOX_ACCESS_TOKEN:-}" \
	--build-arg "VITE_DISTRACOM_ICON_URL=${VITE_DISTRACOM_ICON_URL:-}" \
	--label "com.cotransmeq.git-sha=${EXPECTED_SHA}" \
	-t "${RELEASE_IMAGE}" \
	"${SOURCE_DIR}"

docker tag "${RELEASE_IMAGE}" "${PRODUCTION_IMAGE}"

compose_up() {
	docker compose \
		--project-name cotransmeq-app \
		--env-file "${RUNTIME_ENV}" \
		-f "${COMPOSE_FILE}" \
		up -d --no-deps --force-recreate frontend
}

wait_healthy() {
	local attempt status
	for attempt in $(seq 1 60); do
		status="$(docker inspect "${CONTAINER}" --format '{{if .State.Health}}{{.State.Health.Status}}{{else}}{{.State.Status}}{{end}}' 2>/dev/null || true)"
		[[ "${status}" == "healthy" ]] && return 0
		[[ "${status}" == "unhealthy" || "${status}" == "exited" || "${status}" == "dead" ]] && return 1
		sleep 2
	done
	return 1
}

if ! compose_up || ! wait_healthy || ! curl -fsS --max-time 10 http://127.0.0.1:3002/login >/dev/null; then
	echo "El frontend nuevo no superó el healthcheck; restaurando la imagen anterior." >&2
	docker tag "${previous_image}" "${PRODUCTION_IMAGE}"
	compose_up
	wait_healthy || true
	exit 1
fi

echo "Despliegue de cotransmeq-app completado en ${EXPECTED_SHA}."
