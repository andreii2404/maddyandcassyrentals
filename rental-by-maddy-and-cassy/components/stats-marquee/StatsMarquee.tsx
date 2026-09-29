import styles from "./StatsMarquee.module.css";

interface StatsMarqueeProps {
  items: string[];
}

// Full-width scrolling info strip below the hero. Renders the same content
// twice (second copy aria-hidden) so the CSS translateX(-50%) loop is seamless.
export default function StatsMarquee({ items }: StatsMarqueeProps) {
  if (!items.length) return null;

  return (
    <div className={styles.band} aria-label="Rental highlights">
      <div className={styles.track}>
        <div className={styles.group}>
          {items.map((item, index) => (
            <span key={index} className={styles.item}>
              <span className={styles.mark} aria-hidden="true">{"//"}</span>
              {item}
            </span>
          ))}
        </div>
        <div className={styles.group} aria-hidden="true">
          {items.map((item, index) => (
            <span key={index} className={styles.item}>
              <span className={styles.mark} aria-hidden="true">{"//"}</span>
              {item}
            </span>
          ))}
        </div>
      </div>
    </div>
  );
}
