// ---------------------------------------------------------------------------
// datetime-local helpers — order date fields on the purchase/sales order forms
// ---------------------------------------------------------------------------
// <input type="datetime-local"> takes/returns "YYYY-MM-DDTHH:mm" in the
// browser's local time, with no timezone info. Backend order `date` fields
// are naive datetimes (see PurchaseOrders/SalesOrders models), so the raw
// value round-trips as-is — just padded with seconds for a full ISO string.

// Local "now", for pre-filling the date field on new orders.
export function nowAsDatetimeLocalValue(): string {
  const now = new Date();
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())}T${pad(now.getHours())}:${pad(now.getMinutes())}`;
}

// Backend ISO datetime string -> local input value, for pre-filling the date
// field in edit mode.
export function toDatetimeLocalValue(isoDate: string): string {
  return isoDate.slice(0, 16);
}

// Local input value -> a full ISO string the backend's `datetime` fields can
// parse, for submission.
export function fromDatetimeLocalValue(value: string): string {
  return value.length === 16 ? `${value}:00` : value;
}

// Adds `days` to a datetime-local input value, formatted the same way as
// nowAsDatetimeLocalValue. Used to default a quotation's "valid till" field
// to its issue date + 10 days (quotation-form-modal.tsx) — the result stays
// a plain editable input value, not a derived/computed one.
export function addDaysToDatetimeLocalValue(value: string, days: number): string {
  const date = new Date(fromDatetimeLocalValue(value));
  date.setDate(date.getDate() + days);
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}T${pad(date.getHours())}:${pad(date.getMinutes())}`;
}
