// ---------------------------------------------------------------------------
// Date display helpers — every date shown in a table row or detail field
// ---------------------------------------------------------------------------
// One fixed dd/mm/yyyy form everywhere, rather than Date#toLocaleDateString,
// which follows whatever locale the admin's browser happens to be set to and
// so showed 9/12/2026 (US) on one machine and 12/9/2026 on another for the
// same order.
//
// Backend date fields arrive in two shapes: plain "YYYY-MM-DD" (the accounts
// endpoints) and naive ISO datetimes "YYYY-MM-DDTHH:mm:ss" with no offset
// (order / invoice / quotation dates — see lib/datetime-input.ts). Both are
// read straight off the string: the calendar day is the first ten
// characters, and going through Date would only invite a timezone shift on
// the way through. Anything else (a Date object, or a timestamp carrying a
// "Z" / offset such as the inquiry created_at fields) is a real instant and
// is rendered in Indian time.

const IST = "Asia/Kolkata";
const NAIVE_ISO = /^\d{4}-\d{2}-\d{2}(?:T\d{2}:\d{2}(?::\d{2}(?:\.\d+)?)?)?$/;

export function formatDate(value: string | Date): string {
  if (typeof value === "string" && NAIVE_ISO.test(value)) {
    const [year, month, day] = value.slice(0, 10).split("-");
    return `${day}/${month}/${year}`;
  }

  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return String(value);
  // en-GB is dd/mm/yyyy; the timeZone pins the day to IST rather than the
  // viewer's machine.
  return date.toLocaleDateString("en-GB", { timeZone: IST, day: "2-digit", month: "2-digit", year: "numeric" });
}

// dd/mm/yyyy, HH:mm — for the submission timestamps on the inquiry tables,
// where the time of day matters as well as the date.
export function formatDateTime(value: string | Date): string {
  if (typeof value === "string" && NAIVE_ISO.test(value)) {
    const time = value.length > 10 ? value.slice(11, 16) : "00:00";
    return `${formatDate(value)}, ${time}`;
  }

  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return String(value);
  const time = date.toLocaleTimeString("en-GB", { timeZone: IST, hour: "2-digit", minute: "2-digit", hour12: false });
  return `${formatDate(date)}, ${time}`;
}

