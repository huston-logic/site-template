import type { BookingView } from "@/blocks/types";

/** What the booking flow takes (both flow slots share it). */
export type BookingFlowProps = { view: BookingView; service?: string };
