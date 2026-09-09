"use client";

import Link from "next/link";
import { useCallback, useEffect, useMemo, useState } from "react";
import Spinner from "@/components/ui/Spinner";
import { useToast } from "@/components/ui/ToastProvider";
import { moderateProductReviewAsAdmin } from "@/src/services/productService";
import {
  getAdminReviews,
  type AdminReviewRecord,
  type AdminReviewsData,
} from "@/src/services/operationsService";
import styles from "./reviews.module.css";

type ReviewStatusFilter = "all" | "pending" | "approved" | "rejected";
type ReviewSort = "newest" | "oldest" | "highest" | "lowest";

const PAGE_SIZE = 12;

function formatDate(value: string): string {
  return new Date(value).toLocaleDateString("en-PH", {
    year: "numeric",
    month: "short",
    day: "numeric",
  });
}

function statusLabel(status: AdminReviewRecord["status"]): string {
  if (status === "approved") return "Published";
  if (status === "rejected") return "Hidden";
  return "Needs Review";
}

const RENTAL_STATUS_LABELS: Record<string, string> = {
  draft: "Draft",
  pending: "Pending Review",
  approved: "Approved",
  confirmed: "Confirmed",
  ready_for_release: "Ready for Handover",
  released: "Released",
  returned: "Returned / Completed",
  cancelled: "Cancelled",
  rejected: "Declined",
};

function rentalStatusLabel(status: string): string {
  return RENTAL_STATUS_LABELS[status] ?? status.replaceAll("_", " ");
}

