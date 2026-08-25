import type { Metadata } from "next";

export const metadata: Metadata = {
  title: "Audit Logs | Rental by Maddy & Cassy Admin",
  description: "Review the administrative activity history for the rental platform.",
};

export default function AdminAuditLayout({ children }: { children: React.ReactNode }) {
  return children;
}
