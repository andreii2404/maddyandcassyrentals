import type { Metadata } from "next";
import GuidePage, { type GuideSection } from "@/components/rental-guide/GuidePage";

const sections: GuideSection[] = [
  {
    number: "01",
    title: "Two Valid IDs",
    paragraphs: [
      "Provide two valid government-issued or accepted school IDs. At least one must show your current address and signature.",
    ],
    bullets: [
      "Passport",
      "National ID",
      "Driver's license",
      "Student ID or another accepted valid ID",
    ],
  },
  {
    number: "02",
    title: "Verified Facebook & Instagram Profiles",
    paragraphs: [
      "Both profiles must be your primary personal social media accounts and must be available for verification.",
    ],
    subBullets: [
      "An account is private or locked",
      "A profile is newly created or appears suspicious",
      "An account has no profile picture or appears to be a dummy account",
    ],
  },
  {
    number: "03",
    title: "Emergency Contact Information",
    paragraphs: [
      "Provide a relative or immediate family member who may be contacted in an emergency or rental-related issue.",
    ],
    bullets: [
      "Full name and Facebook account",
      "Active phone number",
      "Photo of their valid government-issued ID",
    ],
  },
  {
    number: "04",
    title: "Rental Contract Agreement",
    paragraphs: [
      "Every renter must review and sign a rental agreement. The agreement protects both parties and documents responsibilities concerning the rented unit, accessories, loss, damage, and proper use.",
    ],
  },
];

export const metadata: Metadata = {
  title: "Rental Requirements | Rental by Maddy & Cassy",
  description: "Review the IDs, social profiles, emergency contact, and agreement required to rent.",
};

export default function RentalRequirementsPage() {
  return (
    <div>
      <GuidePage
        eyebrow="BEFORE YOU BOOK"
        title="Rental Requirements"
        introduction="Prepare these requirements before submitting your booking so the team can verify your request without delays."
        sections={sections}
      />
    </div>
  );
}