export default function AdminReviewsManager() {
  const { showToast } = useToast();
  const [data, setData] = useState<AdminReviewsData | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [search, setSearch] = useState("");
  const [status, setStatus] = useState<ReviewStatusFilter>("all");
  const [rating, setRating] = useState("all");
  const [sort, setSort] = useState<ReviewSort>("newest");
  const [page, setPage] = useState(1);
  const [refreshing, setRefreshing] = useState(false);
  const [activeReviewId, setActiveReviewId] = useState<string | null>(null);

  const load = useCallback(async (silent = false) => {
    if (!silent) setRefreshing(true);
    try {
      const result = await getAdminReviews();
      setData(result);
      setError(null);
    } catch (loadError) {
      setError(
        loadError instanceof Error
          ? loadError.message
          : "Customer feedback could not be loaded.",
      );
    } finally {
      if (!silent) setRefreshing(false);
    }
  }, []);

  useEffect(() => {
    const initialLoadId = window.setTimeout(() => void load(), 0);
    const intervalId = window.setInterval(() => void load(true), 20_000);
    return () => {
      window.clearTimeout(initialLoadId);
      window.clearInterval(intervalId);
    };
  }, [load]);

  const summary = useMemo(() => {
    const reviews = data?.reviews ?? [];
    const approved = reviews.filter((review) => review.status === "approved");
    return {
      total: reviews.length,
      pending: reviews.filter((review) => review.status === "pending").length,
      published: approved.length,
      hidden: reviews.filter((review) => review.status === "rejected").length,
      average: approved.length
        ? approved.reduce((total, review) => total + review.rating, 0) / approved.length
        : 0,
    };
  }, [data]);

  const filteredReviews = useMemo(() => {
    const query = search.trim().toLowerCase();
    const reviews = (data?.reviews ?? []).filter((review) => {
      const matchesStatus = status === "all" || review.status === status;
      const matchesRating = rating === "all" || review.rating === Number(rating);
      const matchesSearch = !query || [
        review.customerName,
        review.customerEmail ?? "",
        review.bookingRef,
        review.productName,
        review.comment ?? "",
      ].join(" ").toLowerCase().includes(query);
      return matchesStatus && matchesRating && matchesSearch;
    });

    return reviews.sort((left, right) => {
      if (sort === "oldest") return Date.parse(left.createdAt) - Date.parse(right.createdAt);
      if (sort === "highest") return right.rating - left.rating || Date.parse(right.createdAt) - Date.parse(left.createdAt);
      if (sort === "lowest") return left.rating - right.rating || Date.parse(right.createdAt) - Date.parse(left.createdAt);
      return Date.parse(right.createdAt) - Date.parse(left.createdAt);
    });
  }, [data, rating, search, sort, status]);

  const pageCount = Math.max(1, Math.ceil(filteredReviews.length / PAGE_SIZE));
  const currentPage = Math.min(page, pageCount);
  const visibleReviews = filteredReviews.slice(
    (currentPage - 1) * PAGE_SIZE,
    currentPage * PAGE_SIZE,
  );

  function changeSearch(value: string) {
    setSearch(value);
    setPage(1);
  }

  function changeStatus(value: ReviewStatusFilter) {
    setStatus(value);
    setPage(1);
  }

  async function moderateReview(
    review: AdminReviewRecord,
    nextStatus: "approved" | "rejected",
  ) {
    if (activeReviewId) return;
    const previousStatus = review.status;
    const now = new Date().toISOString();
    setActiveReviewId(review.id);
    setData((current) => current ? {
      reviews: current.reviews.map((item) => item.id === review.id
        ? { ...item, status: nextStatus, moderatedAt: now }
        : item),
    } : current);

    try {
      await moderateProductReviewAsAdmin(review.id, nextStatus);
      showToast(
        nextStatus === "approved"
          ? "Review published on the product page."
          : "Review hidden from the public storefront.",
        "success",
      );
      await load(true);
    } catch (moderationError) {
      setData((current) => current ? {
        reviews: current.reviews.map((item) => item.id === review.id
          ? { ...item, status: previousStatus }
          : item),
      } : current);
      showToast(
        moderationError instanceof Error
          ? moderationError.message
          : "The review decision could not be saved.",
        "error",
      );
    } finally {
      setActiveReviewId(null);
    }
  }

  return (
    <div className={styles.page}>
      <header className={styles.header}>
        <div>
          <p>CUSTOMER EXPERIENCE</p>
          <h1>Feedback &amp; Reviews</h1>
          <span>Review verified renter feedback and control what appears publicly.</span>
        </div>
        <button type="button" onClick={() => void load()} disabled={refreshing}>
          {refreshing ? "Refreshing…" : "Refresh feedback"}
        </button>
      </header>

      <section className={styles.metrics} aria-label="Review summary">
        <article className={styles.priorityMetric}>
          <span>Needs Review</span>
          <strong>{summary.pending}</strong>
          <small>Waiting for your decision</small>
        </article>
        <article>
          <span>Published</span>
          <strong>{summary.published}</strong>
          <small>Visible on product pages</small>
        </article>
        <article>
          <span>Average Rating</span>
          <strong>{summary.average ? `${summary.average.toFixed(1)} / 5` : "—"}</strong>
          <small>Across published reviews</small>
        </article>
        <article>
          <span>Total Reviews</span>
          <strong>{summary.total}</strong>
          <small>{summary.hidden} currently hidden</small>
        </article>
      </section>

      <section className={styles.workspace} aria-labelledby="review-queue-heading">
        <div className={styles.workspaceHeader}>
          <div>
            <p>MANAGE REVIEWS</p>
            <h2 id="review-queue-heading">Customer review queue</h2>
            <span>Reviews stay private until you publish them.</span>
          </div>
          <div className={styles.statusTabs} aria-label="Filter by review status">
            {([
              ["all", "All", summary.total],
              ["pending", "Needs Review", summary.pending],
              ["approved", "Published", summary.published],
              ["rejected", "Hidden", summary.hidden],
            ] as const).map(([value, label, count]) => (
              <button
                key={value}
                type="button"
                className={status === value ? styles.activeTab : ""}
                onClick={() => changeStatus(value)}
                aria-pressed={status === value}
              >
                {label}<span>{count}</span>
              </button>
            ))}
          </div>
        </div>

        <div className={styles.toolbar}>
          <label className={styles.searchField}>
            <span>Search</span>
            <input
              type="search"
              value={search}
              onChange={(event) => changeSearch(event.target.value)}
              placeholder="Customer, booking, product, or review"
            />
          </label>
          <label>
            <span>Rating</span>
            <select value={rating} onChange={(event) => { setRating(event.target.value); setPage(1); }}>
              <option value="all">All ratings</option>
              {[5, 4, 3, 2, 1].map((value) => <option key={value} value={value}>{value} stars</option>)}
            </select>
          </label>
          <label>
            <span>Sort</span>
            <select value={sort} onChange={(event) => { setSort(event.target.value as ReviewSort); setPage(1); }}>
              <option value="newest">Newest first</option>
              <option value="oldest">Oldest first</option>
              <option value="highest">Highest rating</option>
              <option value="lowest">Lowest rating</option>
            </select>
          </label>
        </div>

        {error ? (
          <div className={styles.error} role="alert">
            <div><strong>Feedback could not be loaded</strong><span>{error}</span></div>
            <button type="button" onClick={() => void load()}>Try again</button>
          </div>
        ) : null}

        {!data && !error ? (
          <div className={styles.loading}><Spinner size={30} label="Loading customer feedback" /></div>
        ) : null}

        {data && filteredReviews.length === 0 ? (
          <div className={styles.empty}>
            <strong>No reviews match these filters</strong>
            <p>Adjust the search, rating, or moderation status to see more feedback.</p>
          </div>
        ) : null}

        {visibleReviews.length > 0 ? (
          <div className={styles.reviewList}>
            {visibleReviews.map((review) => {
              const isSaving = activeReviewId === review.id;
              return (
                <article key={review.id} className={styles.reviewCard} data-status={review.status}>
                  <div className={styles.cardHeader}>
                    <span className={styles.avatar} aria-hidden="true">
                      {review.customerName.charAt(0).toUpperCase() || "C"}
                    </span>
                    <div className={styles.identity}>
                      <strong title={review.customerName}>{review.customerName}</strong>
                      <span className={styles.ratingLine}>
                        <span className={styles.stars} aria-label={`${review.rating} out of 5 stars`}>
                          {"★".repeat(review.rating)}<i>{"★".repeat(5 - review.rating)}</i>
                        </span>
                        <span className={styles.ratingValue}>{review.rating}.0</span>
                      </span>
                    </div>
                    <span className={styles.statusPill} data-status={review.status}>
                      {statusLabel(review.status)}
                    </span>
                  </div>

                  <div className={styles.reviewBody}>
                    <span className={styles.metaCaption}>Review</span>
                    <blockquote className={styles.reviewText}>
                      {review.comment || "This customer left a rating without a written review."}
                    </blockquote>
                  </div>

                  <dl className={styles.reviewMeta}>
                    <div>
                      <dt>Product</dt>
                      <dd title={review.productName}>{review.productName}</dd>
                    </div>
                    <div>
                      <dt>Booking</dt>
                      <dd title={review.bookingRef}>{review.bookingRef}</dd>
                    </div>
                    <div>
                      <dt>Rental Status</dt>
                      <dd>{rentalStatusLabel(review.bookingStatus)}</dd>
                    </div>
                    <div>
                      <dt>Submitted</dt>
                      <dd>
                        <time dateTime={review.createdAt}>{formatDate(review.createdAt)}</time>
                      </dd>
                    </div>
                  </dl>

                  <div className={styles.cardActions}>
                    {review.bookingId ? (
                      <Link className={styles.viewButton} href={`/admin/bookings/${review.bookingId}`}>
                        View Booking
                      </Link>
                    ) : null}
                    {review.status !== "rejected" ? (
                      <button
                        type="button"
                        className={styles.hideButton}
                        disabled={Boolean(activeReviewId)}
                        onClick={() => void moderateReview(review, "rejected")}
                      >
                        {isSaving ? "Saving…" : "Hide Review"}
                      </button>
                    ) : null}
                    {review.status !== "approved" ? (
                      <button
                        type="button"
                        className={styles.publishButton}
                        disabled={Boolean(activeReviewId)}
                        onClick={() => void moderateReview(review, "approved")}
                      >
                        {isSaving
                          ? "Saving…"
                          : review.status === "pending"
                            ? "Approve & Publish"
                            : "Publish Review"}
                      </button>
                    ) : null}
                  </div>
                </article>
              );
            })}
          </div>
        ) : null}

        {filteredReviews.length > PAGE_SIZE ? (
          <footer className={styles.pagination}>
            <span>
              Showing {(currentPage - 1) * PAGE_SIZE + 1}–{Math.min(currentPage * PAGE_SIZE, filteredReviews.length)} of {filteredReviews.length}
            </span>
            <div>
              <button type="button" disabled={currentPage === 1} onClick={() => setPage(currentPage - 1)}>Previous</button>
              <strong>Page {currentPage} of {pageCount}</strong>
              <button type="button" disabled={currentPage === pageCount} onClick={() => setPage(currentPage + 1)}>Next</button>
            </div>
          </footer>
        ) : null}
      </section>
    </div>
  );
}
