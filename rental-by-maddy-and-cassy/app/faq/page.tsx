import type { Metadata } from "next";
import Navbar from "@/components/navbar/Navbar";
import GuidePage, { type GuideSection } from "@/components/rental-guide/GuidePage";

const sections: GuideSection[] = [
  {
    title: "How do I reserve a rental?",
    paragraphs: [
      "Submit a booking request through the catalog with your item, dates, and handover preference. You may also message @iosrental.maddycassy through Facebook or TikTok for assistance. The team will confirm availability and guide you through verification.",
    ],
  },
  {
    title: "What payment methods do you accept?",
    paragraphs: [
      "Payments may be made through GCash or bank transfer. A down payment is required to hold an approved unit, with the remaining rental balance due before or at pickup.",
    ],
  },
  {
    title: "Is a security deposit required?",
    paragraphs: [
      "A non-refundable security deposit may apply. Its exact amount is shown on the product page and included in the final amount before you submit your GCash payment proof.",
    ],
  },
  {
    title: "How does the birthday month discount work?",
    paragraphs: [
      "Add your birth date to the booking details. When any selected rental date falls within your birth month, ₱100 is deducted from the rental fee. The birth date must match one of the valid IDs submitted for verification.",
    ],
  },
  {
    title: "How does the loyalty reward work?",
    paragraphs: [
      "Every returned booking under the same customer account counts as one completed rental. After ten completed rentals, ₱200 is automatically applied to the next booking—the 11th rental. No loyalty card is required, and progress is shown under My Bookings.",
    ],
  },
  {
    title: "Can I extend my rental?",
    paragraphs: [
      "Extensions may be approved when the unit remains available for the requested dates. Contact the team before your scheduled return so availability and your rental agreement can be updated.",
    ],
  },
  {
    title: "What happens if I return the item late?",
    paragraphs: [
      "Late returns incur a ₱100 per hour fee. If the delay affects another renter's booking, an additional full-day charge may apply. Notify the team immediately when a delay is expected.",
    ],
  },
  {
    title: "What if the item is damaged or lost?",
    paragraphs: [
      "The renter is responsible for applicable repair costs or replacement value when a unit is damaged, lost, or returned with missing accessories. Handle every unit with care and report incidents immediately.",
    ],
  },
  {
    title: "Are long-term rentals available?",
    paragraphs: [
      "Yes. Contact the team with your dates and requested unit so they can confirm availability and provide a personalized quote.",
    ],
  },
  {
    title: "How do I pick up or return the item?",
    paragraphs: [
      "Pickup and return are arranged at Right Focus Off Campus – Manuel Hizon, Sta. Cruz, Manila. Delivery or pickup may also be arranged through Grab, Lalamove, or Angkas, with roundtrip fees handled by the renter.",
    ],
  },
];

export const metadata: Metadata = {
  title: "Frequently Asked Questions | Rental by Maddy & Cassy",
  description: "Answers about reservations, deposits, extensions, returns, damage, and handover.",
};

export default function FAQPage() {
  return (
    <div>
      <Navbar />
      <GuidePage
        eyebrow="HELP CENTER"
        title="Frequently Asked Questions"
        introduction="Find quick answers to the most common questions about booking, payments, deposits, extensions, returns, and equipment care."
        sections={sections}
        layout="stack"
        notice="For a question specific to your booking, contact the team through the official Contact page."
      />
    </div>
  );
}
