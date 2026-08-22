import type { ActivityCategory } from "@/src/lib/auditLogLabels";
import { formatActivityCategory } from "@/src/lib/auditLogLabels";
import styles from "./ActivityBadge.module.css";

function CategoryIcon({ category }: { category: ActivityCategory }) {
  switch (category) {
    case "booking":
      return (
        <svg viewBox="0 0 16 16" width="13" height="13" fill="none" aria-hidden="true">
          <rect x="2" y="3" width="12" height="11" rx="1.5" stroke="currentColor" strokeWidth="1.3" />
          <path d="M2 6.5h12M5 1.5v3M11 1.5v3" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round" />
        </svg>
      );
    case "payment":
      return (
        <svg viewBox="0 0 16 16" width="13" height="13" fill="none" aria-hidden="true">
          <rect x="1.5" y="3.5" width="13" height="9" rx="1.5" stroke="currentColor" strokeWidth="1.3" />
          <path d="M1.5 6.5h13" stroke="currentColor" strokeWidth="1.3" />
          <path d="M4 9.5h3" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round" />
        </svg>
      );
    case "documents":
      return (
        <svg viewBox="0 0 16 16" width="13" height="13" fill="none" aria-hidden="true">
          <path d="M4 1.5h5.5L12.5 4.5V14.5H4z" stroke="currentColor" strokeWidth="1.3" strokeLinejoin="round" />
          <path d="M9.5 1.5V4.5H12.5" stroke="currentColor" strokeWidth="1.3" strokeLinejoin="round" />
          <path d="M6 8h4M6 10.5h4" stroke="currentColor" strokeWidth="1.2" strokeLinecap="round" />
        </svg>
      );
    case "account":
      return (
        <svg viewBox="0 0 16 16" width="13" height="13" fill="none" aria-hidden="true">
          <circle cx="8" cy="5" r="2.6" stroke="currentColor" strokeWidth="1.3" />
          <path d="M2.8 14c.6-2.8 2.7-4.2 5.2-4.2s4.6 1.4 5.2 4.2" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round" />
        </svg>
      );
    case "catalog":
      return (
        <svg viewBox="0 0 16 16" width="13" height="13" fill="none" aria-hidden="true">
          <path d="M1.8 5 8 2l6.2 3v6L8 14 1.8 11z" stroke="currentColor" strokeWidth="1.3" strokeLinejoin="round" />
          <path d="M1.8 5 8 8l6.2-3M8 8v6" stroke="currentColor" strokeWidth="1.3" strokeLinejoin="round" />
        </svg>
      );
    case "admin":
      return (
        <svg viewBox="0 0 16 16" width="13" height="13" fill="none" aria-hidden="true">
          <path d="M8 1.5 13.5 3.5V7.5C13.5 11 11.2 13.4 8 14.5 4.8 13.4 2.5 11 2.5 7.5V3.5Z" stroke="currentColor" strokeWidth="1.3" strokeLinejoin="round" />
          <path d="M5.8 8 7.3 9.5 10.3 6.3" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round" strokeLinejoin="round" />
        </svg>
      );
    default:
      return (
        <svg viewBox="0 0 16 16" width="13" height="13" fill="none" aria-hidden="true">
          <circle cx="8" cy="8" r="5.5" stroke="currentColor" strokeWidth="1.3" />
        </svg>
      );
  }
}

export default function ActivityBadge({ category }: { category: ActivityCategory }) {
  return (
    <span className={styles.badge} data-category={category}>
      <CategoryIcon category={category} />
      {formatActivityCategory(category)}
    </span>
  );
}
