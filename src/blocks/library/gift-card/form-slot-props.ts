import type { GiftCardSettings } from "@/gift-cards/schema";
import type { PaymentCurrency } from "@/payments/config";

/** What the gift card form takes (both form slots share it). */
export type GiftCardFormProps = { settings: GiftCardSettings; currency: PaymentCurrency };
