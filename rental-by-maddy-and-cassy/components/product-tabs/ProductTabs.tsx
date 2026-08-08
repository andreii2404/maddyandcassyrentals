"use client";

import { useState, type KeyboardEvent } from "react";
import type { ProductReview } from "@/types/product";
import styles from "./ProductTabs.module.css";

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
          <button
            key={tab.id}
            type="button"
            role="tab"
            id={`tab-${tab.id}`}
            aria-selected={activeTab === tab.id}
            aria-controls={`panel-${tab.id}`}
            tabIndex={activeTab === tab.id ? 0 : -1}
            className={`${styles.tab} ${activeTab === tab.id ? styles.tabActive : ""}`}
            onClick={() => setActiveTab(tab.id)}
          >
            {tab.label}
          </button>
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
        {reviews.length > 0 ? (
          <>
            <p className={styles.reviewSummary}><strong>{rating.toFixed(1)}</strong> average rating from {reviewCount} verified renter reviews</p>
            <ul className={styles.reviewList}>
              {reviews.map((review) => (
                <li key={review.id} className={styles.reviewItem}>
                  <div className={styles.reviewHeader}>
                    <span className={styles.reviewAuthor}>{review.author}</span>
                    <span className={styles.reviewRating}>{review.rating.toFixed(1)} ★</span>
                  </div>
                  <p className={styles.reviewComment}>{review.comment || "Rating submitted without a written comment."}</p>
                  <time className={styles.reviewDate} dateTime={review.date}>
                    {new Date(review.date).toLocaleDateString("en-PH", { year: "numeric", month: "short", day: "numeric" })}
                  </time>
                </li>
              ))}
            </ul>
          </>
        ) : (
          <div className={styles.emptyReviews}>
            <strong>No customer reviews yet</strong>
            <p>Verified renters can leave a rating after their rental is returned.</p>
          </div>
        )}
      </div>
    </div>
  );
}
