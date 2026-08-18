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
  // Two-digit GST state code and its name. Auto-filled from companyGst on
  // the client form but stored in its own right: a client with no GSTIN
  // still sits in a state, and a same-state supply to an unregistered
  // client is CGST+SGST rather than IGST. "" for clients saved before the
  // field existed — lib/gst.ts's resolveStateCode falls back to the GSTIN.
  stateCode: string;
  stateName: string;
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
  state_code: string;
  state_name: string;
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
    stateCode: item.state_code ?? "",
    stateName: item.state_name ?? "",
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

export type CustomerOption = {
  id: number;
  name: string;
  isDeleted: boolean;
};

// Shape returned by the backend's CustomerListItem schema.
type CustomerListItem = {
  customer_id: number;
  customer_name: string;
  is_deleted: boolean;
};

// Lightweight id+name list for customer-picker dropdowns (the sales order
// popup). Unlike fetchVendorsList/get_vendors_list, GET /admin/get_customer_list
// returns EVERY customer, active and deleted — CustomerDetailItem (used by
// fetchCustomers/fetchCustomerDetail above) has no numeric id at all, so this
// is the only place the frontend can resolve a sales order's cust_id back to
// a name, including for orders placed against a since-deleted customer.
export async function fetchCustomerList(): Promise<CustomerOption[]> {
  const response = await apiFetch("/admin/get_customer_list");
  if (!response.ok) {
    throw new Error("Failed to load customers");
  }

  const items: CustomerListItem[] = await response.json();
  return items.map((item) => ({ id: item.customer_id, name: item.customer_name, isDeleted: item.is_deleted }));
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
