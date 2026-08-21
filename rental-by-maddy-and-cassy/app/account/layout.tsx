import RequireCustomer from "@/components/route-guards/RequireCustomer";
import styles from "./account.module.css";

export default function AccountLayout({ children }: { children: React.ReactNode }) {
  return (
    <div>
      <RequireCustomer>
        <main className={styles.main}>{children}</main>
      </RequireCustomer>
    </div>
  );
}
