import Image from "next/image";
import Link from "next/link";
import type { Product } from "@/types/product";
import styles from "./RentalOptions.module.css";

interface RentalOptionPick {
  tier: string;
  tagline: string;
  product: Product;
}

interface RentalOptionsProps {
  picks: RentalOptionPick[];
}

export default function RentalOptions({ picks }: RentalOptionsProps) {
  if (picks.length === 0) return null;

  return (
    <section className={styles.section} aria-labelledby="rental-options-heading">
      <div className={styles.intro}>
        <p className={styles.eyebrow}>RENTAL OPTIONS</p>
        <h2 id="rental-options-heading" className={styles.heading}>Pick the rate that fits your plans.</h2>
        <p className={styles.description}>
          Real listings from the live catalog, spanning the range of daily rates available today.
        </p>
      </div>

      <div className={styles.grid}>
        {picks.map(({ tier, tagline, product }) => (
          <article key={product.id} className={styles.card}>
            <div className={styles.imageWrap}>
              <Image
                src={product.image || "/images/product-placeholder.png"}
                alt={`${product.name} available for rent`}
                fill
                sizes="(max-width: 860px) 90vw, 30vw"
                className={styles.image}
              />
              <span className={styles.tier}>{tier}</span>
            </div>
            <div className={styles.body}>
              <p className={styles.tagline}>{tagline}</p>
              <h3 className={styles.name}>{product.name}</h3>
              {product.shortDescription ? (
                <p className={styles.summary}>{product.shortDescription}</p>
              ) : null}
              <p className={styles.price}>
                {product.currency}{product.pricePerDay.toLocaleString()}
                <span>/day</span>
              </p>
              <Link href={`/catalog/${product.slug || product.id}`} className={styles.cta}>
                View {product.category} listing
              </Link>
            </div>
          </article>
        ))}
      </div>
    </section>
  );
}
