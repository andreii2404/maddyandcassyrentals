import styles from "./Stats.module.css";

interface Stat {
  value: string;
  label: string;
}

interface StatsProps {
  itemCount: number;
  categoryCount: number;
}

export default function Stats({ itemCount, categoryCount }: StatsProps) {
  const stats: Stat[] = [
    { value: String(itemCount), label: "Catalog Listings" },
    { value: String(categoryCount), label: "Gear Categories" },
  ];

  return (
    <dl className={styles.stats} aria-label="Rental catalog facts">
      {stats.map((stat) => (
        <div key={stat.label} className={styles.stat}>
          <dt className={styles.value}>{stat.value}</dt>
          <dd className={styles.label}>{stat.label}</dd>
        </div>
      ))}
    </dl>
  );
}
