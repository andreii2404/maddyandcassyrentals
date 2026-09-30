import Image from "next/image";
import Link from "next/link";
import type { Product } from "@/types/product";
import AvailabilityBadge from "@/components/availability-badge/AvailabilityBadge";
import styles from "./ProductShowcase.module.css";

interface ProductShowcaseProps {
  products: Product[];
}

// Hero product visual: one framed panel holding up to two equally sized,
// top-aligned product tiles, each linking to its catalog detail page.
export default function ProductShowcase({ products }: ProductShowcaseProps) {
  const tiles = products.slice(0, 2);

  if (tiles.length === 0) {
    return null;
  }

  return (
    <div
      id="showcase"
      className={`${styles.showcase} ${tiles.length === 1 ? styles.single : ""}`}
      aria-label="Featured rental gear"
    >
      <ul className={styles.grid}>
        {tiles.map((product, index) => (
          <li key={product.id} className={styles.tile}>
            <Link href={`/catalog/${product.slug || product.id}`} className={styles.link}>
              <div className={styles.imageWrap}>
                <Image
                  src={product.image || "/images/product-placeholder.png"}
                  alt={`${product.name} available for rent`}
                  fill
                  priority={index === 0}
                  sizes="(max-width: 560px) 45vw, (max-width: 860px) 280px, 260px"
                  className={styles.image}
                />
                <AvailabilityBadge
                  totalUnits={product.totalUnits}
                  availableUnits={product.availableUnits}
                  mode="summary"
                  className={styles.badge}
                />
              </div>

              <div className={styles.info}>
                {product.brand ? <p className={styles.brand}>{product.brand}</p> : null}
                <h3 className={styles.name}>{product.name}</h3>
                <p className={styles.price}>
                  ₱{product.pricePerDay.toLocaleString("en-PH")}
                  <span className={styles.perDay}>/day</span>
                </p>
              </div>
            </Link>
          </li>
        ))}
      </ul>
    </div>
  );
}
