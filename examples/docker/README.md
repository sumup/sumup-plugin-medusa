# Local Docker Example

A fully local, end-to-end playground for `@sumup/medusa-plugin`. It spins up:

- **Postgres** – database for Medusa.
- **Medusa backend** – builds **this plugin from source** and links it via a
  local `file:` dependency. **No `npm publish` and no local registry needed.**
- **Minimal storefront** – a zero-dependency static page that drives the Store
  API to create a real SumUp checkout.

The backend boots with preconfigured data: a `Europe` region with the SumUp
provider enabled, a published demo product, a stock location, a shipping
option, and a publishable API key (auto-shared with the storefront).

## Prerequisites

- Docker + Docker Compose
- A **SumUp sandbox** merchant (API key + merchant code)

## Quick start

```bash
cd examples/docker
cp example.env .env
# edit .env and set SUMUP_API_KEY and SUMUP_MERCHANT_CODE
docker compose up --build
```

First boot takes a few minutes (installing deps, building the plugin + admin,
running migrations, seeding). When ready:

- Storefront: <http://localhost:8080>
- Admin dashboard: <http://localhost:9000/app>
  (login: `admin@medusa.local` / `supersecret`, configurable in `.env`)

On the storefront, click **Start SumUp checkout**. The page creates a cart,
a payment collection, and a SumUp payment session, then shows a
**Pay with SumUp** link pointing at SumUp's hosted checkout.

## How the plugin is loaded (no npm publish)

1. The backend `Dockerfile` has a first stage that copies this repo's `src/`
   and runs `npm run build` (`medusa plugin:build`) to produce
   `.medusa/server/src/...`.
2. The final stage installs the Medusa app deps (`@medusajs/*`, `@sumup/sdk`),
   then hand-places the built plugin into
   `node_modules/@sumup/medusa-plugin` (its `package.json` + `.medusa`) — exactly
   what `medusa plugin:add` does, just without a local registry.
3. Crucially, the plugin's own `node_modules` is **not** copied, so the plugin
   resolves `@medusajs/framework` from the app (a duplicate copy would break
   Medusa's dependency injection). `@sumup/sdk` is provided at the app level.
4. Medusa then resolves `@sumup/medusa-plugin` and
   `@sumup/medusa-plugin/providers/sumup` like any installed package.

If you change plugin source, rebuild: `docker compose up --build`.

## How the storefront gets its keys

The seed script (`medusa/src/scripts/seed.ts`) writes a `config.json`
(publishable key, backend URL, region id) to a shared Docker volume. The
storefront serves it at `/config.json`, so there is nothing to copy by hand.

## Switching to the Payment Widget

Set `SUMUP_CHECKOUT_MODE=widget` in `.env` and rebuild. The payment session
will then expose a `checkout_id` (no hosted URL); see the widget snippet in
[`../nextjs`](../nextjs) for how to mount it.

## Webhooks (optional)

`returnUrl` is set to `http://localhost:9000/hooks/payment/sumup_sumup`, which
SumUp cannot reach from the internet. To test webhooks, expose the backend with
a tunnel (e.g. `ngrok http 9000`) and set `MEDUSA_BACKEND_URL` to the public URL
in `.env`.

## Reset

```bash
docker compose down -v   # also drops the DB + reseeds on next up
```

## Notes / limitations

- Runs Medusa in `develop` mode for simplicity (live source). Not a production
  setup.
- The plugin requires `SUMUP_API_KEY` and `SUMUP_MERCHANT_CODE`; the backend
  will not start without them.
- Use a **sandbox** merchant. SumUp's deliberate-failure amount is `11`.
