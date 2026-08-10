#!/bin/sh
set -e

echo "Waiting for PostgreSQL at ${PGHOST:-localhost}:${PGPORT:-5432}..."
# Belt-and-suspenders on top of docker-compose's healthcheck-based
# depends_on - retries a few times in case the DB reports healthy but
# isn't quite ready to accept connections yet.
ATTEMPTS=0
until node -e "require('pg').Pool && new (require('pg').Pool)().query('SELECT 1').then(()=>process.exit(0)).catch(()=>process.exit(1))" 2>/dev/null; do
    ATTEMPTS=$((ATTEMPTS + 1))
    if [ "$ATTEMPTS" -ge 30 ]; then
        echo "PostgreSQL did not become ready in time."
        exit 1
    fi
    sleep 2
done

echo "Running database migrations..."
node src/db/migrate.js

echo "Running first-run bootstrap (safe to re-run - skips what already exists)..."
node src/db/bootstrap.js

echo "Starting Green Gold ERP..."
exec node src/server.js
