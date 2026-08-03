// ---------------------------------------------------------------------------
// sanitizeDecimalInput — plain-text numeric entry for rate/price/GST fields
// ---------------------------------------------------------------------------
// Keeps these fields as plain text so a leading "0" can just be typed over
// instead of fighting a controlled type="number" input (which re-renders
// through Number() on every keystroke and leaves stray leading zeros, e.g.
// "05", until the field loses focus). Strips anything that isn't a digit or
// a decimal point, and collapses extra leading zeros (but not "0.5"-style
// values, where the leading zero is meaningful).
export function sanitizeDecimalInput(raw: string): string {
  let value = raw.replace(/[^\d.]/g, "");
  const firstDot = value.indexOf(".");
  if (firstDot !== -1) {
    value = value.slice(0, firstDot + 1) + value.slice(firstDot + 1).replace(/\./g, "");
  }
  return value.replace(/^0+(?=\d)/, "");
}
