"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import Image from "next/image";
import { Button } from "@/components/ui/Button";
import ConfirmModal from "@/components/ui/ConfirmModal";
import Link from "next/link";
import { useToast } from "@/components/ui/ToastProvider";
import Spinner from "@/components/ui/Spinner";
import {
  createCatalogCategoryAsAdmin,
  createCatalogProductAsAdmin,
  deactivateCatalogProductAsAdmin,
  deleteCatalogCategoryAsAdmin,
  deleteCatalogImageAsAdmin,
  moderateProductReviewAsAdmin,
  replaceCatalogImageAsAdmin,
  setPrimaryCatalogImageAsAdmin,
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
import type { Product, ProductImage, ProductStatus } from "@/types/product";
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

const UNITS_PAGE_SIZE = 10;
const CATALOG_PAGE_SIZE = 10;

type CatalogTab = "catalog" | "units" | "reviews" | "pricing";

const catalogTabs: { value: CatalogTab; label: string }[] = [
  { value: "catalog", label: "Complete Catalog" },
  { value: "units", label: "Inventory Units" },
  { value: "reviews", label: "Reviews & Pricing" },
  { value: "pricing", label: "Recent Pricing Updates" },
];

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

interface ProductFieldSnapshot {
  name: string;
  brand: string;
  category: string;
  status: ProductStatus;
  dailyRate: number;
  refundableDeposit: number;
  discountPercent: number;
  discountLabel: string;
  totalUnits: number;
  shortDescription: string;
  description: string;
  specificationsText: string;
  includedText: string;
  isFeatured: boolean;
}

interface ProductFieldChange {
  label: string;
  detail: string;
}

function capitalizeStatus(status: string): string {
  return status.charAt(0).toUpperCase() + status.slice(1);
}

function describeProductChanges(before: ProductFieldSnapshot, after: ProductFieldSnapshot): ProductFieldChange[] {
  const changes: ProductFieldChange[] = [];
  const addText = (label: string, previous: string, next: string) => {
    if (previous !== next) changes.push({ label, detail: `${previous.trim() || "(none)"} → ${next.trim() || "(none)"}` });
  };
  addText("Product Name", before.name, after.name);
  addText("Brand", before.brand, after.brand);
  addText("Category", before.category, after.category);
  if (before.status !== after.status) {
    changes.push({ label: "Catalog Status", detail: `${capitalizeStatus(before.status)} → ${capitalizeStatus(after.status)}` });
  }
  if (before.dailyRate !== after.dailyRate) {
    changes.push({ label: "Regular Daily Price", detail: `${formatMoney(before.dailyRate)} → ${formatMoney(after.dailyRate)}` });
  }
  if (before.refundableDeposit !== after.refundableDeposit) {
    changes.push({ label: "Non-refundable Deposit", detail: `${formatMoney(before.refundableDeposit)} → ${formatMoney(after.refundableDeposit)}` });
  }
  if (before.discountPercent !== after.discountPercent) {
    changes.push({ label: "Discount %", detail: `${before.discountPercent}% → ${after.discountPercent}%` });
  }
  addText("Discount Label", before.discountLabel, after.discountLabel);
  if (before.totalUnits !== after.totalUnits) {
    changes.push({ label: "Active Rental Units", detail: `${before.totalUnits} → ${after.totalUnits}` });
  }
  addText("Short Description", before.shortDescription, after.shortDescription);
  if (before.description !== after.description) changes.push({ label: "Detailed Description", detail: "updated" });
  if (before.specificationsText !== after.specificationsText) changes.push({ label: "Specifications", detail: "updated" });
  if (before.includedText !== after.includedText) changes.push({ label: "Included Accessories", detail: "updated" });
  if (before.isFeatured !== after.isFeatured) {
    changes.push({ label: "Storefront Feature", detail: `${before.isFeatured ? "Yes" : "No"} → ${after.isFeatured ? "Yes" : "No"}` });
  }
  return changes;
}

export default function AdminCatalogManager() {
  const { showToast } = useToast();
  const [products, setProducts] = useState<Product[] | null>(null);
  const [categories, setCategories] = useState<AdminCatalogCategory[]>([]);
  const [inventoryUnits, setInventoryUnits] = useState<AdminInventoryUnit[]>([]);
  const [priceHistory, setPriceHistory] = useState<AdminPriceHistoryEntry[]>([]);
  const [reviews, setReviews] = useState<AdminProductReview[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [activeTab, setActiveTab] = useState<CatalogTab>("catalog");
  const [search, setSearch] = useState("");
  const [categoryFilter, setCategoryFilter] = useState("All");
  const [statusFilter, setStatusFilter] = useState<"all" | ProductStatus>("all");
  const [inventoryProductFilter, setInventoryProductFilter] = useState("all");
  const [unitsPage, setUnitsPage] = useState(1);
  const [catalogPage, setCatalogPage] = useState(1);
  const [editing, setEditing] = useState<Product | "new" | null>(null);
  const [form, setForm] = useState<CatalogEditorInput>(blankForm);
  const [includedText, setIncludedText] = useState("");
  const [specificationsText, setSpecificationsText] = useState("");
  const [imageFile, setImageFile] = useState<File | null>(null);
  const photoInputRef = useRef<HTMLInputElement>(null);
  const [pendingPhotoAction, setPendingPhotoAction] = useState<
    { type: "add" } | { type: "replace"; imageId: string } | null
  >(null);
  const [photoBusyId, setPhotoBusyId] = useState<string | null>(null);
  const [productSnapshot, setProductSnapshot] = useState<ProductFieldSnapshot | null>(null);
  const [productSaveConfirm, setProductSaveConfirm] = useState<
    { kind: "create" } | { kind: "update"; changes: ProductFieldChange[] } | null
  >(null);
  const [replaceConfirmImageId, setReplaceConfirmImageId] = useState<string | null>(null);
  const [setMainConfirmImage, setSetMainConfirmImage] = useState<ProductImage | null>(null);
  const [categoriesModalOpen, setCategoriesModalOpen] = useState(false);
  const [categoryEditing, setCategoryEditing] = useState<AdminCatalogCategory | "new" | null>(null);
  const [categoryForm, setCategoryForm] = useState<CatalogCategoryInput>(blankCategory);
  const [unitEditing, setUnitEditing] = useState<AdminInventoryUnit | null>(null);
  const [unitForm, setUnitForm] = useState<InventoryUnitEditorInput | null>(null);
  const [saving, setSaving] = useState(false);
  const [confirmDialog, setConfirmDialog] = useState<{
    title: string;
    message: string;
    confirmLabel: string;
    successMessage: string;
    /** When set, re-syncs the open product editor with this product's fresh data after the action runs. */
    focusProductId?: string;
    action: () => Promise<void>;
  } | null>(null);
  const [confirmBusy, setConfirmBusy] = useState(false);

  const load = useCallback(async (focusProductId?: string) => {
    setError(null);
    try {
      const data = await getAdminCatalog();
      setProducts(data.products);
      setCategories(data.categories);
      setInventoryUnits(data.inventoryUnits);
      setPriceHistory(data.priceHistory);
      setReviews(data.reviews);
      if (focusProductId) {
        setEditing((current) =>
          current !== "new" && current && current.id === focusProductId
            ? data.products.find((product) => product.id === focusProductId) ?? current
            : current,
        );
      }
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

  const catalogPageCount = Math.max(1, Math.ceil(filteredProducts.length / CATALOG_PAGE_SIZE));
  const catalogCurrentPage = Math.min(catalogPage, catalogPageCount);
  const pagedProducts = filteredProducts.slice(
    (catalogCurrentPage - 1) * CATALOG_PAGE_SIZE,
    catalogCurrentPage * CATALOG_PAGE_SIZE,
  );

  const visibleInventoryUnits = useMemo(
    () => inventoryUnits.filter((unit) => inventoryProductFilter === "all" || unit.productId === inventoryProductFilter),
    [inventoryProductFilter, inventoryUnits],
  );

  const unitsPageCount = Math.max(1, Math.ceil(visibleInventoryUnits.length / UNITS_PAGE_SIZE));
  const unitsCurrentPage = Math.min(unitsPage, unitsPageCount);
  const pagedInventoryUnits = visibleInventoryUnits.slice(
    (unitsCurrentPage - 1) * UNITS_PAGE_SIZE,
    unitsCurrentPage * UNITS_PAGE_SIZE,
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
      const includedTextValue = product.included.join("\n");
      const specificationsTextValue = Object.entries(product.specs).map(([key, value]) => `${key}: ${value}`).join("\n");
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
      setIncludedText(includedTextValue);
      setSpecificationsText(specificationsTextValue);
      setProductSnapshot({
        name: product.name,
        brand: product.brand ?? "",
        category: product.category,
        status: product.status,
        dailyRate: product.dailyRate,
        refundableDeposit: product.refundableDeposit,
        discountPercent: product.discountPercent,
        discountLabel: product.discountLabel ?? "",
        totalUnits: product.totalUnits,
        shortDescription: product.shortDescription ?? "",
        description: product.description ?? "",
        specificationsText: specificationsTextValue,
        includedText: includedTextValue,
        isFeatured: product.isFeatured,
      });
    } else {
      setEditing("new");
      setForm({ ...blankForm, category: categories[0]?.name ?? "" });
      setIncludedText("");
      setSpecificationsText("");
      setProductSnapshot(null);
    }
    setImageFile(null);
    setPendingPhotoAction(null);
    setPhotoBusyId(null);
    setProductSaveConfirm(null);
  }

  function closeEditor() {
    setEditing(null);
    setPendingPhotoAction(null);
    setPhotoBusyId(null);
    setProductSnapshot(null);
    setProductSaveConfirm(null);
  }

  function requestSaveProduct() {
    if (saving) return;
    if (!editing) return;
    if (!form.name.trim()) {
      showToast("Product name is required.", "error");
      return;
    }
    if (!form.category) {
      showToast("Choose a category for this product.", "error");
      return;
    }
    if (!(form.dailyRate > 0)) {
      showToast("Enter a regular daily price greater than zero.", "error");
      return;
    }
    if (editing === "new" || !productSnapshot) {
      setProductSaveConfirm({ kind: "create" });
      return;
    }
    const currentSnapshot: ProductFieldSnapshot = {
      name: form.name,
      brand: form.brand ?? "",
      category: form.category,
      status: form.status,
      dailyRate: form.dailyRate,
      refundableDeposit: form.refundableDeposit,
      discountPercent: form.discountPercent,
      discountLabel: form.discountLabel ?? "",
      totalUnits: form.totalUnits,
      shortDescription: form.shortDescription ?? "",
      description: form.description,
      specificationsText,
      includedText,
      isFeatured: form.isFeatured,
    };
    const changes = describeProductChanges(productSnapshot, currentSnapshot);
    if (changes.length === 0) {
      showToast("No changes to save.", "error");
      return;
    }
    setProductSaveConfirm({ kind: "update", changes });
  }

  async function saveProduct() {
    if (saving) return;
    if (!editing) return;
    if (!form.name.trim()) {
      showToast("Product name is required.", "error");
      return;
    }
    if (!form.category) {
      showToast("Choose a category for this product.", "error");
      return;
    }
    if (!(form.dailyRate > 0)) {
      showToast("Enter a regular daily price greater than zero.", "error");
      return;
    }
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
      closeEditor();
      showToast("Product details and inventory updated.", "success");
    } catch (saveError) {
      showToast(saveError instanceof Error ? saveError.message : "The product could not be saved.", "error");
    } finally {
      setSaving(false);
    }
  }

  function requestDeactivate(product: Product) {
    setConfirmDialog({
      title: `Remove ${product.name}?`,
      message: "This hides the product from the public catalog. Historical bookings and unit records will remain.",
      confirmLabel: "Remove Product",
      successMessage: "Product removed from the public catalog.",
      action: async () => {
        await deactivateCatalogProductAsAdmin(product.id);
      },
    });
  }

  function triggerAddPhoto() {
    setPendingPhotoAction({ type: "add" });
    photoInputRef.current?.click();
  }

  function triggerReplacePhoto(imageId: string) {
    setPendingPhotoAction({ type: "replace", imageId });
    photoInputRef.current?.click();
  }

  function requestReplacePhoto(imageId: string) {
    setReplaceConfirmImageId(imageId);
  }

  async function handlePhotoFileSelected(file: File | null) {
    const action = pendingPhotoAction;
    setPendingPhotoAction(null);
    if (photoInputRef.current) photoInputRef.current.value = "";
    if (!file || !action || editing === "new" || !editing) return;
    const productId = editing.id;
    setPhotoBusyId(action.type === "replace" ? action.imageId : "new");
    try {
      if (action.type === "add") {
        await uploadCatalogImage(productId, file);
        showToast("Photo added.", "success");
      } else {
        await replaceCatalogImageAsAdmin(productId, action.imageId, file);
        showToast("Photo replaced.", "success");
      }
      await load(productId);
    } catch (photoError) {
      showToast(photoError instanceof Error ? photoError.message : "The photo could not be saved.", "error");
    } finally {
      setPhotoBusyId(null);
    }
  }

  async function setMainPhoto(imageId: string) {
    if (editing === "new" || !editing) return;
    const productId = editing.id;
    setPhotoBusyId(imageId);
    try {
      await setPrimaryCatalogImageAsAdmin(productId, imageId);
      await load(productId);
      showToast("Main photo updated.", "success");
    } catch (photoError) {
      showToast(photoError instanceof Error ? photoError.message : "The main photo could not be updated.", "error");
    } finally {
      setPhotoBusyId(null);
    }
  }

  function requestSetMainPhoto(image: ProductImage) {
    setSetMainConfirmImage(image);
  }

  function requestDeletePhoto(image: ProductImage) {
    if (editing === "new" || !editing) return;
    const productId = editing.id;
    setConfirmDialog({
      title: "Delete this photo?",
      message: "This permanently removes the photo from Supabase Storage. This cannot be undone.",
      confirmLabel: "Delete Photo",
      successMessage: "Photo deleted.",
      focusProductId: productId,
      action: async () => {
        await deleteCatalogImageAsAdmin(productId, image.id);
      },
    });
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
    if (saving) return;
    if (!categoryEditing) return;
    if (!categoryForm.name.trim()) {
      showToast("Category name is required.", "error");
      return;
    }
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

  function requestRemoveCategory(category: AdminCatalogCategory) {
    setConfirmDialog({
      title: `Delete ${category.name}?`,
      message: "This permanently deletes the category. Products in it must be reassigned first.",
      confirmLabel: "Delete Category",
      successMessage: "Category deleted.",
      action: async () => {
        await deleteCatalogCategoryAsAdmin(category.id);
      },
    });
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
    if (saving) return;
    if (!unitEditing || !unitForm) return;
    if (!unitForm.unitCode.trim()) {
      showToast("Unit code is required.", "error");
      return;
    }
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

  async function runConfirmedAction() {
    if (!confirmDialog || confirmBusy) return;
    setConfirmBusy(true);
    try {
      await confirmDialog.action();
      await load(confirmDialog.focusProductId);
      setConfirmDialog(null);
      showToast(confirmDialog.successMessage, "success");
    } catch (actionError) {
      showToast(actionError instanceof Error ? actionError.message : "The action could not be completed.", "error");
    } finally {
      setConfirmBusy(false);
    }
  }

  return (
    <div className={styles.page}>
      <header className={styles.header}>
        <p>CATALOG &amp; INVENTORY</p>
        <h1>Rental Inventory</h1>
        <span>Manage listings, categories, pricing, discounts, and every physical rental unit.</span>
      </header>

      <div className={styles.tabBar}>
      <nav className={styles.tabNav} role="tablist" aria-label="Catalog sections">
        {catalogTabs.map((tab) => (
          <Button variant="none"
            key={tab.value}
            type="button"
            role="tab"
            id={`catalog-tab-${tab.value}`}
            aria-selected={activeTab === tab.value}
            aria-controls={`catalog-panel-${tab.value}`}
            className={activeTab === tab.value ? styles.activeTab : undefined}
            onClick={() => setActiveTab(tab.value)}
          >
            {tab.label}
          </Button>
        ))}
      </nav>
      </div>

      {error ? <div className={styles.error} role="alert">{error}<Button variant="none" type="button" onClick={() => void load()}>Try again</Button></div> : null}

      {activeTab === "catalog" ? (
      <div id="catalog-panel-catalog" role="tabpanel" aria-labelledby="catalog-tab-catalog">
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
            <input type="search" value={search} onChange={(event) => { setSearch(event.target.value); setCatalogPage(1); }} placeholder="Search by name, brand, description, or specification" />
          </label>
          <label className={styles.filterField}>
            <span className={styles.srOnly}>Category</span>
            <select value={categoryFilter} onChange={(event) => { setCategoryFilter(event.target.value); setCatalogPage(1); }}><option>All categories</option>{categories.map((category) => <option key={category.id}>{category.name}</option>)}</select>
          </label>
          <label className={styles.filterField}>
            <span className={styles.srOnly}>Status</span>
            <select value={statusFilter} onChange={(event) => { setStatusFilter(event.target.value as typeof statusFilter); setCatalogPage(1); }}><option value="all">All statuses</option><option value="active">Active</option><option value="draft">Draft</option><option value="inactive">Inactive</option><option value="archived">Archived</option></select>
          </label>
          <Button variant="none" type="button" className={styles.addButton} onClick={() => setCategoriesModalOpen(true)}>Manage Categories</Button>
          <Button variant="none" type="button" className={styles.addButton} onClick={() => openEditor()}>+ Add Product</Button>
        </div>
      </section>

      <section className={styles.section} aria-labelledby="products-heading">
        <div className={styles.sectionHeading}>
          <div><p>PRODUCTS</p><h2 id="products-heading">Complete Catalog</h2></div>
          <span>{filteredProducts.length} shown · auto-updates</span>
        </div>

        {!products && !error ? <div className={styles.loading}><Spinner size={28} label="Loading catalog" /></div> : null}
        {products && filteredProducts.length === 0 ? <div className={styles.empty}>No products match the current search and filters.</div> : null}
        {products && filteredProducts.length > 0 ? (
          <div className={styles.grid}>
            {pagedProducts.map((product) => {
              const productUnits = inventoryUnits.filter((unit) => unit.productId === product.id);
              const maintenanceCount = productUnits.filter((unit) => unit.lifecycleStatus === "maintenance").length;
              return (
                <article key={product.id} className={styles.card}>
                  <div className={styles.imageWrap}>
                    <Image src={product.image || "/images/product-placeholder.png"} alt={`${product.name} catalog preview`} fill sizes="(max-width:650px) 100vw, (max-width:900px) 45vw, (max-width:1200px) 30vw, 22vw" className={styles.image} />
                    <span className={styles.categoryTag}>{product.category}</span>
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
                      <div><dt>Availability</dt><dd>{product.availableUnits} / {product.totalUnits}</dd></div>
                      <div><dt>Maintenance</dt><dd>{maintenanceCount}</dd></div>
                      <div><dt>Specifications</dt><dd>{Object.keys(product.specs).length}</dd></div>
                    </dl>
                    <div className={styles.statusLine}>
                      <span className={styles.statusLineLabel}>Product status</span>
                      <i className={styles.statusTag} data-status={product.status}>{product.status}</i>
                    </div>
                    {(!product.description || Object.keys(product.specs).length === 0) ? <p className={styles.contentWarning}>Needs more product details</p> : null}
                    <div className={styles.actions}>
                      <div className={styles.actionRow}>
                        <Button variant="none" type="button" className={styles.primaryAction} onClick={() => openEditor(product)}>View / Edit</Button>
                        {product.isActive ? <Link className={styles.secondaryAction} href={`/catalog/${product.id}`} target="_blank">Public page</Link> : null}
                      </div>
                      {product.isActive ? <Button variant="none" type="button" className={styles.removeAction} onClick={() => requestDeactivate(product)}>Remove</Button> : null}
                    </div>
                  </div>
                </article>
              );
            })}
          </div>
        ) : null}
        {products && filteredProducts.length > CATALOG_PAGE_SIZE ? (
          <nav className={styles.pagination} aria-label="Catalog pagination">
            <span>
              Showing {(catalogCurrentPage - 1) * CATALOG_PAGE_SIZE + 1}&ndash;{Math.min(catalogCurrentPage * CATALOG_PAGE_SIZE, filteredProducts.length)} of {filteredProducts.length}
            </span>
            <div>
              <Button variant="none" type="button" disabled={catalogCurrentPage === 1} onClick={() => setCatalogPage(catalogCurrentPage - 1)}>Previous</Button>
              {Array.from({ length: catalogPageCount }, (_, index) => index + 1).map((pageNumber) => (
                <Button variant="none"
                  key={pageNumber}
                  type="button"
                  className={pageNumber === catalogCurrentPage ? styles.pageActive : undefined}
                  aria-current={pageNumber === catalogCurrentPage ? "page" : undefined}
                  onClick={() => setCatalogPage(pageNumber)}
                >
                  {pageNumber}
                </Button>
              ))}
              <Button variant="none" type="button" disabled={catalogCurrentPage === catalogPageCount} onClick={() => setCatalogPage(catalogCurrentPage + 1)}>Next</Button>
            </div>
          </nav>
        ) : null}
      </section>
      </div>
      ) : null}

      {activeTab === "units" ? (
      <div id="catalog-panel-units" role="tabpanel" aria-labelledby="catalog-tab-units">
      <section className={styles.section} aria-labelledby="units-heading">
        <div className={styles.sectionHeading}>
          <div><p>PHYSICAL UNITS</p><h2 id="units-heading">Inventory Management</h2></div>
          <label className={styles.compactFilter}><span>Product</span><select value={inventoryProductFilter} onChange={(event) => { setInventoryProductFilter(event.target.value); setUnitsPage(1); }}><option value="all">All products</option>{(products ?? []).map((product) => <option key={product.id} value={product.id}>{product.name}</option>)}</select></label>
        </div>
        <p className={styles.sectionCopy}>Availability updates automatically when units move between active, maintenance, and retired states. Units with active reservations are protected.</p>
        <div className={styles.tableWrap}>
          {visibleInventoryUnits.length === 0 ? <div className={styles.emptySmall}>{inventoryProductFilter === "all" ? "No physical units have been added yet." : "No units belong to the selected product."}</div> : (
          <table><thead><tr><th>Unit code</th><th>Product</th><th>Serial number</th><th>Status</th><th>Reservation</th><th>Action</th></tr></thead>
            <tbody>{pagedInventoryUnits.map((unit) => <tr key={unit.id}>
              <td data-label="Unit code"><strong>{unit.unitCode}</strong></td><td data-label="Product">{products?.find((product) => product.id === unit.productId)?.name ?? "Product"}</td><td data-label="Serial number">{unit.serialNumber || "Not recorded"}</td>
              <td data-label="Status"><span className={styles.unitStatus} data-status={unit.lifecycleStatus}>{unit.lifecycleStatus}</span></td><td data-label="Reservation">{unit.hasActiveReservation ? "Reserved / in use" : "Clear"}</td>
              <td data-label="Action"><Button variant="none" type="button" className={styles.tableButton} onClick={() => openUnitEditor(unit)}>Manage</Button></td>
            </tr>)}</tbody>
          </table>
          )}
        </div>
        {visibleInventoryUnits.length > UNITS_PAGE_SIZE ? (
          <nav className={styles.pagination} aria-label="Inventory units pagination">
            <span>
              Showing {(unitsCurrentPage - 1) * UNITS_PAGE_SIZE + 1}&ndash;{Math.min(unitsCurrentPage * UNITS_PAGE_SIZE, visibleInventoryUnits.length)} of {visibleInventoryUnits.length}
            </span>
            <div>
              <Button variant="none" type="button" disabled={unitsCurrentPage === 1} onClick={() => setUnitsPage(unitsCurrentPage - 1)}>Previous</Button>
              {Array.from({ length: unitsPageCount }, (_, index) => index + 1).map((pageNumber) => (
                <Button variant="none"
                  key={pageNumber}
                  type="button"
                  className={pageNumber === unitsCurrentPage ? styles.pageActive : undefined}
                  aria-current={pageNumber === unitsCurrentPage ? "page" : undefined}
                  onClick={() => setUnitsPage(pageNumber)}
                >
                  {pageNumber}
                </Button>
              ))}
              <Button variant="none" type="button" disabled={unitsCurrentPage === unitsPageCount} onClick={() => setUnitsPage(unitsCurrentPage + 1)}>Next</Button>
            </div>
          </nav>
        ) : null}
      </section>
      </div>
      ) : null}

      {activeTab === "reviews" ? (
      <div id="catalog-panel-reviews" role="tabpanel" aria-labelledby="catalog-tab-reviews">
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
            {review.status === "pending" ? <div className={styles.tableActions}><Button variant="none" type="button" onClick={() => void moderateReview(review, "approved")}>Approve</Button><Button variant="none" type="button" className={styles.dangerText} onClick={() => void moderateReview(review, "rejected")}>Reject</Button></div> : null}
          </article>)}</div>
        )}
      </section>
      </div>
      ) : null}

      {activeTab === "pricing" ? (
      <div id="catalog-panel-pricing" role="tabpanel" aria-labelledby="catalog-tab-pricing">
      <section className={styles.history}>
        <div><p>PRICE CHANGE HISTORY</p><h2>Recent Pricing Updates</h2></div>
        <div className={styles.tableWrap}>
          {priceHistory.length === 0 ? <div className={styles.emptySmall}>No price changes have been recorded yet.</div> : (
          <table><thead><tr><th>Product</th><th>Previous</th><th>New price</th><th>Reason</th><th>Date</th></tr></thead>
          <tbody>{[...priceHistory].sort((a, b) => Date.parse(b.createdAt || "") - Date.parse(a.createdAt || "")).slice(0, 20).map((entry) => <tr key={`${entry.productId}-${entry.id}`}>
            <td data-label="Product">{products?.find((product) => product.id === entry.productId)?.name ?? entry.productId}</td><td data-label="Previous">{entry.previousPrice === null ? "Initial" : formatMoney(entry.previousPrice)}</td><td data-label="New price">{formatMoney(entry.newPrice)}</td><td data-label="Reason">{entry.reason || "Catalog pricing update"}</td><td data-label="Date">{entry.createdAt ? new Date(entry.createdAt).toLocaleString("en-PH") : "—"}</td>
          </tr>)}</tbody></table>
          )}</div>
      </section>
      </div>
      ) : null}

      {editing ? (
        <div className={styles.overlay} role="presentation" onMouseDown={() => !saving && closeEditor()}>
          <form onSubmit={(event) => { event.preventDefault(); requestSaveProduct(); }} aria-busy={saving} className={styles.editor} role="dialog" aria-modal="true" aria-labelledby="product-editor-title" onMouseDown={(event) => event.stopPropagation()}>
            <div className={styles.editorHeader}><div><p>PRODUCT EDITOR</p><h2 id="product-editor-title">{editing === "new" ? "Add Product" : `Edit ${editing.name}`}</h2></div><Button variant="none" type="button" onClick={closeEditor} disabled={saving}>Close</Button></div>
            <div className={styles.formSections}>
              <div className={styles.formSection}>
                <h3 className={styles.formSectionTitle}>Basic Information</h3>
                <div className={styles.formGrid}>
                  <label><span>Product name *</span><input required value={form.name} onChange={(event) => setForm({ ...form, name: event.target.value })} /></label>
                  <label><span>Brand</span><input value={form.brand} onChange={(event) => setForm({ ...form, brand: event.target.value })} /></label>
                  <label><span>Category *</span><select required value={form.category} onChange={(event) => setForm({ ...form, category: event.target.value })}><option value="" disabled>Choose category</option>{categories.map((category) => <option key={category.id}>{category.name}</option>)}</select></label>
                  <label><span>Catalog status</span><select value={form.status} onChange={(event) => setForm({ ...form, status: event.target.value as ProductStatus })}><option value="active">Active</option><option value="draft">Draft</option><option value="inactive">Inactive</option><option value="archived">Archived</option></select></label>
                </div>
              </div>

              <div className={styles.formSection}>
                <h3 className={styles.formSectionTitle}>Pricing</h3>
                <div className={styles.formGrid}>
                  <label><span>Regular daily price (PHP) *</span><input type="number" min="1" step="0.01" value={form.dailyRate} onChange={(event) => setForm({ ...form, dailyRate: Number(event.target.value) })} /></label>
                  <label><span>Non-refundable deposit (PHP)</span><input type="number" min="0" step="0.01" value={form.refundableDeposit} onChange={(event) => setForm({ ...form, refundableDeposit: Number(event.target.value) })} /></label>
                  <label><span>Discount percent</span><input type="number" min="0" max="90" step="1" value={form.discountPercent} onChange={(event) => setForm({ ...form, discountPercent: Number(event.target.value) })} /></label>
                  <label><span>Discount label</span><input value={form.discountLabel} placeholder="Example: Weekday special" onChange={(event) => setForm({ ...form, discountLabel: event.target.value })} /></label>
                </div>
              </div>

              <div className={styles.formSection}>
                <h3 className={styles.formSectionTitle}>Inventory</h3>
                <div className={styles.formGrid}>
                  <label className={styles.wide}><span>Active rental units</span><input type="number" min="0" max="1000" value={form.totalUnits} onChange={(event) => setForm({ ...form, totalUnits: Number(event.target.value) })} /><small>Booked units cannot be removed.</small></label>
                </div>
              </div>

              <div className={styles.formSection}>
                <h3 className={styles.formSectionTitle}>Product Photos</h3>
                <div className={styles.formGrid}>
                  {editing !== "new" ? (
                    <div className={`${styles.wide} ${styles.gallerySection}`}>
                      <span className={styles.galleryLabel}>Product photos</span>
                      {editing.images.length === 0 ? (
                        <div className={styles.galleryEmpty}>
                          <Image src="/images/product-placeholder.png" alt="No photos uploaded yet" width={64} height={64} />
                          <p>No photos uploaded yet.</p>
                        </div>
                      ) : (
                        <div className={styles.galleryGrid}>
                          {editing.images.map((image) => (
                            <div key={image.id} className={styles.galleryItem}>
                              <div className={styles.galleryThumbWrap}>
                                <Image src={image.url} alt={image.altText || "Product photo"} fill sizes="140px" className={styles.galleryThumb} />
                                {image.isPrimary ? <span className={styles.galleryPrimaryBadge}>Main</span> : null}
                                {photoBusyId === image.id ? <div className={styles.galleryThumbBusy}><Spinner size={20} /></div> : null}
                              </div>
                              <div className={styles.galleryItemActions}>
                                {!image.isPrimary ? (
                                  <Button variant="none" type="button" className={styles.galleryLinkButton} disabled={photoBusyId !== null} onClick={() => requestSetMainPhoto(image)}>Set as main</Button>
                                ) : null}
                                <Button variant="none" type="button" className={styles.galleryLinkButton} disabled={photoBusyId !== null} onClick={() => requestReplacePhoto(image.id)}>Replace</Button>
                                <Button variant="none" type="button" className={`${styles.galleryLinkButton} ${styles.dangerText}`} disabled={photoBusyId !== null} onClick={() => requestDeletePhoto(image)}>Delete</Button>
                              </div>
                            </div>
                          ))}
                        </div>
                      )}
                      <Button variant="none" type="button" className={styles.galleryAddButton} disabled={photoBusyId !== null} onClick={triggerAddPhoto}>+ Add photos</Button>
                      <small>JPG, PNG, or WebP up to 10 MB each. Changes save immediately.</small>
                      <input
                        ref={photoInputRef}
                        type="file"
                        accept="image/jpeg,image/png,image/webp"
                        className={styles.srOnly}
                        onChange={(event) => void handlePhotoFileSelected(event.target.files?.[0] ?? null)}
                      />
                    </div>
                  ) : (
                    <label className={styles.wide}><span>Catalog image</span><input type="file" accept="image/jpeg,image/png,image/webp" onChange={(event) => setImageFile(event.target.files?.[0] ?? null)} /><small>Optional for now. JPG, PNG, or WebP up to 10 MB. Add more photos after creating the product.</small></label>
                  )}
                </div>
              </div>

              <div className={styles.formSection}>
                <h3 className={styles.formSectionTitle}>Product Details</h3>
                <div className={styles.formGrid}>
                  <label className={styles.wide}><span>Short description</span><input maxLength={300} value={form.shortDescription ?? ""} onChange={(event) => setForm({ ...form, shortDescription: event.target.value })} /></label>
                  <label className={styles.wide}><span>Detailed description</span><textarea rows={4} maxLength={3000} value={form.description} onChange={(event) => setForm({ ...form, description: event.target.value })} /></label>
                </div>
              </div>

              <div className={styles.formSection}>
                <h3 className={styles.formSectionTitle}>Specifications</h3>
                <div className={styles.formGrid}>
                  <label className={styles.wide}><span>Features / specifications</span><textarea rows={5} value={specificationsText} placeholder={"Storage: 256 GB\nColor: Natural Titanium\nCharging: USB-C"} onChange={(event) => setSpecificationsText(event.target.value)} /><small>One per line using Feature: Value.</small></label>
                </div>
              </div>

              <div className={styles.formSection}>
                <h3 className={styles.formSectionTitle}>Included Accessories</h3>
                <div className={styles.formGrid}>
                  <label className={styles.wide}><span>Included accessories</span><textarea rows={5} value={includedText} placeholder="One included item per line" onChange={(event) => setIncludedText(event.target.value)} /></label>
                </div>
              </div>

              <div className={styles.formSection}>
                <h3 className={styles.formSectionTitle}>Storefront Settings</h3>
                <div className={styles.formGrid}>
                  <label className={styles.checkbox}><input type="checkbox" checked={form.isFeatured} onChange={(event) => setForm({ ...form, isFeatured: event.target.checked })} /><span>Feature this product on the storefront</span></label>
                </div>
              </div>
            </div>
            <div className={styles.editorActions}><Button variant="none" type="button" onClick={closeEditor} disabled={saving}>Cancel</Button><Button variant="primary" type="submit" loading={saving} loadingText="Saving...">Save Product</Button></div>
          </form>
        </div>
      ) : null}

      {categoriesModalOpen ? (
        <div className={styles.overlay} role="presentation" onMouseDown={() => setCategoriesModalOpen(false)}>
          <section className={styles.editor} role="dialog" aria-modal="true" aria-labelledby="categories-modal-title" onMouseDown={(event) => event.stopPropagation()}>
            <div className={styles.editorHeader}><div><p>CATEGORIES</p><h2 id="categories-modal-title">Manage Categories</h2></div><Button variant="none" type="button" onClick={() => setCategoriesModalOpen(false)}>Close</Button></div>
            <div className={styles.sectionHeading}>
              <span>{categories.length} categories</span>
              <Button variant="none" type="button" onClick={() => openCategoryEditor()}>Add Category</Button>
            </div>
            <div className={styles.tableWrap}>
              {categories.length === 0 ? <div className={styles.emptySmall}>No categories yet. Add one to organize the catalog.</div> : (
              <table><thead><tr><th>Name</th><th>Description</th><th>Products</th><th>Order</th><th>Actions</th></tr></thead>
                <tbody>{categories.map((category) => <tr key={category.id}>
                  <td data-label="Name"><strong>{category.name}</strong></td><td data-label="Description">{category.description || "No description"}</td><td data-label="Products">{category.productCount}</td><td data-label="Order">{category.sortOrder}</td>
                  <td data-label="Actions"><div className={styles.tableActions}><Button variant="none" type="button" onClick={() => openCategoryEditor(category)}>Edit</Button><Button variant="none" type="button" className={styles.dangerText} onClick={() => requestRemoveCategory(category)}>Delete</Button></div></td>
                </tr>)}</tbody>
              </table>
              )}
            </div>
          </section>
        </div>
      ) : null}

      {categoryEditing ? (
        <div className={styles.overlay} role="presentation" onMouseDown={() => !saving && setCategoryEditing(null)}>
          <form onSubmit={(event) => { event.preventDefault(); void saveCategory(); }} aria-busy={saving} className={styles.smallEditor} role="dialog" aria-modal="true" aria-labelledby="category-editor-title" onMouseDown={(event) => event.stopPropagation()}>
            <div className={styles.editorHeader}><div><p>CATEGORY EDITOR</p><h2 id="category-editor-title">{categoryEditing === "new" ? "Add Category" : "Edit Category"}</h2></div><Button variant="none" type="button" onClick={() => setCategoryEditing(null)} disabled={saving}>Close</Button></div>
            <div className={styles.formGrid}><label><span>Name *</span><input value={categoryForm.name} onChange={(event) => setCategoryForm({ ...categoryForm, name: event.target.value })} /></label><label><span>Display order</span><input type="number" min="0" value={categoryForm.sortOrder} onChange={(event) => setCategoryForm({ ...categoryForm, sortOrder: Number(event.target.value) })} /></label><label className={styles.wide}><span>Description</span><textarea rows={4} value={categoryForm.description} onChange={(event) => setCategoryForm({ ...categoryForm, description: event.target.value })} /></label></div>
            <div className={styles.editorActions}><Button variant="none" type="button" onClick={() => setCategoryEditing(null)} disabled={saving}>Cancel</Button><Button variant="primary" type="submit" loading={saving} loadingText="Saving...">Save Category</Button></div>
          </form>
        </div>
      ) : null}

      {unitEditing && unitForm ? (
        <div className={styles.overlay} role="presentation" onMouseDown={() => !saving && setUnitEditing(null)}>
          <form onSubmit={(event) => { event.preventDefault(); void saveUnit(); }} aria-busy={saving} className={styles.smallEditor} role="dialog" aria-modal="true" aria-labelledby="unit-editor-title" onMouseDown={(event) => event.stopPropagation()}>
            <div className={styles.editorHeader}><div><p>PHYSICAL UNIT</p><h2 id="unit-editor-title">Manage {unitEditing.unitCode}</h2></div><Button variant="none" type="button" onClick={() => setUnitEditing(null)} disabled={saving}>Close</Button></div>
            {unitEditing.hasActiveReservation ? <p className={styles.protectedNotice}>This unit has an active reservation. Its identifying information can be updated, but it cannot be moved out of active service yet.</p> : null}
            <div className={styles.formGrid}>
              <label><span>Unit code *</span><input value={unitForm.unitCode} onChange={(event) => setUnitForm({ ...unitForm, unitCode: event.target.value })} /></label>
              <label><span>Serial number</span><input value={unitForm.serialNumber} onChange={(event) => setUnitForm({ ...unitForm, serialNumber: event.target.value })} /></label>
              <label><span>Lifecycle status</span><select value={unitForm.lifecycleStatus} onChange={(event) => setUnitForm({ ...unitForm, lifecycleStatus: event.target.value as InventoryUnitEditorInput["lifecycleStatus"] })}><option value="active">Active / rental-ready</option><option value="maintenance">Maintenance</option><option value="retired">Retired</option></select></label>
              <label><span>Acquired date</span><input type="date" value={unitForm.acquiredAt} onChange={(event) => setUnitForm({ ...unitForm, acquiredAt: event.target.value })} /></label>
              <label className={styles.wide}><span>Condition notes</span><textarea rows={4} value={unitForm.conditionNotes} onChange={(event) => setUnitForm({ ...unitForm, conditionNotes: event.target.value })} /></label>
            </div>
            <div className={styles.editorActions}><Button variant="none" type="button" onClick={() => setUnitEditing(null)} disabled={saving}>Cancel</Button><Button variant="primary" type="submit" loading={saving} loadingText="Saving...">Save Unit</Button></div>
          </form>
        </div>
      ) : null}
      {confirmDialog ? (
        <ConfirmModal
          title={confirmDialog.title}
          description={confirmDialog.message}
          confirmLabel={confirmDialog.confirmLabel}
          busyLabel="Working..."
          tone="danger"
          onCancel={() => setConfirmDialog(null)}
          onConfirm={() => void runConfirmedAction()}
          busy={confirmBusy}
        />
      ) : null}

      {productSaveConfirm ? (
        <ConfirmModal
          title={productSaveConfirm.kind === "create" ? "Create New Product" : "Save Product Changes"}
          description={
            productSaveConfirm.kind === "create"
              ? "Are you sure you want to create this product?"
              : "Are you sure you want to save these product changes?"
          }
          confirmLabel="Confirm & Save"
          busyLabel="Saving..."
          busy={saving}
          onCancel={() => setProductSaveConfirm(null)}
          onConfirm={() => void saveProduct()}
        >
          {productSaveConfirm.kind === "update" ? (
            <ul className={styles.changeList}>
              {productSaveConfirm.changes.map((change) => (
                <li key={change.label}><strong>{change.label}:</strong> {change.detail}</li>
              ))}
            </ul>
          ) : null}
        </ConfirmModal>
      ) : null}

      {replaceConfirmImageId ? (
        <ConfirmModal
          title="Replace this photo?"
          description="This uploads a new photo and permanently replaces the current one in Supabase Storage."
          confirmLabel="Choose New Photo"
          onCancel={() => setReplaceConfirmImageId(null)}
          onConfirm={() => {
            const imageId = replaceConfirmImageId;
            setReplaceConfirmImageId(null);
            if (imageId) triggerReplacePhoto(imageId);
          }}
        />
      ) : null}

      {setMainConfirmImage ? (
        <ConfirmModal
          title="Set as main photo?"
          description="This photo will become the main image shown for this product across the storefront."
          confirmLabel="Set as Main"
          busyLabel="Updating..."
          busy={photoBusyId === setMainConfirmImage.id}
          onCancel={() => setSetMainConfirmImage(null)}
          onConfirm={() => {
            const image = setMainConfirmImage;
            setSetMainConfirmImage(null);
            if (image) void setMainPhoto(image.id);
          }}
        />
      ) : null}
    </div>
  );
}
