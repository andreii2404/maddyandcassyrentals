import ProductShowcase from "@/components/product-showcase/ProductShowcase";
import type { Product } from "@/types/product";
import { Button } from "@/components/ui/Button";
import styles from "./Hero.module.css";

interface HeroProps {
  products: Product[];
}

export default function Hero({ products }: HeroProps) {
  return (
    <section id="top" className={styles.hero} aria-label="Introduction">
      <div className={styles.backgroundGlow} aria-hidden="true" />
      <div className={`${styles.heroBlob} editorialBlob editorialBreathe`} aria-hidden="true" />

      <div className={styles.inner}>
        <div className={styles.content}>
          <h1 className={styles.heading}>
            Rent the Gear.
            <br />
            Create the
            <br />
            <em className={styles.emphasis}>Moment.</em>
          </h1>

          <p className={styles.supporting}>
            Premium cameras and phones, rented by the day, with delivery and pickup across Metro Manila.
          </p>

          <Button href="/catalog" variant="none" className={styles.primaryButton}>
            Check Availability
            <span className={styles.arrowChip} aria-hidden="true">
              <svg viewBox="0 0 20 20" width="14" height="14">
                <path d="M5 15 15 5M7 5h8v8" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" />
              </svg>
            </span>
          </Button>
        </div>

        <ProductShowcase products={products.slice(0, 2)} />
      </div>
    </section>
  );
}
