# Contributing

## Scope

`README.md` is for people evaluating or integrating the plugin into a Medusa application.

This document is for maintainers and contributors working on the plugin itself.

## Local Development

Install dependencies:

```bash
npm install --global yarn@1.22.22
yarn install
```

Run the main checks:

```bash
yarn format:check
yarn lint
yarn test
yarn typecheck
yarn build
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

- Docker walkthrough: [examples/docker/README.md](./examples/docker/README.md)
- Storefront snippets: [examples/nextjs/README.md](./examples/nextjs/README.md)

## Publishing Checks

Before publishing:

1. Run `yarn test`.
2. Run `yarn typecheck`.
3. Run `yarn build`.
4. Run `npm pack --dry-run` and inspect the tarball contents.
5. Re-read `README.md` from the perspective of a Medusa integrator, not a maintainer.
6. Confirm package metadata in `package.json` is accurate: version, description, repository, homepage, bugs, keywords, and publish surface.

## Medusa-Specific Review Points

Before release, verify the plugin still matches current Medusa expectations:

- The provider is registered under `modules[].options.providers`.
- The consumer path remains `@sumup/medusa-plugin/providers/sumup`.
- The webhook route remains `/hooks/payment/[identifier]_[id]`.
- The payment provider can still be enabled in a region after application start.
- The documented compatibility range still matches the Medusa packages used in development.

## Release Notes

Document user-visible changes in terms of:

- New integration capabilities.
- Configuration changes.
- Behavioral changes in payment, webhook, or refund handling.
- Medusa version compatibility updates.

## Release Publishing

Publishing a GitHub release starts `.github/workflows/release.yaml`. npm publishing uses GitHub OIDC trusted publishing. In the npm settings for `@sumup/medusa-plugin`, configure the GitHub organization as `sumup`, the repository as `sumup-plugin-medusa`, and the workflow filename as `release.yaml`. Allow direct publishing with `npm publish`.

The workflow grants `id-token: write`; no npm token secret is needed. After publishing, confirm the workflow succeeded and verify the version and tarball on npm. A GitHub release alone does not mean the package was published.

## Medusa Integration Listing

Medusa discovers third-party integrations from npm using package keywords, as described in its [plugin publishing guide](https://docs.medusajs.com/learn/fundamentals/plugins/create#package-keywords). Keep `medusa-v2`, `medusa-plugin-integration`, and `medusa-plugin-payment` in the published package's `keywords`. Keep `@swc/core` as a direct development dependency, as required by the same guide's package dependency section.

After publishing a new version:

1. Run `npm view @sumup/medusa-plugin@latest version keywords repository --registry=https://registry.npmjs.org` and confirm the version, all three listing keywords, and the repository URL. Changes on GitHub do not update an already published npm version.
2. Check the [Medusa integrations directory](https://medusajs.com/integrations). Confirm the entry links to the SumUp-owned `@sumup/medusa-plugin` package and this repository; another SumUp payment package may have a similar name.
3. If the package remains absent despite correct public npm metadata, contact Medusa through its [community](https://discord.com/invite/medusajs). Include the package name, published version, repository URL, and required keywords so they can investigate the directory's curation or indexing. The guide does not document a refresh schedule or guarantee a listing immediately after publication.

## Compatibility Maintenance

Check the published npm versions as well as Medusa's [payment provider reference](https://docs.medusajs.com/resources/references/payment/provider), [payment session guide](https://docs.medusajs.com/resources/commerce-modules/payment/payment-session), and [webhook guide](https://docs.medusajs.com/resources/commerce-modules/payment/webhook-events). Keep all Medusa development and example packages on the same release and update the framework peer dependency and README compatibility floor together.

Medusa 2.22.6 supports TypeScript 7 builds. Its CLI still uses the `@typescript/typescript6` compatibility package for `ts-node`; retain that development dependency in both the plugin and example. Verify that a clean build actually emits the provider entry point, then load the built package into the example and build both its backend and admin. Inspect the npm tarball and resolve its public provider path from an installed package.

Provider checks should cover the session ID that Medusa injects into `data.session_id`, storefront updates under `data.client`, unique SumUp checkout references across replacement attempts, cancellation retries, and webhook checkout verification. A mock provider client does not validate SumUp's reference uniqueness or HTTP payload contract; keep regression checks for those boundaries too.

Local unit tests and builds do not exercise a real payment, webhook delivery, database migrations, or refunds. Run the sandbox checklist before releasing payment behavior changes. If a refund request times out, reconcile the transaction in SumUp before retrying: a transport failure does not prove the refund failed.
