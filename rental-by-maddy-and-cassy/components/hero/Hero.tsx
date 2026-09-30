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

      <div className={styles.inner}>
        <div className={styles.content}>
          <h1 className={styles.heading}>
            Rent the Gear.
            <br />
            Create the <em className={styles.emphasis}>Moment.</em>
          </h1>

          <p className={styles.supporting}>
            Premium cameras and phones, rented by the day, with delivery and pickup across Metro Manila.
          </p>

          <Button href="/catalog" variant="none" className={styles.primaryButton}>
            Check Availability
          </Button>
        </div>

        <ProductShowcase products={products.slice(0, 6)} />
      </div>
    </section>
  );
}
