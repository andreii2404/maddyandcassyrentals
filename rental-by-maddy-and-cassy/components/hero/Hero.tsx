import ProductShowcase from "@/components/product-showcase/ProductShowcase";
import Stats from "@/components/stats/Stats";
import CalendarIcon from "@/components/icons/CalendarIcon";
import CameraIcon from "@/components/icons/CameraIcon";
import SearchIcon from "@/components/icons/SearchIcon";
import type { Product } from "@/types/product";
import { Button } from "@/components/ui/Button";
import styles from "./Hero.module.css";

interface HeroCategory {
  name: string;
  description: string;
}

interface HeroProps {
  products: Product[];
  categories?: HeroCategory[];
}

function PhoneIcon() {
  return (
    <svg viewBox="0 0 24 24" width={20} height={20} fill="none" aria-hidden="true">
      <rect x="7" y="3" width="10" height="18" rx="2.4" stroke="currentColor" strokeWidth="1.6" />
      <path d="M11 18h2" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" />
    </svg>
  );
}

export default function Hero({ products, categories = [] }: HeroProps) {
  const categoryCount = new Set(products.map((product) => product.category).filter(Boolean)).size;
  const featureCategories = categories.slice(0, 2);

  return (
    <section id="top" className={styles.hero} aria-label="Introduction">
      <div className={styles.backgroundGlow} aria-hidden="true" />
      <div className={`${styles.heroBlob} editorialBlob editorialBreathe`} aria-hidden="true" />

      <div className={styles.inner}>
        <div className={styles.content}>
          <p className={styles.label}>
            <span className={styles.labelDot} aria-hidden="true" />
            PREMIUM RENTALS · METRO MANILA
          </p>

          <h1 className={styles.heading}>
            Rent the Gear.
            <br />
            Create the
            <br />
            <em className={styles.emphasis}>Moment.</em>
          </h1>

          {featureCategories.length > 0 ? (
            <ul className={styles.featureList} aria-label="Rental categories">
              {featureCategories.map((category, index) => (
                <li key={category.name} className={styles.featureItem}>
                  <span className={styles.featureIcon} aria-hidden="true">
                    {index === 0 ? <CameraIcon size={20} /> : <PhoneIcon />}
                  </span>
                  <span>
                    <strong>{category.name}</strong>
                    <small>{category.description}</small>
                  </span>
                </li>
              ))}
            </ul>
          ) : null}

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
            <Button type="submit" variant="none">
              Search
            </Button>
          </form>

          <div className={styles.buttons}>
            <Button
              href="/catalog"
              variant="none"
              className={styles.primaryButton}
              icon={<CalendarIcon size={18} />}
            >
              Check Availability
              <span className={styles.arrowChip} aria-hidden="true">
                <svg viewBox="0 0 20 20" width="14" height="14">
                  <path d="M5 15 15 5M7 5h8v8" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" />
                </svg>
              </span>
            </Button>
            <a href="#how-it-works" className={styles.tertiaryLink}>
              How Renting Works
              <span className={styles.tertiaryChip} aria-hidden="true">
                <svg viewBox="0 0 20 20" width="12" height="12">
                  <path d="M5 15 15 5M7 5h8v8" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" />
                </svg>
              </span>
            </a>
          </div>

          <Stats itemCount={products.length} categoryCount={categoryCount} />
        </div>

        <ProductShowcase products={products.slice(0, 2)} />
      </div>
    </section>
  );
}
