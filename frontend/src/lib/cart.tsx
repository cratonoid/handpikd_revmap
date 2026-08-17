"use client";

// ---------------------------------------------------------------------------
// Cart state — shared between the product grid, the header badge, and /cart
// ---------------------------------------------------------------------------
// The storefront cart isn't a checkout: nothing is paid for here. It's a
// "collect the products you want, then send us one inquiry about all of them"
// list, which is why the cart page's CTA is "Send inquiry" (posting to
// /product-inquiries/submit, see lib/product-inquiries.ts) rather than
// anything payment-shaped.
//
// Three separate parts of the app need to read/modify the same cart —
// <AddToCartButton> on every product card, the header's cart badge, and the
// /cart page itself — and none of them are parents of the others, so the
// state lives in a React context provider mounted once in app/layout.tsx
// (`<CartProvider>`) instead of being passed down as props.
//
// Contents are mirrored into localStorage so the cart survives a refresh and
// a navigation to any other page. localStorage only exists in the browser,
// so the state starts EMPTY (matching what the server rendered) and is
// filled in from storage in an effect after mount — `hydrated` tracks
// whether that has happened yet, so the header badge doesn't flash a "0"
// count before the real one loads.
import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from "react";

// One line in the cart. Product name/price/image are copied in at add time
// (rather than re-fetched from the product list) so the cart page can render
// standalone without loading the whole catalogue again. The backend
// re-looks-up the authoritative name/price by id at submit time regardless —
// see routes/product_inquiries.py.
export type CartItem = {
  id: string;
  name: string;
  price: number;
  image: string;
  quantity: number;
};

// What a caller passes to addItem — any object with these fields works, which
// makes `Product` from lib/public-products.ts directly usable.
export type CartProductInput = {
  id: string;
  name: string;
  price: number;
  image: string;
};

type CartContextValue = {
  items: CartItem[];
  hydrated: boolean;
  totalItems: number;
  totalPrice: number;
  quantityOf: (productId: string) => number;
  addItem: (product: CartProductInput) => void;
  setQuantity: (productId: string, quantity: number) => void;
  removeItem: (productId: string) => void;
  clearCart: () => void;
};

const STORAGE_KEY = "handpikd-cart-v1";

// Guards against a hand-edited/corrupted localStorage entry (or one written
// by an older shape of this code) crashing every page that reads the cart.
function parseStoredItems(raw: string | null): CartItem[] {
  if (!raw) return [];
  try {
    const parsed: unknown = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [];
    return parsed.filter((item): item is CartItem => {
      if (typeof item !== "object" || item === null) return false;
      const candidate = item as Partial<CartItem>;
      return (
        typeof candidate.id === "string" &&
        typeof candidate.name === "string" &&
        typeof candidate.price === "number" &&
        typeof candidate.image === "string" &&
        typeof candidate.quantity === "number" &&
        candidate.quantity > 0
      );
    });
  } catch {
    return [];
  }
}

const CartContext = createContext<CartContextValue | null>(null);

export function CartProvider({ children }: { children: ReactNode }) {
  const [items, setItems] = useState<CartItem[]>([]);
  const [hydrated, setHydrated] = useState(false);

  // Load once after mount. The setState calls are deferred into a microtask
  // (rather than run synchronously in the effect body) per the project's
  // react-hooks/set-state-in-effect rule — same pattern as
  // components/dashboard-shell.tsx's auth check.
  useEffect(() => {
    const stored = parseStoredItems(window.localStorage.getItem(STORAGE_KEY));
    queueMicrotask(() => {
      setItems(stored);
      setHydrated(true);
    });
  }, []);

  // Mirror every change back out to localStorage — but only AFTER the initial
  // load has happened, otherwise this would immediately overwrite the stored
  // cart with the empty starting state on first render.
  useEffect(() => {
    if (!hydrated) return;
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify(items));
  }, [items, hydrated]);

  // Adding a product that's already in the cart bumps its quantity by one
  // instead of creating a second line for it.
  const addItem = useCallback((product: CartProductInput) => {
    setItems((prev) => {
      const existing = prev.find((item) => item.id === product.id);
      if (existing) {
        return prev.map((item) => (item.id === product.id ? { ...item, quantity: item.quantity + 1 } : item));
      }
      return [...prev, { ...product, quantity: 1 }];
    });
  }, []);

  // Setting a quantity of 0 (or less) removes the line entirely — that's what
  // makes the "−" step of the card stepper drop the product out of the cart
  // once it reaches zero.
  const setQuantity = useCallback((productId: string, quantity: number) => {
    setItems((prev) =>
      quantity <= 0
        ? prev.filter((item) => item.id !== productId)
        : prev.map((item) => (item.id === productId ? { ...item, quantity } : item)),
    );
  }, []);

  const removeItem = useCallback((productId: string) => {
    setItems((prev) => prev.filter((item) => item.id !== productId));
  }, []);

  const clearCart = useCallback(() => setItems([]), []);

  const value = useMemo<CartContextValue>(() => {
    return {
      items,
      hydrated,
      totalItems: items.reduce((sum, item) => sum + item.quantity, 0),
      totalPrice: items.reduce((sum, item) => sum + item.price * item.quantity, 0),
      quantityOf: (productId: string) => items.find((item) => item.id === productId)?.quantity ?? 0,
      addItem,
      setQuantity,
      removeItem,
      clearCart,
    };
  }, [items, hydrated, addItem, setQuantity, removeItem, clearCart]);

  return <CartContext.Provider value={value}>{children}</CartContext.Provider>;
}

// Throws (rather than silently handing back an empty cart) if used outside
// the provider, so a component accidentally rendered outside app/layout.tsx's
// <CartProvider> fails loudly during development instead of quietly never
// adding anything.
export function useCart(): CartContextValue {
  const context = useContext(CartContext);
  if (context === null) {
    throw new Error("useCart must be used inside <CartProvider>");
  }
  return context;
}
