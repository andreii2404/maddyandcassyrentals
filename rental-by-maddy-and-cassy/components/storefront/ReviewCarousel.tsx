"use client";

import Link from "next/link";
import { useCallback, useEffect, useRef, useState } from "react";
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
  const [canScrollPrevious, setCanScrollPrevious] = useState(false);
  const [canScrollNext, setCanScrollNext] = useState(false);

  const updateScrollState = useCallback(() => {
    const track = trackRef.current;
    if (!track) return;
    const maximumScroll = Math.max(0, track.scrollWidth - track.clientWidth);
    setCanScrollPrevious(track.scrollLeft > 2);
    setCanScrollNext(track.scrollLeft < maximumScroll - 2);
  }, []);

  useEffect(() => {
    const track = trackRef.current;
    if (!track) return;
    const resizeObserver = new ResizeObserver(updateScrollState);
    resizeObserver.observe(track);
    updateScrollState();
    return () => resizeObserver.disconnect();
  }, [reviews.length, updateScrollState]);

  if (!reviews.length) return null;

  const averageRating = reviews.reduce((total, review) => total + review.rating, 0) / reviews.length;
  const roundedAverage = Math.round(averageRating);

  function move(direction: -1 | 1) {
    const track = trackRef.current;
    const firstCard = track?.children.item(0) as HTMLElement | null;
    if (!track || !firstCard) return;
    const gap = Number.parseFloat(window.getComputedStyle(track).columnGap) || 0;
    track.scrollBy({ left: direction * (firstCard.offsetWidth + gap), behavior: "smooth" });
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
    updateScrollState();
  }

  return (
    <section className={styles.reviews} aria-labelledby="customer-reviews-heading">
      <div className={styles.header}>
        <div>
          <p className={styles.eyebrow}>CUSTOMER STORIES</p>
          <h2 id="customer-reviews-heading">Real moments, shared by our renters.</h2>
          <p className={styles.description}>
            Read feedback from customers who completed a verified rental with Maddy &amp; Cassy.
          </p>
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
          className={`${styles.track} ${reviews.length === 1 ? styles.singleTrack : reviews.length === 2 ? styles.twoTrack : ""}`}
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

        {canScrollPrevious || canScrollNext ? (
          <div className={styles.controls}>
            <span aria-live="polite">{activeIndex + 1} / {reviews.length}</span>
            <div>
              <button
                type="button"
                onClick={() => move(-1)}
                disabled={!canScrollPrevious}
                aria-label="Previous review"
              >
                <ArrowIcon direction="left" />
              </button>
              <button
                type="button"
                onClick={() => move(1)}
                disabled={!canScrollNext}
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
