import type { Metadata } from "next";
import Navbar from "@/components/navbar/Navbar";
import GuidePage, { type GuideSection } from "@/components/rental-guide/GuidePage";

const sections: GuideSection[] = [
  {
    number: "01",
    title: "Booking in Advance",
    paragraphs: [
      "Reservations should be made ahead of time. Same-day bookings may be accepted only when a unit is available and all requirements are complete. A ₱100 convenience fee applies to an approved same-day rental.",
    ],
  },
  {
    number: "02",
    title: "Security Deposit",
    paragraphs: [
      "A non-refundable security deposit may apply. The exact amount is shown on the product page and in the checkout summary before payment.",
    ],
  },
  {
    number: "03",
    title: "Special Discounts & Loyalty Perks",
    bullets: [
      "A ₱100 birthday discount applies when the selected rental period overlaps the renter's birth month and the saved birth date matches a submitted valid ID.",
      "One returned booking equals one loyalty count, regardless of the number of units in that booking.",
      "The loyalty program is tracked under the same customer account. ₱200 is automatically applied to the booking made after ten completed rentals—the renter's 11th rental.",
      "Discounts cannot reduce the rental-fee portion below zero and do not reduce applicable deposits or courier charges.",
    ],
  },
  {
    number: "04",
    title: "Pickup & Return Schedule",
    bullets: [
      "Pickup is by appointment between 9:00 AM and 7:00 PM.",
      "Rentals are valid for 22 hours from the scheduled pickup time, or 21 hours for rentals outside Manila.",
      "Late returns incur a ₱100 per hour penalty.",
      "Pickup before 9:00 AM or after 7:00 PM may be allowed with a ₱100 convenience fee, subject to availability.",
    ],
  },
  {
    number: "05",
    title: "Handling & Use of Equipment",
    paragraphs: [
      "Treat every rented unit with care. Use only the included chargers, cables, and accessories, and follow the handling guidance provided during release.",
    ],
  },
  {
    number: "06",
    title: "Damage, Loss, or Theft",
    paragraphs: [
      "Damage, water exposure, or missing parts and accessories will be charged accordingly. In the event of loss or theft, the renter is responsible for the applicable full replacement cost.",
    ],
  },
  {
    number: "07",
    title: "Item Condition",
    paragraphs: [
      "Units are sanitized, reset, and tested before release. Inspect the unit at pickup or immediately upon delivery and report any issue at once.",
    ],
  },
  {
    number: "08",
    title: "Inspection & Checklist",
    paragraphs: [
      "Every unit is inspected at release and return. All listed inclusions and accessories must be returned in the same condition.",
    ],
  },
  {
    number: "09",
    title: "Verification & Requirements",
    bullets: [
      "Two valid government-issued or accepted school IDs and a selfie holding an ID",
      "Active personal Facebook and Instagram accounts",
      "A signed rental agreement",
      "Emergency contact's valid ID, Facebook link, and active phone number",
    ],
  },
  {
    number: "10",
    title: "Cancellation & Refund Policy",
    bullets: [
      "Down payments are non-refundable because the unit is exclusively reserved.",
      "Cancellations made at least 48 hours in advance may be considered for rebooking, subject to availability.",
      "Cancellations within 24 hours are non-refundable unless caused by a documented emergency accepted by the rental team.",
    ],
  },
];

export const metadata: Metadata = {
  title: "Terms & Conditions | Rental by Maddy & Cassy",
  description: "Read the booking, deposit, handover, equipment, and cancellation policies.",
};

export default function TermsPage() {
  return (
    <div>
      <Navbar />
      <GuidePage
        eyebrow="RENTAL POLICY"
        title="Terms & Conditions"
        introduction="These policies apply to booking requests, verification, equipment handover, proper use, and return of every rental unit."
        sections={sections}
        layout="stack"
        notice="Reservation payments and applicable non-refundable deposits are paid manually via GCash and verified by our team. Courier delivery costs are arranged separately with the rental team."
      />
    </div>
  );
}
