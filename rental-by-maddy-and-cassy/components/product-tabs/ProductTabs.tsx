"use client";

import { useState, type KeyboardEvent } from "react";
import type { ProductReview } from "@/types/product";
import styles from "./ProductTabs.module.css";
import { Button } from "@/components/ui/Button";
import ProductReviews from "@/components/product-reviews/ProductReviews";

interface ProductTabsProps {
  specs: Record<string, string>;
  included: string[];
  reviews: ProductReview[];
  rating: number;
  reviewCount: number;
}

type TabId = "specifications" | "included" | "reviews";

export default function ProductTabs({ specs, included, reviews, rating, reviewCount }: ProductTabsProps) {
  const tabs: { id: TabId; label: string }[] = [];
  if (Object.keys(specs).length > 0) tabs.push({ id: "specifications", label: "Specifications" });
  if (included.length > 0) tabs.push({ id: "included", label: "What’s Included" });
  tabs.push({ id: "reviews", label: reviewCount > 0 ? `Reviews (${reviewCount})` : "Reviews" });

  const [activeTab, setActiveTab] = useState<TabId | null>(() => tabs[0]?.id ?? null);

  if (!activeTab || tabs.length === 0) return null;

  // With no specs or inclusions to switch between, the tab bar would only
  // repeat the section heading, so show the reviews section on its own.
  if (tabs.length === 1) {
    return <ProductReviews reviews={reviews} rating={rating} reviewCount={reviewCount} />;
  }

  function handleKeyDown(event: KeyboardEvent) {
    const currentIndex = tabs.findIndex((tab) => tab.id === activeTab);
    if (event.key === "ArrowRight") {
      event.preventDefault();
      setActiveTab(tabs[(currentIndex + 1) % tabs.length].id);
    } else if (event.key === "ArrowLeft") {
      event.preventDefault();
      setActiveTab(tabs[(currentIndex - 1 + tabs.length) % tabs.length].id);
    }
  }

  return (
    <div className={styles.card}>
      <div className={styles.tabList} role="tablist" aria-label="Product information" onKeyDown={handleKeyDown}>
        {tabs.map((tab) => (
          <Button
            key={tab.id}
            variant="none"
            role="tab"
            id={`tab-${tab.id}`}
            aria-selected={activeTab === tab.id}
            aria-controls={`panel-${tab.id}`}
            tabIndex={activeTab === tab.id ? 0 : -1}
            className={`${styles.tab} ${activeTab === tab.id ? styles.tabActive : ""}`}
            onClick={() => setActiveTab(tab.id)}
          >
            {tab.label}
          </Button>
        ))}
      </div>

      {Object.keys(specs).length > 0 ? (
        <div role="tabpanel" id="panel-specifications" aria-labelledby="tab-specifications" hidden={activeTab !== "specifications"} className={styles.panel}>
          <dl className={styles.specGrid}>
            {Object.entries(specs).map(([key, value]) => (
              <div key={key} className={styles.specRow}>
                <dt className={styles.specKey}>{key}</dt>
                <dd className={styles.specValue}>{value}</dd>
              </div>
            ))}
          </dl>
        </div>
      ) : null}

      {included.length > 0 ? (
        <div role="tabpanel" id="panel-included" aria-labelledby="tab-included" hidden={activeTab !== "included"} className={styles.panel}>
          <ul className={styles.includedList}>{included.map((item) => <li key={item}>{item}</li>)}</ul>
        </div>
      ) : null}

      <div role="tabpanel" id="panel-reviews" aria-labelledby="tab-reviews" hidden={activeTab !== "reviews"} className={styles.panel}>
        <ProductReviews reviews={reviews} rating={rating} reviewCount={reviewCount} />
      </div>
    </div>
  );
}
