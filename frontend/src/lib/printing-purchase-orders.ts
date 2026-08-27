// ---------------------------------------------------------------------------
// Printing purchase order data for the /admin/orders "Purchase orders" tab
// ---------------------------------------------------------------------------
// The printing half of lib/purchase-orders.ts, against
// backend/app/api/routes/printing_orders.py and its own
// #printing_purchase_orders collection.
//
// The one structural difference runs through everything here: a line item is
// a DESCRIPTION the vendor wrote, not a product of ours. A printing vendor
// bills a service ("Customized Print Service", "Sticker Printing A3 UV")
// that matches nothing in our catalogue and isn't supposed to, so there are
// no productIds to resolve, nothing to look up against lib/products.ts, and
// nothing that moves stock. That is also why these are separate collections
// rather than a flag on the material ones — see the backend model's comments.
//
// Everything about GST is identical to the material side: the RATE belongs
// to the line item (a printing bill can mix rates as freely as a material
// one), and the order only decides which HEADS carry it, from the two
// parties' states.
import { apiFetch } from "@/lib/api";
import type { TaxKind } from "@/lib/purchase-orders";

export type PrintingPurchaseOrder = {
  id: number;
  purchaseOrderNo: string;
  vendorId: number;
  date: string;
  // Parallel arrays, one entry per line item. `descriptions` is the service
  // as the vendor billed it; `hsnCodes` is the SAC/HSN printed against it,
  // "" where the bill carried none.
  descriptions: string[];
  hsnCodes: string[];
  quantities: number[];
  rates: number[];
  // One GST rate per line item — the rate each line is actually taxed at,
  // and what the totals are built from.
  gstPercs: number[];
  totalAmountBeforeTax: number;
  // Which heads the rates fall under. Never null here, unlike on the
  // material side: this collection has no rows predating the field.
  taxKind: TaxKind;
  // The order's single rate under its heads — a derived summary, all null
  // when the line items are taxed at different rates.
  sgstPerc: number | null;
  cgstPerc: number | null;
  igstPerc: number | null;
  totalAmountAfterTax: number;
  description: string;
};

// Shape returned by the backend's PrintingPurchaseOrderDetailItem schema.
type PrintingPurchaseOrderDetailItem = {
  id: number;
  purchase_order_no: string;
  vendor_id: number;
  date: string;
  descriptions: string[];
  hsn_codes: string[];
  quantities: number[];
  rates: number[];
  gst_percs: number[];
  total_amount_before_tax: number;
  tax_kind: TaxKind;
  sgst_perc: number | null;
  cgst_perc: number | null;
  igst_perc: number | null;
  total_amount_after_tax: number;
  description: string;
};

export async function fetchPrintingPurchaseOrders(): Promise<PrintingPurchaseOrder[]> {
  const response = await apiFetch("/admin/get_printing_purchase_order_details");
  if (!response.ok) {
    throw new Error("Failed to load printing purchase orders");
  }

  const items: PrintingPurchaseOrderDetailItem[] = await response.json();
  return items.map((item) => ({
    id: item.id,
    purchaseOrderNo: item.purchase_order_no,
    vendorId: item.vendor_id,
    date: item.date,
    descriptions: item.descriptions,
    hsnCodes: item.hsn_codes,
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
// Reading a printing purchase order off the vendor's own invoice PDF
// ---------------------------------------------------------------------------
// POST /admin/parse_printing_purchase_invoice_pdf reads an uploaded printing
// invoice and returns the values an order would be built from. It writes
// nothing: the admin reviews them in the ordinary printing purchase order
// form and saves through create_new_printing_purchase_order.
//
// Unlike the material parse, no line can come back "unresolved" — there is
// nothing to resolve a description against, so every line arrives complete
// and editable. What it CAN refuse is an invoice whose vendor isn't on file,
// whose vendor is a material vendor (the bill belongs on the other tab), one
// already recorded, or a PDF that couldn't be read in full.

export type ParsedPrintingInvoiceLineItem = {
  description: string;
  hsnCode: string;
  quantity: number;
  rate: number;
  gstPerc: number;
};

export type ParsedPrintingPurchaseInvoice = {
  vendorId: number;
  vendorName: string;
  vendorGstin: string;
  vendorInvoiceNo: string;
  date: string;
  lineItems: ParsedPrintingInvoiceLineItem[];
  // Which heads this purchase falls under, from our state vs the vendor's.
  // Always present, unlike the percentages below, which are all null when
  // the invoice taxes its lines at different rates.
  taxKind: TaxKind;
  sgstPerc: number | null;
  cgstPerc: number | null;
  igstPerc: number | null;
  totalAmountBeforeTax: number;
  totalAmountAfterTax: number;
  // The invoice's own printed total, and whether it disagrees with what
  // these line items add up to. Shown as a warning to check rather than
  // treated as an error — printing bills carry freight and round-off lines
  // too.
  printedTotal: number | null;
  totalMismatch: boolean;
  // "text" if the deterministic parser read the PDF, "claude" if it fell
  // back to reading it with Claude.
  source: string;
};

// Shape returned by the backend's ParsePrintingPurchaseInvoicePdfResponse.
type ParsePrintingPurchaseInvoicePdfResponse = {
  vendor_id: number;
  vendor_name: string;
  vendor_gstin: string;
  vendor_invoice_no: string;
  date: string;
  line_items: {
    description: string;
    hsn_code: string;
    quantity: number;
    rate: number;
    gst_perc: number;
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

export async function parsePrintingPurchaseInvoicePdf(
  file: File,
): Promise<ParsedPrintingPurchaseInvoice> {
  const formData = new FormData();
  formData.append("file", file);

  const response = await apiFetch("/admin/parse_printing_purchase_invoice_pdf", {
    method: "POST",
    body: formData,
  });

  if (!response.ok) {
    // Every rejection reason is written for the admin and names what to fix
    // ("no vendor with GSTIN ...", "X is a material vendor — record this
    // invoice under Purchase orders / Material instead"), so it's shown
    // as-is rather than flattened into a status-code message.
    const body = await response.json().catch(() => null);
    throw new Error(
      typeof body?.detail === "string" ? body.detail : "this invoice couldn't be read. Please try again.",
    );
  }

  const parsed: ParsePrintingPurchaseInvoicePdfResponse = await response.json();
  return {
    vendorId: parsed.vendor_id,
    vendorName: parsed.vendor_name,
    vendorGstin: parsed.vendor_gstin,
    vendorInvoiceNo: parsed.vendor_invoice_no,
    date: parsed.date,
    lineItems: parsed.line_items.map((item) => ({
      description: item.description,
      hsnCode: item.hsn_code,
      quantity: item.quantity,
      rate: item.rate,
      gstPerc: item.gst_perc,
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
