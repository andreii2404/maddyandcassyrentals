"use client";

import { useCallback, useMemo, useSyncExternalStore } from "react";

export interface CartItem {
  productId: string;
  quantity: number;
}

const STORAGE_KEY = "maddy-cassy-rental-cart";
const EMPTY_CART: CartItem[] = [];
const listeners = new Set<() => void>();

let cachedRaw: string | null = null;
let cachedItems: CartItem[] = EMPTY_CART;

function normalizeCart(value: unknown): CartItem[] {
  if (!Array.isArray(value)) return EMPTY_CART;
  const quantities = new Map<string, number>();
  for (const item of value) {
    if (!item || typeof item !== "object") continue;
    const productId = "productId" in item && typeof item.productId === "string"
      ? item.productId.trim()
      : "";
    const rawQuantity = "quantity" in item ? Number(item.quantity) : 1;
    if (!productId) continue;
    quantities.set(productId, Math.min(10, Math.max(1, Math.floor(rawQuantity || 1))));
  }
  return [...quantities].map(([productId, quantity]) => ({ productId, quantity }));
}

function readCart(): CartItem[] {
  if (typeof window === "undefined") return EMPTY_CART;
  const raw = window.localStorage.getItem(STORAGE_KEY);
  if (raw === cachedRaw) return cachedItems;
  cachedRaw = raw;
  try {
    cachedItems = normalizeCart(raw ? JSON.parse(raw) : EMPTY_CART);
  } catch {
    cachedItems = EMPTY_CART;
  }
  return cachedItems;
}

function writeCart(items: CartItem[]) {
  const normalized = normalizeCart(items);
  const serialized = JSON.stringify(normalized);
  window.localStorage.setItem(STORAGE_KEY, serialized);
  cachedRaw = serialized;
  cachedItems = normalized;
  listeners.forEach((listener) => listener());
}

function subscribe(callback: () => void) {
  listeners.add(callback);
  const handleStorage = (event: StorageEvent) => {
    if (event.key === STORAGE_KEY) {
      cachedRaw = null;
      callback();
    }
  };
  window.addEventListener("storage", handleStorage);
  return () => {
    listeners.delete(callback);
    window.removeEventListener("storage", handleStorage);
  };
}

function getServerSnapshot(): CartItem[] {
  return EMPTY_CART;
}

export function useCart() {
  const items = useSyncExternalStore(subscribe, readCart, getServerSnapshot);

  const addItem = useCallback((productId: string, quantity = 1) => {
    const current = readCart();
    const existing = current.find((item) => item.productId === productId);
    const nextQuantity = Math.min(10, (existing?.quantity ?? 0) + Math.max(1, quantity));
    writeCart(
      existing
        ? current.map((item) => item.productId === productId ? { ...item, quantity: nextQuantity } : item)
        : [...current, { productId, quantity: Math.min(10, Math.max(1, quantity)) }],
    );
  }, []);

  const updateQuantity = useCallback((productId: string, quantity: number) => {
    writeCart(
      readCart().map((item) =>
        item.productId === productId
          ? { ...item, quantity: Math.min(10, Math.max(1, Math.floor(quantity || 1))) }
          : item,
      ),
    );
  }, []);

  const removeItem = useCallback((productId: string) => {
    writeCart(readCart().filter((item) => item.productId !== productId));
  }, []);

  const clearCart = useCallback(() => writeCart([]), []);

  const removeStaleItems = useCallback((activeProductIds: string[]) => {
    const activeIds = new Set(activeProductIds);
    const current = readCart();
    const valid = current.filter((item) => activeIds.has(item.productId));
    if (valid.length !== current.length) writeCart(valid);
  }, []);

  const totalQuantity = useMemo(
    () => items.reduce((sum, item) => sum + item.quantity, 0),
    [items],
  );

  return {
    items,
    totalQuantity,
    addItem,
    updateQuantity,
    removeItem,
    clearCart,
    removeStaleItems,
  };
}
