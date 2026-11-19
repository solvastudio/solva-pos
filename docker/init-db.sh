#!/bin/sh
set -e
psql -v ON_ERROR_STOP=1 --username postgres --dbname postgres -c "CREATE DATABASE solva OWNER solva_owner"
