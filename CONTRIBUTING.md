# Contributing

## Scope

`README.md` is for people evaluating or integrating the plugin into a Medusa application.

This document is for maintainers and contributors working on the plugin itself.

## Local Development

Install dependencies:

```bash
npm install
```

Run the main checks:

```bash
npm run format:check
npm run lint
npm test
npm run typecheck
npm run build
```

## Project Structure

- `src/providers/sumup` contains the payment provider implementation.
- `src/providers/sumup/__tests__` contains unit tests for provider behavior and helper utilities.
- `examples/nextjs` contains storefront integration snippets for hosted and widget flows.
- `examples/docker` contains a local end-to-end playground that builds this plugin from source.

## Local End-to-End Testing

The Docker example is the fastest way to validate the plugin inside a Medusa app without publishing to npm first.

```bash
cd examples/docker
cp example.env .env
# set SUMUP_API_KEY and SUMUP_MERCHANT_CODE
docker compose up --build
```

What it does:

- Builds this plugin from source with `medusa plugin:build`.
- Injects the built package into a Medusa app as a local package.
- Seeds a demo region, product, shipping option, admin user, and publishable key.
- Exposes a minimal storefront for manual SumUp checkout testing.

Relevant references:

- Docker walkthrough: [examples/docker/README.md](/Users/matousdzivjak/code/github.com/sumup/sumup-plugin-medusa/examples/docker/README.md)
- Storefront snippets: [examples/nextjs/README.md](/Users/matousdzivjak/code/github.com/sumup/sumup-plugin-medusa/examples/nextjs/README.md)

## Publishing Checks

Before publishing:

1. Run `npm test`.
2. Run `npm run typecheck`.
3. Run `npm run build`.
4. Run `npm pack --dry-run` and inspect the tarball contents.
5. Re-read `README.md` from the perspective of a Medusa integrator, not a maintainer.
6. Confirm package metadata in `package.json` is accurate: version, description, repository, homepage, bugs, keywords, and publish surface.

## Medusa-Specific Review Points

Before release, verify the plugin still matches current Medusa expectations:

- The provider is registered under `modules[].options.providers`.
- The consumer path remains `@sumup/medusa-plugin/providers/sumup`.
- The webhook route remains `/hooks/payment/[identifier]_[provider]`.
- The payment provider can still be enabled in a region after application start.
- The documented compatibility range still matches the Medusa packages used in development.

## Release Notes

Document user-visible changes in terms of:

- New integration capabilities.
- Configuration changes.
- Behavioral changes in payment, webhook, or refund handling.
- Medusa version compatibility updates.
