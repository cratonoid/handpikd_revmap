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
//
// A standard invoice is "full" or "partial" (an advance). A partial bills
// partialPercent of its orders' value or a fixed partialAmount (tax
// included); any number may sit on the same orders up to their value, and
// the full invoice after them bills what's left. See InvoiceBilling in
// backend/app/models/invoice_details.py. Fixed once raised.
import { apiFetch } from "@/lib/api";
import { printPdfBlob } from "@/lib/print-pdf";

export type InvoiceType = "proforma" | "standard";
export type OnlineOrOffline = "online" | "offline";
// Payment state only — an invoice is either fully outstanding or fully
// settled, matching InvoiceStatus in backend/app/models/invoice_details.py.
export type InvoiceStatus = "unpaid" | "paid";
export type InvoiceBilling = "full" | "partial";

export type Invoice = {
  id: number;
  invoiceNo: number;
  invoiceNoDisplay: string;
  date: string;
  salesIds: number[];
  quotationId: number | null;
  custId: number | null;
  type: InvoiceType;
  billing: InvoiceBilling;
  // Partial invoices only, one or the other; null otherwise.
  partialPercent: number | null;
  partialAmount: number | null;
  dueDate: string;
  onlineOrOffline: OnlineOrOffline;
  transport: string;
  status: InvoiceStatus;
  // "YYYY-MM-DD" the payment came in; null while unpaid, and on invoices
  // marked paid before the date was recorded. See InvoiceDetails.paid_on.
  paidOn: string | null;
  productIds: number[];
  quantities: number[];
  rates: number[];
  taxPercs: number[];
  description: string;
  // Free-text note for this one invoice, printed on its PDF — both types
  // carry it. See InvoiceDetails.notes in
  // backend/app/models/invoice_details.py.
  notes: string;
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
  billing?: InvoiceBilling;
  partial_percent?: number | null;
  partial_amount?: number | null;
  due_date: string;
  online_or_offline: OnlineOrOffline;
  transport: string;
  status: InvoiceStatus;
  paid_on?: string | null;
  product_ids: number[];
  quantities: number[];
  rates: number[];
  tax_percs: number[];
  description: string;
  notes: string;
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
    billing: item.billing ?? "full",
    partialPercent: item.partial_percent ?? null,
    partialAmount: item.partial_amount ?? null,
    dueDate: item.due_date,
    onlineOrOffline: item.online_or_offline,
    transport: item.transport,
    status: item.status,
    paidOn: item.paid_on ?? null,
    productIds: item.product_ids,
    quantities: item.quantities,
    rates: item.rates,
    taxPercs: item.tax_percs,
    description: item.description,
    notes: item.notes,
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
  notes: string;
  billing: InvoiceBilling;
  // Partial only: exactly one of the two.
  partialPercent: number | null;
  partialAmount: number | null;
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
      notes: payload.notes,
      billing: payload.billing,
      partial_percent: payload.billing === "partial" ? payload.partialPercent : null,
      partial_amount: payload.billing === "partial" ? payload.partialAmount : null,
    }),
  });
}

// What a standard invoice bills, mirroring billed_totals in
// backend/app/services/invoice_totals.py, for the form's live preview.
// `partials` are the live partial invoices on the same orders.
export function billedTotals(
  orders: { totalAmountBeforeTax: number; totalTaxAmount: number; totalAmountAfterTax: number }[],
  billing: InvoiceBilling,
  partial: { percent: number | null; amount: number | null },
  partials: Invoice[],
): { beforeTax: number; tax: number; afterTax: number } {
  const round = (value: number) => Math.round(value * 100) / 100;
  const beforeTax = orders.reduce((sum, order) => sum + order.totalAmountBeforeTax, 0);
  const tax = orders.reduce((sum, order) => sum + order.totalTaxAmount, 0);
  const afterTax = orders.reduce((sum, order) => sum + order.totalAmountAfterTax, 0);
  if (billing === "partial") {
    const billedAfter =
      partial.amount !== null ? partial.amount : round(afterTax * ((partial.percent ?? 0) / 100));
    const share = partial.amount !== null ? (afterTax ? partial.amount / afterTax : 0) : (partial.percent ?? 0) / 100;
    const billedBefore = round(beforeTax * share);
    return { beforeTax: billedBefore, tax: round(billedAfter - billedBefore), afterTax: round(billedAfter) };
  }
  if (partials.length === 0) return { beforeTax, tax, afterTax };
  const billedBefore = round(beforeTax - partials.reduce((sum, p) => sum + p.totalAmountBeforeTax, 0));
  const billedTax = round(tax - partials.reduce((sum, p) => sum + p.totalTaxAmount, 0));
  return { beforeTax: billedBefore, tax: billedTax, afterTax: round(billedBefore + billedTax) };
}

export type UpdateInvoicePayload = {
  id: number;
  date: string;
  dueDate: string;
  onlineOrOffline: OnlineOrOffline;
  transport: string;
  notes: string;
  status: InvoiceStatus;
  // Only read when status is "paid"; null keeps the date on file, or takes
  // today if there is none.
  paidOn: string | null;
  isDeleted: boolean;
};

// Backs the status dropdown and the "Paid on" date in each row of the sales
// invoices table. Its own endpoint rather than a full update_invoice_details
// round trip: that one re-snapshots the totals off the linked sales orders
// and re-decides the invoice's tax context against the client's current
// state, neither of which recording a payment should do to a document
// already sent out.
//
// Marking an invoice paid without a paidOn records today; going back to
// unpaid clears the date. Resolves to the payment date the invoice ended up
// with, or to the message to show on failure — the caller has a row to roll
// back, so it needs the reason rather than a boolean.
export async function updateInvoiceStatus(
  id: number,
  status: InvoiceStatus,
  paidOn: string | null = null,
): Promise<{ paidOn: string | null } | { error: string }> {
  try {
    const response = await apiFetch("/admin/update_invoice_status", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ id, status, paid_on: paidOn }),
    });

    const body = await response.json().catch(() => null);
    if (response.ok) {
      return { paidOn: body?.paid_on ?? null };
    }
    return {
      error: typeof body?.detail === "string" ? body.detail : "Couldn't update the status. Please try again.",
    };
  } catch {
    return { error: "Couldn't reach the server. Please try again." };
  }
}

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
      notes: payload.notes,
      status: payload.status,
      paid_on: payload.status === "paid" ? payload.paidOn : null,
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
  notes: string;
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
      notes: payload.notes,
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
      notes: payload.notes,
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

// Sends the invoice PDF straight to the browser's print dialog instead of
// saving it (see lib/print-pdf.ts).
export async function printInvoicePdf(invoiceId: number): Promise<void> {
  const response = await apiFetch(`/admin/get_invoice_pdf?invoice_id=${invoiceId}`);
  if (!response.ok) {
    throw new Error("Failed to generate invoice PDF");
  }

  await printPdfBlob(await response.blob());
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
