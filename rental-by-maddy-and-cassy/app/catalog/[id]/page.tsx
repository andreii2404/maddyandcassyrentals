import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { getActiveProducts, getProductById } from "@/src/services/productService";
import ProductDetailsClient from "./ProductDetailsClient";
import styles from "./details.module.css";

export const revalidate = 60;

interface ProductDetailsPageProps {
  params: Promise<{ id: string }>;
}

export async function generateMetadata({
  params,
}: ProductDetailsPageProps): Promise<Metadata> {
  const { id } = await params;
  const product = await getProductById(id);

  if (!product || !product.isActive) {
    return { title: "Product Not Found | Rental by Maddy & Cassy" };
  }

  return {
    title: `${product.name} | Rental by Maddy & Cassy`,
    description: product.description,
  };
}

export default async function ProductDetailsPage({ params }: ProductDetailsPageProps) {
  const { id } = await params;
  const product = await getProductById(id);

  if (!product || !product.isActive) {
    notFound();
  }

  const allProducts = await getActiveProducts();
  const similarProducts = allProducts.filter(
    (item) => item.category === product.category && item.id !== product.id
  );

  return (
    <div>
      <main className={styles.main}>
        <ProductDetailsClient product={product} similarProducts={similarProducts} />
      </main>
    </div>
  );
}
