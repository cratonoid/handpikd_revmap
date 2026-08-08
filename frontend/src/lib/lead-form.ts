// ---------------------------------------------------------------------------
// Lead form submission — same Google Apps Script endpoint the old Handpikd
// site's "Get Started" form used (see the old site's script.js,
// FORM_CONFIG.googleSheetsUrl). That Apps Script web app writes the
// submission into a Google Sheet AND sends a notification email, so
// reusing it here means new leads land in the exact same place the old
// site's did, with no new backend work required.
//
// The URL is not a new secret: it was already called directly from the old
// site's public, unauthenticated client-side JS — Apps Script web app
// endpoints are designed to be invoked this way.
const GOOGLE_SHEETS_LEAD_URL =
  "https://script.google.com/macros/s/AKfycbzAtwSR9ecYYjL-gqPy0x0bpSw_Dy1Uoob44083l1HRBGL3Im52nPGuL6plEv8uJm07/exec";

export type LeadSubmission = {
  name: string;
  email: string;
  company: string;
  phone: string;
  message: string;
};

// Sends a lead to the shared Google Sheet. `mode: "no-cors"` is required
// because the Apps Script response doesn't send CORS headers back to
// arbitrary origins — that also means the response body/status can't be
// read here, so (matching the old site's own behavior) a resolved fetch
// with no thrown network error is treated as success.
export async function submitLead(data: LeadSubmission): Promise<void> {
  const timestamp = new Date().toLocaleString("en-IN", { timeZone: "Asia/Kolkata" });

  await fetch(GOOGLE_SHEETS_LEAD_URL, {
    method: "POST",
    mode: "no-cors",
    headers: { "Content-Type": "text/plain" },
    body: JSON.stringify({
      timestamp,
      name: data.name,
      email: data.email,
      company: data.company,
      phone: data.phone,
      message: data.message,
    }),
  });
}
