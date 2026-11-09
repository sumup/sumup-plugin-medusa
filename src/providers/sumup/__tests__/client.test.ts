import { afterEach, describe, expect, it, vi } from "vitest"

import SumUpPaymentProviderService from "../service"

afterEach(() => vi.unstubAllGlobals())

describe("SumUp refund HTTP request", () => {
  it("sends integer minor units to the merchant refund endpoint", async () => {
    const fetch = vi.fn().mockResolvedValue(Response.json({}, { status: 201 }))
    vi.stubGlobal("fetch", fetch)
    const provider = new SumUpPaymentProviderService(
      {},
      {
        apiKey: "test_key",
        merchantCode: "MC123",
      },
    )

    await provider.refundPayment({
      amount: 12.34,
      data: { transaction_id: "txn_1", currency: "EUR" },
    })

    expect(fetch).toHaveBeenCalledOnce()
    const [url, init] = fetch.mock.calls[0]
    expect(String(url)).toBe(
      "https://api.sumup.com/v1.0/merchants/MC123/payments/txn_1/refunds",
    )
    expect(init.method).toBe("POST")
    expect(JSON.parse(init.body)).toEqual({ amount: 1234 })
  })
})
