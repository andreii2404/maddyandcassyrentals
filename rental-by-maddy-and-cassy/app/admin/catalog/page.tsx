import type { Metadata } from "next";
import AdminCatalogManager from "./AdminCatalogManager";
import AdminShell from "@/components/admin/AdminShell";

export const metadata: Metadata = {
  title: "Catalog & Pricing | Rental by Maddy & Cassy Admin",
  description: "Manage rental listings, categories, pricing, and physical inventory units.",
};

export default function AdminCatalogPage() {
  return (
    <AdminShell>
      <AdminCatalogManager />
    </AdminShell>
  );
}
