import type { Metadata } from "next";
import AdminShell from "@/components/admin/AdminShell";
import MessagingWorkspace from "@/components/messaging/MessagingWorkspace";

export const metadata: Metadata = {
  title: "Customer Messages | Rental by Maddy & Cassy Admin",
  description: "Respond to registered customer and guest rental questions.",
};

export default function AdminMessagesPage() {
  return (
    <AdminShell>
      <MessagingWorkspace mode="admin" />
    </AdminShell>
  );
}
