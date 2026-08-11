"use client";

import Image from "next/image";
import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import RequireAdmin from "@/components/route-guards/RequireAdmin";
import { useAuth } from "@/hooks/useAuth";
import { logout } from "@/src/services/authService";
import styles from "./AdminShell.module.css";

const adminLinks = [
  { href: "/admin", label: "Dashboard" },
  { href: "/admin/bookings", label: "Bookings" },
  { href: "/admin/catalog", label: "Catalog & Pricing" },
  { href: "/admin/payments", label: "Payments" },
  { href: "/admin/reviews", label: "Feedback & Reviews" },
  { href: "/admin/audit", label: "Audit Logs" },
  { href: "/admin/users", label: "User Accounts" },
  { href: "/admin/profile", label: "Admin Profile" },
];

function isActivePath(pathname: string, href: string): boolean {
  if (href === "/admin") return pathname === href;
  return pathname === href || pathname.startsWith(`${href}/`);
}

export default function AdminShell({ children }: { children: React.ReactNode }) {
  const pathname = usePathname();
  const router = useRouter();
  const { user, profile } = useAuth();
  const displayName = profile?.displayName ?? user?.user_metadata?.display_name ?? "Administrator";

  async function handleSignOut() {
    await logout();
    router.replace("/admin/sign-in");
  }

  return (
    <RequireAdmin>
      <div className={styles.shell}>
        <aside className={styles.sidebar}>
          <div className={styles.brand}>
            <span className={styles.brandIcon}>
              <Image
                src="/images/maddy-cassy-rentals-logo.png"
                alt=""
                width={42}
                height={42}
                className={styles.logoImage}
                priority
              />
            </span>
            <div>
              <strong>Rental Admin</strong>
              <span>Maddy &amp; Cassy</span>
            </div>
          </div>

          <div className={styles.account}>
            <span className={styles.avatar} aria-hidden="true">
              {displayName.charAt(0).toUpperCase()}
            </span>
            <div>
              <strong>{displayName}</strong>
              <span>Administrator</span>
            </div>
          </div>

          <nav className={styles.navigation} aria-label="Administrator navigation">
            {adminLinks.map((item) => (
              <Link
                key={item.href}
                href={item.href}
                className={`${styles.navLink} ${
                  isActivePath(pathname, item.href) ? styles.navLinkActive : ""
                }`}
              >
                {item.label}
              </Link>
            ))}
          </nav>

          <div className={styles.sidebarFooter}>
            <Link href="/" className={styles.siteLink}>
              View Public Website
            </Link>
            <button type="button" className={styles.signOut} onClick={handleSignOut}>
              Sign Out
            </button>
          </div>
        </aside>

        <main className={styles.main}>{children}</main>
      </div>
    </RequireAdmin>
  );
}
