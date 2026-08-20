import type { Metadata } from "next";
import { getActiveProducts } from "@/src/services/productService";
import CatalogView from "./CatalogView";

export const revalidate = 60;

export const metadata: Metadata = {
  title: "Rental Item Catalog | Rental by Maddy & Cassy",
  description:
    "Browse premium iPhones and cameras available for daily rental in Metro Manila.",
};

interface CatalogPageProps {
  searchParams: Promise<{ q?: string; category?: string }>;
}

export default async function CatalogPage({ searchParams }: CatalogPageProps) {
  const params = await searchParams;
  const products = await getActiveProducts();

  return (
    <div>
      <main>
        <CatalogView
          products={products}
          initialSearch={params.q ?? ""}
          initialCategory={params.category ?? "All"}
        />
      </main>
    </div>
  );
}
