import type { Metadata } from "next";
import AdminSignInPage from "../sign-in/page";

export const metadata: Metadata = {
  title: "Admin Login | Rental by Maddy & Cassy",
  description: "Secure administrator access for rental operations.",
};

// Canonical admin entry point linked from the navbar. It renders the existing
// administrator login screen rather than duplicating it, so /admin/sign-in --
// still the target of RequireAdmin, AdminShell, and the password-reset flows --
// and /admin/login can never drift apart.
export default function AdminLoginPage() {
  return <AdminSignInPage />;
}
