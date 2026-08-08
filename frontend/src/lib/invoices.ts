// ---------------------------------------------------------------------------
// Invoice data for the /admin/invoices tab
// ---------------------------------------------------------------------------
// Mirrors lib/sales-orders.ts. Fetches from GET /admin/get_invoice_details
// (backend/app/api/routes/invoices.py), which only ever returns active
// (non-deleted) invoices. An invoice has no line items of its own — it's
// always raised against an existing sales order (salesId), whose own
// productIds/quantities/rates/taxPercs (lib/sales-orders.ts) are what
// GET /admin/get_invoice_pdf renders.
import { apiFetch } from "@/lib/api";

export type InvoiceType = "proforma" | "standard";
export type OnlineOrOffline = "online" | "offline";

export type Invoice = {
  id: number;
  invoiceNo: number;
  date: string;
  salesId: number;
  type: InvoiceType;
  dueDate: string;
  onlineOrOffline: OnlineOrOffline;
  transport: string;
  totalAmountBeforeTax: number;
  totalTaxAmount: number;
  totalAmountAfterTax: number;
  isDeleted: boolean;
};

// Shape returned by the backend's InvoiceDetailItem schema.
type InvoiceDetailItem = {
  id: number;
  invoice_no: number;
  date: string;
  sales_id: number;
  type: InvoiceType;
  due_date: string;
  online_or_offline: OnlineOrOffline;
  transport: string;
  total_amount_before_tax: number;
  total_tax_amount: number;
  total_amount_after_tax: number;
  is_deleted: boolean;
};

function toInvoice(item: InvoiceDetailItem): Invoice {
  return {
    id: item.id,
    invoiceNo: item.invoice_no,
    date: item.date,
    salesId: item.sales_id,
    type: item.type,
    dueDate: item.due_date,
    onlineOrOffline: item.online_or_offline,
    transport: item.transport,
    totalAmountBeforeTax: item.total_amount_before_tax,
    totalTaxAmount: item.total_tax_amount,
    totalAmountAfterTax: item.total_amount_after_tax,
    isDeleted: item.is_deleted,
  };
}

export async function fetchInvoices(): Promise<Invoice[]> {
  const response = await apiFetch("/admin/get_invoice_details");
  if (!response.ok) {
    throw new Error("Failed to load invoices");
  }

  const items: InvoiceDetailItem[] = await response.json();
  return items.map(toInvoice);
}

export type CreateOrUpdateInvoicePayload = {
  id?: number;
  salesId: number;
  date: string;
  type: InvoiceType;
  dueDate: string;
  onlineOrOffline: OnlineOrOffline;
  transport: string;
  isDeleted?: boolean;
};

export async function createInvoice(payload: CreateOrUpdateInvoicePayload): Promise<Response> {
  return apiFetch("/admin/create_new_invoice", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      sales_id: payload.salesId,
      date: payload.date,
      type: payload.type,
      due_date: payload.dueDate,
      online_or_offline: payload.onlineOrOffline,
      transport: payload.transport,
    }),
  });
}

export async function updateInvoice(payload: CreateOrUpdateInvoicePayload): Promise<Response> {
  return apiFetch("/admin/update_invoice_details", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      id: payload.id,
      date: payload.date,
      type: payload.type,
      due_date: payload.dueDate,
      online_or_offline: payload.onlineOrOffline,
      transport: payload.transport,
      is_deleted: payload.isDeleted ?? false,
    }),
  });
}

// GET /admin/get_invoice_pdf needs the Authorization bearer header (see
// apiFetch in lib/api.ts), which a plain <a href> can't attach — so the PDF
// is fetched as a blob and "downloaded" via a throwaway object URL + click,
// rather than just linking straight to the endpoint.
export async function downloadInvoicePdf(invoiceId: number, invoiceNo: number): Promise<void> {
  const response = await apiFetch(`/admin/get_invoice_pdf?invoice_id=${invoiceId}`);
  if (!response.ok) {
    throw new Error("Failed to generate invoice PDF");
  }

  const blob = await response.blob();
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = `invoice-${invoiceNo}.pdf`;
  document.body.appendChild(link);
  link.click();
  document.body.removeChild(link);
  URL.revokeObjectURL(url);
}
