// Sends a PDF straight to the browser's print dialog instead of saving it.
// The PDF endpoints need the bearer header (see apiFetch in lib/api.ts), so
// callers fetch the blob themselves and hand it here; it's loaded into a
// hidden <iframe> and printed from there — a plain window.open + print()
// would fire before the PDF viewer had rendered, and popup blockers tend to
// eat the new tab anyway. The iframe is left in the DOM until printing is
// done (`afterprint` doesn't fire reliably for PDF frames), so it's torn
// down on the next call instead.
let printFrame: HTMLIFrameElement | null = null;

export async function printPdfBlob(blob: Blob): Promise<void> {
  const url = URL.createObjectURL(blob);

  if (printFrame) {
    if (printFrame.src) URL.revokeObjectURL(printFrame.src);
    printFrame.remove();
  }
  const frame = document.createElement("iframe");
  frame.style.position = "fixed";
  frame.style.right = "0";
  frame.style.bottom = "0";
  frame.style.width = "0";
  frame.style.height = "0";
  frame.style.border = "0";
  frame.setAttribute("aria-hidden", "true");
  printFrame = frame;

  await new Promise<void>((resolve, reject) => {
    frame.onload = () => {
      try {
        frame.contentWindow?.focus();
        frame.contentWindow?.print();
        resolve();
      } catch (err) {
        reject(err);
      }
    };
    frame.onerror = () => reject(new Error("Failed to load PDF for printing"));
    frame.src = url;
    document.body.appendChild(frame);
  });
}
