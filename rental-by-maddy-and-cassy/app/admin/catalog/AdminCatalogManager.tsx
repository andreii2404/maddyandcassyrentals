"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import Image from "next/image";
import Link from "next/link";
import { useToast } from "@/components/ui/ToastProvider";
import Spinner from "@/components/ui/Spinner";
import {
  createCatalogCategoryAsAdmin,
  createCatalogProductAsAdmin,
  deactivateCatalogProductAsAdmin,
  deleteCatalogCategoryAsAdmin,
  moderateProductReviewAsAdmin,
  updateCatalogCategoryAsAdmin,
  updateCatalogProductAsAdmin,
  updateInventoryUnitAsAdmin,
  uploadCatalogImage,
  type CatalogCategoryInput,
  type CatalogEditorInput,
  type InventoryUnitEditorInput,
} from "@/src/services/productService";
import {
  getAdminCatalog,
  type AdminCatalogCategory,
  type AdminInventoryUnit,
  type AdminPriceHistoryEntry,
  type AdminProductReview,
} from "@/src/services/operationsService";
import type { Product, ProductStatus } from "@/types/product";
import styles from "./catalog.module.css";

const blankForm: CatalogEditorInput = {
  name: "",
  brand: "",
  category: "",
  shortDescription: "",
  description: "",
  dailyRate: 0,
  refundableDeposit: 0,
  discountPercent: 0,
  discountLabel: "",
  specifications: {},
  totalUnits: 1,
  isFeatured: false,
  status: "active",
};

const blankCategory: CatalogCategoryInput = { name: "", description: "", sortOrder: 0 };

function formatMoney(value: number): string {
  return `PHP ${value.toLocaleString("en-PH", { maximumFractionDigits: 2 })}`;
}

function parseSpecificationLines(value: string): Record<string, string> {
  const specifications: Record<string, string> = {};
  for (const line of value.split("\n").map((item) => item.trim()).filter(Boolean)) {
    const separator = line.indexOf(":");
    if (separator <= 0 || !line.slice(separator + 1).trim()) {
      throw new Error(`Use "Feature: Value" format for specifications. Check: ${line}`);
    }
    specifications[line.slice(0, separator).trim()] = line.slice(separator + 1).trim();
  }
  return specifications;
}

