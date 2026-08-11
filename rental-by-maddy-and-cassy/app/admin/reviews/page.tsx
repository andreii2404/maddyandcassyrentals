import type { Metadata } from "next";
import AdminShell from "@/components/admin/AdminShell";
import AdminReviewsManager from "./AdminReviewsManager";

export const metadata: Metadata = {
  title: "Feedback & Reviews | Rental by Maddy & Cassy Admin",
  description: "Review and moderate verified customer rental feedback.",
};

export default function AdminReviewsPage() {
  return (
    <AdminShell>
      <AdminReviewsManager />
    </AdminShell>
  );
}
