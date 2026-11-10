import type {
  AuthorizePaymentInput,
  AuthorizePaymentOutput,
  CancelPaymentInput,
  CancelPaymentOutput,
  CapturePaymentInput,
  CapturePaymentOutput,
  DeletePaymentInput,
  DeletePaymentOutput,
  GetPaymentStatusInput,
  GetPaymentStatusOutput,
  InitiatePaymentInput,
  InitiatePaymentOutput,
  ProviderWebhookPayload,
  RefundPaymentInput,
  RefundPaymentOutput,
  RetrievePaymentInput,
  RetrievePaymentOutput,
  UpdatePaymentInput,
  UpdatePaymentOutput,
  WebhookActionResult,
} from "@medusajs/framework/types"
import {
  AbstractPaymentProvider,
  MedusaError,
  PaymentActions,
  PaymentSessionStatus,
} from "@medusajs/framework/utils"
import type { CheckoutSuccess, CheckoutUpdateRequest } from "@sumup/sdk"

import { SumUpApiClient } from "./client"
import type {
  SumUpClient,
  SumUpPaymentData,
  SumUpProviderOptions,
  SumUpWebhookBody,
} from "./types"
import {
  createCheckoutPayload,
  createCheckoutUpdatePayload,
  getMedusaSessionId,
  getTransactionId,
  mapCheckoutToSessionStatus,
  mapCheckoutToWebhookAction,
  mergeCheckoutIntoPaymentData,
  resolveCheckoutMode,
  toRefundMinorUnits,
  toStoredPaymentData,
} from "./utils"

type InjectedDependencies = Record<string, unknown>

class SumUpPaymentProviderService extends AbstractPaymentProvider<SumUpProviderOptions> {
  static identifier = "sumup"

  protected readonly options_: SumUpProviderOptions
  protected readonly client_: SumUpClient

  static validateOptions(options: SumUpProviderOptions): void {
    if (!options?.apiKey) {
      throw new MedusaError(
        MedusaError.Types.INVALID_DATA,
        "Required option `apiKey` is missing in SumUp payment provider options.",
      )
    }

    if (!options?.merchantCode) {
      throw new MedusaError(
        MedusaError.Types.INVALID_DATA,
        "Required option `merchantCode` is missing in SumUp payment provider options.",
      )
    }
  }

  constructor(container: InjectedDependencies, options: SumUpProviderOptions) {
    super(container, options)

    this.options_ = {
      checkoutMode: "hosted",
      ...options,
    }
    this.client_ = options.client ?? new SumUpApiClient(this.options_)
  }

  async initiatePayment(
    input: InitiatePaymentInput,
  ): Promise<InitiatePaymentOutput> {
    const mode = resolveCheckoutMode(this.options_, input.data)
    const checkout = await this.client_.createCheckout(
      createCheckoutPayload({
        amount: input.amount,
        currencyCode: input.currency_code,
        data: input.data,
        options: this.options_,
      }),
      input.context?.idempotency_key,
    )

    const data = toStoredPaymentData({ checkout, mode })

    return {
      id: data.checkout_id,
      status: PaymentSessionStatus.PENDING,
      data,
    }
  }

  async authorizePayment(
    input: AuthorizePaymentInput,
  ): Promise<AuthorizePaymentOutput> {
    const checkout = await this.retrieveProviderCheckout(input.data)
    this.assertExpectedPayment(checkout, input.data)

    return {
      status: mapCheckoutToSessionStatus(checkout),
      data: mergeCheckoutIntoPaymentData(input.data, checkout),
    }
  }

  async getPaymentStatus(
    input: GetPaymentStatusInput,
  ): Promise<GetPaymentStatusOutput> {
    const checkout = await this.retrieveProviderCheckout(input.data)

    return {
      status: mapCheckoutToSessionStatus(checkout),
      data: mergeCheckoutIntoPaymentData(input.data, checkout),
    }
  }

  async capturePayment(
    input: CapturePaymentInput,
  ): Promise<CapturePaymentOutput> {
    const checkout = await this.retrieveProviderCheckout(input.data)
    this.assertExpectedPayment(checkout, input.data)
    const status = mapCheckoutToSessionStatus(checkout)

    if (status !== PaymentSessionStatus.CAPTURED) {
      throw new MedusaError(
        MedusaError.Types.UNEXPECTED_STATE,
        "Cannot capture SumUp payment before the checkout is paid.",
      )
    }

    return {
      data: mergeCheckoutIntoPaymentData(input.data, checkout),
    }
  }

