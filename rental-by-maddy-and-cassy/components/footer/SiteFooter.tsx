"use client";

import Image from "next/image";
import Link from "next/link";
import { usePathname } from "next/navigation";
import styles from "./SiteFooter.module.css";

const footerGroups = [
  {
    title: "Rentals",
    links: [
      { href: "/catalog", label: "Browse Catalog" },
      { href: "/favorites", label: "Favorites" },
      { href: "/cart", label: "Rental Cart" },
      { href: "/account/bookings", label: "My Bookings" },
    ],
  },
  {
    title: "Rental Guide",
    links: [
      { href: "/how-to-book", label: "How to Book" },
      { href: "/rental-requirements", label: "Requirements" },
      { href: "/terms", label: "Terms & Conditions" },
      { href: "/faq", label: "FAQs" },
    ],
  },
  {
    title: "Company",
    links: [
      { href: "/#about", label: "Our Story" },
      { href: "/contact", label: "Contact Us" },
      { href: "/privacy", label: "Privacy Notice" },
      { href: "/sign-in", label: "Customer Login" },
    ],
  },
] as const;

function ArrowIcon() {
  return (
    <svg viewBox="0 0 20 20" aria-hidden="true">
      <path d="M4 10h11M11 6l4 4-4 4" />
    </svg>
  );
}

export default function SiteFooter() {
  const pathname = usePathname();

  if (pathname.startsWith("/admin") || pathname.startsWith("/demo")) return null;

  return (
    <footer className={styles.footer}>
      <div className={styles.ctaWrap}>
        <div className={styles.cta}>
          <div>
            <span>YOUR NEXT MEMORY STARTS HERE</span>
            <h2>Premium gear, ready when your plans are.</h2>
            <p>Browse the live catalog, choose your dates, and complete one clear booking process.</p>
          </div>
          <Link href="/catalog" className={styles.ctaLink}>
            Browse rentals <ArrowIcon />
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
        </nav>
      </div>

      <div className={styles.bottom}>
        <p>© {new Date().getFullYear()} Rental by Maddy &amp; Cassy. All rights reserved.</p>
        <div>
          <span>Secure checkout powered by PayMongo</span>
          <Link href="/privacy">Privacy</Link>
          <Link href="/terms">Terms</Link>
        </div>
      </div>
    </footer>
  );
}
