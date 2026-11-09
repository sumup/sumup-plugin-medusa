import { PaymentActions, PaymentSessionStatus } from "@medusajs/framework/utils"
import { describe, expect, it } from "vitest"

import {
  createCheckoutPayload,
  createCheckoutUpdatePayload,
  mapCheckoutToSessionStatus,
  mapCheckoutToWebhookAction,
  toMajorUnitNumber,
  toRefundMinorUnits,
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

  it("creates a checkout update payload from mutable fields", () => {
    const payload = createCheckoutUpdatePayload({
      amount: "15.25",
      currencyCode: "usd",
      data: {
        description: "Updated order",
        checkout_reference: "payses_updated",
      },
    })

    expect(payload).toEqual({
      amount: 15.25,
      currency: "USD",
      description: "Updated order",
      checkout_reference: "payses_updated",
    })
  })

  it("normalizes Medusa BigNumber-like amounts", () => {
    expect(toMajorUnitNumber({ numeric: 42 } as never)).toBe(42)
    expect(toMajorUnitNumber({ raw: { value: "13.37" } } as never)).toBe(13.37)
  })

  it.each([
    [12.34, "EUR", 1234],
    [0.29, "eur", 29],
    ["19.99", "GBP", 1999],
    [{ numeric: 5.25 }, "USD", 525],
    [{ raw: { value: "3.75" } }, "CHF", 375],
    [500, "CLP", 500],
    [500, "COP", 500],
    [500, "HUF", 500],
  ])(
    "converts %s %s to %s refund minor units",
    (amount, currency, expected) => {
      expect(toRefundMinorUnits(amount as never, currency)).toBe(expected)
    },
  )

  it.each([0, -1, NaN, Infinity, 0.001, Number.MAX_SAFE_INTEGER])(
    "rejects invalid EUR refund amount %s",
    (amount) => expect(() => toRefundMinorUnits(amount, "EUR")).toThrow(),
  )

  it("rejects fractional amounts for currencies without minor units", () => {
    expect(() => toRefundMinorUnits(1.5, "CLP")).toThrow()
  })

  it("rejects unsupported refund currencies", () => {
    expect(() => toRefundMinorUnits(5, "XYZ")).toThrow()
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
