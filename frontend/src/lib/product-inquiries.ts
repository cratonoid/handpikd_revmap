// ---------------------------------------------------------------------------
// Product inquiries — the storefront cart's "Send inquiry" submission
// ---------------------------------------------------------------------------
// Backed by POST /product-inquiries/submit (public/unauthenticated) and GET
// /admin/product-inquiries/get_inquiries (admin-only) — see
// backend/app/api/routes/product_inquiries.py. Same public/admin split as
// lib/inquiry-form.ts, which does the equivalent for the hamper inquiry form.
//
// Note what the submit call does NOT send: product names or prices. Only
// each product's id and quantity go up; the backend looks the rest up itself
// so the stored inquiry always reflects Handpikd's real listed price rather
// than whatever a stale/tampered browser cart happened to hold.
import { apiFetch } from "@/lib/api";

export type ProductInquirySubmission = {
  name: string;
  email: string;
  company: string;
  phone: string;
  message: string;
  items: { productId: string; quantity: number }[];
};

export async function submitProductInquiry(data: ProductInquirySubmission): Promise<void> {
  const response = await apiFetch("/product-inquiries/submit", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      name: data.name,
      email: data.email,
      company: data.company,
      phone: data.phone,
      message: data.message,
      items: data.items.map((item) => ({ product_id: Number(item.productId), quantity: item.quantity })),
    }),
  });

  if (!response.ok) {
    const body: { detail?: string } = await response.json().catch(() => ({}));
    throw new Error(body.detail ?? "Something went wrong sending your inquiry. Please try again.");
  }
}

// ---------------------------------------------------------------------------
// Admin — viewing submitted inquiries (/admin/product-inquiries)
// ---------------------------------------------------------------------------
export type ProductInquiryLine = {
  productId: number;
  productName: string;
  unitPrice: number;
  quantity: number;
  lineTotal: number;
};

export type ProductInquiry = {
  id: number;
  name: string;
  email: string;
  company: string;
  phone: string | null;
  message: string | null;
  totalAmount: number;
  createdAt: string;
  items: ProductInquiryLine[];
};

type ProductInquiryApiItem = {
  id: number;
  name: string;
  email: string;
  company: string;
  phone: string | null;
  message: string | null;
  total_amount: number;
  created_at: string;
  items: {
    product_id: number;
    product_name: string;
    unit_price: number;
    quantity: number;
    line_total: number;
  }[];
};

export async function fetchProductInquiries(): Promise<ProductInquiry[]> {
  const response = await apiFetch("/admin/product-inquiries/get_inquiries");
  if (!response.ok) {
    throw new Error("Failed to load product inquiries.");
  }

  const items: ProductInquiryApiItem[] = await response.json();
  return items.map((item) => ({
    id: item.id,
    name: item.name,
    email: item.email,
    company: item.company,
    phone: item.phone,
    message: item.message,
    totalAmount: item.total_amount,
    createdAt: item.created_at,
    items: item.items.map((line) => ({
      productId: line.product_id,
      productName: line.product_name,
      unitPrice: line.unit_price,
      quantity: line.quantity,
      lineTotal: line.line_total,
    })),
  }));
}
