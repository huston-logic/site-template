import { BookingFlow } from "@/components/hl/BookingFlow";
import type { BookingFlowProps } from "./flow-slot-props";

// Used in place of ./flow-slot.tsx when the build can take bookings (see next.config.ts).
export function BookingFlowSlot(props: BookingFlowProps) {
  return <BookingFlow {...props} />;
}
