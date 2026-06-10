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

import { SumUpApiClient } from "./client"
import type {
  SumUpClient,
  SumUpPaymentData,
  SumUpProviderOptions,
  SumUpWebhookBody,
} from "./types"
import {
  createCheckoutPayload,
  getTransactionId,
  mapCheckoutToSessionStatus,
  mapCheckoutToWebhookAction,
  mergeCheckoutIntoPaymentData,
  resolveCheckoutMode,
  toMajorUnitNumber,
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
        data: {
          ...input.data,
          idempotency_key: input.context?.idempotency_key,
        },
        options: this.options_,
      }),
      input.context?.idempotency_key,
    )

    const data = toStoredPaymentData({ checkout, mode })

    return {
      id: data.checkout_id,
      status: PaymentSessionStatus.PENDING,
      data: data as unknown as Record<string, unknown>,
    }
  }

  async authorizePayment(
    input: AuthorizePaymentInput,
  ): Promise<AuthorizePaymentOutput> {
    return await this.getPaymentStatus(input)
  }

  async getPaymentStatus(
    input: GetPaymentStatusInput,
  ): Promise<GetPaymentStatusOutput> {
    const checkout = await this.retrieveProviderCheckout(input.data)

    return {
      status: mapCheckoutToSessionStatus(checkout),
      data: mergeCheckoutIntoPaymentData(
        input.data,
        checkout,
      ) as unknown as Record<string, unknown>,
    }
  }

  async capturePayment(
    input: CapturePaymentInput,
  ): Promise<CapturePaymentOutput> {
    const checkout = await this.retrieveProviderCheckout(input.data)
    const status = mapCheckoutToSessionStatus(checkout)

    if (status !== PaymentSessionStatus.CAPTURED) {
      throw new MedusaError(
        MedusaError.Types.UNEXPECTED_STATE,
        "Cannot capture SumUp payment before the checkout is paid.",
      )
    }

    return {
      data: mergeCheckoutIntoPaymentData(
        input.data,
        checkout,
      ) as unknown as Record<string, unknown>,
    }
  }

  async refundPayment({
    amount,
    data,
  }: RefundPaymentInput): Promise<RefundPaymentOutput> {
    const paymentData = data as SumUpPaymentData | undefined
    let transactionId = paymentData?.transaction_id
    let nextData = data

    if (!transactionId) {
      const checkout = await this.retrieveProviderCheckout(data)
      transactionId = getTransactionId(checkout)
      nextData = mergeCheckoutIntoPaymentData(
        data,
        checkout,
      ) as unknown as Record<string, unknown>
    }

    if (!transactionId) {
      throw new MedusaError(
        MedusaError.Types.INVALID_DATA,
        "Cannot refund SumUp payment without a successful transaction id.",
      )
    }

    await this.client_.refundTransaction(
      transactionId,
      toMajorUnitNumber(amount),
    )

    return {
      data: nextData,
    }
  }

  async cancelPayment({
    data,
  }: CancelPaymentInput): Promise<CancelPaymentOutput> {
    const checkoutId = this.getCheckoutId(data)

    if (!checkoutId) {
      return { data }
    }

    const checkout = await this.retrieveProviderCheckout(data)
    const status = mapCheckoutToSessionStatus(checkout)

    if (status === PaymentSessionStatus.CAPTURED) {
      return {
        data: mergeCheckoutIntoPaymentData(data, checkout) as unknown as Record<
          string,
          unknown
        >,
      }
    }

    try {
      const deactivated = await this.client_.deactivateCheckout(checkoutId)
      return {
        data: mergeCheckoutIntoPaymentData(
          data,
          deactivated,
        ) as unknown as Record<string, unknown>,
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
      data: mergeCheckoutIntoPaymentData(data, checkout) as unknown as Record<
        string,
        unknown
      >,
    }
  }

  async updatePayment(input: UpdatePaymentInput): Promise<UpdatePaymentOutput> {
    const checkout = await this.retrieveProviderCheckout(input.data)
    const status = mapCheckoutToSessionStatus(checkout)
    const currentAmount = toMajorUnitNumber(input.amount)
    const currentCurrency = input.currency_code.toUpperCase()

    if (
      checkout.amount === currentAmount &&
      checkout.currency === currentCurrency
    ) {
      return {
        status,
        data: mergeCheckoutIntoPaymentData(
          input.data,
          checkout,
        ) as unknown as Record<string, unknown>,
      }
    }

    if (status === PaymentSessionStatus.CAPTURED) {
      throw new MedusaError(
        MedusaError.Types.UNEXPECTED_STATE,
        "Cannot update a SumUp checkout after it has been paid.",
      )
    }

    if (!checkout.id) {
      throw new MedusaError(
        MedusaError.Types.UNEXPECTED_STATE,
        "Cannot replace a SumUp checkout without an existing checkout id.",
      )
    }

    await this.client_.deactivateCheckout(checkout.id)

    const mode = resolveCheckoutMode(this.options_, input.data)
    const replacement = await this.client_.createCheckout(
      createCheckoutPayload({
        amount: input.amount,
        currencyCode: input.currency_code,
        data: input.data,
        options: this.options_,
      }),
      input.context?.idempotency_key,
    )

    return {
      status: PaymentSessionStatus.PENDING,
      data: toStoredPaymentData({
        checkout: replacement,
        mode,
      }) as unknown as Record<string, unknown>,
    }
  }

  async getWebhookActionAndData(
    payload: ProviderWebhookPayload["payload"],
  ): Promise<WebhookActionResult> {
    const data = payload.data as SumUpWebhookBody

    if (data?.event_type !== "CHECKOUT_STATUS_CHANGED" || !data.id) {
      return { action: PaymentActions.NOT_SUPPORTED }
    }

    const checkout = await this.client_.retrieveCheckout(data.id)
    const action = mapCheckoutToWebhookAction(checkout)

    if (action === PaymentActions.NOT_SUPPORTED) {
      return { action }
    }

    return {
      action,
      data: {
        session_id: checkout.checkout_reference ?? "",
        amount: checkout.amount ?? 0,
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
      return await this.client_.retrieveCheckout(checkoutId)
    } catch (error) {
      throw this.buildProviderError("Failed to retrieve SumUp checkout.", error)
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
