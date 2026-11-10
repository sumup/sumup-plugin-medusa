<div align="center">

# @sumup/medusa-plugin

[![NPM Version](https://img.shields.io/npm/v/%40sumup%2Fmedusa-plugin.svg)](https://www.npmjs.org/package/@sumup/medusa-plugin)
[![CI](https://github.com/sumup/sumup-plugin-medusa/actions/workflows/ci.yaml/badge.svg)](https://github.com/sumup/sumup-plugin-medusa/actions/workflows/ci.yaml)
[![Downloads](https://img.shields.io/npm/dm/%40sumup%2Fmedusa-plugin.svg)](https://www.npmjs.com/package/@sumup/medusa-plugin)
[![License](https://img.shields.io/github/license/sumup/sumup-plugin-medusa)](./LICENSE)
[![Node.js](https://img.shields.io/badge/node-%3E%3D22.22.0-339933?logo=node.js&logoColor=white)](https://nodejs.org/)
[![Medusa](https://img.shields.io/badge/Medusa-v2-0A7AFF)](https://medusajs.com/)

</div>

SumUp payment provider for [Medusa v2](https://medusajs.com/).

This plugin lets a Medusa application create and manage SumUp online checkouts from the backend. It supports:

- Hosted Checkout, where the customer is redirected to SumUp's hosted payment page.
- Payment Widget, where the storefront mounts SumUp's card widget with the checkout created by Medusa.
- Refunds through SumUp transactions.
- Medusa's built-in payment webhook route for asynchronous status updates.

The plugin never handles raw card data directly. SumUp credentials remain on the Medusa backend.

## Compatibility

- Medusa v2.22.6 or later (tested with v2.22.6).
- Node.js 22.22.0 or later.
- SumUp online checkout flows

## Install

```bash
yarn add @sumup/medusa-plugin
```

## Configure Medusa

Register the plugin and payment provider in `medusa-config.ts`:

```ts
import { defineConfig } from "@medusajs/framework/utils"

export default defineConfig({
  plugins: [
    {
      resolve: "@sumup/medusa-plugin",
      options: {},
    },
  ],
  modules: [
    {
      resolve: "@medusajs/medusa/payment",
      options: {
        providers: [
          {
            resolve: "@sumup/medusa-plugin/providers/sumup",
            id: "sumup",
            options: {
              apiKey: process.env.SUMUP_API_KEY,
              merchantCode: process.env.SUMUP_MERCHANT_CODE,
              checkoutMode: "hosted",
              returnUrl: `${process.env.MEDUSA_BACKEND_URL}/hooks/payment/sumup_sumup`,
              redirectUrl: `${process.env.STOREFRONT_URL}/checkout/sumup/return`,
            },
          },
        ],
      },
    },
  ],
})
```

After the application starts, enable the provider for the relevant region in Medusa Admin. Per Medusa's payment-provider model, the resulting provider identifier is `pp_sumup_sumup` when the service identifier is `sumup` and the configured provider `id` is `sumup`.

## Configuration Options

| Option               | Required | Description                                                                                                                    |
| -------------------- | -------- | ------------------------------------------------------------------------------------------------------------------------------ |
| `apiKey`             | Yes      | SumUp API key or access token. Keep it server-side.                                                                            |
| `merchantCode`       | Yes      | SumUp merchant code that receives the payment.                                                                                 |
| `checkoutMode`       | No       | Default checkout mode: `hosted` or `widget`. Defaults to `hosted`.                                                             |
| `returnUrl`          | No       | Backend webhook URL. For provider `id: "sumup"`, use `/hooks/payment/sumup_sumup`.                                             |
| `redirectUrl`        | No       | Storefront URL used after redirect or Strong Customer Authentication flows.                                                    |
| `paymentDescription` | No       | Default SumUp checkout description.                                                                                            |
| `timeout`            | No       | SumUp SDK request timeout in milliseconds.                                                                                     |
| `maxRetries`         | No       | SumUp SDK retry count. Refund requests always disable automatic retries to avoid duplicate refunds after an ambiguous failure. |

Backend integrations can set `checkout_mode`, `description`, `return_url`, and `redirect_url` in provider data when creating a session. The plugin reserves `checkout_reference` for Medusa session routing; custom references are ignored.

Since Medusa v2.22.1, storefront updates use `client_data`, which Medusa passes to the provider as `data.client`. To switch between hosted checkout and the widget:

```ts
await sdk.store.payment.updatePaymentSession(
  paymentCollectionId,
  paymentSessionId,
  {
    client_data: { checkout_mode: "widget" },
  },
)
```

Only the checkout mode is read from client data. Amounts, currency, merchant, callback URLs, and checkout identifiers remain controlled by the backend. Use the updated payment session returned by Medusa: switching modes creates a new checkout and invalidates the previous checkout URL or widget ID.

## Hosted Checkout

With `checkoutMode: "hosted"`, the plugin creates a SumUp checkout with Hosted Checkout enabled. Medusa stores the returned `hosted_checkout_url` in the payment-session data. The storefront should redirect the customer to that URL.

Use backend state as the source of truth. The storefront should not treat the redirect alone as proof of payment success.

## Payment Widget

With `checkoutMode: "widget"`, the plugin creates a SumUp checkout without Hosted Checkout enabled. Medusa stores the returned `checkout_id` in the payment-session data. The storefront is then responsible for:

- Loading SumUp's widget SDK.
- Mounting the widget with the checkout ID.
- Asking the backend to re-check the payment state after widget success.

Minimal storefront snippets are available in [examples/nextjs/README.md](./examples/nextjs/README.md).

## Webhooks

Medusa provides a built-in webhook listener route for payment providers at:

```text
/hooks/payment/[identifier]_[id]
```

For this plugin, with service identifier `sumup` and provider `id: "sumup"`, the webhook URL is:

```text
https://your-medusa-backend.com/hooks/payment/sumup_sumup
```

The plugin's `getWebhookActionAndData` implementation follows Medusa's payment-webhook flow: it receives the webhook payload, retrieves the checkout from SumUp, maps the result to a Medusa payment action, and returns the payment session reference back to Medusa.

## What the Plugin Stores

The payment-session data is visible to the storefront. The provider stores the fields below and discards the full SumUp response, including any saved payment token or mandate details:

- `checkout_id`
- `checkout_reference` (reserved for session routing and unique checkout attempts)
- `checkout_mode`
- `hosted_checkout_url` for hosted flows
- `transaction_id` and `transaction_code` when available
- `merchant_code`
- `amount` and `currency`

## Current Behavior and Limitations

- `authorizePayment` checks the remote SumUp checkout status rather than performing a separate authorization step.
- `capturePayment` does not trigger a separate capture API call. Authorization and capture require a paid checkout that matches the stored amount, currency, and configured merchant. Legacy records without stored amounts or currencies retain their previous behavior.
- If the amount, currency, or description changes before payment, `updatePayment` updates the existing SumUp checkout when possible. Switching checkout modes creates a replacement with a unique reference, then deactivates the previous checkout. Paid checkouts cannot be changed.
- Refunds require a successful SumUp transaction and its currency. Medusa refund amounts use major units; the plugin converts them to integer minor units for SumUp (for example, EUR 5.25 becomes 525). CLP, COP, and HUF use zero decimal places. Refunds with invalid or fractional minor-unit amounts are rejected.
- The plugin is built for SumUp online payments, not terminal or card-present flows.

## Sandbox Checklist

- Verify one successful Hosted Checkout payment.
- Verify one successful Payment Widget payment.
- Verify at least one webhook-driven payment update.
- Verify one full refund and one partial refund.
- Test SumUp's deliberate failure path with amount `11`.
- Verify expired or canceled checkouts map cleanly back into Medusa session state.

## Examples

- Consumer storefront snippets: [examples/nextjs/README.md](./examples/nextjs/README.md)
- Local end-to-end playground: [examples/docker/README.md](./examples/docker/README.md)

## Contributing

Maintainer and release workflow documentation lives in [CONTRIBUTING.md](./CONTRIBUTING.md).
