"use client";

import { useEffect, useMemo } from "react";
import Image from "next/image";
import Link from "next/link";
import type { Product } from "@/types/product";
import type { UnitCounts } from "@/lib/availability";
import { useCart } from "@/hooks/useCart";
import { useInventoryMap } from "@/hooks/useInventory";
import styles from "./cart.module.css";

function money(value: number): string {
  return `PHP ${value.toLocaleString("en-PH", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
}

export default function CartView({ products }: { products: Product[] }) {
  const { items, totalQuantity, updateQuantity, removeItem, clearCart, removeStaleItems } = useCart();
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
    .map((line) => ({ line, units: unitsByProductId.get(line.product.id) ?? defaultsById[line.product.id] }))
    .find(({ line, units }) => line.quantity > units.totalUnits);

  return (
    <section className={styles.page} aria-labelledby="cart-heading">
      <header className={styles.header}>
        <div>
          <p className={styles.eyebrow}>RENTAL CART</p>
          <h1 id="cart-heading">Plan your rentals before checkout.</h1>
          <p>Adjust quantities here. Exact dates, fulfillment, payment, documents, and the agreement are completed per rental booking.</p>
        </div>
        {cartLines.length > 0 ? (
          <button type="button" className={styles.clearButton} onClick={clearCart}>Clear cart</button>
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
            {cartLines.map(({ product, quantity }) => {
              const units = unitsByProductId.get(product.id) ?? defaultsById[product.id];
              const maxQuantity = Math.max(1, Math.min(10, units.totalUnits));
              const lineRental = product.pricePerDay * quantity;
              const lineDiscount = Math.max(0, product.listPricePerDay - product.pricePerDay) * quantity;
              return (
                <article key={product.id} className={styles.item}>
                  <Link href={`/catalog/${product.id}`} className={styles.imageWrap}>
                    <Image
                      src={product.image || "/images/product-placeholder.png"}
                      alt={product.name}
                      fill
                      sizes="120px"
                      className={styles.image}
                    />
                  </Link>
                  <div className={styles.itemInfo}>
                    <p className={styles.meta}>{product.brand} · {product.category}</p>
                    <Link href={`/catalog/${product.id}`}><h2>{product.name}</h2></Link>
                    <p className={styles.rate}>{money(product.pricePerDay)} <span>per unit / day</span></p>
                    {lineDiscount > 0 ? <p className={styles.discount}>You save {money(lineDiscount)} per rental day</p> : null}
                    <p className={styles.stock}>{units.totalUnits} active {units.totalUnits === 1 ? "unit" : "units"}; dates are checked during checkout.</p>
                  </div>
                  <div className={styles.itemControls}>
                    <label htmlFor={`quantity-${product.id}`}>Quantity</label>
                    <div className={styles.quantityControl}>
                      <button type="button" onClick={() => updateQuantity(product.id, quantity - 1)} disabled={quantity <= 1} aria-label={`Decrease ${product.name} quantity`}>−</button>
                      <input
                        id={`quantity-${product.id}`}
                        type="number"
                        min={1}
                        max={maxQuantity}
                        value={quantity}
                        onChange={(event) => updateQuantity(product.id, Math.min(maxQuantity, Number(event.target.value)))}
                      />
                      <button type="button" onClick={() => updateQuantity(product.id, quantity + 1)} disabled={quantity >= maxQuantity} aria-label={`Increase ${product.name} quantity`}>+</button>
                    </div>
                    <strong>{money(lineRental)} / day</strong>
                    <button type="button" className={styles.removeButton} onClick={() => removeItem(product.id)}>Remove</button>
                  </div>
                </article>
              );
            })}
            <Link href="/catalog" className={styles.continueLink}>← Continue shopping</Link>
          </div>

          <aside className={styles.summary} aria-label="Rental cart estimate">
            <p className={styles.summaryEyebrow}>ONE-DAY ESTIMATE</p>
            <h2>Cart summary</h2>
            <dl>
              <div><dt>Product subtotal</dt><dd>{money(totals.listSubtotal)}</dd></div>
              <div><dt>Discounts</dt><dd className={styles.savings}>−{money(discount)}</dd></div>
              <div><dt>Rental subtotal</dt><dd>{money(totals.rentalSubtotal)}</dd></div>
              <div><dt>Non-refundable deposit</dt><dd>{money(totals.deposit)}</dd></div>
              <div><dt>Online fees</dt><dd>Free</dd></div>
              <div className={styles.total}><dt>Estimated amount</dt><dd>{money(oneDayEstimate)}</dd></div>
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
                  {oversubscribedLine.line.product.name} only has {oversubscribedLine.units.totalUnits} {oversubscribedLine.units.totalUnits === 1 ? "unit" : "units"} in inventory — lower the quantity to continue.
                </p>
              </>
            ) : (
              <Link href="/checkout" className={styles.primaryLink}>Start checkout</Link>
            )}
            <p className={styles.bookingRule}>All items above are booked together — one rental period, one payment, one document review, and one signed agreement.</p>
          </aside>
        </div>
      )}
    </section>
  );
}
