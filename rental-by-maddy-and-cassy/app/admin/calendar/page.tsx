import type { Metadata } from "next";
import AdminShell from "@/components/admin/AdminShell";
import AdminCalendar from "./AdminCalendar";

export const metadata: Metadata = {
  title: "Calendar | Rental by Maddy & Cassy Admin",
  description: "See which days have approved rentals and open each booking.",
};

export default function AdminCalendarPage() {
  return (
    <AdminShell>
      <AdminCalendar />
    </AdminShell>
  );
}
