// ---------------------------------------------------------------------------
// Shopping cart — localStorage-backed, no backend involved
// ---------------------------------------------------------------------------
// There's no cart/checkout API on the backend (and none is needed): the
// cart's whole job is to accumulate items client-side, then hand them off as
// one multi-item message through the existing lead-capture pipeline
// (lib/lead-form.ts's submitLead — same Apps Script endpoint the "Get It Now"
// single-product enquiry already uses). See components/cart/cart-modal.tsx
// for where that handoff happens.
//
// Persisted to localStorage (not React Context) because <Header>, which
// hosts the cart icon, is rendered separately by every top-level page.tsx
// rather than through a shared layout — so it (and everything inside it)
// remounts on every navigation anyway, and a Context provider mounted that
// low wouldn't survive navigation either. localStorage plus a same-tab
// "cart:updated" CustomEvent (dispatched by writeCart, listened for by
// useCart below) is what keeps every mounted cart-aware component in sync
// with each other AND across page loads, without needing a provider higher
// up the tree than exists today.
import { useSyncExternalStore } from "react";

const STORAGE_KEY = "handpikd_cart";
const CART_EVENT = "cart:updated";

export type CartItem = {
  productId: string;
  name: string;
  price: number; // discounted_price at the time it was added
  originalPrice: number;
  image: string;
  quantity: number;
};

function readCart(): CartItem[] {
  if (typeof window === "undefined") return [];
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY);
    if (!raw) return [];
    const parsed: unknown = JSON.parse(raw);
    return Array.isArray(parsed) ? (parsed as CartItem[]) : [];
  } catch {
    return [];
  }
}

function writeCart(items: CartItem[]): void {
  if (typeof window === "undefined") return;
  window.localStorage.setItem(STORAGE_KEY, JSON.stringify(items));
  // Same-tab components (the header's cart badge, an open cart modal, ...)
  // don't see localStorage's own "storage" event — that only fires in OTHER
  // tabs/windows. Dispatching a plain CustomEvent here is what lets every
  // useCart() instance in THIS tab react immediately.
  window.dispatchEvent(new CustomEvent(CART_EVENT));
}

// useSyncExternalStore snapshot cache — see useCart below for why this
// exists instead of just calling readCart() straight from getSnapshot.
let cachedSnapshot: CartItem[] | null = null;

function getSnapshot(): CartItem[] {
  if (cachedSnapshot === null) {
    cachedSnapshot = readCart();
  }
  return cachedSnapshot;
}

// Always the same empty array — matches what readCart() returns during SSR
// (no window), so the client's first hydration pass renders identically to
// the server and React doesn't throw a hydration mismatch. Must be a stable
// reference (not a fresh `[]` literal per call): useSyncExternalStore
// compares snapshots with Object.is, and a new array every call looks like
// a change on every render, which React warns can spin into an infinite
// loop. useSyncExternalStore then re-renders with the real client snapshot
// right after hydration commits.
const EMPTY_CART: CartItem[] = [];

function getServerSnapshot(): CartItem[] {
  return EMPTY_CART;
}

function subscribeToCart(callback: () => void): () => void {
  function handleChange() {
    cachedSnapshot = readCart();
    callback();
  }
  window.addEventListener(CART_EVENT, handleChange);
  window.addEventListener("storage", handleChange);
  return () => {
    window.removeEventListener(CART_EVENT, handleChange);
    window.removeEventListener("storage", handleChange);
  };
}

export function addToCart(item: Omit<CartItem, "quantity">, quantity = 1): void {
  const items = readCart();
  const existing = items.find((i) => i.productId === item.productId);
  if (existing) {
    existing.quantity += quantity;
  } else {
    items.push({ ...item, quantity });
  }
  writeCart(items);
}

export function removeFromCart(productId: string): void {
  writeCart(readCart().filter((i) => i.productId !== productId));
}

export function setCartQuantity(productId: string, quantity: number): void {
  if (quantity <= 0) {
    removeFromCart(productId);
    return;
  }
  writeCart(readCart().map((i) => (i.productId === productId ? { ...i, quantity } : i)));
}

export function clearCart(): void {
  writeCart([]);
}

// Subscribes to the cart's current contents, re-rendering the calling
// component whenever it changes (in this tab, via CART_EVENT, or in another
// tab/window, via the browser's native "storage" event) — same pattern as a
// small custom store hook. useSyncExternalStore (rather than a useState
// initializer read from localStorage) is what's required here: Header is
// rendered on every page, so any component reading real cart contents
// during its very first client render — before React has reconciled
// against the server's markup — mismatches the server's necessarily-empty
// render (no window/localStorage during SSR) and React throws a hydration
// error. getServerSnapshot's stable `[]` keeps that first pass identical to
// the server, then React re-renders with the real snapshot right after
// hydration commits.
export function useCart() {
  const items = useSyncExternalStore(subscribeToCart, getSnapshot, getServerSnapshot);

  const count = items.reduce((sum, i) => sum + i.quantity, 0);
  const subtotal = items.reduce((sum, i) => sum + i.price * i.quantity, 0);

  return {
    items,
    count,
    subtotal,
    addToCart,
    removeFromCart,
    setCartQuantity,
    clearCart,
  };
}