  async refundPayment({
    amount,
    data,
  }: RefundPaymentInput): Promise<RefundPaymentOutput> {
    const paymentData = data as SumUpPaymentData | undefined
    let transactionId = paymentData?.transaction_id
    let currency = paymentData?.currency
    let nextData = { ...data }
    delete nextData.raw_checkout

    if (!transactionId || !currency) {
      const checkout = await this.retrieveProviderCheckout(data)
      transactionId = getTransactionId(checkout) ?? transactionId
      currency = checkout.currency
      nextData = mergeCheckoutIntoPaymentData(data, checkout)
    }

    if (!transactionId) {
      throw new MedusaError(
        MedusaError.Types.INVALID_DATA,
        "Cannot refund SumUp payment without a successful transaction id.",
      )
    }

    if (!currency) {
      throw new MedusaError(
        MedusaError.Types.INVALID_DATA,
        "Cannot refund SumUp payment without its currency.",
      )
    }

    await this.client_.refundTransaction(
      transactionId,
      toRefundMinorUnits(amount, currency),
    )

    return {
      data: { ...nextData, transaction_id: transactionId },
    }
  }

  async cancelPayment({
    data,
  }: CancelPaymentInput): Promise<CancelPaymentOutput> {
    const checkoutId = this.getCheckoutId(data)

    if (!checkoutId) {
      const safeData = { ...data }
      delete safeData.raw_checkout
      return { data: safeData }
    }

    const checkout = await this.retrieveProviderCheckout(data)
    const status = mapCheckoutToSessionStatus(checkout)

    if (
      status === PaymentSessionStatus.CAPTURED ||
      status === PaymentSessionStatus.CANCELED
    ) {
      return {
        data: mergeCheckoutIntoPaymentData(data, checkout),
      }
    }

    try {
      const deactivated = await this.client_.deactivateCheckout(checkoutId)
      return {
        data: mergeCheckoutIntoPaymentData(data, deactivated),
      }
    } catch (error) {
      throw this.buildProviderError("Failed to cancel SumUp checkout.", error)
    }
  }

  async deletePayment(input: DeletePaymentInput): Promise<DeletePaymentOutput> {
    return await this.cancelPayment(input)
  }

  async retrievePayment({
    data,
  }: RetrievePaymentInput): Promise<RetrievePaymentOutput> {
    const checkout = await this.retrieveProviderCheckout(data)

    return {
      data: mergeCheckoutIntoPaymentData(data, checkout),
    }
  }

  async updatePayment(input: UpdatePaymentInput): Promise<UpdatePaymentOutput> {
    const checkout = await this.retrieveProviderCheckout(input.data)
    const status = mapCheckoutToSessionStatus(checkout)
    const currentMode = resolveCheckoutMode(this.options_, input.data)
    const existingMode =
      checkout.hosted_checkout_url || input.data?.hosted_checkout_url
        ? "hosted"
        : "widget"
    const requestedUpdatePayload = createCheckoutUpdatePayload({
      amount: input.amount,
      currencyCode: input.currency_code,
      data: input.data,
    })
    const updatePayload: CheckoutUpdateRequest = {}

    if (checkout.amount !== requestedUpdatePayload.amount) {
      updatePayload.amount = requestedUpdatePayload.amount
    }

    if (checkout.currency !== requestedUpdatePayload.currency) {
      updatePayload.currency = requestedUpdatePayload.currency
    }

    if (
      requestedUpdatePayload.description !== undefined &&
      checkout.description !== requestedUpdatePayload.description
    ) {
      updatePayload.description = requestedUpdatePayload.description
    }

    if (
      Object.keys(updatePayload).length === 0 &&
      existingMode === currentMode
    ) {
      return {
        status,
        data: mergeCheckoutIntoPaymentData(input.data, checkout),
      }
    }

    if (status === PaymentSessionStatus.CAPTURED) {
      throw new MedusaError(
        MedusaError.Types.UNEXPECTED_STATE,
        "Cannot update a SumUp checkout after it has been paid.",
      )
    }

    if (
      status === PaymentSessionStatus.PENDING &&
      existingMode === currentMode
    ) {
      const updated = await this.client_.updateCheckout(
        checkout.id,
        updatePayload,
      )

      return {
        status: PaymentSessionStatus.PENDING,
        data: mergeCheckoutIntoPaymentData(input.data, updated),
      }
    }

    const replacement = await this.client_.createCheckout(
      createCheckoutPayload({
        amount: input.amount,
        currencyCode: input.currency_code,
        data: {
          ...input.data,
          checkout_mode: currentMode,
          // The original reference retains the session link for older stored data.
          session_id: getMedusaSessionId(checkout.checkout_reference),
        },
        options: this.options_,
      }),
      input.context?.idempotency_key,
    )

    const replacementData = toStoredPaymentData({
      checkout: replacement,
      mode: currentMode,
    })

    try {
      if (status !== PaymentSessionStatus.CANCELED) {
        await this.client_.deactivateCheckout(checkout.id)
      }
    } catch (error) {
      await this.client_.deactivateCheckout(replacementData.checkout_id)
      throw this.buildProviderError(
        "Failed to deactivate the original SumUp checkout; replacement was canceled.",
        error,
      )
    }

    return {
      status: PaymentSessionStatus.PENDING,
      data: replacementData,
    }
  }

