import type { Metadata } from "next";
import { notFound } from "next/navigation";
import Navbar from "@/components/navbar/Navbar";
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
  for (const key of ["bookingId", "items"]) {
    const value = query[key];
    if (typeof value === "string" && value) returnParams.set(key, value);
  }

  const itemSelections = typeof query.items === "string"
    ? query.items.split(",").slice(0, 10).flatMap((entry) => {
        const [productId, quantityText] = entry.split(":");
        const quantity = Number(quantityText);
        return /^[0-9a-f-]{36}$/i.test(productId) && Number.isInteger(quantity) && quantity >= 1 && quantity <= 10
          ? [{ productId, quantity }]
          : [];
      })
    : [];
  const selectedProducts = await Promise.all(itemSelections.map(async (selection) => ({
    ...selection,
    product: await getProductById(selection.productId),
  })));
  const cartProducts = selectedProducts.flatMap(({ product: selectedProduct, quantity }) =>
    selectedProduct?.isActive
      ? [{
          product: selectedProduct,
          quantity,
          units: {
            totalUnits: selectedProduct.totalUnits,
            availableUnits: selectedProduct.availableUnits,
            reservedUnits: selectedProduct.reservedUnits,
            rentedUnits: selectedProduct.rentedUnits,
          },
        }]
      : [],
  );

  return (
    <div>
      <Navbar />
      <main>
        <ReserveFlowClient
          product={product}
          units={{
            totalUnits: product.totalUnits,
            availableUnits: product.availableUnits,
            reservedUnits: product.reservedUnits,
            rentedUnits: product.rentedUnits,
          }}
          cartProducts={cartProducts.length ? cartProducts : undefined}
          returnQuery={returnParams.toString()}
        />
      </main>
    </div>
  );
}
