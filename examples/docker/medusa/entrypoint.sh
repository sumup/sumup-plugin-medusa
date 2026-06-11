#!/bin/sh
set -e

echo "[entrypoint] Running database migrations..."
yarn medusa db:migrate

# Seed demo data exactly once. The marker lives on the shared volume so it
# survives restarts; run `docker compose down -v` to reseed from scratch.
if [ ! -f /shared/.seeded ]; then
  echo "[entrypoint] Seeding demo data (region, product, SumUp provider, API key)..."
  # Run seed outside of set -e so a seed failure doesn't abort the entrypoint.
  # Medusa must still start so the admin dashboard and API are reachable for
  # debugging; the storefront polling will surface the failure via its timeout.
  if yarn medusa exec ./src/scripts/seed.ts; then
    touch /shared/.seeded
    echo "[entrypoint] Seeding complete."
  else
    echo "[entrypoint] WARNING: seeding failed (exit $?). Medusa will still start." >&2
    echo "[entrypoint] Check your SUMUP_API_KEY / SUMUP_MERCHANT_CODE and re-run with:" >&2
    echo "[entrypoint]   docker compose restart medusa" >&2
  fi
else
  echo "[entrypoint] Demo data already seeded, skipping."
fi

# Create an admin user so you can log into the dashboard. Ignore if it exists.
echo "[entrypoint] Ensuring admin user exists..."
yarn medusa user \
  -e "${MEDUSA_ADMIN_EMAIL:-admin@medusa.local}" \
  -p "${MEDUSA_ADMIN_PASSWORD:-supersecret}" || true

echo "[entrypoint] Starting Medusa (develop mode)..."
exec yarn medusa develop
