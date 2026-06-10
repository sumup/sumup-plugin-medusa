import type {
  Checkout,
  CheckoutCreateRequest,
  CheckoutSuccess,
} from "@sumup/sdk"

export type SumUpCheckoutMode = "hosted" | "widget"

export type SumUpProviderOptions = {
  apiKey: string
  merchantCode: string
  checkoutMode?: SumUpCheckoutMode
  returnUrl?: string
  redirectUrl?: string
  paymentDescription?: string
  timeout?: number
  maxRetries?: number
  client?: SumUpClient
}

export type SumUpClient = {
  createCheckout(
    payload: CheckoutCreateRequest,
    idempotencyKey?: string,
  ): Promise<Checkout>
  retrieveCheckout(checkoutId: string): Promise<CheckoutSuccess>
  deactivateCheckout(checkoutId: string): Promise<Checkout>
  refundTransaction(transactionId: string, amount?: number): Promise<void>
}

export type SumUpPaymentData = {
  id: string
  checkout_id: string
  checkout_reference: string
  checkout_mode: SumUpCheckoutMode
  hosted_checkout_url?: string
  transaction_id?: string
  transaction_code?: string
  merchant_code: string
  currency?: string
  amount?: number
  raw_checkout?: Checkout | CheckoutSuccess
}

export type SumUpWebhookBody = {
  event_type?: string
  id?: string
}
