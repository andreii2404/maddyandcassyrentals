import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { getProductById } from "@/src/services/productService";
import ReserveFlowClient from "./ReserveFlowClient";

interface ReservePageProps {
  params: Promise<{ id: string }>;
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}

export async function generateMetadata({ params }: ReservePageProps): Promise<Metadata> {
  const { id } = await params;
  const product = await getProductById(id);
  return {
    title: product ? `Reserve ${product.name} | Rental by Maddy & Cassy` : "Reserve | Rental by Maddy & Cassy",
  };
}

export default async function ReservePage({ params, searchParams }: ReservePageProps) {
  const { id } = await params;
  const query = await searchParams;
  const product = await getProductById(id);

  if (!product || !product.isActive) {
    notFound();
  }

  const returnParams = new URLSearchParams();
  for (const key of ["bookingId", "payment", "cartItem", "color"]) {
    const value = query[key];
    if (typeof value === "string" && value) returnParams.set(key, value);
  }

  return (
    <div>
      <main>
        <ReserveFlowClient
          product={product}
          units={{
            totalUnits: product.totalUnits,
            availableUnits: product.availableUnits,
            reservedUnits: product.reservedUnits,
            rentedUnits: product.rentedUnits,
          }}
          returnQuery={returnParams.toString()}
        />
      </main>
    </div>
  );
}
