// ---------------------------------------------------------------------------
// GST percentage options
// ---------------------------------------------------------------------------
// Placeholder values (India's standard GST slabs) for the GST %/SGST %/
// CGST %/IGST % dropdowns on the product and purchase order forms. These are
// hardcoded stand-ins — swap the array out once the real rates to offer are
// decided, and every dropdown that imports this picks up the change.
export const GST_PERCENT_OPTIONS = [0, 5, 12, 18, 28];

// ---------------------------------------------------------------------------
// GST state codes
// ---------------------------------------------------------------------------
// Mirror of backend/app/services/gst.py's GST_STATE_CODES — the first two
// digits of every GSTIN. Kept client-side so the client/vendor/profile forms
// can fill the state in the moment a GSTIN is typed, and so the purchase
// order form can pick SGST+CGST vs IGST without a round trip. The backend
// re-derives all of this on save; nothing here is trusted.
export const GST_STATE_CODES: Record<string, string> = {
  "01": "Jammu and Kashmir",
  "02": "Himachal Pradesh",
  "03": "Punjab",
  "04": "Chandigarh",
  "05": "Uttarakhand",
  "06": "Haryana",
  "07": "Delhi",
  "08": "Rajasthan",
  "09": "Uttar Pradesh",
  "10": "Bihar",
  "11": "Sikkim",
  "12": "Arunachal Pradesh",
  "13": "Nagaland",
  "14": "Manipur",
  "15": "Mizoram",
  "16": "Tripura",
  "17": "Meghalaya",
  "18": "Assam",
  "19": "West Bengal",
  "20": "Jharkhand",
  "21": "Odisha",
  "22": "Chhattisgarh",
  "23": "Madhya Pradesh",
  "24": "Gujarat",
  "26": "Dadra and Nagar Haveli and Daman and Diu",
  "27": "Maharashtra",
  "29": "Karnataka",
  "30": "Goa",
  "31": "Lakshadweep",
  "32": "Kerala",
  "33": "Tamil Nadu",
  "34": "Puducherry",
  "35": "Andaman and Nicobar Islands",
  "36": "Telangana",
  "37": "Andhra Pradesh",
  "38": "Ladakh",
};

// Sorted by state name for the dropdowns — the codes themselves are not in
// any order a user would scan for.
export const GST_STATE_OPTIONS = Object.entries(GST_STATE_CODES)
  .map(([code, name]) => ({ code, name }))
  .sort((a, b) => a.name.localeCompare(b.name));

// "" for anything that isn't an assigned code, so a half-typed GSTIN or a
// stale value never reads as a real state.
export function normaliseStateCode(value: string | null | undefined): string {
  if (!value) return "";
  let code = String(value).trim();
  if (code.length === 1 && /^\d$/.test(code)) code = `0${code}`;
  code = code.slice(0, 2);
  return code in GST_STATE_CODES ? code : "";
}

export function stateCodeFromGstin(gstin: string | null | undefined): string {
  return normaliseStateCode(gstin?.trim().slice(0, 2));
}

export function stateNameForCode(code: string | null | undefined): string {
  return GST_STATE_CODES[normaliseStateCode(code)] ?? "";
}

// A party's effective state: what's stored on them, else whatever their
// GSTIN implies. Same precedence as resolve_state_code in
// backend/app/services/gst.py, so the form and the saved record agree.
export function resolveStateCode(
  stateCode: string | null | undefined,
  gstin: string | null | undefined,
): string {
  return normaliseStateCode(stateCode) || stateCodeFromGstin(gstin);
}

// Both parties in the same state -> CGST + SGST; anything else (including a
// party whose state can't be established) -> IGST.
export function isIntraState(
  partyStateCode: string | null | undefined,
  ownStateCode: string | null | undefined,
): boolean {
  const party = normaliseStateCode(partyStateCode);
  const own = normaliseStateCode(ownStateCode);
  return party !== "" && party === own;
}
