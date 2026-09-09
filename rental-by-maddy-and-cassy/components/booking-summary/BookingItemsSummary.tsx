import styles from "./BookingItemsSummary.module.css";

export interface BookingItemsSummaryItem {
  productName: string;
  brand?: string;
  pricePerDay: number;
  quantity: number;
  rentalDays: number;
  lineTotal: number;
  includedAccessories?: string[];
  /** Present once the signed agreement snapshot has frozen the assigned units. */
  units?: { unitCode: string; serialNumber: string | null }[];
}

export interface BookingItemsSummaryProps {
  currency: string;
  items: BookingItemsSummaryItem[];
  subtotal: number;
  discountAmount: number;
  depositAmount: number;
  fees: number;
  grandTotal: number;
  /** True once an agreement exists -- unlocks the "pending" unit-assignment label instead of hiding it entirely. */
  unitsExpected?: boolean;
}

function money(currency: string, value: number): string {
  return `${currency} ${value.toLocaleString("en-PH")}`;
}

/**
 * Some product names already begin with the brand ("DJI Osmo Action 6"), so
 * prefixing the brand again would read "DJI DJI Osmo Action 6". Only show the
 * brand chip when the name does not already start with it.
 */
function shouldPrefixBrand(productName: string, brand?: string): boolean {
  if (!brand?.trim()) return false;
  return !productName.trim().toLowerCase().startsWith(brand.trim().toLowerCase());
}

/** Product | Price/Day | Quantity | Rental Days | Line Total -- the same detailed table used at checkout, reused for every booking output. A single-item booking renders exactly one row. */
export default function BookingItemsSummary({
  currency,
  items,
  subtotal,
  discountAmount,
  depositAmount,
  fees,
  grandTotal,
  unitsExpected = false,
}: BookingItemsSummaryProps) {
  return (
    <div className={styles.wrap}>
      <div className={styles.tableWrap}>
        <table className={styles.table}>
          <thead>
            <tr>
              <th scope="col">Product</th>
              <th scope="col">Price/Day</th>
              <th scope="col">Quantity</th>
              <th scope="col">Rental Days</th>
              <th scope="col">Line Total</th>
            </tr>
          </thead>
          <tbody>
            {items.map((item, index) => (
              <tr key={`${item.productName}-${index}`}>
                <td>
                  <div className={styles.productCell}>
                    <span className={styles.productName}>
                      {shouldPrefixBrand(item.productName, item.brand) ? (
                        <span className={styles.brand}>{item.brand}</span>
                      ) : null}
                      {item.productName}
                    </span>
                    {item.includedAccessories?.length ? (
                      <span className={styles.meta}>Included: {item.includedAccessories.join(", ")}</span>
                    ) : null}
                    {item.units?.length ? (
                      <span className={styles.meta}>
                        Unit{item.units.length === 1 ? "" : "s"}:{" "}
                        {item.units
                          .map((unit) => `${unit.unitCode}${unit.serialNumber ? ` (SN ${unit.serialNumber})` : ""}`)
                          .join(", ")}
                      </span>
                    ) : unitsExpected ? (
                      <span className={styles.metaPending}>Unit assignment pending</span>
                    ) : null}
                  </div>
                </td>
                <td>{money(currency, item.pricePerDay)}</td>
                <td>
                  {item.quantity} {item.quantity === 1 ? "unit" : "units"}
                </td>
                <td>{item.rentalDays}</td>
                <td>{money(currency, item.lineTotal)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <dl className={styles.totals}>
        <div className={styles.totalItem}>
          <dt>Subtotal</dt>
          <dd>{money(currency, subtotal)}</dd>
        </div>
        <div className={styles.totalItem}>
          <dt>Discount</dt>
          <dd>{discountAmount > 0 ? `-${money(currency, discountAmount)}` : money(currency, 0)}</dd>
        </div>
        <div className={styles.totalItem}>
          <dt>Deposit</dt>
          <dd>{money(currency, depositAmount)}</dd>
        </div>
        <div className={styles.totalItem}>
          <dt>Fees</dt>
          <dd>{money(currency, fees)}</dd>
        </div>
        <div className={styles.grandTotal}>
          <dt>Grand Total</dt>
          <dd>{money(currency, grandTotal)}</dd>
        </div>
      </dl>
    </div>
  );
}
