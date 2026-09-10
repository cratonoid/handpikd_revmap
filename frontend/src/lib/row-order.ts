// ---------------------------------------------------------------------------
// Row ordering for the admin/customer list tables
// ---------------------------------------------------------------------------
// Every list table in the app — inquiries, invoices, orders, quotations —
// shows the newest record first, so the row an admin just created (or the
// one that just came in from the public site) is at the top instead of
// buried at the bottom of a year's history.
//
// Most of the admin list endpoints return rows in whatever order they
// iterate, so the sort happens here rather than being relied on from the
// API. It is for display only — the fetched arrays are left untouched.
//
// The tables number their S.No column DOWN from the row count
// (`rows.length - index`) rather than up from 1, which is what keeps that
// column stable: numbering is anchored at the oldest row, so a new record
// takes the next number at the top and every row below it keeps the number
// it had. Numbering up from 1 would renumber the whole table on every
// insert. It is still a row counter and not an identifier — a filtered
// table numbers only the rows it is showing.
//
// The id tiebreaker matters because the date fields are entered by hand and
// two records keyed on the same day compare equal. JS sort is stable, so
// without it those two would fall back to the backend's iteration order,
// which is not something to depend on. Descending id keeps "newest first"
// consistent within a day: the later-created row wins.

// For the records carrying an admin-entered `date` (invoices, orders,
// quotations).
export function byNewestFirst(
  a: { date: string; id: number },
  b: { date: string; id: number },
): number {
  return new Date(b.date).getTime() - new Date(a.date).getTime() || b.id - a.id;
}

// For the records stamped with a server-side `createdAt` instead — the two
// inquiry feeds, which are written by visitors rather than by an admin.
export function byNewestCreatedFirst(
  a: { createdAt: string; id: number },
  b: { createdAt: string; id: number },
): number {
  return new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime() || b.id - a.id;
}
