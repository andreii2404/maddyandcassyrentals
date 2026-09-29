import Link from "next/link";
import type { FaqItem } from "@/src/data/faq";
import styles from "./FaqPreview.module.css";

interface FaqPreviewProps {
  items: FaqItem[];
}

export default function FaqPreview({ items }: FaqPreviewProps) {
  if (items.length === 0) return null;

  return (
    <section id="faq" className={styles.section} aria-labelledby="faq-heading">
      <div className={styles.intro}>
        <p className={styles.eyebrow}>FAQ</p>
        <h2 id="faq-heading" className={styles.heading}>Quick answers before you book.</h2>
        <p className={styles.description}>
          The most common questions about payments, deposits, and returns.
        </p>
      </div>

      <div className={styles.list}>
        {items.map((item, index) => (
          <details key={item.question} className={styles.item} open={index === 0}>
            <summary>
              <h3>{item.question}</h3>
              <span className={styles.toggle} aria-hidden="true">+</span>
            </summary>
            <p>{item.answer}</p>
          </details>
        ))}
      </div>

      <Link href="/faq" className={styles.viewAll}>Browse all FAQs →</Link>
    </section>
  );
}
