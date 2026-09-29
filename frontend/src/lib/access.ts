// ---------------------------------------------------------------------------
// Admin sections and what the signed-in team member may open
// ---------------------------------------------------------------------------
// ADMIN_SECTIONS is the one list of admin areas: the sidebar
// (components/dashboard-shell.tsx) draws its links from it and the role
// editor (components/admin/role-form-modal.tsx) its checkboxes. Each `key`
// matches a value of the backend's Section enum (backend/app/models/role.py),
// which is what the API actually enforces — hiding a link here is only for
// tidiness, never the protection itself.
import { apiFetch } from "@/lib/api";

export type SectionKey =
  | "dashboard"
  | "clients"
  | "vendors"
  | "database"
  | "orders"
  | "invoices"
  | "accounts"
  | "inventory"
  | "products"
  | "categories"
  | "catalogues"
  | "inquiry_form"
  | "product_inquiries"
  | "quotation"
  | "profile"
  | "emails"
  | "users";

export type AdminSection = {
  key: SectionKey;
  label: string;
  href: string;
};

export const ADMIN_SECTIONS: AdminSection[] = [
  { key: "dashboard", label: "Analytical Dashboard", href: "/admin" },
  { key: "clients", label: "Clients", href: "/admin/clients" },
  { key: "vendors", label: "Vendors", href: "/admin/vendors" },
  { key: "database", label: "Database", href: "/admin/database" },
  { key: "emails", label: "Emails", href: "/admin/emails" },
  { key: "orders", label: "Orders", href: "/admin/orders" },
  { key: "invoices", label: "Invoices", href: "/admin/invoices" },
  { key: "accounts", label: "Accounts", href: "/admin/accounts" },
  { key: "inventory", label: "Inventory", href: "/admin/inventory" },
  { key: "products", label: "Products", href: "/admin/products" },
  { key: "categories", label: "Categories", href: "/admin/categories" },
  { key: "catalogues", label: "Catalogues", href: "/admin/catalogues" },
  { key: "inquiry_form", label: "Hamper Inquiry Form", href: "/admin/inquiry-form" },
  { key: "product_inquiries", label: "Product Inquiries", href: "/admin/product-inquiries" },
  { key: "quotation", label: "Quotation", href: "/admin/quotation" },
  { key: "profile", label: "Profile", href: "/admin/profile" },
  { key: "users", label: "Users & Roles", href: "/admin/users" },
];

// A section also owns its sub-pages (the sales order details page sits
// under /admin/orders). The dashboard is the exception: every admin page is
// under /admin, so it owns that exact path and nothing below it.
export function isSectionPath(pathname: string, href: string): boolean {
  if (href === "/admin" || href === "/customer") return pathname === href;
  return pathname === href || pathname.startsWith(`${href}/`);
}

export function sectionForPath(pathname: string): AdminSection | undefined {
  return ADMIN_SECTIONS.find((section) => isSectionPath(pathname, section.href));
}

export type MyAccess = {
  userId: number;
  name: string;
  mail: string;
  roleName: string;
  // null means every section (the built-in Administrator role).
  sections: SectionKey[] | null;
};

export function canAccess(access: MyAccess, key: SectionKey): boolean {
  return access.sections === null || access.sections.includes(key);
}

type MyAccessResponse = {
  user_id: number;
  name: string;
  mail: string;
  role_name: string;
  sections: SectionKey[] | null;
};

// GET /authentication/get_my_access (backend/app/api/routes/authentication.py).
// Fetched on every admin page load, so a role change takes effect on the
// next navigation rather than at the next sign-in.
export async function fetchMyAccess(): Promise<MyAccess> {
  const response = await apiFetch("/authentication/get_my_access");
  if (!response.ok) {
    throw new Error("Failed to load access");
  }

  const data: MyAccessResponse = await response.json();
  return {
    userId: data.user_id,
    name: data.name,
    mail: data.mail,
    roleName: data.role_name,
    sections: data.sections,
  };
}
