import {
  BigNumber,
  PaymentActions,
  PaymentSessionStatus,
} from "@medusajs/framework/utils"
import { describe, expect, it } from "vitest"

import {
  createCheckoutPayload,
  createCheckoutReference,
  createCheckoutUpdatePayload,
  getMedusaSessionId,
  mapCheckoutToSessionStatus,
  mapCheckoutToWebhookAction,
  mergeCheckoutIntoPaymentData,
  toMajorUnitNumber,
  toRefundMinorUnits,
  toStoredPaymentData,
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
      checkout_reference: expect.stringMatching(/^payses_123:[a-f0-9]{16}$/),
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
    expect(payload.checkout_reference).toMatch(/^payses_widget:[a-f0-9]{16}$/)
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
    })
  })

  it("reserves the reference for Medusa and generates unique attempts within 64 characters", () => {
    const data = {
      session_id: `payses_${"a".repeat(40)}`,
      checkout_reference: "custom-order",
    }
    const first = createCheckoutReference(data)
    const second = createCheckoutReference(data)
    expect(first).not.toBe(second)
    expect(first).toHaveLength(64)
    expect(getMedusaSessionId(first)).toBe(data.session_id)
    expect(getMedusaSessionId("payses_legacy")).toBe("payses_legacy")
  })

  it.each([undefined, "", "order_123", `payses_${"a".repeat(41)}`])(
    "rejects missing or invalid Medusa session ids %s",
    (session_id) => {
      expect(() =>
        createCheckoutReference({
          session_id,
          checkout_reference: "payses_custom",
        }),
      ).toThrow("session_id")
    },
  )

  it("does not expose provider response tokens or retain legacy raw checkout data", () => {
    const checkout = {
      id: "checkout_1",
      checkout_reference: "payses_123",
      merchant_code: "MC123",
      payment_instrument: { token: "saved_instrument_token" },
      mandate: { type: "recurring" },
    }
    const stored = toStoredPaymentData({ checkout, mode: "hosted" })
    expect(JSON.stringify(stored)).not.toContain("saved_instrument_token")
    const merged = mergeCheckoutIntoPaymentData(
      { raw_checkout: checkout, client: { checkout_mode: "widget" } },
      checkout,
    )
    expect(merged).not.toHaveProperty("raw_checkout")
    expect(merged).toHaveProperty("client.checkout_mode", "widget")
  })

  it("normalizes supported Medusa amount types", () => {
    expect(toMajorUnitNumber(42)).toBe(42)
    expect(toMajorUnitNumber("13.37")).toBe(13.37)
    expect(toMajorUnitNumber({ value: "13.37" })).toBe(13.37)
    expect(toMajorUnitNumber(new BigNumber(42))).toBe(42)
  })

  it.each([
    [1, "EUR", 100],
    [2, "EUR", 200],
    [5, "EUR", 500],
    [41, "EUR", 4100],
    [100, "EUR", 10000],
    [12.34, "EUR", 1234],
    [0.29, "eur", 29],
    ["19.99", "GBP", 1999],
    [new BigNumber(5.25), "USD", 525],
    [{ value: "3.75" }, "CHF", 375],
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
