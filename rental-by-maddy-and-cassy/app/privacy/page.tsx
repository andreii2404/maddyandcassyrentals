import type { Metadata } from "next";
import GuidePage, { type GuideSection } from "@/components/rental-guide/GuidePage";

const sections: GuideSection[] = [
  {
    number: "01",
    title: "Information We Collect",
    paragraphs: [
      "Customer account creation collects your full name, active phone number, email address, and email-verification record. Administrator accounts also use password-based credentials. When you submit a booking request, the reservation process collects your address, Facebook and Instagram profile links, two valid IDs, a selfie holding an ID, and consent records. It also collects the emergency contact's name, relationship, phone number, Facebook link, and government-issued ID.",
    ],
  },
  {
    number: "02",
    title: "Why We Use It",
    paragraphs: [
      "This information is used to create and secure customer accounts, verify identity and rental eligibility, prevent fraud, process booking requests, prepare rental agreements, coordinate pickup or delivery, manage active rentals, and respond to rental-related incidents or disputes.",
    ],
  },
  {
    number: "03",
    title: "Access & Disclosure",
    paragraphs: [
      "Private identity files are limited to the customer and active Rental by Maddy & Cassy administrators. Information may be processed by service providers used for authentication, database hosting, file storage, and security. Only necessary contact or delivery information may be provided to a courier when the customer requests delivery.",
    ],
  },
  {
    number: "04",
    title: "Storage & Security",
    paragraphs: [
      "Account data is stored through Supabase services. Government IDs and verification files are kept in private storage paths protected by authenticated access rules. Reasonable administrative and technical safeguards are used, but no online system can guarantee absolute security.",
    ],
  },
  {
    number: "05",
    title: "Retention",
    paragraphs: [
      "Account details are retained while the account remains active. Verification documents are stored with the related booking. Account deletion removes the login, customer profile, and notifications, while booking, agreement, and rental records may be retained when necessary for active obligations, completed rental history, disputes, fraud prevention, accounting, or legal requirements.",
    ],
  },
  {
    number: "06",
    title: "Your Privacy Rights",
    paragraphs: [
      "You may ask to access or correct your personal information, object to or withdraw consent where applicable, or request deletion or blocking subject to active rental and lawful recordkeeping requirements. You may also raise a concern with the National Privacy Commission.",
    ],
  },
  {
    number: "07",
    title: "Emergency Contact Information",
    paragraphs: [
      "Before submitting another person's details or ID, you must obtain their permission and explain that the information will be used only for rental verification, emergency contact, and rental-issue handling.",
    ],
  },
  {
    number: "08",
    title: "Contact",
    paragraphs: [
      "For privacy questions, corrections, or account requests, contact Rental by Maddy & Cassy at iosrentalbymaddycassy@gmail.com.",
    ],
  },
];

export const metadata: Metadata = {
  title: "Privacy Notice | Rental by Maddy & Cassy",
  description:
    "How Rental by Maddy & Cassy collects, uses, protects, and retains customer registration information.",
};

export default function PrivacyPage() {
  return (
    <div>
      <GuidePage
        eyebrow="CUSTOMER PRIVACY"
        title="Privacy Notice"
        introduction="This notice explains how basic account information and the documents submitted during a booking request are handled."
        sections={sections}
        layout="stack"
        notice="Effective July 26, 2026. This notice may be updated when the registration or rental process changes."
        showRelated={false}
      />
    </div>
  );
}
