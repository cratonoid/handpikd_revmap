// ---------------------------------------------------------------------------
// Purchase invoice data for the /admin/invoices Purchase Invoices tab
// ---------------------------------------------------------------------------
// Mirrors lib/invoices.ts. Fetches from GET /admin/get_purchase_invoice_details
// (backend/app/api/routes/purchase_invoices.py), which only ever returns
// active (non-deleted) purchase invoices. A purchase invoice is raised
// either against an existing PurchaseOrders record (source "po_dropdown",
// no line items of its own — same borrowing convention as sales invoices
// riding on a sales order) or from an uploaded vendor PDF (source
// "pdf_upload", best-effort parsed via uploadAndParsePurchaseInvoicePdf,
// carries its own free-text line items). source/poId/hasUploadedPdf are
// immutable once raised.
import { apiFetch } from "@/lib/api";

export type PurchaseInvoiceSource = "po_dropdown" | "pdf_upload";

export type PurchaseInvoiceLineItem = {
  description: string;
  hsnCode: string;
  quantity: number;
  rate: number;
  taxPerc: number;
};

export type PurchaseInvoice = {
  id: number;
  purchaseInvoiceNo: number;
  purchaseInvoiceNoDisplay: string;
  date: string;
  vendorId: number;
  poId: number | null;
  source: PurchaseInvoiceSource;
  hasUploadedPdf: boolean;
  // Only populated for source == "pdf_upload" — po_dropdown invoices' line
  // items live on the linked PurchaseOrders instead.
  lineItems: PurchaseInvoiceLineItem[];
  totalAmountBeforeTax: number;
  totalTaxAmount: number;
  totalAmountAfterTax: number;
  isDeleted: boolean;
};

// Shape returned by the backend's PurchaseInvoiceDetailItem schema.
type BackendLineItem = {
  description: string;
  hsn_code: string;
  quantity: number;
  rate: number;
  tax_perc: number;
};

type PurchaseInvoiceDetailItem = {
  id: number;
  purchase_invoice_no: number;
  purchase_invoice_no_display: string;
  date: string;
  vendor_id: number;
  po_id: number | null;
  source: PurchaseInvoiceSource;
  has_uploaded_pdf: boolean;
  line_items: BackendLineItem[];
  total_amount_before_tax: number;
  total_tax_amount: number;
  total_amount_after_tax: number;
  is_deleted: boolean;
};

function toPurchaseInvoice(item: PurchaseInvoiceDetailItem): PurchaseInvoice {
  return {
    id: item.id,
    purchaseInvoiceNo: item.purchase_invoice_no,
    purchaseInvoiceNoDisplay: item.purchase_invoice_no_display,
    date: item.date,
    vendorId: item.vendor_id,
    poId: item.po_id,
    source: item.source,
    hasUploadedPdf: item.has_uploaded_pdf,
    lineItems: item.line_items.map((lineItem) => ({
      description: lineItem.description,
      hsnCode: lineItem.hsn_code,
      quantity: lineItem.quantity,
      rate: lineItem.rate,
      taxPerc: lineItem.tax_perc,
    })),
    totalAmountBeforeTax: item.total_amount_before_tax,
    totalTaxAmount: item.total_tax_amount,
    totalAmountAfterTax: item.total_amount_after_tax,
    isDeleted: item.is_deleted,
  };
}

export async function fetchPurchaseInvoices(): Promise<PurchaseInvoice[]> {
  const response = await apiFetch("/admin/get_purchase_invoice_details");
  if (!response.ok) {
    throw new Error("Failed to load purchase invoices");
  }

  const items: PurchaseInvoiceDetailItem[] = await response.json();
  return items.map(toPurchaseInvoice);
}

export type CreatePurchaseInvoicePayload = {
  date: string;
  vendorId: number;
  source: PurchaseInvoiceSource;
  poId?: number;
  uploadedPdfPath?: string;
  lineItems?: PurchaseInvoiceLineItem[];
};

function lineItemsToPayload(lineItems: PurchaseInvoiceLineItem[] | undefined) {
  return (lineItems ?? []).map((item) => ({
    description: item.description,
    hsn_code: item.hsnCode,
    quantity: item.quantity,
    rate: item.rate,
    tax_perc: item.taxPerc,
  }));
}

