import { PaymentActions, PaymentSessionStatus } from "@medusajs/framework/utils"
import type {
  Checkout,
  CheckoutCreateRequest,
  CheckoutSuccess,
} from "@sumup/sdk"
import { describe, expect, it } from "vitest"

import SumUpPaymentProviderService from "../service"
import type { SumUpClient } from "../types"

class FakeSumUpClient implements SumUpClient {
  checkouts = new Map<string, CheckoutSuccess>()
  createdPayloads: CheckoutCreateRequest[] = []
  refunds: { transactionId: string; amount?: number }[] = []
  deactivated: string[] = []

  async createCheckout(payload: CheckoutCreateRequest): Promise<Checkout> {
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
      checkout_reference: "payses_hosted",
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
      ...(initiated.data?.raw_checkout as CheckoutSuccess),
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

    const result = await provider.cancelPayment({
      data: {
        checkout_id: "checkout_1",
      },
    })

    expect(client.deactivated).toEqual(["checkout_1"])
    expect(result.data?.raw_checkout).toMatchObject({
      status: "EXPIRED",
    })
  })

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
