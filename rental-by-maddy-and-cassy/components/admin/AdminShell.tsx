"use client";

import { useEffect, useState } from "react";
import Image from "next/image";
import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import RequireAdmin from "@/components/route-guards/RequireAdmin";
import { useAuth } from "@/hooks/useAuth";
import { logout } from "@/src/services/authService";
import styles from "./AdminShell.module.css";

const navSections = [
  {
    title: "Overview",
    items: [{ href: "/admin", label: "Dashboard" }],
  },
  {
    title: "Rental Management",
    items: [
      { href: "/admin/bookings", label: "Bookings" },
      { href: "/admin/payments", label: "Payments" },
      { href: "/admin/catalog", label: "Catalog & Pricing" },
    ],
  },
  {
    title: "Customer Management",
    items: [
      { href: "/admin/users", label: "User Accounts" },
      { href: "/admin/reviews", label: "Feedback & Reviews" },
    ],
  },
  {
    title: "System",
    items: [{ href: "/admin/audit", label: "Audit Logs" }],
  },
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
  const [sidebarOpen, setSidebarOpen] = useState(false);

  useEffect(() => {
    setSidebarOpen(false);
  }, [pathname]);

  useEffect(() => {
    if (!sidebarOpen) return undefined;

    function handleKeyDown(event: KeyboardEvent) {
      if (event.key === "Escape") setSidebarOpen(false);
    }

    document.addEventListener("keydown", handleKeyDown);
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      document.removeEventListener("keydown", handleKeyDown);
      document.body.style.overflow = previousOverflow;
    };
  }, [sidebarOpen]);

  async function handleSignOut() {
    await logout();
    router.replace("/admin/sign-in");
  }

  return (
    <RequireAdmin>
      <div className={styles.shell}>
        <header className={styles.mobileTopbar}>
          <button
            type="button"
            className={`${styles.menuButton} ${sidebarOpen ? styles.menuButtonOpen : ""}`}
            aria-expanded={sidebarOpen}
            aria-controls="admin-sidebar"
            aria-label={sidebarOpen ? "Close navigation menu" : "Open navigation menu"}
            onClick={() => setSidebarOpen((open) => !open)}
          >
            <span />
            <span />
            <span />
          </button>
          <span className={styles.mobileTopbarTitle}>Rental Admin</span>
        </header>

        {sidebarOpen ? (
          <button
            type="button"
            className={styles.backdrop}
            aria-label="Close navigation menu"
            onClick={() => setSidebarOpen(false)}
          />
        ) : null}

        <aside
          id="admin-sidebar"
          className={`${styles.sidebar} ${sidebarOpen ? styles.sidebarOpen : ""}`}
        >
          <div className={styles.sidebarHeader}>
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
            <button
              type="button"
              className={styles.closeButton}
              aria-label="Close navigation menu"
              onClick={() => setSidebarOpen(false)}
            >
              ✕
            </button>
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
            {navSections.map((section) => (
              <div className={styles.navSection} key={section.title}>
                <p className={styles.navSectionTitle}>{section.title}</p>
                {section.items.map((item) => (
                  <Link
                    key={item.href}
                    href={item.href}
                    className={`${styles.navLink} ${
                      isActivePath(pathname, item.href) ? styles.navLinkActive : ""
                    }`}
                    aria-current={isActivePath(pathname, item.href) ? "page" : undefined}
                  >
                    {item.label}
                  </Link>
                ))}
              </div>
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
