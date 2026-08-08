"use client";

import { useRouter } from "next/navigation";
import Link from "next/link";
import type { Product } from "@/types/product";
import type { UnitCounts } from "@/lib/availability";
import { useCart } from "@/hooks/useCart";
import { useToast } from "@/components/ui/ToastProvider";
import styles from "./ReserveAction.module.css";

interface ReserveActionProps {
  product: Product;
  units: UnitCounts;
}

export default function ReserveAction({ product, units }: ReserveActionProps) {
  const router = useRouter();
  const { addItem } = useCart();
  const { showToast } = useToast();
  const unavailable = units.totalUnits <= 0;

  function handleReserve() {
    const reservePath = `/catalog/${product.id}/reserve`;
    router.push(reservePath);
  }

  return (
    <div id="reserve" className={styles.wrapper}>
      <div className={styles.actions}>
        <button
          type="button"
          className={styles.reserveButton}
          disabled={unavailable}
          onClick={handleReserve}
        >
          {unavailable ? "Unavailable" : "Reserve Now"}
        </button>
        <button
          type="button"
          className={styles.cartButton}
          disabled={unavailable}
          onClick={() => {
            addItem(product.id);
            showToast(`${product.name} added to your rental cart.`, "success");
          }}
        >
          Add to Cart
        </button>
      </div>
      <Link href="/cart" className={styles.cartLink}>View rental cart</Link>

      {unavailable ? (
        <p className={styles.error} role="status">
          This item does not currently have an active rental unit.
        </p>
      ) : (
        <p className={styles.hint}>
          You&apos;ll choose your dates, provide your details, and sign a rental agreement
          before your request is submitted for review.
        </p>
      )}
    </div>
  );
}
