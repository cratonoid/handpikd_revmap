// ---------------------------------------------------------------------------
// Invoice data for the client portal's /customer/invoices screen
// ---------------------------------------------------------------------------
// The client-side counterpart to lib/invoices.ts. Everything here goes to the
// /customer endpoints in backend/app/api/routes/customer_invoices.py, which
// scope every response to the CustomerDetails row behind the signed-in login
// — there is no id to pass and no way to ask for somebody else's invoice.
// That's why this is a separate module rather than a couple of extra
// functions on lib/invoices.ts: nothing on this screen may reach an /admin
// endpoint, and keeping the two files apart makes that visible.
//
// The shapes are narrower than lib/invoices.ts's Invoice for the same reason
// — a client is shown what's on their own document, not how it was assembled
// (no salesIds, custId or isDeleted).
import { apiFetch } from "@/lib/api";
import type { InvoiceStatus, InvoiceType } from "@/lib/invoices";

export type { InvoiceStatus, InvoiceType };

// Which GST heads the invoice was raised under, frozen on it at creation
// time. Null on invoices raised before that was recorded — the screen falls
// back to whichever of the three amounts is non-zero.
export type TaxKind = "igst" | "cgst_sgst";

export type CustomerInvoice = {
  id: number;
  invoiceNoDisplay: string;
  date: string;
  dueDate: string;
  type: InvoiceType;
  status: InvoiceStatus;
  // Order numbers behind a standard invoice ("SO-14" is rendered from these),
  // so a client can tie it back to an order they placed. Empty for proforma
  // invoices, which are raised without an order.
  salesOrderNos: number[];
  totalAmountBeforeTax: number;
  totalTaxAmount: number;
  totalAmountAfterTax: number;
};

export type CustomerInvoiceLineItem = {
  productName: string;
  hsnCode: string;
  quantity: number;
  rate: number;
  discount: number;
  taxableValue: number;
  taxPerc: number;
  taxAmount: number;
  total: number;
};

export type CustomerInvoiceDetail = CustomerInvoice & {
  transport: string;
  description: string;
  lineItems: CustomerInvoiceLineItem[];
  taxKind: TaxKind | null;
  placeOfSupplyCode: string;
  placeOfSupplyName: string;
  totalIgstAmount: number;
  totalCgstAmount: number;
  totalSgstAmount: number;
  billedToName: string;
  billedToAddress: string;
  billedToGstin: string;
};

// Shapes returned by the backend's CustomerInvoiceListItem /
// CustomerInvoiceDetail schemas.
type CustomerInvoiceListItemResponse = {
  id: number;
  invoice_no_display: string;
  date: string;
  due_date: string;
  type: InvoiceType;
  status: InvoiceStatus;
  sales_order_nos: number[];
  total_amount_before_tax: number;
  total_tax_amount: number;
  total_amount_after_tax: number;
};

type CustomerInvoiceLineItemResponse = {
  product_name: string;
  hsn_code: string;
  quantity: number;
  rate: number;
  discount: number;
  taxable_value: number;
  tax_perc: number;
  tax_amount: number;
  total: number;
};

type CustomerInvoiceDetailResponse = CustomerInvoiceListItemResponse & {
  transport: string;
  description: string;
  line_items: CustomerInvoiceLineItemResponse[];
  tax_kind: TaxKind | null;
  place_of_supply_code: string;
  place_of_supply_name: string;
  total_igst_amount: number;
  total_cgst_amount: number;
  total_sgst_amount: number;
  billed_to_name: string;
  billed_to_address: string;
  billed_to_gstin: string;
};

function toInvoice(item: CustomerInvoiceListItemResponse): CustomerInvoice {
  return {
    id: item.id,
    invoiceNoDisplay: item.invoice_no_display,
    date: item.date,
    dueDate: item.due_date,
    type: item.type,
    status: item.status,
    salesOrderNos: item.sales_order_nos,
    totalAmountBeforeTax: item.total_amount_before_tax,
    totalTaxAmount: item.total_tax_amount,
    totalAmountAfterTax: item.total_amount_after_tax,
  };
}

function toLineItem(item: CustomerInvoiceLineItemResponse): CustomerInvoiceLineItem {
  return {
    productName: item.product_name,
    hsnCode: item.hsn_code,
    quantity: item.quantity,
    rate: item.rate,
    discount: item.discount,
    taxableValue: item.taxable_value,
    taxPerc: item.tax_perc,
    taxAmount: item.tax_amount,
    total: item.total,
  };
}

