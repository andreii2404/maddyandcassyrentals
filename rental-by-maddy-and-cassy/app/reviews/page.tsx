import type { Metadata } from "next";
import Link from "next/link";
import type { StorefrontReview } from "@/components/storefront/ReviewCarousel";
import { getActiveProducts } from "@/src/services/productService";
import styles from "./reviews.module.css";

export const revalidate = 60;

export const metadata: Metadata = {
  title: "Customer Reviews | Rental by Maddy & Cassy",
  description: "Read verified reviews and stories from customers who rented with Maddy & Cassy.",
};

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

function renderStars(rating: number): string {
  const filled = Math.min(5, Math.max(0, Math.round(rating)));
  return `${"★".repeat(filled)}${"☆".repeat(5 - filled)}`;
}

export default async function ReviewsPage() {
  const products = await getActiveProducts();
  // Same source as the home page's Customer Stories carousel: approved reviews
  // from completed rentals, newest first.
  const reviews: StorefrontReview[] = products
    .flatMap((product) => product.reviews.map((review) => ({
      ...review,
      productName: product.name,
      productHref: `/catalog/${product.slug || product.id}`,
    })))
    .sort((left, right) => Date.parse(right.date) - Date.parse(left.date));

  const averageRating = reviews.length
    ? reviews.reduce((total, review) => total + review.rating, 0) / reviews.length
    : 0;

  return (
    <main className={styles.main}>
      <header className={styles.header}>
        <p className={styles.eyebrow}>CUSTOMER STORIES &amp; REVIEWS</p>
        <h1>Reviews</h1>
        <p className={styles.introduction}>
          Every review below comes from a customer who completed a verified rental with
          Maddy &amp; Cassy.
        </p>

        {reviews.length ? (
          <div
            className={styles.summary}
            aria-label={`${averageRating.toFixed(1)} out of 5 from ${reviews.length} verified ${reviews.length === 1 ? "review" : "reviews"}`}
          >
            <strong>{averageRating.toFixed(1)}</strong>
            <span className={styles.summaryStars} aria-hidden="true">{renderStars(averageRating)}</span>
            <small>
              {reviews.length} verified {reviews.length === 1 ? "review" : "reviews"}
            </small>
          </div>
        ) : null}
      </header>

      {reviews.length ? (
        <ul className={styles.grid} aria-label="Verified rental reviews">
          {reviews.map((review) => (
            <li key={review.id}>
              <article className={styles.card}>
                <div className={styles.cardTopline}>
                  <span className={styles.stars} aria-label={`${review.rating} out of 5 stars`}>
                    <span aria-hidden="true">{renderStars(review.rating)}</span>
                  </span>
                  <span className={styles.verified}>✓ Verified rental</span>
                </div>
                <blockquote>
                  “{review.comment.trim() || `A ${review.rating}-star rental experience.`}”
                </blockquote>
                <footer>
                  <div className={styles.reviewerInfo}>
                    <span className={styles.avatar} aria-hidden="true">{getInitials(review.author)}</span>
                    <div>
                      <strong>{review.author}</strong>
                      <small>{formatReviewDate(review.date)}</small>
                    </div>
                  </div>
                  <Link href={review.productHref}>{review.productName}</Link>
                </footer>
              </article>
            </li>
          ))}
        </ul>
      ) : (
        <div className={styles.empty}>
          <p>No verified reviews yet. Reviews appear here once customers complete their rentals.</p>
          <Link href="/catalog">Browse the catalog</Link>
        </div>
      )}
    </main>
  );
}
