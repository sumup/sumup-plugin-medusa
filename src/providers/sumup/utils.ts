import type { BigNumberInput } from "@medusajs/framework/types"
import { PaymentActions, PaymentSessionStatus } from "@medusajs/framework/utils"
import type {
  Checkout,
  CheckoutCreateRequest,
  CheckoutSuccess,
  CheckoutUpdateRequest,
  Currency,
} from "@sumup/sdk"

import type {
  SumUpCheckoutMode,
  SumUpPaymentData,
  SumUpProviderOptions,
} from "./types"

const SUPPORTED_CURRENCIES = new Set([
  "BGN",
  "BRL",
  "CHF",
  "CLP",
  "COP",
  "CZK",
  "DKK",
  "EUR",
  "GBP",
  "HRK",
  "HUF",
  "NOK",
  "PLN",
  "RON",
  "SEK",
  "USD",
])

export function toMajorUnitNumber(amount: BigNumberInput): number {
  if (typeof amount === "number") {
    return amount
  }

  if (typeof amount === "string") {
    return Number(amount)
  }

  const value = amount as {
    numeric?: number
    value?: string | number
    raw?: { value?: string | number }
    bigNumber?: { toNumber?: () => number }
    toNumber?: () => number
  }

  if (typeof value.numeric === "number") {
    return value.numeric
  }

  if (value.value !== undefined) {
    return Number(value.value)
  }

  if (value.raw?.value !== undefined) {
    return Number(value.raw.value)
  }

  if (typeof value.bigNumber?.toNumber === "function") {
    return value.bigNumber.toNumber()
  }

  if (typeof value.toNumber === "function") {
    return value.toNumber()
  }

  return Number(amount)
}

export function normalizeCurrency(currencyCode: string): Currency {
  const currency = currencyCode.toUpperCase()

  if (!SUPPORTED_CURRENCIES.has(currency)) {
    throw new Error(`Currency ${currencyCode} is not supported by SumUp.`)
  }

  return currency as Currency
}

export function resolveCheckoutMode(
  options: SumUpProviderOptions,
  data?: Record<string, unknown>,
): SumUpCheckoutMode {
  const mode = data?.checkout_mode ?? data?.checkoutMode ?? options.checkoutMode

  if (mode === "hosted" || mode === "widget") {
    return mode
  }

  return "hosted"
}

export function createCheckoutReference(
  data?: Record<string, unknown>,
  idempotencyKey?: string,
): string {
  const reference =
    data?.checkout_reference ?? data?.checkoutReference ?? data?.session_id

  if (typeof reference === "string" && reference.length > 0) {
    return reference.slice(0, 90)
  }

  if (idempotencyKey) {
    return idempotencyKey.slice(0, 90)
  }

  return `sumup_${Date.now()}_${Math.random().toString(36).slice(2, 10)}`.slice(
    0,
    90,
  )
}

export function createCheckoutPayload({
  amount,
  currencyCode,
  data,
  options,
}: {
  amount: BigNumberInput
  currencyCode: string
  data?: Record<string, unknown>
  options: SumUpProviderOptions
}): CheckoutCreateRequest {
  const checkoutMode = resolveCheckoutMode(options, data)
  const description =
    (data?.description as string | undefined) ??
    (data?.payment_description as string | undefined) ??
    options.paymentDescription ??
    "Medusa order payment"

  return {
    checkout_reference: createCheckoutReference(
      data,
      data?.idempotency_key as string | undefined,
    ),
    amount: toMajorUnitNumber(amount),
    currency: normalizeCurrency(currencyCode),
    merchant_code: options.merchantCode,
    description,
    return_url:
      (data?.return_url as string | undefined) ??
      (data?.returnUrl as string | undefined) ??
      options.returnUrl,
    redirect_url:
      (data?.redirect_url as string | undefined) ??
      (data?.redirectUrl as string | undefined) ??
      options.redirectUrl,
    hosted_checkout:
      checkoutMode === "hosted"
        ? {
            enabled: true,
          }
        : undefined,
  }
}

