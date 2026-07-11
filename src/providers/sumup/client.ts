import SumUp, {
  type Checkout,
  type CheckoutCreateRequest,
  type CheckoutSuccess,
  type CheckoutUpdateRequest,
} from "@sumup/sdk"

import type { SumUpClient, SumUpProviderOptions } from "./types"

export class SumUpApiClient implements SumUpClient {
  private readonly client_: SumUp
  private readonly merchantCode_: string

  constructor(options: SumUpProviderOptions) {
    this.client_ = new SumUp({
      apiKey: options.apiKey,
      timeout: options.timeout,
      maxRetries: options.maxRetries,
    })
    this.merchantCode_ = options.merchantCode
  }

  async createCheckout(
    payload: CheckoutCreateRequest,
    idempotencyKey?: string,
  ): Promise<Checkout> {
    return await this.client_.checkouts.create(payload, {
      headers: idempotencyKey
        ? {
            "Idempotency-Key": idempotencyKey,
          }
        : undefined,
    })
  }

  async updateCheckout(
    checkoutId: string,
    payload: CheckoutUpdateRequest,
  ): Promise<Checkout> {
    return await this.client_.checkouts.update(checkoutId, payload)
  }

  async retrieveCheckout(checkoutId: string): Promise<CheckoutSuccess> {
    return await this.client_.checkouts.get(checkoutId)
  }

  async deactivateCheckout(checkoutId: string): Promise<Checkout> {
    return await this.client_.checkouts.deactivate(checkoutId)
  }

  async refundTransaction(
    transactionId: string,
    amount?: number,
  ): Promise<void> {
    await this.client_.transactions.refund(
      this.merchantCode_,
      transactionId,
      amount === undefined ? undefined : { amount },
    )
  }
}
