import { ModuleProvider, Modules } from "@medusajs/framework/utils"

import SumUpPaymentProviderService from "./service"

export default ModuleProvider(Modules.PAYMENT, {
  services: [SumUpPaymentProviderService],
})
