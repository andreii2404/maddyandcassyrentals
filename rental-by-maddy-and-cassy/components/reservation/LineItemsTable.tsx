import type { ReservationLinePricing } from "@/src/lib/reservationPricing";
import styles from "./LineItemsTable.module.css";

function money(currency: string, value: number): string {
  return `${currency}${value.toLocaleString()}`;
}

/** Product | Price/Day | Quantity | Rental Days | Line Total -- one row per line. */
export default function LineItemsTable({
  lines,
  currency,
}: {
  lines: ReservationLinePricing[];
  currency: string;
}) {
  return (
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
          {lines.map((line) => (
            <tr key={line.productId}>
              <td>{line.productName}</td>
              <td>{money(currency, line.pricePerDay)}</td>
              <td>{line.quantity} {line.quantity === 1 ? "unit" : "units"}</td>
              <td>{line.rentalDays}</td>
              <td>{money(currency, line.lineTotal)}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
