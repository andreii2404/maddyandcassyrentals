"use client";

import { useState, useSyncExternalStore } from "react";
import Image from "next/image";
import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { useAuth } from "@/hooks/useAuth";
import { useFavorites } from "@/hooks/useFavorites";
import { useCart } from "@/hooks/useCart";
import { logout } from "@/src/services/authService";
import styles from "./Navbar.module.css";

const primaryLinks = [
  { href: "/", label: "Home" },
  { href: "/catalog", label: "Browse" },
  { href: "/favorites", label: "Favorites" },
  { href: "/cart", label: "Cart" },
  { href: "/#about", label: "About" },
  { href: "/contact", label: "Contact" },
];

const guideLinks = [
  { href: "/how-to-book", label: "How to Book" },
  { href: "/rental-requirements", label: "Rental Requirements" },
  { href: "/terms", label: "Terms & Conditions" },
  { href: "/faq", label: "FAQs" },
];

function subscribeToHash(callback: () => void) {
  window.addEventListener("hashchange", callback);
  return () => window.removeEventListener("hashchange", callback);
}

function getHashSnapshot() {
  return window.location.hash;
}

function getServerHashSnapshot() {
  return "";
}

export default function Navbar() {
  const { user, profile, isAdmin } = useAuth();
  const { favorites } = useFavorites();
  const { totalQuantity } = useCart();
  const router = useRouter();
  const pathname = usePathname();
  const [menuOpen, setMenuOpen] = useState(false);
  const hash = useSyncExternalStore(subscribeToHash, getHashSnapshot, getServerHashSnapshot);

  async function handleSignOut() {
    await logout();
    setMenuOpen(false);
    router.push("/");
  }

  const displayName = profile?.displayName || user?.user_metadata?.display_name || "Account";
  const firstName = displayName.split(" ")[0];
  const accountHomeHref = isAdmin ? "/admin" : "/account/bookings";
  const accountHomeLabel = isAdmin ? "Admin Dashboard" : "My Bookings";
  const profileHref = isAdmin ? "/admin/profile" : "/account/profile";
  const profileLabel = isAdmin ? "Admin Profile" : "My Profile";
  const guideActive = guideLinks.some((item) => pathname === item.href);

  function isPrimaryLinkActive(href: string): boolean {
    if (href === "/") return pathname === "/" && hash !== "#about";
    if (href === "/#about") return pathname === "/" && hash === "#about";
    if (href === "/catalog") return pathname.startsWith("/catalog");
    if (href === "/favorites") return pathname === "/favorites";
    if (href === "/cart") return pathname === "/cart";
    return pathname === href;
  }

  return (
    <header className={styles.navbar}>
      <div className={styles.inner}>
        <Link href="/" className={styles.brand} aria-label="Rental by Maddy & Cassy home">
          <span className={styles.brandIcon}>
            <Image
              src="/images/maddy-cassy-rentals-logo.png"
              alt=""
              width={44}
              height={44}
              className={styles.logoImage}
              priority
            />
          </span>
          <span className={styles.brandName}>Rental by Maddy &amp; Cassy</span>
        </Link>

        <nav className={styles.links} aria-label="Primary navigation">
          {primaryLinks.slice(0, 4).map((item) => {
            const active = isPrimaryLinkActive(item.href);
            return (
              <Link
                key={item.href}
                href={item.href}
                className={`${styles.link} ${active ? styles.linkActive : ""}`}
                aria-current={active ? "page" : undefined}
              >
                {item.label}
                {item.href === "/favorites" && favorites.length > 0 ? (
                  <span className={styles.favoriteCount}>{favorites.length}</span>
                ) : null}
                {item.href === "/cart" && totalQuantity > 0 ? (
                  <span className={styles.favoriteCount}>{totalQuantity}</span>
                ) : null}
              </Link>
            );
          })}

          <details className={styles.guideMenu}>
            <summary
              className={`${styles.guideTrigger} ${guideActive ? styles.linkActive : ""}`}
            >
              Rental Guide
            </summary>
            <div className={styles.guideDropdown}>
              {guideLinks.map((item) => {
                const active = pathname === item.href;
                return (
                  <Link
                    key={item.href}
                    href={item.href}
                    className={`${styles.guideMenuLink} ${
                      active ? styles.guideMenuLinkActive : ""
                    }`}
                    aria-current={active ? "page" : undefined}
                  >
                    {item.label}
                  </Link>
                );
              })}
            </div>
          </details>

          {primaryLinks.slice(4).map((item) => {
            const active = isPrimaryLinkActive(item.href);
            return (
              <Link
                key={item.href}
                href={item.href}
                className={`${styles.link} ${active ? styles.linkActive : ""}`}
                aria-current={active ? "page" : undefined}
              >
                {item.label}
              </Link>
            );
          })}
        </nav>

        <div className={styles.actions}>
          {user ? (
            <>
              <Link href={accountHomeHref} className={styles.accountLink}>
                {accountHomeLabel}
              </Link>
              <details className={styles.profileMenu}>
                <summary className={styles.profileTrigger}>Hi, {firstName}</summary>
                <div className={styles.profileDropdown}>
                  <Link href={profileHref} className={styles.profileMenuLink}>
                    {profileLabel}
                  </Link>
                  {!isAdmin ? (
                    <Link href="/account/payments" className={styles.profileMenuLink}>
                      Payment History
                    </Link>
                  ) : null}
                  <button
                    type="button"
                    className={styles.profileMenuButton}
                    onClick={handleSignOut}
                  >
                    Sign Out
                  </button>
                </div>
              </details>
            </>
          ) : (
            <>
              <Link href="/sign-in" className={styles.accountLink}>
                Customer Login
              </Link>
              <Link href="/admin/sign-in" className={styles.adminLink}>
                Admin Login
              </Link>
            </>
          )}
        </div>

        <button
          type="button"
          className={styles.menuButton}
          aria-expanded={menuOpen}
          aria-controls="mobile-navigation"
          aria-label={menuOpen ? "Close navigation menu" : "Open navigation menu"}
          onClick={() => setMenuOpen((open) => !open)}
        >
          <span />
          <span />
          <span />
        </button>
      </div>

      {menuOpen ? (
        <div id="mobile-navigation" className={styles.mobileMenu}>
          <nav className={styles.mobileLinks} aria-label="Mobile navigation">
            {primaryLinks.map((item) => {
              const active = isPrimaryLinkActive(item.href);
              return (
                <Link
                  key={item.href}
                  href={item.href}
                  className={`${styles.mobileLink} ${
                    active ? styles.mobileLinkActive : ""
                  }`}
                  aria-current={active ? "page" : undefined}
                  onClick={() => setMenuOpen(false)}
                >
                  {item.label}
                  {item.href === "/favorites" && favorites.length > 0 ? (
                    <span className={styles.favoriteCount}>{favorites.length}</span>
                  ) : null}
                  {item.href === "/cart" && totalQuantity > 0 ? (
                    <span className={styles.favoriteCount}>{totalQuantity}</span>
                  ) : null}
                </Link>
              );
            })}
          </nav>

          <nav className={styles.mobileGuide} aria-label="Rental guide navigation">
            <p>Rental Guide</p>
            <div>
              {guideLinks.map((item) => {
                const active = pathname === item.href;
                return (
                  <Link
                    key={item.href}
                    href={item.href}
                    className={`${styles.mobileGuideLink} ${
                      active ? styles.mobileGuideLinkActive : ""
                    }`}
                    aria-current={active ? "page" : undefined}
                    onClick={() => setMenuOpen(false)}
                  >
                    {item.label}
                  </Link>
                );
              })}
            </div>
          </nav>

          <div className={styles.mobileActions}>
            {user ? (
              <>
                <Link
                  href={accountHomeHref}
                  className={styles.mobileAccountLink}
                  onClick={() => setMenuOpen(false)}
                >
                  {accountHomeLabel}
                </Link>
                <Link
                  href={profileHref}
                  className={styles.mobileAccountLink}
                  onClick={() => setMenuOpen(false)}
                >
                  {profileLabel}
                </Link>
                {!isAdmin ? (
                  <Link
                    href="/account/payments"
                    className={styles.mobileAccountLink}
                    onClick={() => setMenuOpen(false)}
                  >
                    Payment History
                  </Link>
                ) : null}
                <button type="button" className={styles.mobileTextButton} onClick={handleSignOut}>
                  Sign Out
                </button>
              </>
            ) : (
              <>
                <Link
                  href="/sign-in"
                  className={styles.mobileAccountLink}
                  onClick={() => setMenuOpen(false)}
                >
                  Customer Login
                </Link>
                <Link
                  href="/admin/sign-in"
                  className={styles.mobileAdminLink}
                  onClick={() => setMenuOpen(false)}
                >
                  Admin Login
                </Link>
              </>
            )}
          </div>
        </div>
      ) : null}
    </header>
  );
}
