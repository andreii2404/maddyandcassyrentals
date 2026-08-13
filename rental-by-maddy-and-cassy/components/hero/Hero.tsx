import Link from "next/link";
import ProductShowcase from "@/components/product-showcase/ProductShowcase";
import Stats from "@/components/stats/Stats";
import CalendarIcon from "@/components/icons/CalendarIcon";
import SearchIcon from "@/components/icons/SearchIcon";
import type { Product } from "@/types/product";
import styles from "./Hero.module.css";

interface HeroProps {
  products: Product[];
}

export default function Hero({ products }: HeroProps) {
  const categoryCount = new Set(products.map((product) => product.category).filter(Boolean)).size;

  return (
    <section id="top" className={styles.hero} aria-label="Introduction">
      <div className={styles.backgroundGlow} aria-hidden="true" />

      <div className={styles.inner}>
        <div className={styles.content}>
          <p className={styles.label}>PREMIUM RENTALS · METRO MANILA</p>

          <h1 className={styles.heading}>
            Rent the Gear.
            <br />
            Create the
            <br />
            Moment.
          </h1>

          <p className={styles.description}>
            Premium cameras and iPhones for daily rental. Quality equipment,
            simple booking, and transparent pricing—all in one place.
          </p>

          <form action="/catalog" method="get" role="search" className={styles.searchForm}>
            <SearchIcon size={19} className={styles.searchIcon} />
            <label className={styles.srOnly} htmlFor="storefront-search">Search rental products</label>
            <input
              id="storefront-search"
              name="q"
              type="search"
              autoComplete="off"
              placeholder="Search iPhones, cameras, or models"
            />
            <button type="submit">Search</button>
          </form>

          <div className={styles.buttons}>
            <Link href="/catalog" className={styles.primaryButton}>
              <CalendarIcon size={18} />
              Check Availability
            </Link>
            <a href="#how-it-works" className={styles.secondaryButton}>
              How Renting Works
            </a>
          </div>

          <Stats itemCount={products.length} categoryCount={categoryCount} />
        </div>

        <ProductShowcase products={products.slice(0, 2)} />
      </div>
    </section>
  );
}
