"use client";

import { useRef, useState, type KeyboardEvent, type TouchEvent } from "react";
import type { Product } from "@/types/product";
import ProductCard from "@/components/product-card/ProductCard";
import styles from "./ProductShowcase.module.css";

interface ProductShowcaseProps {
  products: Product[];
}

const SWIPE_THRESHOLD_PX = 40;

export default function ProductShowcase({ products }: ProductShowcaseProps) {
  const cards = products.slice(0, 2);
  const [frontIndex, setFrontIndex] = useState(0);
  const touchStartX = useRef<number | null>(null);

  if (cards.length === 0) {
    return null;
  }

  const canSwap = cards.length > 1;

  const swap = () => {
    if (!canSwap) return;
    setFrontIndex((current) => (current === 0 ? 1 : 0));
  };

  const handleBackKeyDown = (event: KeyboardEvent<HTMLDivElement>) => {
    if (event.key === "Enter" || event.key === " ") {
      event.preventDefault();
      swap();
    }
  };

  const handleTouchStart = (event: TouchEvent<HTMLDivElement>) => {
    if (!canSwap) return;
    touchStartX.current = event.touches[0]?.clientX ?? null;
  };

  const handleTouchEnd = (event: TouchEvent<HTMLDivElement>) => {
    if (!canSwap || touchStartX.current === null) return;
    const endX = event.changedTouches[0]?.clientX ?? touchStartX.current;
    const deltaX = endX - touchStartX.current;
    touchStartX.current = null;
    if (Math.abs(deltaX) > SWIPE_THRESHOLD_PX) {
      swap();
    }
  };

  return (
    <div
      id="showcase"
      className={styles.showcase}
      aria-label="Featured rental gear"
      onTouchStart={handleTouchStart}
      onTouchEnd={handleTouchEnd}
    >
      <div className={styles.glow} aria-hidden="true" />

      {cards.map((product, index) => {
        const isFront = index === frontIndex;
        return (
          <div
            key={product.id}
            className={`${styles.slot} ${isFront ? styles.front : styles.back}`}
            role={isFront || !canSwap ? undefined : "button"}
            tabIndex={isFront || !canSwap ? undefined : 0}
            aria-label={isFront || !canSwap ? undefined : `Show ${product.name} details`}
            onClick={isFront ? undefined : swap}
            onKeyDown={isFront ? undefined : handleBackKeyDown}
          >
            <ProductCard product={product} />
          </div>
        );
      })}
    </div>
  );
}
