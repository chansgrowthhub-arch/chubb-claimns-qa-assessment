#!/usr/bin/env bash
set -e
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"

# Use an installed Maven if there is one, otherwise the service's Maven Wrapper.
build_service() { # <service folder>
  if command -v mvn >/dev/null 2>&1; then
    mvn package -Dmaven.test.skip=true -Dcheckstyle.skip -Dpmd.skip -f "$SCRIPT_DIR/code/$1/pom.xml"
  else
    (cd "$SCRIPT_DIR/code/$1" && ./mvnw package -Dmaven.test.skip=true -Dcheckstyle.skip -Dpmd.skip)
  fi
}

echo "==> Building claims-service..."
build_service claims-service

echo "==> Building bff-service..."
build_service bff-service

echo "==> Starting application services..."
docker compose -f "$SCRIPT_DIR/docker-compose.apps.yml" up --build --pull never "$@"
