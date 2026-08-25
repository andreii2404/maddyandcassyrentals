import type { Metadata } from "next";

export const metadata: Metadata = {
  title: "Payments | Rental by Maddy & Cassy Admin",
  description: "Review manually submitted GCash payments and their verification status.",
};

export default function AdminPaymentsLayout({ children }: { children: React.ReactNode }) {
  return children;
}
