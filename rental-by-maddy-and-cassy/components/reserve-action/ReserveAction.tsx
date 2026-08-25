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
  /** Color variant currently selected on the product page, when one applies. */
  selectedColor?: string | null;
  /** True while a multi-color product still needs an explicit color choice. */
  awaitingColor?: boolean;
}

export default function ReserveAction({ product, units, selectedColor, awaitingColor = false }: ReserveActionProps) {
  const router = useRouter();
  const { addItem } = useCart();
  const { showToast } = useToast();
  const unavailable = units.totalUnits <= 0;
  const locked = unavailable || awaitingColor;
  const color = selectedColor?.trim() || undefined;

  function handleReserve() {
    if (locked) return;
    const colorParam = color ? `?color=${encodeURIComponent(color)}` : "";
    router.push(`/catalog/${product.id}/reserve${colorParam}`);
  }

  return (
    <div id="reserve" className={styles.wrapper}>
      <div className={styles.actions}>
        <button
          type="button"
          className={styles.reserveButton}
          disabled={locked}
          onClick={handleReserve}
        >
          {unavailable ? "Unavailable" : "Reserve Now"}
        </button>
        <button
          type="button"
          className={styles.cartButton}
          disabled={locked}
          onClick={() => {
            addItem(product.id, 1, color);
            showToast(
              `${product.name}${color ? ` (${color})` : ""} added to your rental cart.`,
              "success",
            );
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
      ) : awaitingColor ? (
        <p className={styles.hint} role="status">
          Choose a color above — Reserve Now and Add to Cart unlock once a color is selected.
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
