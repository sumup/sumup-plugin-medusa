import { PaymentActions, PaymentSessionStatus } from "@medusajs/framework/utils"
import { describe, expect, it } from "vitest"

import {
  createCheckoutPayload,
  mapCheckoutToSessionStatus,
  mapCheckoutToWebhookAction,
  toMajorUnitNumber,
} from "../utils"

describe("SumUp provider utilities", () => {
  it("creates a hosted checkout payload by default", () => {
    const payload = createCheckoutPayload({
      amount: 12.5,
      currencyCode: "eur",
      data: {
        session_id: "payses_123",
      },
      options: {
        apiKey: "sk",
        merchantCode: "MC123",
        returnUrl: "https://backend.test/hooks/payment/sumup_sumup",
        redirectUrl: "https://storefront.test/return",
      },
    })

    expect(payload).toMatchObject({
      checkout_reference: "payses_123",
      amount: 12.5,
      currency: "EUR",
      merchant_code: "MC123",
      hosted_checkout: { enabled: true },
      return_url: "https://backend.test/hooks/payment/sumup_sumup",
      redirect_url: "https://storefront.test/return",
    })
  })

  it("creates a widget checkout payload when requested", () => {
    const payload = createCheckoutPayload({
      amount: "19.99",
      currencyCode: "GBP",
      data: {
        session_id: "payses_widget",
        checkout_mode: "widget",
      },
      options: {
        apiKey: "sk",
        merchantCode: "MC123",
      },
    })

    expect(payload.hosted_checkout).toBeUndefined()
    expect(payload.checkout_reference).toBe("payses_widget")
    expect(payload.amount).toBe(19.99)
  })

  it("normalizes Medusa BigNumber-like amounts", () => {
    expect(toMajorUnitNumber({ numeric: 42 } as never)).toBe(42)
    expect(toMajorUnitNumber({ raw: { value: "13.37" } } as never)).toBe(13.37)
  })

  it("maps SumUp checkout statuses to Medusa payment session statuses", () => {
    expect(mapCheckoutToSessionStatus({ status: "PENDING" })).toBe(
      PaymentSessionStatus.PENDING,
    )
    expect(mapCheckoutToSessionStatus({ status: "FAILED" })).toBe(
      PaymentSessionStatus.ERROR,
    )
    expect(mapCheckoutToSessionStatus({ status: "EXPIRED" })).toBe(
      PaymentSessionStatus.CANCELED,
    )
    expect(mapCheckoutToSessionStatus({ status: "PAID" })).toBe(
      PaymentSessionStatus.CAPTURED,
    )
    expect(
      mapCheckoutToSessionStatus({
        status: "PENDING",
        transactions: [{ status: "SUCCESSFUL", id: "txn_1" }],
      }),
    ).toBe(PaymentSessionStatus.CAPTURED)
  })

  it("maps SumUp checkout statuses to Medusa webhook actions", () => {
    expect(mapCheckoutToWebhookAction({ status: "PENDING" })).toBe(
      PaymentActions.PENDING,
    )
    expect(mapCheckoutToWebhookAction({ status: "FAILED" })).toBe(
      PaymentActions.FAILED,
    )
    expect(mapCheckoutToWebhookAction({ status: "EXPIRED" })).toBe(
      PaymentActions.CANCELED,
    )
    expect(mapCheckoutToWebhookAction({ status: "PAID" })).toBe(
      PaymentActions.SUCCESSFUL,
    )
  })
})
