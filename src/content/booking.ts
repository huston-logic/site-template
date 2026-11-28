/**
 * Every visible word of the booking block and its thank-you page. Template wording in the owner's first-person voice, for
 * the owner to approve (it is listed in the PR). No client facts, no prices: a figure is passed in, already written by the
 * code that knows the currency. The owner's own wording (policy, how to change a booking, the gift card line) is in
 * src/content/booking.json.
 */
export const bookingWords = {
  /** On a catalog piece's page, beside the quote. */
  bookATime: "Book a time",
  /** The service step. */
  serviceLegend: "What would you like to book?",
  free: "Free",
  /** "Two sessions of 3 hours, 2 to 10 days apart". */
  length: {
    one: (duration: string) => duration,
    several: (count: number, duration: string, between: string) => `${count === 2 ? "Two" : String(count)} sessions of ${duration}, ${between} apart`,
    days: (min: number, max: number) => (min === max ? `${min} ${min === 1 ? "day" : "days"}` : min === 0 ? `up to ${max} days` : `${min} to ${max} days`),
    hours: (hours: number) => `${hours} ${hours === 1 ? "hour" : "hours"}`,
    minutes: (minutes: number) => `${minutes} minutes`,
    hoursAndMinutes: (hours: number, minutes: number) => `${hours} ${hours === 1 ? "hour" : "hours"} ${minutes} minutes`,
  },
  /** The price line of a service card. */
  price: {
    perPerson: (amount: string) => `${amount} per person`,
    perBooking: (amount: string) => `${amount} for the booking`,
    deposit: (text: string) => `${text} deposit`,
    percent: (percent: number) => `${percent}%`,
    paidOnTheDay: ", paid on the day",
  },
  partyLegend: "How many people?",
  partyHint: (min: number, max: number) => (min === max ? "" : `From ${min} to ${max}.`),
  partyDecrease: "Fewer people",
  partyIncrease: "More people",
  partyOutput: (count: number) => `${count} ${count === 1 ? "person" : "people"}`,
  /** A session's step. */
  singleSessionHeading: "Choose a time",
  sessionHeading: (index: number, count: number) => `Session ${index} of ${count}`,
  sessionLength: (duration: string) => duration,
  /** Under a later session's heading: the rule, in words. */
  rule: {
    sameDayOrLater: (max: number) => `On the same day as the one before, or up to ${max} ${max === 1 ? "day" : "days"} after it.`,
    exact: (days: number) => `${days} ${days === 1 ? "day" : "days"} after the one before.`,
    range: (min: number, max: number) => `${min} to ${max} days after the one before.`,
    after: (min: number) => `At least ${min} ${min === 1 ? "day" : "days"} after the one before.`,
  },
  zone: (name: string) => `Times are in ${name}.`,
  dayGroupLegend: "Day",
  previousWeek: "Earlier days",
  nextWeek: "Later days",
  noTimesDay: "no times",
  noTimesAtAll: "There are no times in these days. Try the later days.",
  timesLegend: (day: string) => `Times on ${day}`,
  pickADay: "Choose a day to see its times.",
  loading: "Loading times",
  timesFailed: "Times could not be loaded. Please get in touch.",
  contactLink: "Get in touch",
  chosenAnnounce: (index: number, count: number) => (index < count ? `Time chosen. Session ${index + 1} of ${count} is next.` : "Time chosen. Your details come next."),
  taken: "That time was just taken. Please choose another.",
  /** The details step. */
  detailsHeading: "Your details",
  /** The summary. */
  summaryHeading: "Your booking",
  summary: {
    service: "Service",
    when: "When",
    nothingNow: "Nothing",
    people: "People",
    total: "Total",
    dueNow: "Due now",
    dueLater: "Due later",
    forItem: (name: string) => `For: ${name}`,
  },
  /** The one button. */
  payButton: (amount: string) => `Pay ${amount} now`,
  confirmButton: "Confirm booking",
  working: "One moment",
  payNote: "You pay on Stripe's secure page. I never see your card number.",
  noPayNote: "Nothing is charged online.",
  /** Back from Stripe without paying. */
  cancelled: "Nothing was charged. Your choices are kept.",
  /** Plain errors under the button. */
  errors: {
    refused: "I could not make the booking. Please check the details and try again.",
    unavailable: "I could not reach the booking system just now. Nothing was charged. Please try again in a minute, or get in touch.",
    rateLimited: "Too many tries in a row. Please wait a minute and try again.",
    closed: "Booking is closed right now. Nothing was charged. Please get in touch.",
    verification: "Please complete the check above, then try again.",
    chooseTimes: "Please choose a time for every session.",
  },
  /** For a visitor without JavaScript. */
  noScript: {
    heading: "To book, get in touch",
    body: "Choosing a time needs JavaScript. You can reach me here.",
    emailLabel: "Email",
    phoneLabel: "Phone",
  },
  /** Shown while booking is off, or no service can be booked. */
  closed: {
    heading: "Booking is not open right now",
    body: "Please check back soon, or get in touch and I will help.",
  },
  thanks: {
    page: { title: "Thank you for booking", description: "Confirmation of a booking." },
    checking: { heading: "Checking your booking", body: "One moment while I look it up." },
    booked: {
      heading: "You are booked",
      paid: (amount: string) => `Your payment of ${amount} is in.`,
      free: "Your booking is confirmed.",
      dueLater: (text: string) => text,
      emailed: "The details and a calendar file are in your inbox.",
      notEmailed: "Please keep this page for your records.",
      sessionsLegend: "Your times",
    },
    clash: {
      heading: "Your payment is in",
      body: (owner: string) => `${owner} will contact you about your time.`,
      ownerFallback: "I",
    },
    waiting: { heading: "Your payment is in", body: "Your time is being confirmed. This page checks again on its own." },
    notPaid: { heading: "No payment found", body: "Nothing was charged. You can go back and choose your time again.", back: "Back to booking" },
    error: { heading: "I could not check your booking", body: "If you paid, your payment is safe. Please get in touch and I will confirm it by hand." },
    freeMissing: { heading: "Thank you", body: "Your booking is confirmed. The details are in your inbox." },
    noScript: { heading: "Thank you", body: "If you booked, the details are in your inbox. If you do not see them soon, please get in touch." },
    summary: { reference: "Reference", people: "People", service: "Service", forItem: "For" },
  },
} as const;
