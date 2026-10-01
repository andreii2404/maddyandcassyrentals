"use client";

import { Button } from "@/components/ui/Button";
import ConfirmModal from "@/components/ui/ConfirmModal";
import { useCallback, useEffect, useMemo, useState } from "react";
import Link from "next/link";
import type { Product } from "@/types/product";
import type { UnitCounts } from "@/lib/availability";
import CatalogProductCard from "@/components/catalog-product-card/CatalogProductCard";
import { useFavorites } from "@/hooks/useFavorites";
import { useInventoryMap } from "@/hooks/useInventory";
import styles from "./favorites.module.css";

interface FavoritesViewProps {
  products: Product[];
}

export default function FavoritesView({ products }: FavoritesViewProps) {
  const {
    favorites,
    toggleFavorite,
    isFavorite,
    clearFavorites,
    removeStaleFavorites,
  } = useFavorites();
  const [isClearConfirmOpen, setIsClearConfirmOpen] = useState(false);
  const defaultsById: Record<string, UnitCounts> = Object.fromEntries(
    products.map((product) => [
      product.id,
      {
        totalUnits: product.totalUnits,
        availableUnits: product.availableUnits,
        reservedUnits: product.reservedUnits,
        rentedUnits: product.rentedUnits,
      },
    ])
  );
  const unitsByProductId = useInventoryMap(defaultsById);
  const favoriteProducts = useMemo(
    () => products.filter((product) => favorites.includes(product.id)),
    [favorites, products]
  );

  useEffect(() => {
    removeStaleFavorites(products.map((product) => product.id));
  }, [products, removeStaleFavorites]);

  // Clearing every favorite is destructive and irreversible, so it only runs
  // once the shortlist owner confirms in the dialog.
  const handleConfirmClear = useCallback(() => {
    clearFavorites();
    setIsClearConfirmOpen(false);
  }, [clearFavorites]);

  return (
    <section className={styles.page} aria-labelledby="favorites-heading">
      <header className={styles.header}>
        <div>
          <p className={styles.eyebrow}>YOUR SHORTLIST</p>
          <h1 id="favorites-heading">Favorite Rentals</h1>
          <p>
            Save items while you compare. Favorites work with or without an
            account and stay on this browser.
          </p>
        </div>
        {favoriteProducts.length > 0 ? (
          <div className={styles.headerActions}>
            <span className={styles.count}>
              {favoriteProducts.length} {favoriteProducts.length === 1 ? "saved item" : "saved items"}
            </span>
            <span className={styles.divider} aria-hidden="true" />
            <Button
              variant="none"
              type="button"
              className={styles.clearButton}
              onClick={() => setIsClearConfirmOpen(true)}
            >
              Clear all
            </Button>
          </div>
        ) : null}
      </header>

      {favoriteProducts.length > 0 ? (
        <>
          <div className={styles.grid}>
            {favoriteProducts.map((product) => (
              <CatalogProductCard
                key={product.id}
                product={product}
                units={unitsByProductId.get(product.id) ?? defaultsById[product.id]}
                isFavorite={isFavorite(product.id)}
                onToggleFavorite={toggleFavorite}
                variant="favorite"
              />
            ))}
          </div>
          <div className={styles.moreRow}>
            <p>Still comparing? Save more options from the full catalog.</p>
            <Link href="/catalog" className={styles.moreLink}>Browse rentals</Link>
          </div>
        </>
      ) : (
        <div className={styles.empty}>
          <span className={styles.emptyHeart} aria-hidden="true">♡</span>
          <h2>Your favorites list is ready when you are.</h2>
          <p>Tap the heart on any catalog item to keep it here for easy comparison.</p>
          <Link href="/catalog" className={styles.browseButton}>Browse all rentals</Link>
        </div>
      )}

      {isClearConfirmOpen ? (
        <ConfirmModal
          title="Clear all favorites?"
          description="Are you sure you want to remove all saved items?"
          confirmLabel="Clear all"
          cancelLabel="Cancel"
          tone="danger"
          onConfirm={handleConfirmClear}
          onCancel={() => setIsClearConfirmOpen(false)}
        />
      ) : null}
    </section>
  );
}
