// ---------------------------------------------------------------------------
// Quotation data for the /admin/quotation tab
// ---------------------------------------------------------------------------
// Mirrors lib/sales-orders.ts + lib/invoices.ts combined: a quotation carries
// its own line items (like a sales order — product/quantity/rate/tax rows
// live in the separate #quotation_summary collection, backend/app/models/
// quotation_summary.py, folded back into parallel productIds/quantities/
// rates/taxPercs arrays by GET /admin/get_quotation_details), but also has a
// downloadable PDF (like an invoice, via GET /admin/get_quotation_pdf).
//
// Unlike create_new_invoice/create_new_sales_order (which only ever return
// {message}), POST /admin/create_new_quotation also returns the new row's
// id/quotationNo — quotation-form-modal.tsx's "Generate" button needs the id
// immediately to chain straight into downloadQuotationPdf without a second
// round trip to re-fetch the list.
import { apiFetch } from "@/lib/api";

export type QuotationStatus = "draft" | "sent" | "accepted" | "rejected" | "expired";

export type Quotation = {
  id: number;
  quotationNo: number;
  date: string;
  validTill: string;
  custId: number;
  status: QuotationStatus;
  productIds: number[];
  quantities: number[];
  rates: number[];
  taxPercs: number[];
  totalAmountBeforeTax: number;
  totalTaxAmount: number;
  totalAmountAfterTax: number;
  description: string;
  isDeleted: boolean;
};

// Shape returned by the backend's QuotationDetailItem schema.
type QuotationDetailItem = {
  id: number;
  quotation_no: number;
  date: string;
  valid_till: string;
  cust_id: number;
  status: QuotationStatus;
  product_ids: number[];
  quantities: number[];
  rates: number[];
  tax_percs: number[];
  total_amount_before_tax: number;
  total_tax_amount: number;
  total_amount_after_tax: number;
  description: string;
  is_deleted: boolean;
};

function toQuotation(item: QuotationDetailItem): Quotation {
  return {
    id: item.id,
    quotationNo: item.quotation_no,
    date: item.date,
    validTill: item.valid_till,
    custId: item.cust_id,
    status: item.status,
    productIds: item.product_ids,
    quantities: item.quantities,
    rates: item.rates,
    taxPercs: item.tax_percs,
    totalAmountBeforeTax: item.total_amount_before_tax,
    totalTaxAmount: item.total_tax_amount,
    totalAmountAfterTax: item.total_amount_after_tax,
    description: item.description,
    isDeleted: item.is_deleted,
  };
}

export async function fetchQuotations(): Promise<Quotation[]> {
  const response = await apiFetch("/admin/get_quotation_details");
  if (!response.ok) {
    throw new Error("Failed to load quotations");
  }

  const items: QuotationDetailItem[] = await response.json();
  return items.map(toQuotation);
}

export type QuotationLineItemPayload = {
  productId: number;
  quantity: number;
  rate: number;
  taxPerc: number;
};

export type CreateQuotationPayload = {
  custId: number;
  date: string;
  validTill: string;
  lineItems: QuotationLineItemPayload[];
  description: string;
};

export type UpdateQuotationPayload = CreateQuotationPayload & {
  id: number;
  status: QuotationStatus;
  isDeleted?: boolean;
};

function lineItemsToParallelArrays(lineItems: QuotationLineItemPayload[]) {
  return {
    product_ids: lineItems.map((item) => item.productId),
    quantities: lineItems.map((item) => item.quantity),
    rates: lineItems.map((item) => item.rate),
    tax_percs: lineItems.map((item) => item.taxPerc),
  };
}

// Returns the parsed {id, quotationNo} on success so callers (the "Generate"
// button) can chain straight into downloadQuotationPdf — throws (with the
// backend's detail message, if any) otherwise, matching how the rest of the
// form modals surface save errors.
export async function createQuotation(
  payload: CreateQuotationPayload,
): Promise<{ id: number; quotationNo: number }> {
  const response = await apiFetch("/admin/create_new_quotation", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      cust_id: payload.custId,
      date: payload.date,
      valid_till: payload.validTill,
      description: payload.description,
      ...lineItemsToParallelArrays(payload.lineItems),
    }),
  });

  if (!response.ok) {
    const detail = await response.json().catch(() => null);
    throw new Error(typeof detail?.detail === "string" ? detail.detail : "Failed to create quotation");
  }

  const body: { id: number; quotation_no: number } = await response.json();
  return { id: body.id, quotationNo: body.quotation_no };
}

export async function updateQuotation(payload: UpdateQuotationPayload): Promise<Response> {
  return apiFetch("/admin/update_quotation_details", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      id: payload.id,
      status: payload.status,
      is_deleted: payload.isDeleted ?? false,
      cust_id: payload.custId,
      date: payload.date,
      valid_till: payload.validTill,
      description: payload.description,
      ...lineItemsToParallelArrays(payload.lineItems),
    }),
  });
}

// GET /admin/get_quotation_pdf needs the Authorization bearer header (see
// apiFetch in lib/api.ts), which a plain <a href> can't attach — same
// blob + object-URL download dance as downloadInvoicePdf (lib/invoices.ts).
export async function downloadQuotationPdf(quotationId: number, quotationNo: number): Promise<void> {
  const response = await apiFetch(`/admin/get_quotation_pdf?quotation_id=${quotationId}`);
  if (!response.ok) {
    throw new Error("Failed to generate quotation PDF");
  }

  const blob = await response.blob();
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = `quotation-${quotationNo}.pdf`;
  document.body.appendChild(link);
  link.click();
  document.body.removeChild(link);
  URL.revokeObjectURL(url);
}
