// ---------------------------------------------------------------------------
// Invoice data for the /admin/invoices Sales Invoices tab
// ---------------------------------------------------------------------------
// Mirrors lib/sales-orders.ts. Fetches from GET /admin/get_invoice_details
// (backend/app/api/routes/invoices.py), which only ever returns active
// (non-deleted) invoices. Standard invoices are raised against one or more
// existing sales orders (salesIds, all belonging to the same customer) and
// have no line items of their own here. Proforma invoices are raised by
// hand, like a quotation — own customer (custId) and own line items
// (productIds/quantities/rates/taxPercs, parallel arrays, empty for standard
// invoices) — see lib/quotations.ts for the identical shape. `type` is
// immutable once an invoice exists, and so is salesIds.
import { apiFetch } from "@/lib/api";

export type InvoiceType = "proforma" | "standard";
export type OnlineOrOffline = "online" | "offline";
export type InvoiceStatus = "new" | "submitted" | "paid";

export type Invoice = {
  id: number;
  invoiceNo: number;
  invoiceNoDisplay: string;
  date: string;
  salesIds: number[];
  quotationId: number | null;
  custId: number | null;
  type: InvoiceType;
  dueDate: string;
  onlineOrOffline: OnlineOrOffline;
  transport: string;
  status: InvoiceStatus;
  productIds: number[];
  quantities: number[];
  rates: number[];
  taxPercs: number[];
  description: string;
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
  sales_ids: number[];
  quotation_id: number | null;
  cust_id: number | null;
  type: InvoiceType;
  due_date: string;
  online_or_offline: OnlineOrOffline;
  transport: string;
  status: InvoiceStatus;
  product_ids: number[];
  quantities: number[];
  rates: number[];
  tax_percs: number[];
  description: string;
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
    salesIds: item.sales_ids,
    quotationId: item.quotation_id,
    custId: item.cust_id,
    type: item.type,
    dueDate: item.due_date,
    onlineOrOffline: item.online_or_offline,
    transport: item.transport,
    status: item.status,
    productIds: item.product_ids,
    quantities: item.quantities,
    rates: item.rates,
    taxPercs: item.tax_percs,
    description: item.description,
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

// Manual creation via this function is standard-only — proforma invoices
// are created through createProformaInvoice below instead.
export type CreateInvoicePayload = {
  salesIds: number[];
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
      sales_ids: payload.salesIds,
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
  status: InvoiceStatus;
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
      status: payload.status,
      is_deleted: payload.isDeleted,
    }),
  });
}

// Proforma invoices are raised by hand — own customer + line items, no
// sales order/quotation involved. Mirrors lib/quotations.ts's
// createQuotation/updateQuotation exactly (same parallel-array line-item
// convention, same "create returns id so the caller can chain into a PDF
// download" reasoning).
export type ProformaInvoiceLineItemPayload = {
  productId: number;
  quantity: number;
  rate: number;
  taxPerc: number;
};

export type CreateProformaInvoicePayload = {
  custId: number;
  date: string;
  dueDate: string;
  lineItems: ProformaInvoiceLineItemPayload[];
  description: string;
};

export type UpdateProformaInvoicePayload = CreateProformaInvoicePayload & {
  id: number;
  isDeleted?: boolean;
};

function proformaLineItemsToParallelArrays(lineItems: ProformaInvoiceLineItemPayload[]) {
  return {
    product_ids: lineItems.map((item) => item.productId),
    quantities: lineItems.map((item) => item.quantity),
    rates: lineItems.map((item) => item.rate),
    tax_percs: lineItems.map((item) => item.taxPerc),
  };
}

export async function createProformaInvoice(
  payload: CreateProformaInvoicePayload,
): Promise<{ id: number; invoiceNoDisplay: string }> {
  const response = await apiFetch("/admin/create_new_proforma_invoice", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      cust_id: payload.custId,
      date: payload.date,
      due_date: payload.dueDate,
      description: payload.description,
      ...proformaLineItemsToParallelArrays(payload.lineItems),
    }),
  });

  if (!response.ok) {
    const detail = await response.json().catch(() => null);
    throw new Error(typeof detail?.detail === "string" ? detail.detail : "Failed to create proforma invoice");
  }

  const body: { id: number; invoice_no_display: string } = await response.json();
  return { id: body.id, invoiceNoDisplay: body.invoice_no_display };
}

export async function updateProformaInvoice(payload: UpdateProformaInvoicePayload): Promise<Response> {
  return apiFetch("/admin/update_proforma_invoice_details", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      id: payload.id,
      is_deleted: payload.isDeleted ?? false,
      cust_id: payload.custId,
      date: payload.date,
      due_date: payload.dueDate,
      description: payload.description,
      ...proformaLineItemsToParallelArrays(payload.lineItems),
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

// Bulk-downloads every standard invoice raised within [startDate, endDate]
// (both "YYYY-MM-DD") as a single .zip of individual invoice PDFs — same
// blob-and-throwaway-link approach as downloadInvoicePdf above, since this
// endpoint needs the Authorization header too.
export async function downloadInvoicesZip(startDate: string, endDate: string): Promise<void> {
  const response = await apiFetch(
    `/admin/get_invoices_pdf_zip?start_date=${encodeURIComponent(startDate)}&end_date=${encodeURIComponent(endDate)}`,
  );
  if (!response.ok) {
    if (response.status === 404) {
      throw new Error("No invoices found in that date range.");
    }
    throw new Error("Failed to generate invoices zip");
  }

  const blob = await response.blob();
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = `invoices-${startDate}-to-${endDate}.zip`;
  document.body.appendChild(link);
  link.click();
  document.body.removeChild(link);
  URL.revokeObjectURL(url);
}
