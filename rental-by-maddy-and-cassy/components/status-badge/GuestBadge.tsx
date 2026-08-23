import styles from "./StatusBadge.module.css";

/** Marks a booking/customer row as a guest checkout, alongside their real name and contact details. */
export default function GuestBadge() {
  return <span className={`${styles.badge} ${styles.neutral}`}>Guest</span>;
}
