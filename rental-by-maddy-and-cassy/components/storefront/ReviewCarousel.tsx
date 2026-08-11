"use client";

import Link from "next/link";
import { useRef, useState } from "react";
import styles from "./ReviewCarousel.module.css";

export interface StorefrontReview {
  id: string;
  author: string;
  rating: number;
  comment: string;
  date: string;
  productName: string;
  productHref: string;
}

interface ReviewCarouselProps {
  reviews: StorefrontReview[];
}

function formatReviewDate(value: string): string {
  return new Date(value).toLocaleDateString("en-PH", {
    year: "numeric",
    month: "short",
    day: "numeric",
  });
}

function ArrowIcon({ direction }: { direction: "left" | "right" }) {
  return (
    <svg viewBox="0 0 20 20" aria-hidden="true">
      <path d={direction === "left" ? "M12.5 4.5 7 10l5.5 5.5" : "m7.5 4.5 5.5 5.5-5.5 5.5"} />
    </svg>
  );
}

export default function ReviewCarousel({ reviews }: ReviewCarouselProps) {
  const trackRef = useRef<HTMLDivElement>(null);
  const [activeIndex, setActiveIndex] = useState(0);

  if (!reviews.length) return null;

  const averageRating = reviews.reduce((total, review) => total + review.rating, 0) / reviews.length;
  const roundedAverage = Math.round(averageRating);

  function move(direction: -1 | 1) {
    const track = trackRef.current;
    if (!track) return;
    const nextIndex = Math.min(Math.max(activeIndex + direction, 0), reviews.length - 1);
    const card = track.children.item(nextIndex) as HTMLElement | null;
    if (card) {
      track.scrollTo({ left: card.offsetLeft - track.offsetLeft, behavior: "smooth" });
    }
    setActiveIndex(nextIndex);
  }

  function syncActiveReview() {
    const track = trackRef.current;
    if (!track?.children.length) return;
    const cards = Array.from(track.children) as HTMLElement[];
    const closestIndex = cards.reduce((bestIndex, card, index) => {
      const best = cards[bestIndex];
      return Math.abs(card.offsetLeft - track.scrollLeft) < Math.abs(best.offsetLeft - track.scrollLeft)
        ? index
        : bestIndex;
    }, 0);
    setActiveIndex(closestIndex);
  }

  return (
    <section className={styles.reviews} aria-labelledby="customer-reviews-heading">
      <div className={styles.header}>
        <div>
          <p className={styles.eyebrow}>CUSTOMER STORIES</p>
          <h3 id="customer-reviews-heading">Loved by verified renters</h3>
        </div>
        <div className={styles.ratingSummary} aria-label={`${averageRating.toFixed(1)} out of 5 from ${reviews.length} approved ${reviews.length === 1 ? "review" : "reviews"}`}>
          <strong>{averageRating.toFixed(1)}</strong>
          <span aria-hidden="true">{"★".repeat(roundedAverage)}{"☆".repeat(5 - roundedAverage)}</span>
          <small>{reviews.length} approved {reviews.length === 1 ? "review" : "reviews"}</small>
        </div>
      </div>

      <div className={styles.carouselShell}>
        <div
          ref={trackRef}
          className={styles.track}
          onScroll={syncActiveReview}
          aria-label="Approved customer reviews"
          tabIndex={0}
        >
          {reviews.map((review) => (
            <article key={review.id} className={styles.reviewCard}>
              <div className={styles.cardTopline}>
                <span className={styles.stars} aria-label={`${review.rating} out of 5 stars`}>
                  <span aria-hidden="true">{"★".repeat(review.rating)}{"☆".repeat(5 - review.rating)}</span>
                </span>
                <span className={styles.verified}>✓ Verified rental</span>
              </div>
              <blockquote>
                “{review.comment.trim() || `A ${review.rating}-star rental experience.`}”
              </blockquote>
              <footer>
                <div>
                  <strong>{review.author}</strong>
                  <small>{formatReviewDate(review.date)}</small>
                </div>
                <Link href={review.productHref}>{review.productName}</Link>
              </footer>
            </article>
          ))}
        </div>

        {reviews.length > 1 ? (
          <div className={styles.controls}>
            <span aria-live="polite">{activeIndex + 1} / {reviews.length}</span>
            <div>
              <button
                type="button"
                onClick={() => move(-1)}
                disabled={activeIndex === 0}
                aria-label="Previous review"
              >
                <ArrowIcon direction="left" />
              </button>
              <button
                type="button"
                onClick={() => move(1)}
                disabled={activeIndex === reviews.length - 1}
                aria-label="Next review"
              >
                <ArrowIcon direction="right" />
              </button>
            </div>
          </div>
        ) : null}
      </div>
    </section>
  );
}
