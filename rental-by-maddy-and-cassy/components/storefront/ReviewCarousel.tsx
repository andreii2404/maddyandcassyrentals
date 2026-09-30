"use client";

import Link from "next/link";
import { useState } from "react";
import Reveal from "@/components/ui/Reveal";
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

function getInitials(name: string): string {
  const parts = name.trim().split(/\s+/).filter(Boolean);
  if (parts.length === 0) return "";
  if (parts.length === 1) return parts[0].slice(0, 2).toUpperCase();
  return (parts[0][0] + parts[parts.length - 1][0]).toUpperCase();
}

export default function ReviewCarousel({ reviews }: ReviewCarouselProps) {
  const [activeIndex, setActiveIndex] = useState(0);

  if (!reviews.length) return null;

  const averageRating = reviews.reduce((total, review) => total + review.rating, 0) / reviews.length;
  const roundedAverage = Math.round(averageRating);
  const activeReview = reviews[Math.min(activeIndex, reviews.length - 1)];

  return (
    <Reveal>
    <div className={styles.block}>
    <p className={styles.sectionTitle}>CUSTOMER STORIES &amp; REVIEWS</p>
    <section className={styles.reviews} aria-labelledby="customer-reviews-heading">
      <div className={styles.layout}>
        <div className={styles.info}>
          <p className={styles.eyebrow}>CUSTOMER STORIES</p>
          <h2 id="customer-reviews-heading">Real moments, shared by our renters.</h2>
          <p className={styles.description}>
            Read feedback from customers who completed a verified rental with Maddy &amp; Cassy.
          </p>

          <div className={styles.ratingSummary} aria-label={`${averageRating.toFixed(1)} out of 5 from ${reviews.length} approved ${reviews.length === 1 ? "review" : "reviews"}`}>
            <strong>{averageRating.toFixed(1)}</strong>
            <span aria-hidden="true">{"★".repeat(roundedAverage)}{"☆".repeat(5 - roundedAverage)}</span>
          </div>

          {reviews.length > 1 ? (
            <div className={styles.dots} aria-label="Choose a review to display">
              {reviews.map((review, index) => (
                <button
                  key={review.id}
                  type="button"
                  className={styles.dot}
                  aria-current={index === activeIndex ? "true" : undefined}
                  aria-label={`Show review from ${review.author}`}
                  onClick={() => setActiveIndex(index)}
                />
              ))}
            </div>
          ) : null}
        </div>

        <div className={styles.cardShell}>
          <article key={activeReview.id} className={styles.reviewCard}>
            <div className={styles.cardTopline}>
              <span className={styles.stars} aria-label={`${activeReview.rating} out of 5 stars`}>
                <span aria-hidden="true">{"★".repeat(activeReview.rating)}{"☆".repeat(5 - activeReview.rating)}</span>
              </span>
              <span className={styles.verified}>✓ Verified rental</span>
            </div>
            <blockquote>
              “{activeReview.comment.trim() || `A ${activeReview.rating}-star rental experience.`}”
            </blockquote>
            <footer>
              <div className={styles.reviewerInfo}>
                <span className={styles.avatar} aria-hidden="true">{getInitials(activeReview.author)}</span>
                <div>
                  <strong>{activeReview.author}</strong>
                  <small>{formatReviewDate(activeReview.date)}</small>
                </div>
              </div>
              <Link href={activeReview.productHref}>{activeReview.productName}</Link>
            </footer>
          </article>
        </div>
      </div>
    </section>
    </div>
    </Reveal>
  );
}
