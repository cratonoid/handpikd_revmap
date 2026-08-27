// ---------------------------------------------------------------------------
// Purchase order data for the /admin/orders "Purchase orders" tab
// ---------------------------------------------------------------------------
// Mirrors lib/vendors.ts. Fetches from GET /admin/get_purchase_order_details
// (backend/app/api/routes/orders.py), expected to return every purchase
// order as a flat list.
//
// PurchaseOrders itself has no line-item field — product/quantity/rate rows
// belong to the separate #purchase_summary collection
// (backend/app/models/purchase_summary.py), linked back via its
// purchase_order_id FK. get_purchase_order_details folds those rows back in
// as parallel productIds/quantities/rates arrays (raw ids, same convention
// as vendorId on ProductDetailItem — the frontend resolves names against
// its own vendor/product lists rather than the backend embedding them).
// purchase-order-form-modal.tsx submits/edits them the same way, as parallel
// product_ids/quantities/rates/gst_percs arrays, to create_new_purchase_order /
// update_purchase_order_details.
//
// The GST RATE is one of those per-line arrays, because a vendor invoice
// routinely taxes its lines at different rates (5% paper board billed
// alongside 18% toiletries). What the order decides is only which HEADS
// carry that rate — taxKind, CGST + SGST for an intra-state purchase or IGST
// for an inter-state one — since that follows from the two parties' states
// rather than from the goods. sgstPerc/cgstPerc/igstPerc below are a derived
// summary of a single-rate order and are all null when the lines differ.
import { apiFetch } from "@/lib/api";

// Which GST heads a document is taxed under. Mirrors TaxKind in
// backend/app/services/gst.py.
export type TaxKind = "igst" | "cgst_sgst";

export type PurchaseOrder = {
  id: number;
  purchaseOrderNo: string;
  vendorId: number;
  date: string;
  productIds: number[];
  quantities: number[];
  rates: number[];
  // One GST rate per line item, parallel to the arrays above — the rate each
  // line is actually taxed at, and what the totals are built from.
  gstPercs: number[];
  totalAmountBeforeTax: number;
  // Which heads the rates fall under. Null only on orders saved before this
  // was recorded, where the percentages below are the only thing that says.
  taxKind: TaxKind | null;
  // The order's single rate under its heads — a derived summary, all null
  // when the line items are taxed at different rates.
  sgstPerc: number | null;
  cgstPerc: number | null;
  igstPerc: number | null;
  totalAmountAfterTax: number;
  description: string;
};

// Shape returned by the backend's PurchaseOrderDetailItem schema.
type PurchaseOrderDetailItem = {
  id: number;
  purchase_order_no: string;
  vendor_id: number;
  date: string;
  product_ids: number[];
  quantities: number[];
  rates: number[];
  gst_percs: number[];
  total_amount_before_tax: number;
  tax_kind: TaxKind | null;
  sgst_perc: number | null;
  cgst_perc: number | null;
  igst_perc: number | null;
  total_amount_after_tax: number;
  description: string;
};

export type PurchaseOrderOption = {
  id: number;
  purchaseOrderNo: string;
  vendorName: string;
};

// Shape returned by the backend's PurchaseOrderListItem schema.
type PurchaseOrderListItem = {
  id: number;
  purchase_order_no: string;
  vendor_name: string;
};

// Lightweight id+PO no.+vendor name list for the "related purchase orders"
// multiselect on the sales order popup — PurchaseOrders has no is_deleted, so
// unlike get_vendors_list/get_customer_list there's no active/deleted split
// to worry about here.
export async function fetchPurchaseOrderList(): Promise<PurchaseOrderOption[]> {
  const response = await apiFetch("/admin/get_purchase_order_list");
  if (!response.ok) {
    throw new Error("Failed to load purchase orders");
  }

  const items: PurchaseOrderListItem[] = await response.json();
  return items.map((item) => ({
    id: item.id,
    purchaseOrderNo: item.purchase_order_no,
    vendorName: item.vendor_name,
  }));
}

export async function fetchPurchaseOrders(): Promise<PurchaseOrder[]> {
  const response = await apiFetch("/admin/get_purchase_order_details");
  if (!response.ok) {
    throw new Error("Failed to load purchase orders");
  }

  const items: PurchaseOrderDetailItem[] = await response.json();
  return items.map((item) => ({
    id: item.id,
    purchaseOrderNo: item.purchase_order_no,
    vendorId: item.vendor_id,
    date: item.date,
    productIds: item.product_ids,
    quantities: item.quantities,
    rates: item.rates,
    gstPercs: item.gst_percs,
    totalAmountBeforeTax: item.total_amount_before_tax,
    taxKind: item.tax_kind,
    sgstPerc: item.sgst_perc,
    cgstPerc: item.cgst_perc,
    igstPerc: item.igst_perc,
    totalAmountAfterTax: item.total_amount_after_tax,
    description: item.description,
  }));
}

