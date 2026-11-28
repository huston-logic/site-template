import type { GiftCardFormProps } from "./form-slot-props";

// Where the gift card block puts its form. This file renders nothing and imports no client code, so a production build
// with payments off ships no gift card script on any page (design R1). next.config.ts points this import at
// ./form-slot-on.tsx when payments are on, and on every build that is not production (previews, CI and local builds keep
// the form, so the showcase and the checks still exercise it). A server component cannot code-split a client one here.
export function GiftCardFormSlot(props: GiftCardFormProps): null {
  void props;
  return null;
}
