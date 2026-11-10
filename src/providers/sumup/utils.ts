import { randomUUID } from "node:crypto"
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
  if (typeof amount === "object" && "value" in amount) {
    return Number(amount.value)
  }

  return Number(amount)
}

// SumUp uses zero decimals for these currencies, including COP and HUF.
const ZERO_DECIMAL_CURRENCIES = new Set(["CLP", "COP", "HUF"])

export function toRefundMinorUnits(
  amount: BigNumberInput,
  currencyCode: string,
): number {
  const currency = normalizeCurrency(currencyCode)
  const majorUnits = toMajorUnitNumber(amount)
  const scaled = majorUnits * (ZERO_DECIMAL_CURRENCIES.has(currency) ? 1 : 100)
  const minorUnits = Math.round(scaled)
  // Allow floating-point multiplication noise, but never round a fractional cent.
  const tolerance = Math.min(1e-7, Number.EPSILON * Math.abs(scaled) * 4)

  if (
    !Number.isFinite(majorUnits) ||
    !Number.isSafeInteger(minorUnits) ||
    minorUnits <= 0 ||
    Math.abs(scaled - minorUnits) > tolerance
  ) {
    throw new Error(
      `Refund amount must be positive and representable in ${currency} minor units.`,
    )
  }

  return minorUnits
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
  const client = data?.client as Record<string, unknown> | undefined
  const mode =
    client?.checkout_mode ??
    client?.checkoutMode ??
    data?.checkout_mode ??
    data?.checkoutMode ??
    options.checkoutMode

  if (mode === "hosted" || mode === "widget") {
    return mode
  }

  return "hosted"
}

export function getMedusaSessionId(reference?: string): string | undefined {
  if (!reference) return undefined
  const match = /^(payses_[A-Za-z0-9_]{1,40})(?::[a-f0-9]{16})?$/.exec(
    reference,
  )
  return match?.[1]
}

export function createCheckoutReference(
  data?: Record<string, unknown>,
): string {
  const sessionId =
    typeof data?.session_id === "string"
      ? getMedusaSessionId(data.session_id)
      : undefined

  if (!sessionId) {
    throw new Error(
      "A valid Medusa payment session_id is required to create a SumUp checkout.",
    )
  }

  return `${sessionId}:${randomUUID().replaceAll("-", "").slice(0, 16)}`
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
    checkout_reference: createCheckoutReference(data),
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

  const safeCurrent = { ...current }
  delete safeCurrent.raw_checkout

  return {
    ...safeCurrent,
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