// ---------------------------------------------------------------------------
// Reading a purchase order off the vendor's own invoice PDF
// ---------------------------------------------------------------------------
// POST /admin/parse_purchase_invoice_pdf (backend/app/api/routes/orders.py)
// reads an uploaded vendor invoice and returns the values a purchase order
// would be built from — vendor, invoice number and date, and one line item
// per product resolved to one of ours. It writes nothing: the admin reviews
// these values in the ordinary purchase order form and saves them through
// create_new_purchase_order like any other order.
//
// The endpoint refuses the upload outright (rather than returning partial
// values) if the vendor isn't on file, the invoice has already been
// recorded, or the PDF couldn't be read in full — parsePurchaseInvoicePdf
// surfaces the backend's own explanation of which, since it names the record
// the admin has to add.
//
// An invoice whose lines are taxed at different rates is NOT a refusal: each
// line carries its own gstPerc through to its purchase order line item, so
// such a bill records exactly as printed. It used to be turned away, because
// a purchase order held one rate for the whole order and there was nowhere
// to put the second one.
//
// A line item whose product it couldn't place is NOT a refusal: it comes
// back with productId null and an unresolvedReason, and the review screen
// asks the admin to point it at an existing product or create the missing
// one there. The order simply can't be saved while any line is unresolved,
// which the product <select>'s own `required` already enforces.

export type ParsedInvoiceLineItem = {
  // Both null when the invoice's wording didn't resolve to exactly one of
  // this vendor's products — unresolvedReason then says why, in a sentence
  // written for the admin.
  productId: number | null;
  // Our product's name, and the text as printed on the invoice — both are
  // shown so the admin can see what was matched to what.
  productName: string | null;
  description: string;
  // The line's HSN/SAC code as printed. Carried so that creating the missing
  // product from this line doesn't send the admin back to the PDF for it.
  hsnCode: string;
  quantity: number;
  rate: number;
  gstPerc: number;
  unresolvedReason: string | null;
};

export type ParsedPurchaseInvoice = {
  vendorId: number;
  vendorName: string;
  vendorGstin: string;
  vendorInvoiceNo: string;
  date: string;
  lineItems: ParsedInvoiceLineItem[];
  // Which heads this purchase falls under, from our state vs the vendor's.
  // Always present, unlike the percentages below, which are all null when the
  // invoice taxes its lines at different rates.
  taxKind: TaxKind;
  sgstPerc: number | null;
  cgstPerc: number | null;
  igstPerc: number | null;
  totalAmountBeforeTax: number;
  totalAmountAfterTax: number;
  // The invoice's own printed total, and whether it disagrees with the total
  // these line items add up to. Shown as a warning to check rather than
  // treated as an error — vendors add freight, labour and round-off lines
  // that no line item accounts for.
  printedTotal: number | null;
  totalMismatch: boolean;
  // "text" if the deterministic parser read the PDF, "claude" if it fell
  // back to reading it with Claude.
  source: string;
};

// Shape returned by the backend's ParsePurchaseInvoicePdfResponse schema.
type ParsePurchaseInvoicePdfResponse = {
  vendor_id: number;
  vendor_name: string;
  vendor_gstin: string;
  vendor_invoice_no: string;
  date: string;
  line_items: {
    product_id: number | null;
    product_name: string | null;
    description: string;
    hsn_code: string;
    quantity: number;
    rate: number;
    gst_perc: number;
    unresolved_reason: string | null;
  }[];
  tax_kind: TaxKind;
  sgst_perc: number | null;
  cgst_perc: number | null;
  igst_perc: number | null;
  total_amount_before_tax: number;
  total_amount_after_tax: number;
  printed_total: number | null;
  total_mismatch: boolean;
  source: string;
};

export async function parsePurchaseInvoicePdf(file: File): Promise<ParsedPurchaseInvoice> {
  const formData = new FormData();
  formData.append("file", file);

  const response = await apiFetch("/admin/parse_purchase_invoice_pdf", { method: "POST", body: formData });

  if (!response.ok) {
    // Every rejection reason is written for the admin and names what to fix
    // ("no vendor with GSTIN ...", "invoice X has already been recorded"),
    // so it's shown as-is rather than flattened into a status-code message.
    const body = await response.json().catch(() => null);
    throw new Error(
      typeof body?.detail === "string" ? body.detail : "this invoice couldn't be read. Please try again.",
    );
  }

  const parsed: ParsePurchaseInvoicePdfResponse = await response.json();
  return {
    vendorId: parsed.vendor_id,
    vendorName: parsed.vendor_name,
    vendorGstin: parsed.vendor_gstin,
    vendorInvoiceNo: parsed.vendor_invoice_no,
    date: parsed.date,
    lineItems: parsed.line_items.map((item) => ({
      productId: item.product_id,
      productName: item.product_name,
      description: item.description,
      hsnCode: item.hsn_code,
      quantity: item.quantity,
      rate: item.rate,
      gstPerc: item.gst_perc,
      unresolvedReason: item.unresolved_reason,
    })),
    taxKind: parsed.tax_kind,
    sgstPerc: parsed.sgst_perc,
    cgstPerc: parsed.cgst_perc,
    igstPerc: parsed.igst_perc,
    totalAmountBeforeTax: parsed.total_amount_before_tax,
    totalAmountAfterTax: parsed.total_amount_after_tax,
    printedTotal: parsed.printed_total,
    totalMismatch: parsed.total_mismatch,
    source: parsed.source,
  };
}