export function createCheckoutUpdatePayload({
  amount,
  currencyCode,
  data,
}: {
  amount: BigNumberInput
  currencyCode: string
  data?: Record<string, unknown>
}): CheckoutUpdateRequest {
  const payload: CheckoutUpdateRequest = {
    amount: toMajorUnitNumber(amount),
    currency: normalizeCurrency(currencyCode),
  }

  const description = data?.description ?? data?.payment_description

  if (typeof description === "string") {
    payload.description = description
  }

  const checkoutReference = data?.checkout_reference ?? data?.checkoutReference

  if (typeof checkoutReference === "string" && checkoutReference.length > 0) {
    payload.checkout_reference = checkoutReference.slice(0, 90)
  }

  return payload
}

export function getSuccessfulTransaction(
  checkout?: Checkout | CheckoutSuccess,
) {
  return checkout?.transactions?.find(
    (transaction: NonNullable<Checkout["transactions"]>[number]) => {
      return transaction.status === "SUCCESSFUL"
    },
  )
}

export function getTransactionId(checkout?: Checkout | CheckoutSuccess) {
  return (
    (checkout as CheckoutSuccess | undefined)?.transaction_id ??
    getSuccessfulTransaction(checkout)?.id
  )
}

export function getTransactionCode(checkout?: Checkout | CheckoutSuccess) {
  return (
    (checkout as CheckoutSuccess | undefined)?.transaction_code ??
    getSuccessfulTransaction(checkout)?.transaction_code
  )
}

export function toStoredPaymentData({
  checkout,
  mode,
}: {
  checkout: Checkout | CheckoutSuccess
  mode: SumUpCheckoutMode
}): SumUpPaymentData {
  const checkoutId = checkout.id
  const checkoutReference = checkout.checkout_reference

  if (!checkoutId || !checkoutReference) {
    throw new Error("SumUp checkout response is missing id or reference.")
  }

  return {
    id: checkoutId,
    checkout_id: checkoutId,
    checkout_reference: checkoutReference,
    checkout_mode: mode,
    hosted_checkout_url: checkout.hosted_checkout_url,
    transaction_id: getTransactionId(checkout),
    transaction_code: getTransactionCode(checkout),
    merchant_code: checkout.merchant_code ?? "",
    currency: checkout.currency,
    amount: checkout.amount,
    raw_checkout: checkout,
  }
}

export function mergeCheckoutIntoPaymentData(
  current: Record<string, unknown> | undefined,
  checkout: Checkout | CheckoutSuccess,
): SumUpPaymentData {
  const mode =
    current?.checkout_mode === "widget" || current?.checkout_mode === "hosted"
      ? current.checkout_mode
      : "hosted"

  return {
    ...(current as SumUpPaymentData | undefined),
    ...toStoredPaymentData({ checkout, mode }),
  }
}

export function mapCheckoutToSessionStatus(
  checkout: Checkout | CheckoutSuccess,
): PaymentSessionStatus {
  if (getSuccessfulTransaction(checkout) || checkout.status === "PAID") {
    return PaymentSessionStatus.CAPTURED
  }

  switch (checkout.status) {
    case "PENDING":
      return PaymentSessionStatus.PENDING
    case "FAILED":
      return PaymentSessionStatus.ERROR
    case "EXPIRED":
      return PaymentSessionStatus.CANCELED
    default:
      return PaymentSessionStatus.PENDING
  }
}

export function mapCheckoutToWebhookAction(
  checkout: Checkout | CheckoutSuccess,
): PaymentActions {
  if (getSuccessfulTransaction(checkout) || checkout.status === "PAID") {
    return PaymentActions.SUCCESSFUL
  }

  switch (checkout.status) {
    case "PENDING":
      return PaymentActions.PENDING
    case "FAILED":
      return PaymentActions.FAILED
    case "EXPIRED":
      return PaymentActions.CANCELED
    default:
      return PaymentActions.NOT_SUPPORTED
  }
}
