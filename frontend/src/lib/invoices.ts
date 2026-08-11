// ---------------------------------------------------------------------------
// Invoice data for the /admin/invoices Sales Invoices tab
// ---------------------------------------------------------------------------
// Mirrors lib/sales-orders.ts. Fetches from GET /admin/get_invoice_details
// (backend/app/api/routes/invoices.py), which only ever returns active
// (non-deleted) invoices. An invoice has no line items of its own.
// Standard invoices are raised against an existing sales order (salesId);
// proforma invoices are generated automatically when a quotation is marked
// accepted (quotationId) — see routes/quotations.py. Exactly one of
// salesId/quotationId is set, matching `type`, and `type` is immutable once
// an invoice exists (manual creation here is standard-only).
import { apiFetch } from "@/lib/api";

export type InvoiceType = "proforma" | "standard";
export type OnlineOrOffline = "online" | "offline";

export type Invoice = {
  id: number;
  invoiceNo: number;
  invoiceNoDisplay: string;
  date: string;
  salesId: number | null;
  quotationId: number | null;
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
  invoice_no_display: string;
  date: string;
  sales_id: number | null;
  quotation_id: number | null;
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
    invoiceNoDisplay: item.invoice_no_display,
    date: item.date,
    salesId: item.sales_id,
    quotationId: item.quotation_id,
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

// Manual creation is standard-only — proforma invoices only come from the
// quotation-acceptance flow (see purchase-invoices-tab.tsx's sibling,
// invoices-tab.tsx, for the Proforma view which has no "+ New" action).
export type CreateInvoicePayload = {
  salesId: number;
  date: string;
  dueDate: string;
  onlineOrOffline: OnlineOrOffline;
  transport: string;
};

export async function createInvoice(payload: CreateInvoicePayload): Promise<Response> {
  return apiFetch("/admin/create_new_invoice", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      sales_id: payload.salesId,
      date: payload.date,
      due_date: payload.dueDate,
      online_or_offline: payload.onlineOrOffline,
      transport: payload.transport,
    }),
  });
}

export type UpdateInvoicePayload = {
  id: number;
  date: string;
  dueDate: string;
  onlineOrOffline: OnlineOrOffline;
  transport: string;
  isDeleted: boolean;
};

export async function updateInvoice(payload: UpdateInvoicePayload): Promise<Response> {
  return apiFetch("/admin/update_invoice_details", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      id: payload.id,
      date: payload.date,
      due_date: payload.dueDate,
      online_or_offline: payload.onlineOrOffline,
      transport: payload.transport,
      is_deleted: payload.isDeleted,
    }),
  });
}

// GET /admin/get_invoice_pdf needs the Authorization bearer header (see
// apiFetch in lib/api.ts), which a plain <a href> can't attach — so the PDF
// is fetched as a blob and "downloaded" via a throwaway object URL + click,
// rather than just linking straight to the endpoint.
export async function downloadInvoicePdf(invoiceId: number, invoiceNoDisplay: string): Promise<void> {
  const response = await apiFetch(`/admin/get_invoice_pdf?invoice_id=${invoiceId}`);
  if (!response.ok) {
    throw new Error("Failed to generate invoice PDF");
  }

  const blob = await response.blob();
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = `invoice-${invoiceNoDisplay}.pdf`;
  document.body.appendChild(link);
  link.click();
  document.body.removeChild(link);
  URL.revokeObjectURL(url);
}
