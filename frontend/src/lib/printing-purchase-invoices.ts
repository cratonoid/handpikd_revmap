// ---------------------------------------------------------------------------
// Printing purchase invoice data for the /admin/invoices Purchase Invoices tab
// ---------------------------------------------------------------------------
// The printing half of lib/purchase-invoices.ts, against
// backend/app/api/routes/printing_purchase_invoices.py. Numbered PPINV-nnnn
// off its own series, so it never has to be told apart from a material
// PINV-nnnn by anything but its prefix.
//
// Two differences from the material module:
//   - There is no branded PDF to download. A printing purchase invoice is a
//     record of the VENDOR's document, so the uploaded original is the only
//     PDF it has — downloadUploadedPrintingPurchaseInvoicePdf is the only
//     download here.
//   - Nothing about it touches products or stock, on either side of the wire.
//
// As on the material side there is deliberately no create function: every
// printing purchase invoice is raised automatically as part of creating its
// printing purchase order.
import { apiFetch } from "@/lib/api";

export type PrintingPurchaseInvoice = {
  id: number;
  printingPurchaseInvoiceNo: number;
  printingPurchaseInvoiceNoDisplay: string;
  date: string;
  vendorId: number;
  poId: number;
  // The vendor's own invoice number, present only for orders created by
  // uploading their invoice PDF.
  vendorInvoiceNo: string | null;
  hasUploadedPdf: boolean;
  totalAmountBeforeTax: number;
  totalTaxAmount: number;
  totalAmountAfterTax: number;
  isDeleted: boolean;
};

// Shape returned by the backend's PrintingPurchaseInvoiceDetailItem schema.
type PrintingPurchaseInvoiceDetailItem = {
  id: number;
  printing_purchase_invoice_no: number;
  printing_purchase_invoice_no_display: string;
  date: string;
  vendor_id: number;
  po_id: number;
  vendor_invoice_no: string | null;
  has_uploaded_pdf: boolean;
  total_amount_before_tax: number;
  total_tax_amount: number;
  total_amount_after_tax: number;
  is_deleted: boolean;
};

function toPrintingPurchaseInvoice(item: PrintingPurchaseInvoiceDetailItem): PrintingPurchaseInvoice {
  return {
    id: item.id,
    printingPurchaseInvoiceNo: item.printing_purchase_invoice_no,
    printingPurchaseInvoiceNoDisplay: item.printing_purchase_invoice_no_display,
    date: item.date,
    vendorId: item.vendor_id,
    poId: item.po_id,
    vendorInvoiceNo: item.vendor_invoice_no,
    hasUploadedPdf: item.has_uploaded_pdf,
    totalAmountBeforeTax: item.total_amount_before_tax,
    totalTaxAmount: item.total_tax_amount,
    totalAmountAfterTax: item.total_amount_after_tax,
    isDeleted: item.is_deleted,
  };
}

export async function fetchPrintingPurchaseInvoices(): Promise<PrintingPurchaseInvoice[]> {
  const response = await apiFetch("/admin/get_printing_purchase_invoice_details");
  if (!response.ok) {
    throw new Error("Failed to load printing purchase invoices");
  }

  const items: PrintingPurchaseInvoiceDetailItem[] = await response.json();
  return items.map(toPrintingPurchaseInvoice);
}

// Attaches the vendor's PDF to a printing purchase invoice, or replaces the
// one already attached — the backend hard-deletes the old file from disk
// once the new one is saved, so there's no history kept.
export async function attachPrintingPurchaseInvoicePdf(
  printingPurchaseInvoiceId: number,
  file: File,
): Promise<void> {
  const formData = new FormData();
  formData.append("printing_purchase_invoice_id", String(printingPurchaseInvoiceId));
  formData.append("file", file);

  const response = await apiFetch("/admin/attach_printing_purchase_invoice_pdf", {
    method: "POST",
    body: formData,
  });

  if (!response.ok) {
    throw new Error("Failed to attach PDF");
  }
}

export type UpdatePrintingPurchaseInvoicePayload = {
  id: number;
  date: string;
  isDeleted: boolean;
};

export async function updatePrintingPurchaseInvoice(
  payload: UpdatePrintingPurchaseInvoicePayload,
): Promise<Response> {
  return apiFetch("/admin/update_printing_purchase_invoice_details", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      id: payload.id,
      date: payload.date,
      is_deleted: payload.isDeleted,
    }),
  });
}

export async function downloadUploadedPrintingPurchaseInvoicePdf(
  printingPurchaseInvoiceId: number,
  displayNo: string,
): Promise<void> {
  const response = await apiFetch(
    `/admin/get_printing_purchase_invoice_uploaded_pdf?printing_purchase_invoice_id=${printingPurchaseInvoiceId}`,
  );
  if (!response.ok) {
    throw new Error("Failed to download PDF");
  }

  const blob = await response.blob();
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = `${displayNo}.pdf`;
  document.body.appendChild(link);
  link.click();
  document.body.removeChild(link);
  URL.revokeObjectURL(url);
}
