"use client";

import SearchIcon from "@/components/icons/SearchIcon";
import styles from "./CatalogFilters.module.css";

export type CategoryFilter = string;
export type SortOption = "featured" | "price-asc" | "price-desc" | "rating-desc" | "name-asc";

interface CatalogFiltersProps {
  search: string;
  onSearchChange: (value: string) => void;
  category: CategoryFilter;
  onCategoryChange: (value: CategoryFilter) => void;
  sort: SortOption;
  onSortChange: (value: SortOption) => void;
  availableOnly: boolean;
  onAvailableOnlyChange: (value: boolean) => void;
  resultCount: number;
  categories: CategoryFilter[];
}

export default function CatalogFilters({
  search,
  onSearchChange,
  category,
  onCategoryChange,
  sort,
  onSortChange,
  availableOnly,
  onAvailableOnlyChange,
  resultCount,
  categories,
}: CatalogFiltersProps) {
  return (
    <div className={styles.toolbar}>
      <div className={styles.categoryRow} role="group" aria-label="Filter by category">
        {categories.map((item) => (
          <button
            key={item}
            type="button"
            aria-pressed={category === item}
            className={`${styles.categoryPill} ${category === item ? styles.categoryPillActive : ""}`}
            onClick={() => onCategoryChange(item)}
          >
            {item === "All" ? "All Products" : item}
          </button>
        ))}
      </div>

      <div className={styles.controlsRow}>
        <label className={styles.searchField}>
          <SearchIcon size={17} className={styles.searchIcon} />
          <input
            type="search"
            autoComplete="off"
            value={search}
            onChange={(event) => onSearchChange(event.target.value)}
            placeholder="Search products..."
            aria-label="Search products"
            className={styles.searchInput}
          />
        </label>

        <label className={styles.selectField}>
          <span className={styles.selectLabel}>Sort</span>
          <select
            value={sort}
            onChange={(event) => onSortChange(event.target.value as SortOption)}
            className={styles.select}
            aria-label="Sort products"
          >
            <option value="featured">Recommended</option>
            <option value="price-asc">Price: Low to High</option>
            <option value="price-desc">Price: High to Low</option>
            <option value="rating-desc">Highest Rated</option>
            <option value="name-asc">Name: A to Z</option>
          </select>
        </label>

        <label className={styles.checkboxField}>
          <input
            type="checkbox"
            checked={availableOnly}
            onChange={(event) => onAvailableOnlyChange(event.target.checked)}
            className={styles.checkbox}
          />
          Available only
        </label>

        <p className={styles.resultCount} aria-live="polite">
          {resultCount} {resultCount === 1 ? "product" : "products"} found
        </p>
      </div>
    </div>
  );
}
