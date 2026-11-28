import type { BookingFlowProps } from "./flow-slot-props";

// Where the booking block puts its flow. This file renders nothing and imports no client code, so a production build with
// booking off ships no booking script on any page (design R1). next.config.ts points this import at ./flow-slot-on.tsx
// when booking is on, and on every build that is not production (previews, CI and local builds keep the flow, so the
// showcase and the checks still exercise it). A server component cannot code-split a client one here.
export function BookingFlowSlot(props: BookingFlowProps): null {
  void props;
  return null;
}
