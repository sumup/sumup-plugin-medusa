import { PaymentActions, PaymentSessionStatus } from "@medusajs/framework/utils"
import type {
  Checkout,
  CheckoutCreateRequest,
  CheckoutSuccess,
  CheckoutUpdateRequest,
} from "@sumup/sdk"
import { describe, expect, it, vi } from "vitest"

import SumUpPaymentProviderService from "../service"
import type { SumUpClient } from "../types"

class FakeSumUpClient implements SumUpClient {
  checkouts = new Map<string, CheckoutSuccess>()
  createdPayloads: CheckoutCreateRequest[] = []
  updatedPayloads: { checkoutId: string; payload: CheckoutUpdateRequest }[] = []
  refunds: { transactionId: string; amount?: number }[] = []
  deactivated: string[] = []

  async createCheckout(payload: CheckoutCreateRequest): Promise<Checkout> {
    if (
      this.createdPayloads.some(
        (previous) =>
          previous.checkout_reference === payload.checkout_reference,
      )
    ) {
      throw new Error("DUPLICATED_CHECKOUT")
    }
    this.createdPayloads.push(payload)

    const checkout = {
      ...payload,
      id: `checkout_${this.createdPayloads.length}`,
      status: "PENDING" as const,
      hosted_checkout_url: payload.hosted_checkout?.enabled
        ? "https://checkout.sumup.com/pay/test"
        : undefined,
      transactions: [],
    }

    this.checkouts.set(checkout.id, checkout)

    return checkout
  }

  async updateCheckout(
    checkoutId: string,
    payload: CheckoutUpdateRequest,
  ): Promise<Checkout> {
    this.updatedPayloads.push({ checkoutId, payload })

    const checkout = this.checkouts.get(checkoutId)

    if (!checkout) {
      throw new Error(`Missing checkout ${checkoutId}`)
    }

    const updated = {
      ...checkout,
      ...payload,
    }

    this.checkouts.set(checkoutId, updated)

    return updated
  }

  async retrieveCheckout(checkoutId: string): Promise<CheckoutSuccess> {
    const checkout = this.checkouts.get(checkoutId)

    if (!checkout) {
      throw new Error(`Missing checkout ${checkoutId}`)
    }

    return checkout
  }

  async deactivateCheckout(checkoutId: string): Promise<Checkout> {
    this.deactivated.push(checkoutId)

    const checkout = this.checkouts.get(checkoutId)

    if (!checkout) {
      throw new Error(`Missing checkout ${checkoutId}`)
    }

    if (checkout.status === "EXPIRED") throw new Error("Already deactivated")

    const deactivated = {
      ...checkout,
      status: "EXPIRED" as const,
    }

    this.checkouts.set(checkoutId, deactivated)

    return deactivated
  }

  async refundTransaction(
    transactionId: string,
    amount?: number,
  ): Promise<void> {
    this.refunds.push({ transactionId, amount })
  }
}

const createProvider = (client = new FakeSumUpClient()) => {
  const provider = new SumUpPaymentProviderService(
    {},
    {
      apiKey: "sk",
      merchantCode: "MC123",
      client,
    },
  )

  return { provider, client }
}

