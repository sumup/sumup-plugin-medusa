import { afterEach, describe, expect, it, vi } from "vitest"
import { SumUpApiClient } from "../client"
import SumUpPaymentProviderService from "../service"

afterEach(() => {
  vi.unstubAllGlobals()
})

describe("SumUpApiClient", () => {
  it("does not retry a refund after an ambiguous server failure", async () => {
    const fetch = vi.fn().mockResolvedValue(
      new Response(JSON.stringify({ message: "Internal server error" }), {
        status: 503,
        headers: { "Content-Type": "application/json" },
      }),
    )
    vi.stubGlobal("fetch", fetch)
    const client = new SumUpApiClient({
      apiKey: "test_api_key",
      merchantCode: "MC123",
      maxRetries: 1,
    })

    await expect(client.refundTransaction("txn_1", 100)).rejects.toThrow()

    expect(fetch).toHaveBeenCalledTimes(1)
  })
})

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
