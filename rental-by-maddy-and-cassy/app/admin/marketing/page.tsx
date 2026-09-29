import type { Metadata } from "next";
import AdminMarketingManager from "@/components/admin/AdminMarketingManager";
import AdminShell from "@/components/admin/AdminShell";

export const metadata: Metadata = {
  title: "Marketing | Rental by Maddy & Cassy Admin",
  description: "Manage promotions, newsletter subscribers, and marketing conversion metrics.",
};

export default function AdminMarketingPage() {
  return (
    <AdminShell>
      <AdminMarketingManager />
    </AdminShell>
  );
}