export async function createPurchaseInvoice(payload: CreatePurchaseInvoicePayload): Promise<Response> {
  return apiFetch("/admin/create_new_purchase_invoice", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      date: payload.date,
      vendor_id: payload.vendorId,
      source: payload.source,
      po_id: payload.poId ?? null,
      uploaded_pdf_path: payload.uploadedPdfPath ?? null,
      line_items: lineItemsToPayload(payload.lineItems),
    }),
  });
}

export type UpdatePurchaseInvoicePayload = {
  id: number;
  date: string;
  vendorId: number;
  lineItems?: PurchaseInvoiceLineItem[];
  isDeleted: boolean;
};

export async function updatePurchaseInvoice(payload: UpdatePurchaseInvoicePayload): Promise<Response> {
  return apiFetch("/admin/update_purchase_invoice_details", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      id: payload.id,
      date: payload.date,
      vendor_id: payload.vendorId,
      line_items: lineItemsToPayload(payload.lineItems),
      is_deleted: payload.isDeleted,
    }),
  });
}

export type ParsedPurchaseInvoice = {
  vendorName: string | null;
  vendorGstin: string | null;
  suggestedVendorId: number | null;
  date: string | null;
  totalAmountAfterTax: number | null;
  lineItems: { description: string; quantity: number | null; rate: number | null }[];
};

export type ParsedPurchaseInvoiceUpload = {
  uploadedPdfPath: string;
  parsed: ParsedPurchaseInvoice;
};

// Uploads a vendor PDF, storing it immediately and running best-effort local
// text extraction to prefill the purchase-invoice form (see
// purchase_invoice_parser.py — no LLM involved, every field stays editable).
// The returned uploadedPdfPath is passed straight into
// createPurchaseInvoice's payload so the file doesn't need re-uploading.
export async function uploadAndParsePurchaseInvoicePdf(file: File): Promise<ParsedPurchaseInvoiceUpload> {
  const formData = new FormData();
  formData.append("file", file);

  const response = await apiFetch("/admin/parse_purchase_invoice_pdf", {
    method: "POST",
    body: formData,
  });

  if (!response.ok) {
    const detail = await response.json().catch(() => null);
    throw new Error(detail?.detail ?? "Failed to parse purchase invoice PDF");
  }

  const data: {
    uploaded_pdf_path: string;
    parsed: {
      vendor_name: string | null;
      vendor_gstin: string | null;
      suggested_vendor_id: number | null;
      date: string | null;
      total_amount_after_tax: number | null;
      line_items: { description: string; quantity: number | null; rate: number | null }[];
    };
  } = await response.json();

  return {
    uploadedPdfPath: data.uploaded_pdf_path,
    parsed: {
      vendorName: data.parsed.vendor_name,
      vendorGstin: data.parsed.vendor_gstin,
      suggestedVendorId: data.parsed.suggested_vendor_id,
      date: data.parsed.date,
      totalAmountAfterTax: data.parsed.total_amount_after_tax,
      lineItems: data.parsed.line_items,
    },
  };
}

async function downloadPdf(path: string, filename: string): Promise<void> {
  const response = await apiFetch(path);
  if (!response.ok) {
    throw new Error("Failed to generate PDF");
  }

  const blob = await response.blob();
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = filename;
  document.body.appendChild(link);
  link.click();
  document.body.removeChild(link);
  URL.revokeObjectURL(url);
}

export async function downloadPurchaseInvoicePdf(
  purchaseInvoiceId: number,
  purchaseInvoiceNoDisplay: string,
): Promise<void> {
  await downloadPdf(
    `/admin/get_purchase_invoice_pdf?purchase_invoice_id=${purchaseInvoiceId}`,
    `purchase-invoice-${purchaseInvoiceNoDisplay}.pdf`,
  );
}

export async function downloadUploadedPurchaseInvoicePdf(
  purchaseInvoiceId: number,
  purchaseInvoiceNoDisplay: string,
): Promise<void> {
  await downloadPdf(
    `/admin/get_purchase_invoice_uploaded_pdf?purchase_invoice_id=${purchaseInvoiceId}`,
    `purchase-invoice-${purchaseInvoiceNoDisplay}-original.pdf`,
  );
}
