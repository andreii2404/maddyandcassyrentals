"use client";

import { useEffect, useMemo, useState } from "react";
import Image from "next/image";
import Link from "next/link";
import type { Product } from "@/types/product";
import type { UnitCounts } from "@/lib/availability";
import { useCart } from "@/hooks/useCart";
import { useInventoryMap } from "@/hooks/useInventory";
import { useAuth } from "@/hooks/useAuth";
import CheckoutAccessDialog from "@/components/checkout/CheckoutAccessDialog";
import { Button } from "@/components/ui/Button";
import ConfirmModal from "@/components/ui/ConfirmModal";
import styles from "./cart.module.css";
import { getVariantQuantityLimit } from "@/src/lib/variantInventory";

function money(value: number): string {
  return `PHP ${value.toLocaleString("en-PH", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
}

export default function CartView({ products }: { products: Product[] }) {
  const { items, totalQuantity, updateQuantity, removeItem, clearCart, removeStaleItems } = useCart();
  const { user, loading: authLoading } = useAuth();
  const [accessDialogOpen, setAccessDialogOpen] = useState(false);
  const [subtotalOpen, setSubtotalOpen] = useState(false);
  const [clearConfirmOpen, setClearConfirmOpen] = useState(false);
  // Visitors with no session (not even the anonymous session behind guest
  // checkout) choose between guest checkout and logging in here, before the
  // flow starts. While auth is still resolving we keep the plain link so a
  // signed-in customer is never asked to pick again; /checkout carries the
  // same gate as a fallback for direct visits.
  const needsCheckoutAccess = !authLoading && !user;
  const productsById = useMemo(() => new Map(products.map((product) => [product.id, product])), [products]);
  const defaultsById: Record<string, UnitCounts> = Object.fromEntries(
    products.map((product) => [product.id, {
      totalUnits: product.totalUnits,
      availableUnits: product.availableUnits,
      reservedUnits: product.reservedUnits,
      rentedUnits: product.rentedUnits,
    }]),
  );
  const unitsByProductId = useInventoryMap(defaultsById);
  const cartLines = items.flatMap((item) => {
    const product = productsById.get(item.productId);
    return product ? [{ ...item, product }] : [];
  });

  useEffect(() => {
    removeStaleItems(products.map((product) => product.id));
  }, [products, removeStaleItems]);

  const totals = cartLines.reduce((summary, line) => {
    summary.listSubtotal += line.product.listPricePerDay * line.quantity;
    summary.rentalSubtotal += line.product.pricePerDay * line.quantity;
    summary.deposit += line.product.refundableDeposit * line.quantity;
    return summary;
  }, { listSubtotal: 0, rentalSubtotal: 0, deposit: 0 });
  const discount = Math.max(0, totals.listSubtotal - totals.rentalSubtotal);
  const oneDayEstimate = totals.rentalSubtotal + totals.deposit;

  // Blocks only on total physical inventory that exists, never on today's
  // availableUnits -- availability depends on rental dates the customer
  // hasn't chosen yet (checkout's own availability check handles that).
  const oversubscribedLine = cartLines
    .map((line) => ({
      line,
      limit: line.product.colorOptions.length > 0
        ? getVariantQuantityLimit(line.product, line.color)
        : (unitsByProductId.get(line.product.id) ?? defaultsById[line.product.id]).totalUnits,
    }))
    .find(({ line, limit }) => limit <= 0 || line.quantity > limit);

  return (
    <section className={styles.page} aria-labelledby="cart-heading">
      <header className={styles.header}>
        <div>
          <p className={styles.eyebrow}>RENTAL CART</p>
          <h1 id="cart-heading">Plan your rentals before checkout.</h1>
          <p>Adjust quantities here. Exact dates, fulfillment, payment, documents, and the agreement are completed per rental booking.</p>
        </div>
        {cartLines.length > 0 ? (
          <Button
            variant="none"
            className={styles.clearButton}
            aria-haspopup="dialog"
            aria-expanded={clearConfirmOpen}
            onClick={() => setClearConfirmOpen(true)}
          >
            Clear cart
          </Button>
        ) : null}
      </header>

      {cartLines.length === 0 ? (
        <div className={styles.empty}>
          <span aria-hidden="true">BAG</span>
          <h2>Your rental cart is empty.</h2>
          <p>Add an iPhone or camera, then return here to adjust the number of units and begin checkout.</p>
          <Link href="/catalog" className={styles.primaryLink}>Browse rentals</Link>
        </div>
      ) : (
        <div className={styles.layout}>
          <div className={styles.items}>
            <div className={styles.itemsHeading}>
              <h2>{cartLines.length} {cartLines.length === 1 ? "rental item" : "rental items"}</h2>
              <span>{totalQuantity} {totalQuantity === 1 ? "unit" : "units"}</span>
            </div>
            {cartLines.map(({ product, quantity, color }) => {
              const units = unitsByProductId.get(product.id) ?? defaultsById[product.id];
              const variantLimit = product.colorOptions.length > 0
                ? getVariantQuantityLimit(product, color)
                : units.totalUnits;
              const maxQuantity = Math.max(1, Math.min(10, variantLimit));
              const lineRental = product.pricePerDay * quantity;
              const lineDiscount = Math.max(0, product.listPricePerDay - product.pricePerDay) * quantity;
              const lineImage = color
                ? product.images.find((image) => image.color === color)?.url
                : undefined;
              return (
                <article key={product.id} className={styles.item}>
                  <Link href={`/catalog/${product.id}`} className={styles.imageWrap}>
                    <Image
                      src={lineImage || product.image || "/images/product-placeholder.png"}
                      alt={color ? `${product.name} in ${color}` : product.name}
                      fill
                      sizes="120px"
                      className={styles.image}
                    />
                  </Link>
                  <div className={styles.itemInfo}>
                    <p className={styles.meta}>{product.brand} · {product.category}</p>
                    <Link href={`/catalog/${product.id}`}><h2>{product.name}</h2></Link>
                    {color ? <p className={styles.meta}>Color: <strong>{color}</strong></p> : null}
                    <p className={styles.rate}>{money(product.pricePerDay)} <span>per unit / day</span></p>
                    {lineDiscount > 0 ? <p className={styles.discount}>You save {money(lineDiscount)} per rental day</p> : null}
                    <p className={styles.stock}>
                      {variantLimit > 0
                        ? `${variantLimit} active ${variantLimit === 1 ? "unit" : "units"}${color ? ` in ${color}` : ""}; dates are checked during checkout.`
                        : `${color ?? "This variant"} is unavailable.`}
                    </p>
                  </div>
                  <div className={styles.itemControls}>
                    <label htmlFor={`quantity-${product.id}`}>Quantity</label>
                    <div className={styles.quantityControl}>
                      <Button variant="none" aria-label={`Decrease ${product.name} quantity`} onClick={() => updateQuantity(product.id, quantity - 1)} disabled={quantity <= 1}>−</Button>
                      <input
                        id={`quantity-${product.id}`}
                        type="number"
                        min={1}
                        max={maxQuantity}
                        value={quantity}
                        onChange={(event) => updateQuantity(product.id, Math.min(maxQuantity, Number(event.target.value)))}
                      />
                      <Button variant="none" aria-label={`Increase ${product.name} quantity`} onClick={() => updateQuantity(product.id, quantity + 1)} disabled={variantLimit <= 0 || quantity >= maxQuantity}>+</Button>
                    </div>
                    <strong>{money(lineRental)} / day</strong>
                    <Button variant="none" className={styles.removeButton} onClick={() => removeItem(product.id)}>Remove</Button>
                  </div>
                </article>
              );
            })}
            <Link href="/catalog" className={styles.continueLink}>Continue shopping</Link>
          </div>

          <aside className={styles.summary} aria-label="Rental cart estimate">
            <p className={styles.summaryEyebrow}>ONE-DAY ESTIMATE</p>
            <h2>Cart summary</h2>
            <div className={styles.priceGroup}>
              <Button
                variant="none"
                className={styles.subtotalToggle}
                aria-expanded={subtotalOpen}
                aria-controls="cart-subtotal-breakdown"
                onClick={() => setSubtotalOpen((open) => !open)}
              >
                <span className={styles.subtotalLabel}>
                  Product subtotal
                  <svg className={styles.chevron} viewBox="0 0 16 16" width="14" height="14" aria-hidden="true" focusable="false">
                    <path d="M4 6l4 4 4-4" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" />
                  </svg>
                </span>
                <span className={styles.subtotalValue}>{money(totals.listSubtotal)}</span>
              </Button>
              <div id="cart-subtotal-breakdown" className={styles.breakdown} hidden={!subtotalOpen}>
                <ul>
                  {cartLines.map(({ product, quantity, color }) => (
                    <li key={`${product.id}-${color ?? ""}`}>
                      <span className={styles.breakdownName}>{product.name}{color ? ` (${color})` : ""}</span>
                      <span className={styles.breakdownMath}>
                        <span>× {quantity} × {money(product.listPricePerDay)}/day =</span>
                        <strong>{money(product.listPricePerDay * quantity)}</strong>
                      </span>
                    </li>
                  ))}
                </ul>
                <p>Regular daily rates, before discounts.</p>
              </div>
              <dl>
                <div><dt>Discounts</dt><dd className={styles.savings}>−{money(discount)}</dd></div>
                <div className={styles.subtotalRow}><dt>Rental subtotal</dt><dd>{money(totals.rentalSubtotal)}</dd></div>
              </dl>
            </div>
            <dl className={styles.priceGroup}>
              <div><dt>Non-refundable deposit</dt><dd>{money(totals.deposit)}</dd></div>
              <div><dt>Online fees</dt><dd>Free</dd></div>
            </dl>
            <dl className={styles.totalGroup}>
              <div className={styles.total}><dt>Estimated total</dt><dd>{money(oneDayEstimate)}</dd></div>
            </dl>
            <div className={styles.perkNote}>
              <strong>More savings at checkout</strong>
              <span>Birthday-month rentals can receive ₱100 off, and the 11th rental under the same account receives ₱200 off.</span>
            </div>
            <p className={styles.summaryNote}>Final amounts update after you choose dates. Delivery courier fees are arranged separately and are not charged online.</p>
            {oversubscribedLine ? (
              <>
                <span className={`${styles.primaryLink} ${styles.primaryLinkDisabled}`} aria-disabled="true">Start checkout</span>
                <p className={styles.unavailableNote} role="alert">
                  {oversubscribedLine.limit <= 0
                    ? `${oversubscribedLine.line.product.name}${oversubscribedLine.line.color ? ` in ${oversubscribedLine.line.color}` : ""} is unavailable — remove it to continue.`
                    : `${oversubscribedLine.line.product.name}${oversubscribedLine.line.color ? ` in ${oversubscribedLine.line.color}` : ""} only has ${oversubscribedLine.limit} ${oversubscribedLine.limit === 1 ? "unit" : "units"} in inventory — lower the quantity to continue.`}
                </p>
              </>
            ) : (
              needsCheckoutAccess ? (
                <Button
                  variant="none"
                  className={styles.primaryLink}
                  aria-haspopup="dialog"
                  aria-expanded={accessDialogOpen}
                  onClick={() => setAccessDialogOpen(true)}
                >
                  Start checkout
                </Button>
              ) : (
                <Link href="/checkout" className={styles.primaryLink}>Start checkout</Link>
              )
            )}
            <p className={styles.bookingRule}>All items above are booked together — one rental period, one payment, one document review, and one signed agreement.</p>
          </aside>
        </div>
      )}
      {accessDialogOpen ? (
        <CheckoutAccessDialog onClose={() => setAccessDialogOpen(false)} />
      ) : null}
      {clearConfirmOpen ? (
        <ConfirmModal
          title="Clear cart?"
          description="Are you sure you want to remove all items from your cart?"
          confirmLabel="Clear Cart"
          cancelLabel="Keep Items"
          tone="danger"
          onConfirm={() => {
            clearCart();
            setClearConfirmOpen(false);
          }}
          onCancel={() => setClearConfirmOpen(false)}
        />
      ) : null}
    </section>
  );
}
