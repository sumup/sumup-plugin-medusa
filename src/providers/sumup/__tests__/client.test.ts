import { afterEach, describe, expect, it, vi } from "vitest"
import { SumUpApiClient } from "../client"

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
