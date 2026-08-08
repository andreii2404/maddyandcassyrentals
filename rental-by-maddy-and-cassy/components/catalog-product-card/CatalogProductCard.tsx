"use client";

import Image from "next/image";
import Link from "next/link";
import type { Product } from "@/types/product";
import type { UnitCounts } from "@/lib/availability";
import HeartIcon from "@/components/icons/HeartIcon";
import AvailabilityBadge from "@/components/availability-badge/AvailabilityBadge";
import { useCart } from "@/hooks/useCart";
import { useToast } from "@/components/ui/ToastProvider";
import styles from "./CatalogProductCard.module.css";

interface CatalogProductCardProps {
  product: Product;
  units: UnitCounts;
  isFavorite: boolean;
  onToggleFavorite: (productId: string) => void;
  ctaLabel?: string;
}

export default function CatalogProductCard({
  product,
  units,
  isFavorite,
  onToggleFavorite,
  ctaLabel = "Reserve Now",
}: CatalogProductCardProps) {
  const { addItem } = useCart();
  const { showToast } = useToast();
  const detailsHref = `/catalog/${product.id}`;
  const unavailable = units.totalUnits <= 0;

  return (
    <article className={styles.card}>
      <Link
        href={detailsHref}
        className={styles.imageLink}
        aria-label={`View details for ${product.name}`}
      >
        <div className={styles.imageWrapper}>
          <Image
            src={product.image || "/images/product-placeholder.png"}
            alt={`${product.name} available for rent`}
            fill
            sizes="(max-width: 640px) 90vw, (max-width: 1024px) 45vw, 280px"
            className={styles.image}
          />
          {product.badge ? <span className={styles.productBadge}>{product.badge}</span> : null}
        </div>
      </Link>

      <button
        type="button"
        className={`${styles.favoriteButton} ${isFavorite ? styles.favoriteActive : ""}`}
        onClick={() => onToggleFavorite(product.id)}
        aria-pressed={isFavorite}
        aria-label={isFavorite ? `Remove ${product.name} from favorites` : `Add ${product.name} to favorites`}
      >
        <HeartIcon size={17} filled={isFavorite} />
      </button>

      <div className={styles.info}>
        <p className={styles.category}>{product.category}</p>
        <Link href={detailsHref} className={styles.nameLink}>
          <h3 className={styles.name}>{product.name}</h3>
        </Link>
        <p className={styles.brand}>{product.brand}</p>
        {Object.keys(product.specs).length > 0 ? (
          <p className={styles.specSummary}>{Object.values(product.specs).join(" · ")}</p>
        ) : null}
        <div className={styles.priceBlock}>
          {product.discountPercent > 0 ? (
            <p className={styles.listPrice}>{product.currency}{product.listPricePerDay.toLocaleString()}/day</p>
          ) : null}
          <p className={styles.price}>
            {product.currency}
            {product.pricePerDay.toLocaleString()}
            <span className={styles.perDay}>/day</span>
          </p>
          {product.discountPercent > 0 ? (
            <span className={styles.discountText}>{product.discountLabel || `${product.discountPercent}% catalog discount`}</span>
          ) : null}
        </div>
        {product.reviewCount > 0 ? (
          <p className={styles.rating}>
            {product.rating.toFixed(1)} ★{" "}
            <span className={styles.reviewCount}>({product.reviewCount})</span>
          </p>
        ) : null}

        <AvailabilityBadge
          totalUnits={units.totalUnits}
          availableUnits={units.availableUnits}
          mode="summary"
          className={styles.availabilityBadge}
        />

        <div className={styles.actions}>
          <Link href={detailsHref} className={styles.detailsButton}>
            View Details
          </Link>
          <button
            type="button"
            className={styles.cartButton}
            disabled={unavailable}
            onClick={() => {
              addItem(product.id);
              showToast(`${product.name} added to your rental cart.`, "success");
            }}
          >
            Add to Cart
          </button>
          <Link
            href={`${detailsHref}/reserve`}
            className={`${styles.reserveButton} ${unavailable ? styles.reserveDisabled : ""}`}
            aria-disabled={unavailable}
            onClick={(event) => {
              if (unavailable) event.preventDefault();
            }}
          >
            {unavailable ? "Unavailable" : ctaLabel}
          </Link>
        </div>
      </div>
    </article>
  );
}
