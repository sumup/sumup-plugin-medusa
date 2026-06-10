# @sumup/medusa-plugin

SumUp online payments provider for Medusa v2. The plugin creates SumUp checkouts server-side and supports both:

- Hosted Checkout: redirect customers to SumUp's hosted payment page.
- Payment Widget: embed SumUp's card widget in a storefront checkout step.

The plugin never handles raw card data. SumUp credentials stay in the Medusa backend.

## Install

```bash
npm install @sumup/medusa-plugin
```

## Configure Medusa

Register the plugin and the payment provider in `medusa-config.ts`:

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

Then enable the `sumup` payment provider for your Medusa regions in Admin.

## Options

| Option | Required | Description |
| --- | --- | --- |
| `apiKey` | Yes | SumUp API key or access token. Keep it server-side. |
| `merchantCode` | Yes | SumUp merchant code that receives the payment. |
| `checkoutMode` | No | Default checkout mode: `hosted` or `widget`. Defaults to `hosted`. |
| `returnUrl` | No | Backend callback URL for SumUp status webhooks. Use `/hooks/payment/sumup_sumup` when provider `id` is `sumup`. |
| `redirectUrl` | No | Storefront URL shown by Hosted Checkout or used after redirect/SCA flows. |
| `paymentDescription` | No | Default SumUp checkout description. |
| `timeout` | No | SumUp SDK request timeout. |
| `maxRetries` | No | SumUp SDK retry count. |

You can override `checkoutMode`, `description`, `return_url`, and `redirect_url` per payment session through provider data when creating the payment session.

## Hosted Checkout Flow

1. The storefront selects the SumUp payment provider for the cart.
2. Medusa calls the plugin's `initiatePayment`, which creates a SumUp checkout with `hosted_checkout.enabled = true`.
3. The storefront reads `payment_session.data.hosted_checkout_url` and redirects the customer to SumUp.
4. SumUp processes the payment and notifies `returnUrl`.
5. Your backend verifies the checkout through SumUp before treating the payment as complete.

Use SumUp's hosted page as the customer interface, but use the backend status as the source of truth.

## Payment Widget Flow

1. Configure `checkoutMode: "widget"` or pass `checkout_mode: "widget"` in payment-session data.
2. The plugin creates a SumUp checkout without Hosted Checkout enabled.
3. The storefront loads `https://gateway.sumup.com/gateway/ecom/card/v2/sdk.js`.
4. Mount the widget with `payment_session.data.checkout_id`.
5. On widget `success`, ask Medusa to verify or complete the cart. Do not trust the widget callback alone.

See [`examples/nextjs`](examples/nextjs) for minimal storefront snippets.

## Webhooks

SumUp webhook payloads contain the changed checkout id. The plugin retrieves the checkout from SumUp and maps it to Medusa payment actions.

When the provider `id` is `sumup`, set SumUp checkout `return_url` to:

```plain
https://your-medusa-backend.com/hooks/payment/sumup_sumup
```

The checkout reference is used to correlate SumUp events with the Medusa payment session. Medusa normally passes the payment session id in provider data; if you create payment sessions manually, pass `session_id` in the session data.

## Sandbox Checklist

- Create a SumUp sandbox merchant and use its merchant code.
- Complete one successful Hosted Checkout payment.
- Complete one successful Payment Widget payment.
- Test SumUp's deliberate failure path with amount `11`.
- Confirm duplicate checkout references are rejected or handled safely.
- Let one Hosted Checkout expire and verify the payment session becomes canceled.
- Verify webhook retries are idempotent.
- Run one full refund and one partial refund.
- Confirm reconciliation fields are stored: checkout id, checkout reference, transaction id, transaction code, merchant code, amount, and currency.

## Development

```bash
npm install
npm run format:check
npm run lint
npm run typecheck
npm test
npm run build
```

For local Medusa app testing:

```bash
npx medusa plugin:publish
cd /path/to/medusa-app
npx medusa plugin:add @sumup/medusa-plugin
```

## Testing Strategy

The current test suite covers the provider logic with Vitest unit tests.

For Medusa-level plugin tests, Medusa's testing framework is the recommended path:

- Use `@medusajs/test-utils` with `medusaIntegrationTestRunner` to boot a real Medusa app, load the plugin from source, and exercise payment flows end-to-end.
- Use `moduleIntegrationTestRunner` when you want faster isolated tests around a single Medusa module instead of a full app boot.

That means the next testing step for this plugin should be an integration suite that starts a temporary Medusa app, registers the SumUp provider, and verifies session creation, webhook handling, and refund behavior against mocked SumUp API responses.
