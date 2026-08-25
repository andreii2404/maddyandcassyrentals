"use client";

import { useState } from "react";
import Link from "next/link";
import type { Product } from "@/types/product";
import type { UnitCounts } from "@/lib/availability";
import ArrowLeftIcon from "@/components/icons/ArrowLeftIcon";
import FavoriteButton from "@/components/favorite-button/FavoriteButton";
import ReserveAction from "@/components/reserve-action/ReserveAction";
import AvailabilityBadge from "@/components/availability-badge/AvailabilityBadge";
import ImageGallery from "@/components/image-gallery/ImageGallery";
import ProductTabs from "@/components/product-tabs/ProductTabs";
import SimilarProducts from "@/components/similar-products/SimilarProducts";
import { useInventoryMap } from "@/hooks/useInventory";
import styles from "./details.module.css";

interface ProductDetailsClientProps {
  product: Product;
  similarProducts: Product[];
}

export default function ProductDetailsClient({
  product,
  similarProducts,
}: ProductDetailsClientProps) {
  const defaultsById: Record<string, UnitCounts> = {
    [product.id]: {
      totalUnits: product.totalUnits,
      availableUnits: product.availableUnits,
      reservedUnits: product.reservedUnits,
      rentedUnits: product.rentedUnits,
    },
  };
  for (const item of similarProducts) {
    defaultsById[item.id] = {
      totalUnits: item.totalUnits,
      availableUnits: item.availableUnits,
      reservedUnits: item.reservedUnits,
      rentedUnits: item.rentedUnits,
    };
  }

  const unitsByProductId = useInventoryMap(defaultsById);
  const units = unitsByProductId.get(product.id) ?? defaultsById[product.id];

  // Multi-color products require an explicit color choice before the customer
  // can reserve or add to cart. Until a swatch is clicked, only the primary
  // catalog photo is shown as a teaser -- never a mix of color variants.
  const [selectedColor, setSelectedColor] = useState<string | null>(null);
  const needsColorChoice = product.colorOptions.length > 1;
  const hasChosenColor = !needsColorChoice || selectedColor !== null;
  const activeColor =
    selectedColor && product.images.some((image) => image.color === selectedColor)
      ? selectedColor
      : null;
  const colorImages = activeColor
    ? product.images.filter((image) => image.color === activeColor)
    : [];
  const allImageUrls = product.images.map((image) => image.url);
  const galleryImages = !needsColorChoice
    ? allImageUrls.length ? allImageUrls : [product.image]
    : colorImages.length
      ? colorImages.map((image) => image.url)
      : [product.image];
  const specificationEntries = Object.entries(product.specs);
  const rentalName = product.brand && !product.name.toLowerCase().startsWith(product.brand.toLowerCase())
    ? `${product.brand} ${product.name}`
    : product.name;
  const fallbackDescription = [
    `Rent the ${rentalName} by the day from Rental by Maddy & Cassy.`,
    specificationEntries.length > 0
      ? `Key details include ${specificationEntries.map(([label, value]) => `${label.toLowerCase()}: ${value}`).join(", ")}.`
      : "Check the listing details and live calendar before choosing your rental dates.",
    product.included.length > 0
      ? `The rental package includes ${product.included.join(", ")}.`
      : "Package inclusions can be confirmed with the rental team before pickup or delivery.",
  ].join(" ");

  return (
    <>
      <Link href="/catalog" className={styles.backLink}>
        <ArrowLeftIcon size={16} />
        Back to Listings
      </Link>

      <div className={styles.layout}>
        <div className={styles.left}>
          <ImageGallery images={galleryImages} productName={product.name} badge={product.badge} />
        </div>

        <div className={styles.info}>
          <p className={styles.category}>{[product.brand, product.category].filter(Boolean).join(" · ")}</p>
          <h1 className={styles.name}>{product.name}</h1>
          {needsColorChoice ? (
            <div className={styles.colorPicker} role="group" aria-label={`Choose a color for ${product.name}`}>
              <span className={styles.colorPickerLabel}>Color</span>
              {product.colorOptions.map((color) => {
                const hasPhotos = product.images.some((image) => image.color === color);
                return (
                  <button
                    key={color}
                    type="button"
                    aria-pressed={activeColor === color}
                    disabled={!hasPhotos}
                    title={hasPhotos ? `Show ${color} photos` : `${color} photos coming soon`}
                    className={[
                      styles.colorButton,
                      activeColor === color ? styles.colorButtonActive : "",
                      hasPhotos ? "" : styles.colorButtonSoon,
                    ].filter(Boolean).join(" ")}
                    onClick={() => setSelectedColor(color)}
                  >
                    {color}{hasPhotos ? "" : " · soon"}
                  </button>
                );
              })}
              <span className={styles.colorHint} role="status">
                {hasChosenColor
                  ? `Showing ${activeColor ?? selectedColor} photos`
                  : "Select a color to see its photos before reserving."}
              </span>
            </div>
          ) : null}
          {specificationEntries.length > 0 ? (
            <dl className={styles.specificationPills} aria-label="Product specifications">
              {specificationEntries.map(([label, value]) => (
                <div key={label} className={styles.specificationPill}>
                  <dt>{label}</dt>
                  <dd>{value}</dd>
                </div>
              ))}
            </dl>
          ) : null}
          {product.reviewCount > 0 ? (
            <p className={styles.rating}>
              {product.rating.toFixed(1)} ★{" "}
              <span className={styles.reviewCount}>({product.reviewCount} reviews)</span>
            </p>
          ) : null}

          <p className={styles.description}>{product.description || product.shortDescription || fallbackDescription}</p>

          <div className={styles.infoCards}>
            <div className={styles.infoCard}>
              <p className={styles.infoCardLabel}>Daily Rate</p>
              {product.discountPercent > 0 ? (
                <p className={styles.originalRate}>{product.currency}{product.listPricePerDay.toLocaleString()} / day</p>
              ) : null}
              <p className={styles.infoCardValue}>
                {product.currency}
                {product.pricePerDay.toLocaleString()}
                <span className={styles.perDay}>/day</span>
              </p>
              {product.discountPercent > 0 ? (
                <p className={styles.discountNote}>{product.discountLabel || `${product.discountPercent}% discount applied`}</p>
              ) : null}
            </div>
            <div className={styles.infoCard}>
              <p className={styles.infoCardLabel}>Availability Status</p>
              <AvailabilityBadge
                totalUnits={units.totalUnits}
                availableUnits={units.availableUnits}
                variant="detailed"
                mode="summary"
              />
            </div>
            <div className={styles.infoCard}>
              <p className={styles.infoCardLabel}>Non-refundable Deposit</p>
              <p className={styles.infoCardValue}>
                {product.currency}{product.refundableDeposit.toLocaleString()}
              </p>
            </div>
          </div>

          <div className={styles.detailsSplit}>
            {product.included.length > 0 ? (
              <section className={styles.includedCard} aria-labelledby="included-heading">
                <div className={styles.panelHeadingRow}>
                  <div>
                    <p className={styles.panelEyebrow}>RENTAL KIT</p>
                    <h2 id="included-heading">What comes with it</h2>
                  </div>
                  <span>{product.included.length} items</span>
                </div>
                <ul className={styles.includedGrid}>
                  {product.included.map((item) => (
                    <li key={item}><span aria-hidden="true">✓</span>{item}</li>
                  ))}
                </ul>
              </section>
            ) : null}

            <section className={styles.reserveCard} aria-labelledby="reserve-heading">
              <div className={styles.favoriteRow}>
                <FavoriteButton productId={product.id} productName={product.name} />
              </div>
              <p className={styles.panelEyebrow}>NEXT STEP</p>
              <h2 id="reserve-heading" className={styles.reserveHeading}>Build your reservation</h2>
              <p className={styles.reserveCopy}>
                Choose exact dates, pickup or delivery, then pay 50% or the full amount.
              </p>
              <ReserveAction
                product={product}
                units={units}
                selectedColor={activeColor}
                awaitingColor={needsColorChoice && !hasChosenColor}
              />
            </section>
          </div>
        </div>
      </div>

      <ProductTabs
        specs={{}}
        included={[]}
        reviews={product.reviews}
        rating={product.rating}
        reviewCount={product.reviewCount}
      />

      <SimilarProducts products={similarProducts} unitsByProductId={unitsByProductId} />
    </>
  );
}
