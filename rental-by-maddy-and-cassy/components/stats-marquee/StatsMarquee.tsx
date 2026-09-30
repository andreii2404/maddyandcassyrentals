import styles from "./StatsMarquee.module.css";

interface StatsMarqueeProps {
  items: string[];
}

// Static trust strip below the hero. Items sit in equal-width columns inside the
// page container, so every item is fully visible — nothing scrolls or clips.
export default function StatsMarquee({ items }: StatsMarqueeProps) {
  if (!items.length) return null;

  return (
    <div className={styles.band}>
      <ul className={styles.list} aria-label="Rental highlights">
        {items.map((item) => (
          <li key={item} className={styles.item}>
            <svg className={styles.mark} viewBox="0 0 16 16" width="14" height="14" aria-hidden="true">
              <path d="m3.5 8.4 2.9 2.9 6.1-6.6" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" />
            </svg>
            <span>{item}</span>
          </li>
        ))}
      </ul>
    </div>
  );
}
