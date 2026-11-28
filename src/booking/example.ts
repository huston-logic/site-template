// The showcase settings (/blocks): booking on, one free consultation and one two-session paid workshop. Template wording, not a client's.
import type { BookingSettings, Window } from "./schema.ts";

const workday: Window[] = [["09:00", "17:00"]];
const consultationDay: Window[] = [["10:00", "16:00"]];

export const exampleBooking: BookingSettings = {
  taking: true,
  policy: "Please arrive a few minutes early. A deposit is not refunded if you cancel less than 48 hours before your first session.",
  changeWording: "To change or cancel a booking, reply to your confirmation email at least 48 hours ahead.",
  giftCardLine: "Have a gift card? Book as usual and show your certificate when you arrive.",
  hours: {
    weekly: { mon: workday, tue: workday, wed: workday, thu: workday, fri: workday, sat: [], sun: [] },
    starts: { every: 30 },
    bufferMinutes: 15,
    noticeHours: 24,
    aheadDays: 60,
    closed: [],
  },
  services: [
    {
      id: "consultation",
      name: "Consultation",
      description: "A one-hour conversation about what you need.",
      status: "live",
      sessions: [{ minutes: 60 }],
      between: null,
      party: { min: 1, max: 1 },
      price: null,
      payment: { kind: "free" },
      hours: { weekly: { mon: consultationDay, tue: consultationDay, wed: consultationDay, thu: consultationDay, fri: consultationDay, sat: [], sun: [] } },
    },
    {
      id: "workshop",
      name: "Workshop",
      description: "Two three-hour sessions, a few days apart.",
      status: "live",
      sessions: [{ minutes: 180 }, { minutes: 180 }],
      between: { minDays: 2, maxDays: 10 },
      party: { min: 1, max: 6 },
      price: { amount: 150, per: "person" },
      payment: { kind: "deposit", percent: 25 },
    },
  ],
};
