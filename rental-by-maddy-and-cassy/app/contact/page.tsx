import type { Metadata } from "next";
import styles from "./contact.module.css";

const contactMethods = [
  {
    label: "TikTok",
    value: "@iosrental.maddycassy",
    href: "https://www.tiktok.com/@iosrental.maddycassy",
    description: "See rental updates, featured units, and announcements.",
  },
  {
    label: "Email",
    value: "iosrentalbymaddycassy@gmail.com",
    href: "mailto:iosrentalbymaddycassy@gmail.com",
    description: "Send booking questions or rental-related concerns by email.",
  },
  {
    label: "Facebook",
    value: "Rental by Maddy & Cassy",
    href: "https://www.facebook.com/share/19bCnTQZum/",
    description: "Message the rental team through their Facebook page.",
  },
];

export const metadata: Metadata = {
  title: "Contact | Rental by Maddy & Cassy",
  description: "Contact Rental by Maddy & Cassy through TikTok, email, or Facebook.",
};

export default function ContactPage() {
  return (
    <div>
      <main className={styles.main}>
        <section className={styles.header} aria-labelledby="contact-heading">
          <p className={styles.eyebrow}>CONTACT</p>
          <h1 id="contact-heading" className={styles.heading}>
            Talk to Maddy &amp; Cassy
          </h1>
          <p className={styles.subheading}>
            For availability questions, booking assistance, pickup or delivery
            coordination, and rental concerns, contact the team through an official
            channel below.
          </p>
        </section>

        <section className={styles.grid} aria-label="Official contact channels">
          {contactMethods.map((method) => {
            const external = method.href.startsWith("http");

            return (
              <article key={method.label} className={styles.card}>
                <p className={styles.label}>{method.label}</p>
                <h2 className={styles.value}>{method.value}</h2>
                <p className={styles.description}>{method.description}</p>
                <a
                  href={method.href}
                  className={styles.contactLink}
                  target={external ? "_blank" : undefined}
                  rel={external ? "noreferrer" : undefined}
                >
                  {method.label === "Email" ? "Send Email" : `Open ${method.label}`}
                </a>
              </article>
            );
          })}
        </section>
      </main>
    </div>
  );
}