describe("SumUpPaymentProviderService", () => {
  it("initiates hosted checkout payment sessions", async () => {
    const { provider, client } = createProvider()

    const result = await provider.initiatePayment({
      amount: 20,
      currency_code: "eur",
      data: {
        session_id: "payses_hosted",
      },
      context: {
        idempotency_key: "idem_1",
      },
    })

    expect(result.id).toBe("checkout_1")
    expect(result.status).toBe(PaymentSessionStatus.PENDING)
    expect(result.data?.checkout_id).toBe("checkout_1")
    expect(result.data?.hosted_checkout_url).toBe(
      "https://checkout.sumup.com/pay/test",
    )
    expect(client.createdPayloads[0]).toMatchObject({
      checkout_reference: expect.stringMatching(/^payses_hosted:[a-f0-9]{16}$/),
      hosted_checkout: { enabled: true },
      merchant_code: "MC123",
    })
  })

  it("authorizes a paid checkout as captured", async () => {
    const { provider, client } = createProvider()
    const initiated = await provider.initiatePayment({
      amount: 20,
      currency_code: "eur",
      data: { session_id: "payses_paid" },
    })

    client.checkouts.set("checkout_1", {
      ...client.checkouts.get("checkout_1"),
      id: "checkout_1",
      checkout_reference: "payses_paid",
      status: "PAID",
      transactions: [
        {
          id: "txn_1",
          transaction_code: "T123",
          status: "SUCCESSFUL",
        },
      ],
    })

    const result = await provider.authorizePayment({
      data: initiated.data,
    })

    expect(result.status).toBe(PaymentSessionStatus.CAPTURED)
    expect(result.data?.transaction_id).toBe("txn_1")
    expect(result.data?.transaction_code).toBe("T123")
  })

  it.each(["authorizePayment", "capturePayment"] as const)(
    "%s rejects a paid checkout with an unexpected amount or currency",
    async (method) => {
      const { provider, client } = createProvider()
      const initiated = await provider.initiatePayment({
        amount: 20,
        currency_code: "eur",
        data: { session_id: "payses_integrity" },
      })
      const original = client.checkouts.get("checkout_1")
      for (const changed of [
        { amount: 1 },
        { currency: "USD" as const },
        { amount: undefined },
        { currency: undefined },
      ]) {
        client.checkouts.set("checkout_1", {
          ...original,
          ...changed,
          status: "PAID",
        })
        await expect(
          provider[method]({ data: initiated.data }),
        ).rejects.toThrow("expected amount and currency")
      }
      expect(initiated.data?.amount).toBe(20)
      expect(initiated.data?.currency).toBe("EUR")
    },
  )

  it.each(["authorizePayment", "capturePayment"] as const)(
    "%s accepts the expected paid checkout and legacy data without expectations",
    async (method) => {
      const { provider, client } = createProvider()
      const initiated = await provider.initiatePayment({
        amount: 20,
        currency_code: "eur",
        data: { session_id: "payses_integrity_ok" },
      })
      client.checkouts.set("checkout_1", {
        ...client.checkouts.get("checkout_1"),
        status: "PAID",
      })
      await expect(
        provider[method]({ data: initiated.data }),
      ).resolves.toHaveProperty("data.amount", 20)
      await expect(
        provider[method]({ data: { checkout_id: "checkout_1" } }),
      ).resolves.toHaveProperty("data.amount", 20)
    },
  )

  it("allows updatePayment to reconcile changed remote amounts", async () => {
    const { provider, client } = createProvider()
    const initiated = await provider.initiatePayment({
      amount: 20,
      currency_code: "eur",
      data: { session_id: "payses_reconcile" },
    })
    client.checkouts.set("checkout_1", {
      ...client.checkouts.get("checkout_1"),
      amount: 1,
    })
    await expect(
      provider.updatePayment({
        amount: 20,
        currency_code: "eur",
        data: initiated.data,
      }),
    ).resolves.toHaveProperty("data.amount", 20)
    expect(client.updatedPayloads[0].payload).toEqual({ amount: 20 })
  })

  it("sanitizes legacy raw checkout data in refund and no-id cancellation outputs", async () => {
    const { provider } = createProvider()
    const raw_checkout = { payment_instrument: { token: "fake_legacy_token" } }
    const refunded = await provider.refundPayment({
      amount: 5,
      data: { transaction_id: "txn_1", raw_checkout },
    })
    const canceled = await provider.cancelPayment({
      data: { raw_checkout, other: "preserved" },
    })
    expect(refunded.data).not.toHaveProperty("raw_checkout")
    expect(canceled.data).toEqual({ other: "preserved" })
  })

  it("refunds the successful transaction", async () => {
    const { provider, client } = createProvider()

    await provider.refundPayment({
      amount: 5,
      data: {
        checkout_id: "checkout_1",
        transaction_id: "txn_1",
      },
    })

    expect(client.refunds).toEqual([{ transactionId: "txn_1", amount: 5 }])
  })

  it("looks up a transaction before refunding when stored data is incomplete", async () => {
    const { provider, client } = createProvider()

    client.checkouts.set("checkout_1", {
      id: "checkout_1",
      checkout_reference: "payses_refund",
      status: "PAID",
      amount: 10,
      currency: "EUR",
      merchant_code: "MC123",
      transactions: [
        {
          id: "txn_lookup",
          transaction_code: "TLOOKUP",
          status: "SUCCESSFUL",
        },
      ],
    })

    await provider.refundPayment({
      amount: 3,
      data: {
        checkout_id: "checkout_1",
      },
    })

    expect(client.refunds).toEqual([{ transactionId: "txn_lookup", amount: 3 }])
  })

  it("maps SumUp checkout webhooks after verifying through the API", async () => {
    const { provider, client } = createProvider()

    client.checkouts.set("checkout_1", {
      id: "checkout_1",
      checkout_reference: "payses_webhook",
      status: "PAID",
      amount: 25,
      currency: "EUR",
      merchant_code: "MC123",
      transactions: [
        {
          id: "txn_webhook",
          status: "SUCCESSFUL",
        },
      ],
    })

    const result = await provider.getWebhookActionAndData({
      data: {
        event_type: "CHECKOUT_STATUS_CHANGED",
        id: "checkout_1",
      },
      rawData: "",
      headers: {},
    })

    expect(result).toEqual({
      action: PaymentActions.SUCCESSFUL,
      data: {
        session_id: "payses_webhook",
        amount: 25,
      },
    })
  })

  it("deactivates pending checkouts when canceling payments", async () => {
    const { provider, client } = createProvider()

    client.checkouts.set("checkout_1", {
      id: "checkout_1",
      checkout_reference: "payses_cancel",
      status: "PENDING",
      amount: 12,
      currency: "EUR",
      merchant_code: "MC123",
      transactions: [],
    })

    await provider.cancelPayment({
      data: {
        checkout_id: "checkout_1",
      },
    })

    expect(client.deactivated).toEqual(["checkout_1"])
    expect(client.checkouts.get("checkout_1")?.status).toBe("EXPIRED")
  })

  it("updates a pending checkout in place when only mutable fields change", async () => {
    const { provider, client } = createProvider()
    const initiated = await provider.initiatePayment({
      amount: 20,
      currency_code: "eur",
      data: { session_id: "payses_update" },
    })

    const result = await provider.updatePayment({
      amount: 25,
      currency_code: "eur",
      data: {
        ...initiated.data,
        description: "Updated payment",
      },
    })

    expect(result.status).toBe(PaymentSessionStatus.PENDING)
    expect(result.data?.checkout_id).toBe("checkout_1")
    expect(result.data?.amount).toBe(25)
    expect(client.updatedPayloads).toEqual([
      {
        checkoutId: "checkout_1",
        payload: {
          amount: 25,
          description: "Updated payment",
        },
      },
    ])
    expect(client.deactivated).toEqual([])
    expect(client.createdPayloads).toHaveLength(1)
  })

  it("replaces a pending checkout when switching checkout modes", async () => {
    const { provider, client } = createProvider()
    const initiated = await provider.initiatePayment({
      amount: 20,
      currency_code: "eur",
      data: { session_id: "payses_replace" },
    })

    const result = await provider.updatePayment({
      amount: 25,
      currency_code: "eur",
      data: {
        ...initiated.data,
        checkout_mode: "widget",
      },
    })

    expect(result.status).toBe(PaymentSessionStatus.PENDING)
    expect(result.data?.checkout_id).toBe("checkout_2")
    expect(result.data?.checkout_mode).toBe("widget")
    expect(client.updatedPayloads).toEqual([])
    expect(client.deactivated).toEqual(["checkout_1"])
    expect(client.createdPayloads).toHaveLength(2)
    expect(client.createdPayloads[1].hosted_checkout).toBeUndefined()
  })

  it("replaces a pending checkout when only the checkout mode changes", async () => {
    const { provider, client } = createProvider()
    const initiated = await provider.initiatePayment({
      amount: 20,
      currency_code: "eur",
      data: { session_id: "payses_mode_only" },
    })

    const result = await provider.updatePayment({
      amount: 20,
      currency_code: "eur",
      data: {
        ...initiated.data,
        checkout_mode: "widget",
      },
    })

    expect(result.data?.checkout_id).toBe("checkout_2")
    expect(result.data?.checkout_mode).toBe("widget")
    expect(result.data?.hosted_checkout_url).toBeUndefined()
    expect(client.deactivated).toEqual(["checkout_1"])
    expect(client.createdPayloads).toHaveLength(2)
    expect(client.updatedPayloads).toEqual([])
  })

  it("preserves the original checkout if replacement creation fails", async () => {
    const { provider, client } = createProvider()
    const initiated = await provider.initiatePayment({
      amount: 20,
      currency_code: "eur",
      data: { session_id: "payses_failure" },
    })
    vi.spyOn(client, "createCheckout").mockRejectedValueOnce(
      new Error("Unavailable"),
    )
    await expect(
      provider.updatePayment({
        amount: 20,
        currency_code: "eur",
        data: { ...initiated.data, checkout_mode: "widget" },
      }),
    ).rejects.toThrow("Unavailable")
    expect(client.deactivated).toEqual([])
    expect(client.checkouts.get("checkout_1")?.status).toBe("PENDING")
  })

  it("cancels the replacement if the original becomes paid during replacement", async () => {
    const { provider, client } = createProvider()
    const initiated = await provider.initiatePayment({
      amount: 20,
      currency_code: "eur",
      data: { session_id: "payses_race" },
    })
    vi.spyOn(client, "deactivateCheckout").mockRejectedValueOnce(
      new Error("Already paid"),
    )
    await expect(
      provider.updatePayment({
        amount: 20,
        currency_code: "eur",
        data: { ...initiated.data, checkout_mode: "widget" },
      }),
    ).rejects.toThrow("replacement was canceled")
    expect(client.checkouts.get("checkout_2")?.status).toBe("EXPIRED")
  })

  it("reports failed replacement cleanup for reconciliation", async () => {
    const { provider, client } = createProvider()
    const initiated = await provider.initiatePayment({
      amount: 20,
      currency_code: "eur",
      data: { session_id: "payses_cleanup" },
    })
    vi.spyOn(client, "deactivateCheckout").mockRejectedValue(
      new Error("Unavailable"),
    )
    await expect(
      provider.updatePayment({
        amount: 20,
        currency_code: "eur",
        data: { ...initiated.data, checkout_mode: "widget" },
      }),
    ).rejects.toThrow("reconcile both")
  })

  it("supports mode changes through the Store API client_data field", async () => {
    const { provider, client } = createProvider()
    const initiated = await provider.initiatePayment({
      amount: 20,
      currency_code: "eur",
      data: { session_id: "payses_client" },
    })
    const result = await provider.updatePayment({
      amount: 20,
      currency_code: "eur",
      data: {
        ...initiated.data,
        client: {
          checkout_mode: "widget",
          merchant_code: "OTHER",
          checkout_id: "OTHER",
          description: "untrusted",
        },
      },
    })
    expect(result.data?.checkout_mode).toBe("widget")
    expect(client.createdPayloads[1].merchant_code).toBe("MC123")
    expect(client.createdPayloads[1].description).toBe("Medusa order payment")
    expect(client.createdPayloads[1].checkout_reference).not.toBe(
      client.createdPayloads[0].checkout_reference,
    )
    client.checkouts.set("checkout_2", {
      ...client.checkouts.get("checkout_2"),
      status: "PAID",
    })
    await expect(
      provider.getWebhookActionAndData({
        data: { event_type: "CHECKOUT_STATUS_CHANGED", id: "checkout_2" },
        rawData: "",
        headers: {},
      }),
    ).resolves.toEqual({
      action: PaymentActions.SUCCESSFUL,
      data: { session_id: "payses_client", amount: 20 },
    })
  })

  it("makes repeated cancellation and deletion idempotent", async () => {
    const { provider, client } = createProvider()
    const initiated = await provider.initiatePayment({
      amount: 20,
      currency_code: "eur",
      data: { session_id: "payses_cancel_retry" },
    })
    await provider.cancelPayment({ data: initiated.data })
    await provider.deletePayment({ data: initiated.data })
    expect(client.deactivated).toEqual(["checkout_1"])
  })

  it.each(["OTHER", undefined])(
    "rejects checkout merchant %s before authorization or webhook processing",
    async (merchant_code) => {
      const { provider, client } = createProvider()
      client.checkouts.set("checkout_1", {
        id: "checkout_1",
        checkout_reference: "payses_merchant",
        merchant_code,
        amount: 20,
        status: "PAID",
      })
      await expect(
        provider.authorizePayment({ data: { checkout_id: "checkout_1" } }),
      ).rejects.toThrow("merchant")
      await expect(
        provider.getWebhookActionAndData({
          data: { event_type: "CHECKOUT_STATUS_CHANGED", id: "checkout_1" },
          rawData: "",
          headers: {},
        }),
      ).resolves.toEqual({ action: PaymentActions.NOT_SUPPORTED })
    },
  )

  it.each(["order_custom", "", undefined])(
    "ignores callbacks without a correlated reference %s",
    async (checkout_reference) => {
      const { provider, client } = createProvider()
      client.checkouts.set("checkout_1", {
        id: "checkout_1",
        checkout_reference,
        merchant_code: "MC123",
        amount: 20,
        status: "PAID",
      })
      await expect(
        provider.getWebhookActionAndData({
          data: { event_type: "CHECKOUT_STATUS_CHANGED", id: "checkout_1" },
          rawData: "",
          headers: {},
        }),
      ).resolves.toEqual({ action: PaymentActions.NOT_SUPPORTED })
    },
  )

  it("replaces an expired checkout without trying to deactivate it again", async () => {
    const { provider, client } = createProvider()
    const initiated = await provider.initiatePayment({
      amount: 20,
      currency_code: "eur",
      data: { session_id: "payses_expired" },
    })
    await client.deactivateCheckout("checkout_1")
    const result = await provider.updatePayment({
      amount: 25,
      currency_code: "eur",
      data: initiated.data,
    })
    expect(result.data?.checkout_id).toBe("checkout_2")
    expect(client.deactivated).toEqual(["checkout_1"])
  })

  it("rejects mode changes after payment without creating another checkout", async () => {
    const { provider, client } = createProvider()
    const initiated = await provider.initiatePayment({
      amount: 20,
      currency_code: "eur",
      data: { session_id: "payses_paid_update" },
    })
    client.checkouts.set("checkout_1", {
      ...client.checkouts.get("checkout_1"),
      status: "PAID",
    })
    await expect(
      provider.updatePayment({
        amount: 20,
        currency_code: "eur",
        data: { ...initiated.data, client: { checkout_mode: "widget" } },
      }),
    ).rejects.toThrow("paid")
    expect(client.createdPayloads).toHaveLength(1)
    expect(client.deactivated).toEqual([])
  })

  it.each([0, NaN, Infinity, undefined])(
    "ignores callbacks with invalid amount %s",
    async (amount) => {
      const { provider, client } = createProvider()
      client.checkouts.set("checkout_1", {
        id: "checkout_1",
        checkout_reference: "payses_amount",
        merchant_code: "MC123",
        amount,
        status: "PAID",
      })
      await expect(
        provider.getWebhookActionAndData({
          data: { event_type: "CHECKOUT_STATUS_CHANGED", id: "checkout_1" },
          rawData: "",
          headers: {},
        }),
      ).resolves.toEqual({ action: PaymentActions.NOT_SUPPORTED })
    },
  )

  it("ignores unsupported webhook events", async () => {
    const { provider } = createProvider()

    await expect(
      provider.getWebhookActionAndData({
        data: { event_type: "UNKNOWN", id: "checkout_1" },
        rawData: "",
        headers: {},
      }),
    ).resolves.toEqual({ action: PaymentActions.NOT_SUPPORTED })
  })
})
