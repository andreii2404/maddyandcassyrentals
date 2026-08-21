import type { Metadata } from "next";
import { getActiveProducts } from "@/src/services/productService";
import CartView from "./CartView";

export const revalidate = 60;

export const metadata: Metadata = {
  title: "Rental Cart | Rental by Maddy & Cassy",
  description: "Review rental items, quantities, discounts, and checkout estimates.",
};

export default async function CartPage() {
  const products = await getActiveProducts();
  return (
    <div>
      <main>
        <CartView products={products} />
      </main>
    </div>
  );
}
