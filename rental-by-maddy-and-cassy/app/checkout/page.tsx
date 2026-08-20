import type { Metadata } from "next";
import { getActiveProducts } from "@/src/services/productService";
import CheckoutFlowClient from "./CheckoutFlowClient";

export const revalidate = 60;

export const metadata: Metadata = {
  title: "Checkout | Rental by Maddy & Cassy",
  description: "Choose one rental period, pay, verify, and sign one agreement for your entire cart.",
};

interface CheckoutPageProps {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}

export default async function CheckoutPage({ searchParams }: CheckoutPageProps) {
  const [products, query] = await Promise.all([getActiveProducts(), searchParams]);

  const returnParams = new URLSearchParams();
  const bookingId = query.bookingId;
  if (typeof bookingId === "string" && bookingId) returnParams.set("bookingId", bookingId);

  return (
    <div>
      <main>
        <CheckoutFlowClient products={products} returnQuery={returnParams.toString()} />
      </main>
    </div>
  );
}