export async function fetchMyInvoices(): Promise<CustomerInvoice[]> {
  const response = await apiFetch("/customer/get_my_invoices");
  if (!response.ok) {
    throw new Error("Failed to load invoices");
  }

  const items: CustomerInvoiceListItemResponse[] = await response.json();
  return items.map(toInvoice);
}

export async function fetchMyInvoiceDetail(invoiceId: number): Promise<CustomerInvoiceDetail> {
  const response = await apiFetch(`/customer/get_my_invoice_details?invoice_id=${invoiceId}`);
  if (!response.ok) {
    throw new Error("Failed to load invoice details");
  }

  const item: CustomerInvoiceDetailResponse = await response.json();
  return {
    ...toInvoice(item),
    transport: item.transport,
    description: item.description,
    lineItems: item.line_items.map(toLineItem),
    taxKind: item.tax_kind,
    placeOfSupplyCode: item.place_of_supply_code,
    placeOfSupplyName: item.place_of_supply_name,
    totalIgstAmount: item.total_igst_amount,
    totalCgstAmount: item.total_cgst_amount,
    totalSgstAmount: item.total_sgst_amount,
    billedToName: item.billed_to_name,
    billedToAddress: item.billed_to_address,
    billedToGstin: item.billed_to_gstin,
  };
}

// ---------------------------------------------------------------------------
// Formatting + the dashboard's status summary
// ---------------------------------------------------------------------------
export function formatAmount(value: number): string {
  return `₹${value.toFixed(2)}`;
}

export type InvoiceStatusSummary = {
  outstandingAmount: number;
  outstandingCount: number;
  overdueAmount: number;
  overdueCount: number;
  paidAmount: number;
  paidCount: number;
};

// The three rules below are lifted from the admin's receivables report
// (_UNPAID_INVOICE_STATUSES and get_accounts_receivables in
// backend/app/api/routes/accounts.py) rather than invented here, so a client
// reading "you owe X" and the admin reading their books can never disagree
// about the same invoice:
//
//   - Proforma invoices don't count at all. They aren't statutory documents,
//     and nothing is owed on one until a tax invoice is raised.
//   - Unpaid means status "new" or "submitted", and the FULL invoice value is
//     outstanding — #invoice_details has no part-payment field, status is
//     all-or-nothing.
//   - Overdue is measured against today, not against when the invoice was
//     raised, and an invoice due today is not yet late (the backend's
//     `due < as_of`).
//
// Computed here from the list the screen already has, rather than asking the
// backend for a second, pre-totalled view of it: a client has a handful of
// invoices, not a ledger.
export function summariseInvoiceStatus(
  invoices: CustomerInvoice[],
  asOf: Date = new Date(),
): InvoiceStatusSummary {
  // Compared date-to-date, so an invoice due later today isn't reported late
  // because of the time of day the page happened to be opened.
  const today = new Date(asOf.getFullYear(), asOf.getMonth(), asOf.getDate());

  const summary: InvoiceStatusSummary = {
    outstandingAmount: 0,
    outstandingCount: 0,
    overdueAmount: 0,
    overdueCount: 0,
    paidAmount: 0,
    paidCount: 0,
  };

  for (const invoice of invoices) {
    if (invoice.type !== "standard") continue;

    if (invoice.status === "paid") {
      summary.paidAmount += invoice.totalAmountAfterTax;
      summary.paidCount += 1;
      continue;
    }

    summary.outstandingAmount += invoice.totalAmountAfterTax;
    summary.outstandingCount += 1;

    const due = new Date(invoice.dueDate);
    if (new Date(due.getFullYear(), due.getMonth(), due.getDate()) < today) {
      summary.overdueAmount += invoice.totalAmountAfterTax;
      summary.overdueCount += 1;
    }
  }

  return summary;
}

// Same blob-and-throwaway-link approach as downloadInvoicePdf in
// lib/invoices.ts: the endpoint needs the Authorization bearer header, which
// a plain <a href> can't attach.
export async function downloadMyInvoicePdf(invoiceId: number, invoiceNoDisplay: string): Promise<void> {
  const response = await apiFetch(`/customer/get_my_invoice_pdf?invoice_id=${invoiceId}`);
  if (!response.ok) {
    throw new Error("Failed to generate invoice PDF");
  }

  const blob = await response.blob();
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  // The invoice number carries slashes (H/26-27/12), which a browser reads
  // as path separators in a download name — the backend's own filename
  // slugs them for exactly this reason (invoice_no_filename_slug).
  link.download = `invoice-${invoiceNoDisplay.replace(/\//g, "-")}.pdf`;
  document.body.appendChild(link);
  link.click();
  document.body.removeChild(link);
  URL.revokeObjectURL(url);
}
