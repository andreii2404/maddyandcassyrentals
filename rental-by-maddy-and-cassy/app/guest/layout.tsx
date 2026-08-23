import styles from "@/app/account/account.module.css";

export default function GuestLayout({ children }: { children: React.ReactNode }) {
  return <main className={styles.main}>{children}</main>;
}