export default function AdminCatalogManager() {
  const { showToast } = useToast();
  const [products, setProducts] = useState<Product[] | null>(null);
  const [categories, setCategories] = useState<AdminCatalogCategory[]>([]);
  const [inventoryUnits, setInventoryUnits] = useState<AdminInventoryUnit[]>([]);
  const [priceHistory, setPriceHistory] = useState<AdminPriceHistoryEntry[]>([]);
  const [reviews, setReviews] = useState<AdminProductReview[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [search, setSearch] = useState("");
  const [categoryFilter, setCategoryFilter] = useState("All");
  const [statusFilter, setStatusFilter] = useState<"all" | ProductStatus>("all");
  const [inventoryProductFilter, setInventoryProductFilter] = useState("all");
  const [editing, setEditing] = useState<Product | "new" | null>(null);
  const [form, setForm] = useState<CatalogEditorInput>(blankForm);
  const [includedText, setIncludedText] = useState("");
  const [specificationsText, setSpecificationsText] = useState("");
  const [imageFile, setImageFile] = useState<File | null>(null);
  const [categoryEditing, setCategoryEditing] = useState<AdminCatalogCategory | "new" | null>(null);
  const [categoryForm, setCategoryForm] = useState<CatalogCategoryInput>(blankCategory);
  const [unitEditing, setUnitEditing] = useState<AdminInventoryUnit | null>(null);
  const [unitForm, setUnitForm] = useState<InventoryUnitEditorInput | null>(null);
  const [saving, setSaving] = useState(false);

  const load = useCallback(async () => {
    setError(null);
    try {
      const data = await getAdminCatalog();
      setProducts(data.products);
      setCategories(data.categories);
      setInventoryUnits(data.inventoryUnits);
      setPriceHistory(data.priceHistory);
      setReviews(data.reviews);
    } catch (loadError) {
      setError(loadError instanceof Error ? loadError.message : "The catalog could not be loaded.");
    }
  }, []);

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
    void load();
    const intervalId = window.setInterval(() => void load(), 30_000);
    return () => window.clearInterval(intervalId);
  }, [load]);

  const filteredProducts = useMemo(() => {
    const query = search.trim().toLowerCase();
    return (products ?? []).filter((product) => {
      const matchesSearch = !query || [
        product.name,
        product.brand ?? "",
        product.category,
        product.shortDescription ?? "",
        product.description ?? "",
        ...Object.values(product.specs),
      ].join(" ").toLowerCase().includes(query);
      const matchesCategory = categoryFilter === "All" || product.category === categoryFilter;
      const matchesStatus = statusFilter === "all" || product.status === statusFilter;
      return matchesSearch && matchesCategory && matchesStatus;
    });
  }, [categoryFilter, products, search, statusFilter]);

  const visibleInventoryUnits = useMemo(
    () => inventoryUnits.filter((unit) => inventoryProductFilter === "all" || unit.productId === inventoryProductFilter),
    [inventoryProductFilter, inventoryUnits],
  );

  const summary = useMemo(() => ({
    listings: products?.length ?? 0,
    activeListings: products?.filter((product) => product.status === "active").length ?? 0,
    activeUnits: inventoryUnits.filter((unit) => unit.lifecycleStatus === "active").length,
    maintenanceUnits: inventoryUnits.filter((unit) => unit.lifecycleStatus === "maintenance").length,
  }), [inventoryUnits, products]);

  function openEditor(product?: Product) {
    if (product) {
      setEditing(product);
      setForm({
        name: product.name,
        brand: product.brand ?? "",
        category: product.category,
        shortDescription: product.shortDescription ?? "",
        description: product.description ?? "",
        dailyRate: product.dailyRate,
        refundableDeposit: product.refundableDeposit,
        discountPercent: product.discountPercent,
        discountLabel: product.discountLabel ?? "",
        specifications: product.specs,
        totalUnits: product.totalUnits,
        isFeatured: product.isFeatured,
        status: product.status,
      });
      setIncludedText(product.included.join("\n"));
      setSpecificationsText(Object.entries(product.specs).map(([key, value]) => `${key}: ${value}`).join("\n"));
    } else {
      setEditing("new");
      setForm({ ...blankForm, category: categories[0]?.name ?? "" });
      setIncludedText("");
      setSpecificationsText("");
    }
    setImageFile(null);
  }

  async function saveProduct() {
    if (!editing) return;
    setSaving(true);
    try {
      const editorInput: CatalogEditorInput = {
        ...form,
        specifications: {
          ...parseSpecificationLines(specificationsText),
          included: includedText.split("\n").map((item) => item.trim()).filter(Boolean).join(", "),
        },
      };
      const productId = editing === "new"
        ? await createCatalogProductAsAdmin(editorInput)
        : editing.id;
      if (editing !== "new") await updateCatalogProductAsAdmin(productId, editorInput);
      if (imageFile) await uploadCatalogImage(productId, imageFile);
      await load();
      setEditing(null);
      showToast("Product details and inventory updated.", "success");
    } catch (saveError) {
      showToast(saveError instanceof Error ? saveError.message : "The product could not be saved.", "error");
    } finally {
      setSaving(false);
    }
  }

  async function deactivate(product: Product) {
    if (!window.confirm(`Remove ${product.name} from the public catalog? Historical bookings and unit records will remain.`)) return;
    try {
      await deactivateCatalogProductAsAdmin(product.id);
      await load();
      showToast("Product removed from the public catalog.", "success");
    } catch (deactivateError) {
      showToast(deactivateError instanceof Error ? deactivateError.message : "The product could not be removed.", "error");
    }
  }

  function openCategoryEditor(category?: AdminCatalogCategory) {
    setCategoryEditing(category ?? "new");
    setCategoryForm(category ? {
      name: category.name,
      description: category.description ?? "",
      sortOrder: category.sortOrder,
    } : { ...blankCategory, sortOrder: categories.length + 1 });
  }

  async function saveCategory() {
    if (!categoryEditing) return;
    setSaving(true);
    try {
      if (categoryEditing === "new") await createCatalogCategoryAsAdmin(categoryForm);
      else await updateCatalogCategoryAsAdmin(categoryEditing.id, categoryForm);
      await load();
      setCategoryEditing(null);
      showToast("Product category saved.", "success");
    } catch (categoryError) {
      showToast(categoryError instanceof Error ? categoryError.message : "The category could not be saved.", "error");
    } finally {
      setSaving(false);
    }
  }

  async function removeCategory(category: AdminCatalogCategory) {
    if (!window.confirm(`Delete the ${category.name} category?`)) return;
    try {
      await deleteCatalogCategoryAsAdmin(category.id);
      await load();
      showToast("Category deleted.", "success");
    } catch (categoryError) {
      showToast(categoryError instanceof Error ? categoryError.message : "The category could not be deleted.", "error");
    }
  }

  function openUnitEditor(unit: AdminInventoryUnit) {
    setUnitEditing(unit);
    setUnitForm({
      unitCode: unit.unitCode,
      serialNumber: unit.serialNumber ?? "",
      lifecycleStatus: unit.lifecycleStatus,
      conditionNotes: unit.conditionNotes ?? "",
      acquiredAt: unit.acquiredAt ?? "",
    });
  }

  async function saveUnit() {
    if (!unitEditing || !unitForm) return;
    setSaving(true);
    try {
      await updateInventoryUnitAsAdmin(unitEditing.id, unitForm);
      await load();
      setUnitEditing(null);
      setUnitForm(null);
      showToast("Physical unit updated. Availability recalculated automatically.", "success");
    } catch (unitError) {
      showToast(unitError instanceof Error ? unitError.message : "The inventory unit could not be saved.", "error");
    } finally {
      setSaving(false);
    }
  }

  async function moderateReview(review: AdminProductReview, status: "approved" | "rejected") {
    try {
      await moderateProductReviewAsAdmin(review.id, status);
      await load();
      showToast(`Review ${status}.`, "success");
    } catch (reviewError) {
      showToast(reviewError instanceof Error ? reviewError.message : "The review decision could not be saved.", "error");
    }
  }

  return (
    <div className={styles.page}>
      <header className={styles.header}>
        <p>CATALOG &amp; INVENTORY</p>
        <h1>Rental Inventory</h1>
        <span>Manage listings, categories, pricing, discounts, and every physical rental unit.</span>
      </header>

      <section className={styles.controlPanel} aria-label="Catalog overview and controls">
        <div className={styles.statsStrip} aria-label="Inventory summary">
          <div><strong>{summary.listings}</strong><span>All listings</span></div>
          <div><strong>{summary.activeListings}</strong><span>Publicly active</span></div>
          <div><strong>{summary.activeUnits}</strong><span>Rental-ready units</span></div>
          <div><strong>{summary.maintenanceUnits}</strong><span>Under maintenance</span></div>
        </div>

        <div className={styles.controlsRow}>
          <label className={styles.searchField}>
            <span className={styles.srOnly}>Search products</span>
            <input type="search" value={search} onChange={(event) => setSearch(event.target.value)} placeholder="Search by name, brand, description, or specification" />
          </label>
          <label className={styles.filterField}>
            <span className={styles.srOnly}>Category</span>
            <select value={categoryFilter} onChange={(event) => setCategoryFilter(event.target.value)}><option>All categories</option>{categories.map((category) => <option key={category.id}>{category.name}</option>)}</select>
          </label>
          <label className={styles.filterField}>
            <span className={styles.srOnly}>Status</span>
            <select value={statusFilter} onChange={(event) => setStatusFilter(event.target.value as typeof statusFilter)}><option value="all">All statuses</option><option value="active">Active</option><option value="draft">Draft</option><option value="inactive">Inactive</option><option value="archived">Archived</option></select>
          </label>
          <button type="button" className={styles.addButton} onClick={() => openEditor()}>+ Add Product</button>
        </div>
      </section>

      {error ? <div className={styles.error} role="alert">{error}<button type="button" onClick={() => void load()}>Try again</button></div> : null}

      <section className={styles.section} aria-labelledby="products-heading">
        <div className={styles.sectionHeading}>
          <div><p>PRODUCTS</p><h2 id="products-heading">Complete Catalog</h2></div>
          <span>{filteredProducts.length} shown · auto-updates</span>
        </div>

        {!products && !error ? <div className={styles.loading}><Spinner size={28} label="Loading catalog" /></div> : null}
        {products && filteredProducts.length === 0 ? <div className={styles.empty}>No products match the current search and filters.</div> : null}
        {products && filteredProducts.length > 0 ? (
          <div className={styles.grid}>
            {filteredProducts.map((product) => {
              const productUnits = inventoryUnits.filter((unit) => unit.productId === product.id);
              const maintenanceCount = productUnits.filter((unit) => unit.lifecycleStatus === "maintenance").length;
              return (
                <article key={product.id} className={styles.card}>
                  <div className={styles.imageWrap}>
                    <Image src={product.image || "/images/product-placeholder.png"} alt={`${product.name} catalog preview`} fill sizes="240px" className={styles.image} />
                    <span className={styles.categoryTag}>{product.category}</span>
                    <i className={styles.statusTag} data-status={product.status}>{product.status}</i>
                  </div>
                  <div className={styles.cardBody}>
                    <div className={styles.cardHeading}>
                      <h3>{product.name}</h3>
                      <p>{product.brand || "No brand"}</p>
                    </div>
                    <div className={styles.priceLine}>
                      <strong>{formatMoney(product.pricePerDay)}<small>/day</small></strong>
                      {product.discountPercent > 0 ? <span>{product.discountPercent}% off</span> : null}
                    </div>
                    <dl className={styles.inventoryFacts}>
                      <div><dt>Available today</dt><dd>{product.availableUnits} / {product.totalUnits}</dd></div>
                      <div><dt>Maintenance</dt><dd>{maintenanceCount}</dd></div>
                      <div><dt>Specifications</dt><dd>{Object.keys(product.specs).length}</dd></div>
                    </dl>
                    {(!product.description || Object.keys(product.specs).length === 0) ? <p className={styles.contentWarning}>Needs more product details</p> : null}
                    <div className={styles.actions}>
                      <button type="button" onClick={() => openEditor(product)}>View / Edit</button>
                      {product.isActive ? <Link href={`/catalog/${product.id}`} target="_blank">Public page</Link> : null}
                      {product.isActive ? <button type="button" className={styles.danger} onClick={() => void deactivate(product)}>Remove</button> : null}
                    </div>
                  </div>
                </article>
              );
            })}
          </div>
        ) : null}
      </section>

      <section className={styles.section} aria-labelledby="categories-heading">
        <div className={styles.sectionHeading}>
          <div><p>CATEGORIES</p><h2 id="categories-heading">Product Categories</h2></div>
          <button type="button" onClick={() => openCategoryEditor()}>Add Category</button>
        </div>
        <div className={styles.tableWrap}>
          <table><thead><tr><th>Name</th><th>Description</th><th>Products</th><th>Order</th><th>Actions</th></tr></thead>
            <tbody>{categories.map((category) => <tr key={category.id}>
              <td><strong>{category.name}</strong></td><td>{category.description || "No description"}</td><td>{category.productCount}</td><td>{category.sortOrder}</td>
              <td><div className={styles.tableActions}><button type="button" onClick={() => openCategoryEditor(category)}>Edit</button><button type="button" className={styles.dangerText} onClick={() => void removeCategory(category)}>Delete</button></div></td>
            </tr>)}</tbody>
          </table>
        </div>
      </section>

      <section className={styles.section} aria-labelledby="units-heading">
        <div className={styles.sectionHeading}>
          <div><p>PHYSICAL UNITS</p><h2 id="units-heading">Inventory Management</h2></div>
          <label className={styles.compactFilter}><span>Product</span><select value={inventoryProductFilter} onChange={(event) => setInventoryProductFilter(event.target.value)}><option value="all">All products</option>{(products ?? []).map((product) => <option key={product.id} value={product.id}>{product.name}</option>)}</select></label>
        </div>
        <p className={styles.sectionCopy}>Availability updates automatically when units move between active, maintenance, and retired states. Units with active reservations are protected.</p>
        <div className={styles.tableWrap}>
          <table><thead><tr><th>Unit code</th><th>Product</th><th>Serial number</th><th>Status</th><th>Reservation</th><th>Action</th></tr></thead>
            <tbody>{visibleInventoryUnits.map((unit) => <tr key={unit.id}>
              <td><strong>{unit.unitCode}</strong></td><td>{products?.find((product) => product.id === unit.productId)?.name ?? "Product"}</td><td>{unit.serialNumber || "Not recorded"}</td>
              <td><span className={styles.unitStatus} data-status={unit.lifecycleStatus}>{unit.lifecycleStatus}</span></td><td>{unit.hasActiveReservation ? "Reserved / in use" : "Clear"}</td>
              <td><button type="button" className={styles.tableButton} onClick={() => openUnitEditor(unit)}>Manage</button></td>
            </tr>)}</tbody>
          </table>
        </div>
      </section>

      <section className={styles.history}>
        <div className={styles.sectionHeading}>
          <div><p>CUSTOMER FEEDBACK</p><h2>Ratings &amp; Reviews</h2></div>
          <span>{reviews.filter((review) => review.status === "pending").length} awaiting review</span>
        </div>
        {reviews.length === 0 ? <div className={styles.emptySmall}>No customer reviews have been submitted yet.</div> : (
          <div className={styles.reviewGrid}>{reviews.map((review) => <article key={review.id} className={styles.reviewCard}>
            <div><strong>{review.productName}</strong><span data-status={review.status}>{review.status}</span></div>
            <p className={styles.reviewStars}>{"★".repeat(review.rating)}{"☆".repeat(5 - review.rating)}</p>
            <p>{review.comment || "Rating submitted without a written comment."}</p>
            <small>{new Date(review.createdAt).toLocaleString("en-PH")}</small>
            {review.status === "pending" ? <div className={styles.tableActions}><button type="button" onClick={() => void moderateReview(review, "approved")}>Approve</button><button type="button" className={styles.dangerText} onClick={() => void moderateReview(review, "rejected")}>Reject</button></div> : null}
          </article>)}</div>
        )}
      </section>

      <section className={styles.history}>
        <div><p>PRICE CHANGE HISTORY</p><h2>Recent Pricing Updates</h2></div>
        <div className={styles.tableWrap}><table><thead><tr><th>Product</th><th>Previous</th><th>New price</th><th>Reason</th><th>Date</th></tr></thead>
          <tbody>{[...priceHistory].sort((a, b) => Date.parse(b.createdAt || "") - Date.parse(a.createdAt || "")).slice(0, 20).map((entry) => <tr key={`${entry.productId}-${entry.id}`}>
            <td>{products?.find((product) => product.id === entry.productId)?.name ?? entry.productId}</td><td>{entry.previousPrice === null ? "Initial" : formatMoney(entry.previousPrice)}</td><td>{formatMoney(entry.newPrice)}</td><td>{entry.reason || "Catalog pricing update"}</td><td>{entry.createdAt ? new Date(entry.createdAt).toLocaleString("en-PH") : "—"}</td>
          </tr>)}</tbody></table></div>
      </section>

      {editing ? (
        <div className={styles.overlay} role="presentation" onMouseDown={() => !saving && setEditing(null)}>
          <section className={styles.editor} role="dialog" aria-modal="true" aria-labelledby="product-editor-title" onMouseDown={(event) => event.stopPropagation()}>
            <div className={styles.editorHeader}><div><p>PRODUCT EDITOR</p><h2 id="product-editor-title">{editing === "new" ? "Add Product" : `Edit ${editing.name}`}</h2></div><button type="button" onClick={() => setEditing(null)} disabled={saving}>Close</button></div>
            <div className={styles.formGrid}>
              <label><span>Product name *</span><input required value={form.name} onChange={(event) => setForm({ ...form, name: event.target.value })} /></label>
              <label><span>Brand</span><input value={form.brand} onChange={(event) => setForm({ ...form, brand: event.target.value })} /></label>
              <label><span>Category *</span><select required value={form.category} onChange={(event) => setForm({ ...form, category: event.target.value })}><option value="" disabled>Choose category</option>{categories.map((category) => <option key={category.id}>{category.name}</option>)}</select></label>
              <label><span>Catalog status</span><select value={form.status} onChange={(event) => setForm({ ...form, status: event.target.value as ProductStatus })}><option value="active">Active</option><option value="draft">Draft</option><option value="inactive">Inactive</option><option value="archived">Archived</option></select></label>
              <label><span>Regular daily price (PHP) *</span><input type="number" min="1" step="0.01" value={form.dailyRate} onChange={(event) => setForm({ ...form, dailyRate: Number(event.target.value) })} /></label>
              <label><span>Non-refundable deposit (PHP)</span><input type="number" min="0" step="0.01" value={form.refundableDeposit} onChange={(event) => setForm({ ...form, refundableDeposit: Number(event.target.value) })} /></label>
              <label><span>Discount percent</span><input type="number" min="0" max="90" step="1" value={form.discountPercent} onChange={(event) => setForm({ ...form, discountPercent: Number(event.target.value) })} /></label>
              <label><span>Discount label</span><input value={form.discountLabel} placeholder="Example: Weekday special" onChange={(event) => setForm({ ...form, discountLabel: event.target.value })} /></label>
              <label><span>Active rental units</span><input type="number" min="0" max="1000" value={form.totalUnits} onChange={(event) => setForm({ ...form, totalUnits: Number(event.target.value) })} /><small>Booked units cannot be removed.</small></label>
              <label><span>Catalog image</span><input type="file" accept="image/jpeg,image/png,image/webp" onChange={(event) => setImageFile(event.target.files?.[0] ?? null)} /><small>Optional for now. JPG, PNG, or WebP up to 10 MB.</small></label>
              <label className={styles.wide}><span>Short description</span><input maxLength={300} value={form.shortDescription ?? ""} onChange={(event) => setForm({ ...form, shortDescription: event.target.value })} /></label>
              <label className={styles.wide}><span>Detailed description</span><textarea rows={4} maxLength={3000} value={form.description} onChange={(event) => setForm({ ...form, description: event.target.value })} /></label>
              <label className={styles.wide}><span>Features / specifications</span><textarea rows={5} value={specificationsText} placeholder={"Storage: 256 GB\nColor: Natural Titanium\nCharging: USB-C"} onChange={(event) => setSpecificationsText(event.target.value)} /><small>One per line using Feature: Value.</small></label>
              <label className={styles.wide}><span>Included accessories</span><textarea rows={5} value={includedText} placeholder="One included item per line" onChange={(event) => setIncludedText(event.target.value)} /></label>
              <label className={styles.checkbox}><input type="checkbox" checked={form.isFeatured} onChange={(event) => setForm({ ...form, isFeatured: event.target.checked })} /><span>Feature this product on the storefront</span></label>
            </div>
            <div className={styles.editorActions}><button type="button" onClick={() => setEditing(null)} disabled={saving}>Cancel</button><button type="button" onClick={() => void saveProduct()} disabled={saving}>{saving ? "Saving..." : "Save Product"}</button></div>
          </section>
        </div>
      ) : null}

      {categoryEditing ? (
        <div className={styles.overlay} role="presentation" onMouseDown={() => !saving && setCategoryEditing(null)}>
          <section className={styles.smallEditor} role="dialog" aria-modal="true" aria-labelledby="category-editor-title" onMouseDown={(event) => event.stopPropagation()}>
            <div className={styles.editorHeader}><div><p>CATEGORY EDITOR</p><h2 id="category-editor-title">{categoryEditing === "new" ? "Add Category" : "Edit Category"}</h2></div><button type="button" onClick={() => setCategoryEditing(null)} disabled={saving}>Close</button></div>
            <div className={styles.formGrid}><label><span>Name *</span><input value={categoryForm.name} onChange={(event) => setCategoryForm({ ...categoryForm, name: event.target.value })} /></label><label><span>Display order</span><input type="number" min="0" value={categoryForm.sortOrder} onChange={(event) => setCategoryForm({ ...categoryForm, sortOrder: Number(event.target.value) })} /></label><label className={styles.wide}><span>Description</span><textarea rows={4} value={categoryForm.description} onChange={(event) => setCategoryForm({ ...categoryForm, description: event.target.value })} /></label></div>
            <div className={styles.editorActions}><button type="button" onClick={() => setCategoryEditing(null)} disabled={saving}>Cancel</button><button type="button" onClick={() => void saveCategory()} disabled={saving}>{saving ? "Saving..." : "Save Category"}</button></div>
          </section>
        </div>
      ) : null}

      {unitEditing && unitForm ? (
        <div className={styles.overlay} role="presentation" onMouseDown={() => !saving && setUnitEditing(null)}>
          <section className={styles.smallEditor} role="dialog" aria-modal="true" aria-labelledby="unit-editor-title" onMouseDown={(event) => event.stopPropagation()}>
            <div className={styles.editorHeader}><div><p>PHYSICAL UNIT</p><h2 id="unit-editor-title">Manage {unitEditing.unitCode}</h2></div><button type="button" onClick={() => setUnitEditing(null)} disabled={saving}>Close</button></div>
            {unitEditing.hasActiveReservation ? <p className={styles.protectedNotice}>This unit has an active reservation. Its identifying information can be updated, but it cannot be moved out of active service yet.</p> : null}
            <div className={styles.formGrid}>
              <label><span>Unit code *</span><input value={unitForm.unitCode} onChange={(event) => setUnitForm({ ...unitForm, unitCode: event.target.value })} /></label>
              <label><span>Serial number</span><input value={unitForm.serialNumber} onChange={(event) => setUnitForm({ ...unitForm, serialNumber: event.target.value })} /></label>
              <label><span>Lifecycle status</span><select value={unitForm.lifecycleStatus} onChange={(event) => setUnitForm({ ...unitForm, lifecycleStatus: event.target.value as InventoryUnitEditorInput["lifecycleStatus"] })}><option value="active">Active / rental-ready</option><option value="maintenance">Maintenance</option><option value="retired">Retired</option></select></label>
              <label><span>Acquired date</span><input type="date" value={unitForm.acquiredAt} onChange={(event) => setUnitForm({ ...unitForm, acquiredAt: event.target.value })} /></label>
              <label className={styles.wide}><span>Condition notes</span><textarea rows={4} value={unitForm.conditionNotes} onChange={(event) => setUnitForm({ ...unitForm, conditionNotes: event.target.value })} /></label>
            </div>
            <div className={styles.editorActions}><button type="button" onClick={() => setUnitEditing(null)} disabled={saving}>Cancel</button><button type="button" onClick={() => void saveUnit()} disabled={saving}>{saving ? "Saving..." : "Save Unit"}</button></div>
          </section>
        </div>
      ) : null}
    </div>
  );
}
