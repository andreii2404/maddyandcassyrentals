export interface FaqItem {
  question: string;
  answer: string;
}

/**
 * Shared source of truth for FAQ copy, consumed by both the dedicated /faq
 * page (via GuidePage) and the homepage FAQ preview section, so the two
 * never drift out of sync.
 */
export const faqItems: FaqItem[] = [
  {
    question: "How do I reserve a rental?",
    answer:
      "Submit a booking request through the catalog with your item, dates, and handover preference. You may also message @iosrental.maddycassy through Facebook or TikTok for assistance. The team will confirm availability and guide you through verification.",
  },
  {
    question: "What payment methods do you accept?",
    answer:
      "Payments may be made through GCash or bank transfer. A down payment is required to hold an approved unit, with the remaining rental balance due before or at pickup.",
  },
  {
    question: "Is a security deposit required?",
    answer:
      "A non-refundable security deposit may apply. Its exact amount is shown on the product page and included in the final checkout amount before you pay via GCash.",
  },
  {
    question: "How does the birthday month discount work?",
    answer:
      "Add your birth date to the booking details. When any selected rental date falls within your birth month, ₱100 is deducted from the rental fee. The birth date must match one of the valid IDs submitted for verification.",
  },
  {
    question: "How does the loyalty reward work?",
    answer:
      "Every returned booking under the same customer account counts as one completed rental. After ten completed rentals, ₱200 is automatically applied to the next booking—the 11th rental. No loyalty card is required, and progress is shown under My Bookings.",
  },
  {
    question: "Can I extend my rental?",
    answer:
      "Extensions may be approved when the unit remains available for the requested dates. Contact the team before your scheduled return so availability and your rental agreement can be updated.",
  },
  {
    question: "What happens if I return the item late?",
    answer:
      "Late returns incur a ₱100 per hour fee. If the delay affects another renter's booking, an additional full-day charge may apply. Notify the team immediately when a delay is expected.",
  },
  {
    question: "What if the item is damaged or lost?",
    answer:
      "The renter is responsible for applicable repair costs or replacement value when a unit is damaged, lost, or returned with missing accessories. Handle every unit with care and report incidents immediately.",
  },
  {
    question: "Are long-term rentals available?",
    answer:
      "Yes. Contact the team with your dates and requested unit so they can confirm availability and provide a personalized quote.",
  },
  {
    question: "How do I pick up or return the item?",
    answer:
      "Pickup and return are arranged at Right Focus Off Campus – Manuel Hizon, Sta. Cruz, Manila. Delivery or pickup may also be arranged through Grab, Lalamove, or Angkas, with roundtrip fees handled by the renter.",
  },
];
