import Link from "next/link";
import { CONTACT_EMAIL, GMAIL_COMPOSE_URL } from "@/src/lib/contactEmail";
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
  layout?: "grid" | "stack" | "accordion" | "steps" | "checklist" | "policy";
  notice?: string;
  showRelated?: boolean;
  showHelp?: boolean;
}

// Same official channels as /contact and the site footer.
const helpChannels = [
  {
    href: "/messages",
    label: "Website Chat",
    description: "Message us directly on the website.",
    external: false,
  },
  {
    href: "https://www.facebook.com/share/19bCnTQZum/",
    label: "Facebook / Messenger",
    description: "Reach us on our Facebook page.",
    external: true,
  },
  {
    href: GMAIL_COMPOSE_URL,
    label: "Email",
    description: CONTACT_EMAIL,
    external: true,
  },
];

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
  showHelp = false,
}: GuidePageProps) {
  const isAccordion = layout === "accordion";
  const isSteps = layout === "steps";
  const isChecklist = layout === "checklist";
  const isPolicy = layout === "policy";

  return (
    <main
      className={`${styles.main} ${isAccordion ? styles.mainCompact : ""} ${
        isSteps ? styles.mainSteps : ""
      } ${isChecklist ? styles.mainChecklist : ""} ${isPolicy ? styles.mainPolicy : ""}`}
    >
      <header className={`${styles.header} ${isAccordion ? styles.headerCentered : ""}`}>
        <p className={styles.eyebrow}>{eyebrow}</p>
        <h1>{title}</h1>
        <p className={styles.introduction}>{introduction}</p>
      </header>

      {notice ? (
        <aside
          className={`${styles.notice} ${isAccordion ? styles.noticeQuiet : ""} ${
            isSteps || isPolicy ? styles.noticeCompact : ""
          }`}
        >
          {notice}
        </aside>
      ) : null}

      {isChecklist ? (
        <ol className={styles.checklist} aria-label={title}>
          {sections.map((section, index) => (
            <li key={`${section.number ?? ""}-${section.title}`} className={styles.checkItem}>
              <span className={styles.checkNumber} aria-hidden="true">
                {section.number ?? String(index + 1).padStart(2, "0")}
              </span>
              <div className={styles.checkBody}>
                <h2>{section.title}</h2>

                {section.paragraphs?.map((paragraph) => (
                  <p key={paragraph}>{paragraph}</p>
                ))}

                {section.bullets?.length ? (
                  <ul className={styles.checkBullets}>
                    {section.bullets.map((bullet) => (
                      <li key={bullet}>{bullet}</li>
                    ))}
                  </ul>
                ) : null}

                {section.subBullets?.length ? (
                  <div className={styles.checkNote}>
                    <p>Requests may not be processed when:</p>
                    <ul>
                      {section.subBullets.map((bullet) => (
                        <li key={bullet}>{bullet}</li>
                      ))}
                    </ul>
                  </div>
                ) : null}
              </div>
            </li>
          ))}
        </ol>
      ) : isPolicy ? (
        <ol className={styles.policy} aria-label={title}>
          {sections.map((section, index) => (
            <li key={`${section.number ?? ""}-${section.title}`} className={styles.policyItem}>
              <span className={styles.policyNumber} aria-hidden="true">
                {section.number ?? String(index + 1).padStart(2, "0")}
              </span>
              <div className={styles.policyBody}>
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
              </div>
            </li>
          ))}
        </ol>
      ) : isSteps ? (
        <ol className={styles.steps} aria-label={title}>
          {sections.map((section, index) => (
            <li key={`${section.number ?? ""}-${section.title}`} className={styles.step}>
              <span className={styles.stepMarker} aria-hidden="true">
                {String(index + 1).padStart(2, "0")}
              </span>
              <div className={styles.stepBody}>
                {section.number ? <span className={styles.stepLabel}>{section.number}</span> : null}
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
              </div>
            </li>
          ))}
        </ol>
      ) : isAccordion ? (
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

      {showHelp ? (
        <section className={styles.help} aria-labelledby="guide-help-heading">
          <h2 id="guide-help-heading">Need help?</h2>
          <p className={styles.helpIntro}>
            Questions about your booking? Reach the team through any of these channels.
          </p>
          <ul className={styles.helpList}>
            {helpChannels.map((channel) => (
              <li key={channel.label}>
                {channel.external ? (
                  <a
                    href={channel.href}
                    className={styles.helpLink}
                    target="_blank"
                    rel="noreferrer"
                  >
                    <span className={styles.helpLabel}>{channel.label}</span>
                    <span className={styles.helpDescription}>{channel.description}</span>
                  </a>
                ) : (
                  <Link href={channel.href} className={styles.helpLink}>
                    <span className={styles.helpLabel}>{channel.label}</span>
                    <span className={styles.helpDescription}>{channel.description}</span>
                  </Link>
                )}
              </li>
            ))}
          </ul>
        </section>
      ) : null}
    </main>
  );
}
