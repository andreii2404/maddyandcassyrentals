"use client";

import { useMemo, useState } from "react";
import type { ProductReview } from "@/types/product";
import { Button } from "@/components/ui/Button";
import styles from "./ProductReviews.module.css";

interface ProductReviewsProps {
  reviews: ProductReview[];
  rating: number;
  reviewCount: number;
}

type FilterId = "all" | "verified";
type SortId = "recent" | "oldest" | "highest" | "lowest";

const SORT_OPTIONS: { id: SortId; label: string }[] = [
  { id: "recent", label: "Most Recent" },
  { id: "oldest", label: "Oldest" },
  { id: "highest", label: "Highest Rated" },
  { id: "lowest", label: "Lowest Rated" },
];

const GENERIC_AUTHOR = "verified renter";

function isVerified(review: ProductReview) {
  return review.verified !== false;
}

function timestamp(review: ProductReview) {
  return new Date(review.date).getTime() || 0;
}

function getInitials(author: string) {
  const words = author.trim().split(/\s+/).filter(Boolean);
  if (words.length === 0) return "VR";
  return words.slice(0, 2).map((word) => word[0]!.toUpperCase()).join("");
}

function sortReviews(reviews: ProductReview[], sort: SortId) {
  const sorted = [...reviews];
  switch (sort) {
    case "oldest":
      return sorted.sort((a, b) => timestamp(a) - timestamp(b));
    case "highest":
      return sorted.sort((a, b) => b.rating - a.rating || timestamp(b) - timestamp(a));
    case "lowest":
      return sorted.sort((a, b) => a.rating - b.rating || timestamp(b) - timestamp(a));
    default:
      return sorted.sort((a, b) => timestamp(b) - timestamp(a));
  }
}

function Stars({ value, className = "" }: { value: number; className?: string }) {
  const percent = Math.max(0, Math.min(100, (value / 5) * 100));
  return (
    <span
      className={`${styles.stars} ${className}`}
      role="img"
      aria-label={`${value.toFixed(1)} out of 5 stars`}
    >
      <span className={styles.starsEmpty} aria-hidden="true">★★★★★</span>
      <span className={styles.starsFill} style={{ width: `${percent}%` }} aria-hidden="true">★★★★★</span>
    </span>
  );
}

function VerifiedBadge() {
  return (
    <span className={styles.badge}>
      <svg viewBox="0 0 16 16" width="13" height="13" aria-hidden="true" focusable="false">
        <path
          d="M3.5 8.5l3 3 6-6.5"
          fill="none"
          stroke="currentColor"
          strokeWidth="1.8"
          strokeLinecap="round"
          strokeLinejoin="round"
        />
      </svg>
      Verified renter
    </span>
  );
}

export default function ProductReviews({ reviews, rating, reviewCount }: ProductReviewsProps) {
  const [filter, setFilter] = useState<FilterId>("all");
  const [sort, setSort] = useState<SortId>("recent");

  const verifiedCount = useMemo(() => reviews.filter(isVerified).length, [reviews]);
  const visibleReviews = useMemo(
    () => sortReviews(filter === "verified" ? reviews.filter(isVerified) : reviews, sort),
    [reviews, filter, sort],
  );

  const filters: { id: FilterId; label: string; count: number }[] = [
    { id: "all", label: "All Reviews", count: reviews.length },
    { id: "verified", label: "Verified Renters", count: verifiedCount },
  ];

  return (
    <section id="reviews" className={styles.section} aria-labelledby="reviews-heading">
      <header className={styles.header}>
        <div>
          <h2 id="reviews-heading" className={styles.title}>Reviews</h2>
          <p className={styles.subtitle}>Honest ratings from renters who have returned this item.</p>
        </div>
        <Button href="/account/bookings" variant="primary" size="md" className={styles.writeButton}>
          Write a review
        </Button>
      </header>

      {reviews.length > 0 ? (
        <>
          <div className={styles.summary}>
            <span className={styles.score}>{rating.toFixed(1)}</span>
            <div className={styles.summaryDetail}>
              <Stars value={rating} className={styles.summaryStars} />
              <p className={styles.summaryText}>
                Based on {reviewCount} verified renter {reviewCount === 1 ? "review" : "reviews"}
              </p>
            </div>
          </div>

          <div className={styles.toolbar}>
            <div className={styles.filters} role="group" aria-label="Filter reviews">
              {filters.map((item) => (
                <Button
                  key={item.id}
                  variant="none"
                  type="button"
                  aria-pressed={filter === item.id}
                  className={`${styles.filter} ${filter === item.id ? styles.filterActive : ""}`}
                  onClick={() => setFilter(item.id)}
                >
                  {item.label}
                  <span className={styles.filterCount}>{item.count}</span>
                </Button>
              ))}
            </div>

            <label className={styles.sort}>
              <span className={styles.sortLabel}>Sort by</span>
              <select
                className={styles.sortSelect}
                value={sort}
                onChange={(event) => setSort(event.target.value as SortId)}
              >
                {SORT_OPTIONS.map((option) => (
                  <option key={option.id} value={option.id}>{option.label}</option>
                ))}
              </select>
            </label>
          </div>

          {visibleReviews.length > 0 ? (
            <ul className={styles.list}>
              {visibleReviews.map((review) => {
                const verified = isVerified(review);
                const showName = !(verified && review.author.trim().toLowerCase() === GENERIC_AUTHOR);
                return (
                  <li key={review.id} className={styles.row}>
                    <span className={styles.avatar} aria-hidden="true">{getInitials(review.author)}</span>
                    <div className={styles.rowBody}>
                      <div className={styles.rowHead}>
                        {showName ? <span className={styles.author}>{review.author}</span> : null}
                        {verified ? <VerifiedBadge /> : null}
                      </div>
                      <div className={styles.rowMeta}>
                        <Stars value={review.rating} />
                        <time className={styles.date} dateTime={review.date}>
                          {new Date(review.date).toLocaleDateString("en-PH", { year: "numeric", month: "short", day: "numeric" })}
                        </time>
                      </div>
                      <p className={styles.comment}>{review.comment || "Rating submitted without a written comment."}</p>
                    </div>
                  </li>
                );
              })}
            </ul>
          ) : (
            <p className={styles.noMatches}>No reviews match this filter.</p>
          )}
        </>
      ) : (
        <div className={styles.empty}>
          <strong>No customer reviews yet</strong>
          <p>Verified renters can leave a rating after their rental is returned.</p>
        </div>
      )}
    </section>
  );
}
