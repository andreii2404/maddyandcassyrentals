import type { Metadata } from "next";
import Navbar from "@/components/navbar/Navbar";
import GuidePage, { type GuideSection } from "@/components/rental-guide/GuidePage";

const sections: GuideSection[] = [
  {
    number: "STEP 01",
    title: "Start Your Booking Request",
    paragraphs: [
      "Browse the catalog, choose your preferred unit, and select your rental dates. You may also contact the team through Facebook or TikTok at @iosrental.maddycassy for assistance.",
    ],
  },
  {
    number: "STEP 02",
    title: "Tell Us Your Rental Plan",
    paragraphs: [
      "Provide the item you want, your preferred rental dates, the number of rental days, and your pickup or delivery preference.",
    ],
  },
  {
    number: "STEP 03",
    title: "Save Your Slot",
    paragraphs: [
      "Review any catalog, birthday-month, or 11th-rental loyalty discounts shown in the checkout summary. A 50% down payment of the final booking total secures the reservation and is non-refundable, or you may pay the full amount online.",
    ],
  },
  {
    number: "STEP 04",
    title: "Confirm Your Identity & Sign",
    paragraphs: ["Submit the required verification documents and rental agreement:"],
    bullets: [
      "Two valid government-issued or accepted school IDs",
      "A clear selfie while holding an accepted ID",
      "Verified Facebook and Instagram profiles",
      "A signed rental agreement",
      "Complete emergency contact information",
    ],
  },
  {
    number: "STEP 05",
    title: "Choose Your Handover Option",
    paragraphs: [
      "Pick up your unit at Right Focus Off Campus – Manuel Hizon, Sta. Cruz, Manila, or arrange delivery through Grab, Lalamove, or Angkas. Roundtrip delivery fees are handled by the renter.",
    ],
  },
];

export const metadata: Metadata = {
  title: "How to Book | Rental by Maddy & Cassy",
  description: "Follow the Rental by Maddy & Cassy booking process from request to handover.",
};

export default function HowToBookPage() {
  return (
    <div>
      <Navbar />
      <GuidePage
        eyebrow="RENTAL GUIDE"
        title="How to Book"
        introduction="Follow these steps to request your unit, complete verification, and arrange pickup or delivery."
        sections={sections}
        notice="Reservation payments and applicable non-refundable deposits are sent through GCash and verified by the rental team. Delivery courier costs are arranged separately."
      />
    </div>
  );
}
