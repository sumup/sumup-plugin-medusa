# Next.js Storefront Examples

These snippets show the storefront responsibilities after Medusa has created a SumUp payment session.

## Hosted Checkout Redirect

```tsx
"use client"

type PaymentSession = {
  data?: {
    hosted_checkout_url?: string
  }
}

export function SumUpHostedCheckoutButton({
  paymentSession,
}: {
  paymentSession: PaymentSession
}) {
  const redirect = () => {
    const url = paymentSession.data?.hosted_checkout_url

    if (!url) {
      throw new Error("Missing SumUp hosted checkout URL")
    }

    window.location.href = url
  }

  return <button onClick={redirect}>Pay with SumUp</button>
}
```

After SumUp returns to your storefront, call your normal Medusa cart completion flow only after the backend has verified the SumUp checkout state.

## Payment Widget

```tsx
"use client"

import { useEffect, useRef } from "react"

declare global {
  interface Window {
    SumUpCard?: {
      mount: (config: Record<string, unknown>) => {
        submit: () => void
        unmount: () => void
        update: (config: Record<string, unknown>) => void
      }
    }
  }
}

type PaymentSession = {
  data?: {
    checkout_id?: string
  }
}

export function SumUpPaymentWidget({
  paymentSession,
  onVerified,
}: {
  paymentSession: PaymentSession
  onVerified: () => Promise<void>
}) {
  const widgetRef = useRef<{ unmount: () => void } | null>(null)

  useEffect(() => {
    const checkoutId = paymentSession.data?.checkout_id

    if (!checkoutId) {
      return
    }

    const mount = () => {
      widgetRef.current = window.SumUpCard?.mount({
        id: "sumup-card",
        checkoutId,
        onResponse: async (type: string) => {
          if (type === "success") {
            await onVerified()
          }
        },
      }) ?? null
    }

    if (window.SumUpCard) {
      mount()
      return () => widgetRef.current?.unmount()
    }

    const script = document.createElement("script")
    script.src = "https://gateway.sumup.com/gateway/ecom/card/v2/sdk.js"
    script.async = true
    script.onload = mount
    document.body.appendChild(script)

    return () => {
      widgetRef.current?.unmount()
      script.remove()
    }
  }, [paymentSession.data?.checkout_id, onVerified])

  return <div id="sumup-card" />
}
```

The `success` callback means the widget received a successful checkout response. Always let the backend retrieve the checkout from SumUp before showing final order success.
