"use client";

import { useRef, useState } from "react";
import { submitReview } from "@/src/services/reviewService";
import { useToast } from "@/components/ui/ToastProvider";
import styles from "./CustomerReviewPanel.module.css";

interface ExistingReview {
  id: string;
  rating: number;
  comment: string | null;
  status: "pending" | "approved" | "rejected";
}

interface CustomerReviewPanelProps {
  bookingId: string;
  productId: string;
  productName: string;
  existingReview: ExistingReview | null;
  onSubmitted: () => Promise<void>;
}

export default function CustomerReviewPanel({
  bookingId,
  productId,
  productName,
  existingReview,
  onSubmitted,
}: CustomerReviewPanelProps) {
  const { showToast } = useToast();
  const [rating, setRating] = useState(5);
  const [comment, setComment] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const submitLock = useRef(false);

  if (existingReview) {
    return (
      <div className={styles.existing}>
        <div className={styles.thankYouMessage}>
          <span aria-hidden="true">&#10003;</span>
          <div>
            <strong>Thank you for your review!</strong>
            <p>We&apos;ve received your feedback and appreciate you sharing your Maddy &amp; Cassy rental experience.</p>
          </div>
        </div>
        <div><strong>{"★".repeat(existingReview.rating)}{"☆".repeat(5 - existingReview.rating)}</strong><span>{existingReview.status.replace("_", " ")}</span></div>
        <p>{existingReview.comment || "Rating submitted without a written comment."}</p>
        {existingReview.status === "pending" ? <small>Your review will appear publicly after approval.</small> : null}
        {existingReview.status === "rejected" ? <small>This review was not approved for public display.</small> : null}
      </div>
    );
  }

  async function handleSubmit() {
    if (submitLock.current) return;
    submitLock.current = true;
    setSubmitting(true);
    try {
      const result = await submitReview({ bookingId, productId, rating, comment: comment.trim() || undefined });
      showToast(
        result.alreadySubmitted
          ? "Your review was already received. Thank you for sharing your experience with Maddy & Cassy!"
          : "Thank you! Your review was sent to Maddy & Cassy for approval.",
        "success",
      );
      await onSubmitted();
    } catch (error) {
      showToast(error instanceof Error ? error.message : "The review could not be submitted.", "error");
    } finally {
      submitLock.current = false;
      setSubmitting(false);
    }
  }

  return (
    <div className={styles.form}>
      <p>How was your rental experience with {productName}?</p>
      <fieldset disabled={submitting}>
        <legend>Rating</legend>
        <div className={styles.stars}>
          {[1, 2, 3, 4, 5].map((value) => (
            <button key={value} type="button" onClick={() => setRating(value)} aria-label={`${value} star rating`} aria-pressed={rating === value}>{value <= rating ? "★" : "☆"}</button>
          ))}
        </div>
      </fieldset>
      <label><span>Review (optional)</span><textarea rows={4} maxLength={1000} value={comment} onChange={(event) => setComment(event.target.value)} placeholder="Share helpful details about the item and rental experience." /></label>
      <button type="button" onClick={() => void handleSubmit()} disabled={submitting}>{submitting ? "Submitting..." : "Submit Review"}</button>
    </div>
  );
}
