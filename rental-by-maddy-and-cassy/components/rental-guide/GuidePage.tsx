import Link from "next/link";
import styles from "./GuidePage.module.css";

export interface GuideSection {
  number?: string;
  title: string;
  paragraphs?: string[];
  bullets?: string[];
  subBullets?: string[];
}

interface GuidePageProps {
  eyebrow: string;
  title: string;
  introduction: string;
  sections: GuideSection[];
  layout?: "grid" | "stack" | "accordion";
  notice?: string;
  showRelated?: boolean;
}

const guideLinks = [
  { href: "/how-to-book", label: "How to Book" },
  { href: "/rental-requirements", label: "Rental Requirements" },
  { href: "/terms", label: "Terms & Conditions" },
  { href: "/faq", label: "FAQs" },
];

export default function GuidePage({
  eyebrow,
  title,
  introduction,
  sections,
  layout = "grid",
  notice,
  showRelated = true,
}: GuidePageProps) {
  const isAccordion = layout === "accordion";

  return (
    <main className={`${styles.main} ${isAccordion ? styles.mainCompact : ""}`}>
      <header className={`${styles.header} ${isAccordion ? styles.headerCentered : ""}`}>
        <p className={styles.eyebrow}>{eyebrow}</p>
        <h1>{title}</h1>
        <p className={styles.introduction}>{introduction}</p>
      </header>

      {notice ? (
        <aside className={`${styles.notice} ${isAccordion ? styles.noticeQuiet : ""}`}>{notice}</aside>
      ) : null}

      {isAccordion ? (
        <section className={styles.accordion} aria-label={title}>
          {sections.map((section, index) => (
            <details key={section.title} className={styles.accordionItem} open={index === 0}>
              <summary>
                <h2>{section.title}</h2>
                <span className={styles.accordionToggle} aria-hidden="true" />
              </summary>
              <div className={styles.accordionBody}>
                {section.paragraphs?.map((paragraph) => (
                  <p key={paragraph}>{paragraph}</p>
                ))}
              </div>
            </details>
          ))}
        </section>
      ) : (
      <section
        className={`${styles.sections} ${
          layout === "stack" ? styles.stack : styles.grid
        }`}
        aria-label={title}
      >
        {sections.map((section) => (
          <article key={`${section.number ?? ""}-${section.title}`} className={styles.card}>
            {section.number ? <span className={styles.number}>{section.number}</span> : null}
            <h2>{section.title}</h2>

            {section.paragraphs?.map((paragraph) => (
              <p key={paragraph}>{paragraph}</p>
            ))}

            {section.bullets?.length ? (
              <ul>
                {section.bullets.map((bullet) => (
                  <li key={bullet}>{bullet}</li>
                ))}
              </ul>
            ) : null}

            {section.subBullets?.length ? (
              <div className={styles.subList}>
                <p>Requests may not be processed when:</p>
                <ul>
                  {section.subBullets.map((bullet) => (
                    <li key={bullet}>{bullet}</li>
                  ))}
                </ul>
              </div>
            ) : null}
          </article>
        ))}
      </section>
      )}

      {showRelated ? (
        <nav
          className={`${styles.related} ${isAccordion ? styles.relatedQuiet : ""}`}
          aria-label="Rental guide pages"
        >
          <p>Continue through the rental guide</p>
          <div>
            {guideLinks.map((item) => (
              <Link key={item.href} href={item.href}>
                {item.label}
              </Link>
            ))}
          </div>
        </nav>
      ) : null}
    </main>
  );
}
