import Spinner from "@/components/ui/Spinner";
import styles from "./routeState.module.css";

export default function Loading() {
  return <main className={styles.state} aria-busy="true"><Spinner size={28} label="Loading page" /><p>Loading your page…</p></main>;
}
