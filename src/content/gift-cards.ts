/**
 * The gift card block's words, the closed note, the thank-you page's states and the cancelled note. Template wording in the
 * owner's first-person voice, for the owner to approve (it is listed in the PR). No prices: an amount is passed in, already
 * written by the code that knows the currency. The owner's own wording (how to redeem, the terms line) is in
 * src/content/gift-cards.json.
 */
export const giftCardWords = {
  /** The block's form. */
  amountLegend: "Choose an amount",
  otherAmount: "Other amount",
  otherAmountLabel: "Amount",
  otherAmountHint: (min: string, max: string) => `A whole amount from ${min} to ${max}.`,
  buyerNameLabel: "Your name",
  buyerEmailLabel: "Your email",
  buyerEmailHint: "The gift card is sent here.",
  recipientNameLabel: "Who is it for? (optional)",
  messageLabel: "A short message (optional)",
  messageHint: "Up to 300 characters. It appears on the gift card.",
  recipientEmailLabel: "Their email (optional)",
  recipientEmailHint: "I send them a copy as soon as you have paid. Leave it empty to give the card yourself.",
  button: "Continue to payment",
  working: "One moment",
  payNote: "You pay on Stripe's secure page. I never see your card number.",
  /** Under the message box: "12 of 300". */
  messageCount: (used: number, max: number) => `${used} of ${max}`,
  /** For a visitor without JavaScript; the email, when there is one, follows. */
  noScript: "Buying a gift card needs JavaScript. You can also write to",
  noScriptNoEmail: "Buying a gift card needs JavaScript. You can also reach me from the contact page.",
  /** Under a field, one per problem a visitor can fix. */
  fieldErrors: {
    amount: "Please choose an amount.",
    customAmount: (min: string, max: string) => `Please enter a whole amount from ${min} to ${max}.`,
    buyerName: "Please tell me your name.",
    buyerEmail: "That email doesn't look quite right.",
    recipientName: "Please keep the name to 100 characters or fewer.",
    message: "Please keep your message to 300 characters or fewer.",
    recipientEmail: "That email doesn't look quite right.",
  },
  /** After the owner's terms line, when the cards expire (60 months or more). */
  validFor: (months: number) => (months % 12 === 0 ? `Valid for ${months / 12} years.` : `Valid for ${months} months.`),
  /** The closed note, when selling is off. */
  contactLink: "Contact me",
  closedHeading: "Gift cards are not on sale right now",
  closedBody: "Please check back soon, or get in touch and I will help.",
  /** Shown above the form when the buyer came back from Stripe without paying. */
  cancelled: "Nothing was charged. Your choices are still here if you want to try again.",
  /** Plain errors under the button. */
  errors: {
    refused: "I could not start the payment. Please check the form and try again.",
    unavailable: "I could not reach the payment page just now. Nothing was charged. Please try again in a minute.",
    rateLimited: "Too many tries in a row. Please wait a minute and try again.",
    closed: "Gift cards are not on sale right now. Nothing was charged. Please check back soon, or get in touch.",
    verification: "Please complete the check above, then try again.",
  },
  thanks: {
    /** The page's own title and description (it is not indexed). */
    page: { title: "Thank you for your gift card", description: "Confirmation of a gift card payment." },
    /** Without JavaScript the page cannot ask Stripe, so it says what happens anyway. */
    noScript: {
      heading: "Thank you",
      body: "I cannot confirm your payment on this page without JavaScript. If you have paid, your gift card is on its way to your email. If it has not come within the hour, get in touch and I will sort it out.",
    },
    checking: {
      heading: "Checking your payment",
      body: "One moment while I confirm it with Stripe.",
    },
    paid: {
      heading: "Thank you",
      body: (amount: string) => `Your ${amount} gift card is paid for. I have emailed it to you, with the certificate attached.`,
      recipient: "A copy has gone to the person you named.",
      keepIt: "Keep the email. The certificate carries the code.",
    },
    stillWaiting: {
      heading: "Still waiting for the payment",
      body: "Your bank has not confirmed it yet. This can take a few minutes. You do not need to pay again; I will email your gift card as soon as it arrives.",
    },
    notPaid: {
      heading: "No payment was taken",
      body: "This checkout was not completed, so nothing was charged. You are welcome to try again.",
      back: "Back to gift cards",
    },
    error: {
      heading: "I could not check your payment",
      body: "Please do not pay again. If you have paid, your gift card will arrive by email. If it has not come within the hour, get in touch and I will sort it out.",
    },
  },
} as const;
