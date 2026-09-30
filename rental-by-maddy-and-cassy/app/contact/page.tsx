import type { Metadata } from "next";
import Link from "next/link";
import ChatIcon from "@/components/icons/ChatIcon";
import { CONTACT_EMAIL, GMAIL_COMPOSE_URL } from "@/src/lib/contactEmail";
import styles from "./contact.module.css";

const [emailUser, emailDomain] = CONTACT_EMAIL.split("@");

export const metadata: Metadata = {
  title: "Contact | Rental by Maddy & Cassy",
  description:
    "Contact Rental by Maddy & Cassy through Facebook Messenger or email, and follow rental updates on TikTok.",
};

export default function ContactPage() {
  return (
    <main className={styles.main}>
      <section className={styles.intro} aria-labelledby="contact-heading">
        <p className={styles.eyebrow}>CONTACT</p>
        <h1 id="contact-heading" className={styles.heading}>
          Talk to Maddy &amp; Cassy
        </h1>
        <p className={styles.subheading}>
          For availability questions, booking assistance, pickup or delivery
          coordination, and rental concerns, reach the team through an official
          channel.
        </p>
      </section>

      <section className={styles.methods} aria-label="Official contact channels">
        <div className={styles.row}>
          <div className={styles.rowText}>
            <p className={styles.label}>Facebook · Messenger</p>
            <h2 className={styles.value}>Rental by Maddy &amp; Cassy</h2>
            <p className={styles.description}>
              Message our Facebook page for availability, bookings, and rental
              concerns.
            </p>
          </div>
          <a
            href="https://www.facebook.com/share/19bCnTQZum/"
            className={styles.primaryAction}
            target="_blank"
            rel="noreferrer"
          >
            Message us on Facebook
          </a>
        </div>

        <div className={styles.row}>
          <div className={styles.rowText}>
            <p className={`${styles.label} ${styles.labelWithIcon}`}>
              <ChatIcon size={14} />
              Website Chat
            </p>
            <h2 className={styles.value}>Chat with us</h2>
            <p className={styles.description}>
              Message us directly through the website for booking and rental
              concerns.
            </p>
          </div>
          <Link href="/messages" className={styles.secondaryAction}>
            Start Chat
          </Link>
        </div>

        <div className={styles.row}>
          <div className={styles.rowText}>
            <p className={styles.label}>Email</p>
            <h2 className={`${styles.value} ${styles.email}`}>
              {emailUser}
              <wbr />@{emailDomain}
            </h2>
            <p className={styles.description}>
              Send us your rental question and we&rsquo;ll reply as soon as we can.
            </p>
          </div>
          <a
            href={GMAIL_COMPOSE_URL}
            className={styles.secondaryAction}
            target="_blank"
            rel="noreferrer"
          >
            Send Email
          </a>
        </div>

        <div className={styles.row}>
          <div className={styles.rowText}>
            <p className={styles.label}>Follow us on TikTok</p>
            <h2 className={styles.value}>@iosrental.maddycassy</h2>
            <p className={styles.description}>
              Featured units, availability updates, and announcements.
            </p>
          </div>
          <a
            href="https://www.tiktok.com/@iosrental.maddycassy"
            className={styles.secondaryAction}
            target="_blank"
            rel="noreferrer"
          >
            See rental updates
          </a>
        </div>
      </section>
    </main>
  );
}
