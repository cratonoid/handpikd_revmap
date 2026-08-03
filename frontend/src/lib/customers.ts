// ---------------------------------------------------------------------------
// Customer data for the /admin/clients table
// ---------------------------------------------------------------------------
// Fetches from GET /admin/get_customer_details (backend/app/api/routes/admin.py),
// which returns every customer as a flat list. There's no numeric id exposed
// to the frontend (CustomerDetailItem has none), so `mail` is the unique key
// used for both the table's React key and matching a row back to a customer
// for editing.
import { apiFetch } from "@/lib/api";

export type Contact = {
  name: string;
  phone: string;
};

export type Customer = {
  mail: string;
  registeredName: string;
  companyOrDepartment: string;
  address: string;
  companyGst: string;
  points: number;
  isDeleted: boolean;
  contacts: Contact[];
};

// Shape returned by the backend's CustomerDetailItem schema.
type CustomerDetailItem = {
  mail: string;
  password: string;
  registered_name: string;
  company_or_department: string;
  address: string;
  company_gst: string;
  points: number;
  is_deleted: boolean;
  contact_name: string[];
  contact_phone: string[];
};

function toCustomer(item: CustomerDetailItem): Customer {
  return {
    mail: item.mail,
    registeredName: item.registered_name,
    companyOrDepartment: item.company_or_department,
    address: item.address,
    companyGst: item.company_gst,
    points: item.points,
    isDeleted: item.is_deleted,
    contacts: item.contact_name.map((name, index) => ({
      name,
      phone: item.contact_phone[index] ?? "",
    })),
  };
}

export async function fetchCustomers(): Promise<Customer[]> {
  const response = await apiFetch("/admin/get_customer_details");
  if (!response.ok) {
    throw new Error("Failed to load customers");
  }

  const items: CustomerDetailItem[] = await response.json();
  return items.map(toCustomer);
}

// Single-customer lookup by email — GET /admin/get_customer_details?mail=...
// joins User + CustomerDetails + CustomerPocDetails for that one customer and
// returns a single object (not a list). 404s if no customer has that email.
export async function fetchCustomerDetail(mail: string): Promise<Customer> {
  const response = await apiFetch(`/admin/get_customer_details?mail=${encodeURIComponent(mail)}`);
  if (!response.ok) {
    throw new Error("Failed to load customer");
  }

  const item: CustomerDetailItem = await response.json();
  return toCustomer(item);
}
