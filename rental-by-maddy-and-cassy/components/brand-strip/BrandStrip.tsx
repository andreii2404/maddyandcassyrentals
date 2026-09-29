import styles from "./BrandStrip.module.css";

interface BrandStripProps {
  brands: string[];
}

export default function BrandStrip({ brands }: BrandStripProps) {
  if (brands.length === 0) return null;

  return (
    <section className={styles.strip} aria-label="Brands available in the rental catalog">
      <p className={styles.label}>Gear from the brands you trust</p>
      <ul className={styles.list}>
        {brands.map((brand) => (
          <li key={brand} className={styles.item}>{brand}</li>
        ))}
      </ul>
    </section>
  );
}
