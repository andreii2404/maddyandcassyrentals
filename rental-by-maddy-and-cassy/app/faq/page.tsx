import type { Metadata } from "next";
import GuidePage, { type GuideSection } from "@/components/rental-guide/GuidePage";
import { faqItems } from "@/src/data/faq";

const sections: GuideSection[] = faqItems.map((item) => ({
  title: item.question,
  paragraphs: [item.answer],
}));

export const metadata: Metadata = {
  title: "Frequently Asked Questions | Rental by Maddy & Cassy",
  description: "Answers about reservations, deposits, extensions, returns, damage, and handover.",
};

export default function FAQPage() {
  return (
    <div>
      <GuidePage
        eyebrow="HELP CENTER"
        title="Frequently Asked Questions"
        introduction="Find quick answers to the most common questions about booking, payments, deposits, extensions, returns, and equipment care."
        sections={sections}
        layout="accordion"
        notice="For a question specific to your booking, contact the team through the official Contact page."
      />
    </div>
  );
}
