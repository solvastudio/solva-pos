#!/bin/sh
# Runs once, on the first start of an empty data volume, after 10-init-roles.sql has created the roles.
# Replaces the development passwords of the application roles when production secrets are provided.
# Without SOLVA_OWNER_PASSWORD / SOLVA_APP_PASSWORD it does nothing (local development keeps the defaults).
set -e

if [ -n "$SOLVA_OWNER_PASSWORD" ]; then
  psql -v ON_ERROR_STOP=1 -v pw="$SOLVA_OWNER_PASSWORD" --username postgres --dbname postgres <<'SQL'
ALTER ROLE solva_owner PASSWORD :'pw';
SQL
fi

if [ -n "$SOLVA_APP_PASSWORD" ]; then
  psql -v ON_ERROR_STOP=1 -v pw="$SOLVA_APP_PASSWORD" --username postgres --dbname postgres <<'SQL'
ALTER ROLE solva_app_login PASSWORD :'pw';
SQL
fi