  async getWebhookActionAndData(
    payload: ProviderWebhookPayload["payload"],
  ): Promise<WebhookActionResult> {
    const data = payload.data as SumUpWebhookBody

    if (
      data?.event_type !== "CHECKOUT_STATUS_CHANGED" ||
      typeof data.id !== "string" ||
      !data.id
    ) {
      return { action: PaymentActions.NOT_SUPPORTED }
    }

    const checkout = await this.client_.retrieveCheckout(data.id)
    const sessionId = getMedusaSessionId(checkout.checkout_reference)
    if (
      checkout.id !== data.id ||
      checkout.merchant_code !== this.options_.merchantCode ||
      !sessionId ||
      typeof checkout.amount !== "number" ||
      !Number.isFinite(checkout.amount) ||
      checkout.amount <= 0
    ) {
      return { action: PaymentActions.NOT_SUPPORTED }
    }
    const action = mapCheckoutToWebhookAction(checkout)

    if (action === PaymentActions.NOT_SUPPORTED) {
      return { action }
    }

    return {
      action,
      data: {
        session_id: sessionId,
        amount: checkout.amount,
      },
    }
  }

  private async retrieveProviderCheckout(data?: Record<string, unknown>) {
    const checkoutId = this.getCheckoutId(data)

    if (!checkoutId) {
      throw new MedusaError(
        MedusaError.Types.INVALID_DATA,
        "Missing SumUp checkout id in payment data.",
      )
    }

    try {
      const checkout = await this.client_.retrieveCheckout(checkoutId)
      this.assertCheckoutIdentity(checkout, checkoutId)
      return checkout
    } catch (error) {
      throw this.buildProviderError("Failed to retrieve SumUp checkout.", error)
    }
  }

  private assertCheckoutIdentity(
    checkout: CheckoutSuccess,
    checkoutId: string,
  ): asserts checkout is CheckoutSuccess & { id: string } {
    if (
      checkout.id !== checkoutId ||
      checkout.merchant_code !== this.options_.merchantCode
    ) {
      throw new MedusaError(
        MedusaError.Types.INVALID_DATA,
        "SumUp checkout does not match the requested checkout and configured merchant.",
      )
    }
  }

  private assertExpectedPayment(
    checkout: CheckoutSuccess,
    data?: Record<string, unknown>,
  ): void {
    const expectedAmount = data?.amount
    const expectedCurrency = data?.currency
    if (
      (expectedAmount !== undefined && checkout.amount !== expectedAmount) ||
      (expectedCurrency !== undefined && checkout.currency !== expectedCurrency)
    ) {
      throw new MedusaError(
        MedusaError.Types.INVALID_DATA,
        "SumUp checkout does not match the expected amount and currency stored for this payment.",
      )
    }
  }

  private getCheckoutId(data?: Record<string, unknown>): string | undefined {
    const paymentData = data as SumUpPaymentData | undefined
    const checkoutId = paymentData?.checkout_id ?? paymentData?.id

    return typeof checkoutId === "string" && checkoutId.length > 0
      ? checkoutId
      : undefined
  }

  private buildProviderError(message: string, error: unknown): MedusaError {
    const detail =
      error instanceof Error
        ? error.message
        : typeof error === "string"
          ? error
          : "Unknown SumUp API error"

    return new MedusaError(
      MedusaError.Types.UNEXPECTED_STATE,
      `${message} ${detail}`.trim(),
    )
  }
}

export default SumUpPaymentProviderService
