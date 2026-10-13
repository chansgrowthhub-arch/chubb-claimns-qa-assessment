#!/usr/bin/env bash
set -e
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"

# Use an installed Maven if there is one, otherwise the service's Maven Wrapper.
mvn_for() { if command -v mvn >/dev/null 2>&1; then echo mvn; else echo "$SCRIPT_DIR/code/$1/mvnw"; fi; }

echo "==> Building claims-service..."
$(mvn_for claims-service) package -Dmaven.test.skip=true -Dcheckstyle.skip -Dpmd.skip \
    -f "$SCRIPT_DIR/code/claims-service/pom.xml"

echo "==> Building bff-service..."
$(mvn_for bff-service) package -Dmaven.test.skip=true -Dcheckstyle.skip -Dpmd.skip \
    -f "$SCRIPT_DIR/code/bff-service/pom.xml"

echo "==> Starting application services..."
docker compose -f "$SCRIPT_DIR/docker-compose.apps.yml" up --build --pull never "$@"
