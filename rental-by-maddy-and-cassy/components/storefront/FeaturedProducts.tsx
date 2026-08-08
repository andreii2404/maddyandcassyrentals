"use client";

import { useMemo } from "react";
import Link from "next/link";
import type { Product } from "@/types/product";
import type { UnitCounts } from "@/lib/availability";
import CatalogProductCard from "@/components/catalog-product-card/CatalogProductCard";
import { useFavorites } from "@/hooks/useFavorites";
import { useInventoryMap } from "@/hooks/useInventory";
import styles from "./FeaturedProducts.module.css";

interface FeaturedProductsProps {
  products: Product[];
  totalProductCount: number;
}

export default function FeaturedProducts({ products, totalProductCount }: FeaturedProductsProps) {
  const defaults = useMemo<Record<string, UnitCounts>>(
    () => Object.fromEntries(
      products.map((product) => [
        product.id,
        {
          totalUnits: product.totalUnits,
          availableUnits: product.availableUnits,
          reservedUnits: product.reservedUnits,
          rentedUnits: product.rentedUnits,
        },
      ]),
    ),
    [products],
  );
  const unitsByProductId = useInventoryMap(defaults);
  const { toggleFavorite, isFavorite } = useFavorites();

  if (!products.length) return null;

  return (
    <section className={styles.section} aria-labelledby="featured-products-heading">
      <div className={styles.inner}>
        <div className={styles.header}>
          <div>
            <p className={styles.eyebrow}>FEATURED RENTALS</p>
            <h2 id="featured-products-heading">Popular gear, ready to explore.</h2>
            <p>Compare clear daily rates and open any listing to check dates and reserve.</p>
          </div>
          <Link href="/catalog" className={styles.viewAll}>Browse all {totalProductCount}</Link>
        </div>

        <div className={styles.grid}>
          {products.map((product) => (
            <CatalogProductCard
              key={product.id}
              product={product}
              units={unitsByProductId.get(product.id) ?? defaults[product.id]}
              isFavorite={isFavorite(product.id)}
              onToggleFavorite={toggleFavorite}
            />
          ))}
        </div>
      </div>
    </section>
  );
}
