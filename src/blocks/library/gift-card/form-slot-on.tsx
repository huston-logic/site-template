import { GiftCardForm } from "@/components/hl/GiftCardForm";
import type { GiftCardFormProps } from "./form-slot-props";

// Used in place of ./form-slot.tsx when the build can sell gift cards (see next.config.ts).
export function GiftCardFormSlot(props: GiftCardFormProps) {
  return <GiftCardForm {...props} />;
}
