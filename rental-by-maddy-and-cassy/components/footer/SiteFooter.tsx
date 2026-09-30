"use client";

import Image from "next/image";
import Link from "next/link";
import { usePathname } from "next/navigation";
import styles from "./SiteFooter.module.css";

const footerGroups = [
  {
    title: "Navigation",
    links: [
      { href: "/", label: "Home" },
      { href: "/catalog", label: "Browse Catalog" },
      { href: "/#about", label: "About" },
      { href: "/favorites", label: "Favorites" },
      { href: "/cart", label: "Rental Cart" },
    ],
  },
  {
    title: "Support",
    links: [
      { href: "/how-to-book", label: "How to Book" },
      { href: "/rental-requirements", label: "Requirements" },
      { href: "/faq", label: "FAQs" },
      { href: "/guest/bookings", label: "Track Guest Booking" },
      { href: "/contact", label: "Contact Us" },
    ],
  },
  {
    title: "Legal",
    links: [
      { href: "/terms", label: "Terms & Conditions" },
      { href: "/privacy", label: "Privacy Policy" },
      { href: "/sign-in", label: "Customer Login" },
    ],
  },
] as const;

const socialLinks = [
  { href: "https://www.tiktok.com/@iosrental.maddycassy", label: "TikTok", value: "@iosrental.maddycassy" },
  { href: "https://www.facebook.com/share/19bCnTQZum/", label: "Facebook", value: "Rental by Maddy & Cassy" },
  { href: "mailto:iosrentalbymaddycassy@gmail.com", label: "Email", value: "iosrentalbymaddycassy@gmail.com" },
] as const;

export default function SiteFooter() {
  const pathname = usePathname();

  if (
    pathname.startsWith("/admin") ||
    pathname.startsWith("/demo") ||
    pathname === "/messages"
  ) return null;

  // Keep the CTA low-key where it would otherwise compete with the page's own primary action.
  const compact = pathname === "/contact";

  return (
    <footer className={compact ? `${styles.footer} ${styles.compact}` : styles.footer}>
      <div className={styles.ctaWrap}>
        <div className={styles.cta}>
          <div className={styles.ctaCopy}>
            <span>YOUR NEXT MEMORY STARTS HERE</span>
            <h2>Premium gear, ready when your plans are.</h2>
            <p>Browse the live catalog, choose your dates, and complete one clear booking process.</p>
          </div>
          <Link href="/catalog" className={styles.ctaLink}>
            Browse rentals
          </Link>
        </div>
      </div>

      <div className={styles.main}>
        <div className={styles.brandColumn}>
          <Link href="/" className={styles.brand} aria-label="Rental by Maddy & Cassy home">
            <span className={styles.logoWrap}>
              <Image
                src="/images/maddy-cassy-rentals-logo.png"
                alt=""
                width={52}
                height={52}
                className={styles.logo}
              />
            </span>
            <span><small>Rental by</small><strong>Maddy &amp; Cassy</strong></span>
          </Link>
          <p>
            Premium iPhone and camera rentals for trips, concerts, celebrations,
            content, and every moment worth keeping.
          </p>
          <div className={styles.serviceNote}>
            <span aria-hidden="true" />
            Serving renters across Metro Manila
          </div>
        </div>

        <nav className={styles.linkGrid} aria-label="Footer navigation">
          {footerGroups.map((group) => (
            <div key={group.title} className={styles.linkGroup}>
              <h3>{group.title}</h3>
              {group.links.map((link) => (
                <Link key={link.href} href={link.href}>{link.label}</Link>
              ))}
            </div>
          ))}

          <div className={styles.linkGroup}>
            <h3>Social Media</h3>
            {socialLinks.map((link) => (
              <a
                key={link.href}
                href={link.href}
                target={link.href.startsWith("http") ? "_blank" : undefined}
                rel={link.href.startsWith("http") ? "noreferrer" : undefined}
              >
                {link.label}
              </a>
            ))}
          </div>
        </nav>
      </div>

      <div className={styles.wordmarkWrap} aria-hidden="true">
        <span className={styles.wordmark}>Maddy &amp; Cassy</span>
      </div>

      <div className={styles.bottom}>
        <p>© {new Date().getFullYear()} Rental by Maddy &amp; Cassy. All rights reserved.</p>
        <div>
          <span>Secure checkout via GCash</span>
          <Link href="/privacy">Privacy</Link>
          <Link href="/terms">Terms</Link>
          <Link href="/admin/login">Staff</Link>
        </div>
      </div>
    </footer>
  );
}
