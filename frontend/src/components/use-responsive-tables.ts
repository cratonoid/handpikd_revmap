"use client";

// ---------------------------------------------------------------------------
// useResponsiveTables — phone-width card layout for every dashboard table
// ---------------------------------------------------------------------------
// On a phone, a table wider than the screen hides its right-hand columns
// (an invoice's sales order, an inventory row's quantity) behind a sideways
// swipe inside .tableWrap. Rather than hand-writing a second, card-shaped
// markup for each of the ~30 tables across the admin and customer pages,
// DashboardShell runs this once over its content pane, and it:
//
//   1. labels every body cell with its column's heading (data-label), which
//      the card CSS in dashboard.module.css prints above the value, and marks
//      each row's title cell (data-card-title) and S.No cell
//      (data-card-serial);
//   2. below 768px, flags a table with data-cards ONLY if it actually
//      overflows its container. A table that already fits (the Orders page's
//      three-column Brief view) is easier to scan as a table and stays one.
//
// Overflow is measured with the table in its normal layout (the flag is
// removed, measured, re-added within one frame — no paint happens in
// between, so there is no flicker). A MutationObserver re-runs this whenever
// rows load, filters change or a view toggles. It watches child/text changes
// only, never attributes, so the attributes it writes can't re-trigger it.
import { useEffect, type RefObject } from "react";

const PHONE_QUERY = "(max-width: 767px)";
const SERIAL_LABEL = /^(s\.?\s*no\.?|sr\.?\s*no\.?|#)$/i;

function setAttr(el: Element, name: string, value: string | null) {
  if (value === null) {
    if (el.hasAttribute(name)) el.removeAttribute(name);
  } else if (el.getAttribute(name) !== value) {
    el.setAttribute(name, value);
  }
}

function headingLabels(table: HTMLTableElement): string[] {
  const rows = table.tHead?.rows;
  if (!rows || rows.length === 0) return [];

  // The last header row is the one with a cell per column when a table
  // groups its headings over two rows. colSpan is expanded so the labels
  // stay aligned with the body cells underneath.
  const labels: string[] = [];
  for (const th of Array.from(rows[rows.length - 1].cells)) {
    // First line only: a heading cell may also hold a sort or filter
    // control whose text follows the label.
    const text = (th.innerText || th.textContent || "").split("\n")[0].trim();
    for (let i = 0; i < th.colSpan; i++) labels.push(text);
  }
  return labels;
}

function labelTable(table: HTMLTableElement, primaryCellClass: string) {
  const labels = headingLabels(table);
  const bodyRows = [
    ...Array.from(table.tBodies).flatMap((body) => Array.from(body.rows)),
    ...Array.from(table.tFoot?.rows ?? []),
  ];

  for (const row of bodyRows) {
    let column = 0;
    let title: HTMLTableCellElement | null = null;

    for (const cell of Array.from(row.cells)) {
      // A cell spanning several columns (an empty-state message, a subtotal
      // label) belongs to none of them, so it gets no label.
      const label = cell.colSpan > 1 ? "" : (labels[column] ?? "");
      column += cell.colSpan;

      const isSerial = SERIAL_LABEL.test(label);
      setAttr(cell, "data-label", label);
      setAttr(cell, "data-card-serial", isSerial ? "" : null);

      // The title is the cell the table itself marks as primary, else the
      // first plain-text cell that isn't the S.No — never a control.
      if (cell.classList.contains(primaryCellClass)) {
        title = cell;
      } else if (
        !title &&
        !isSerial &&
        label !== "" &&
        !cell.querySelector("button, select, input, textarea")
      ) {
        title = cell;
      }
    }

    for (const cell of Array.from(row.cells)) {
      setAttr(cell, "data-card-title", cell === title ? "" : null);
    }
  }
}

// `active` is false while the owning component isn't rendering the container
// yet (DashboardShell renders nothing until its role check passes); flipping
// it to true is what re-runs this once the ref has an element to watch.
export function useResponsiveTables(
  containerRef: RefObject<HTMLElement | null>,
  primaryCellClass: string,
  active: boolean,
) {
  useEffect(() => {
    const container = containerRef.current;
    if (!active || !container) return;

    const phone = window.matchMedia(PHONE_QUERY);
    let frame = 0;

    function update() {
      frame = 0;
      for (const table of Array.from(container!.querySelectorAll("table"))) {
        // Back to plain table layout first: both the labels (innerText of a
        // heading hidden by card mode falls back to raw textContent, run
        // together with its controls) and the overflow check need it.
        table.removeAttribute("data-cards");
        labelTable(table, primaryCellClass);
        if (!phone.matches) continue;

        const parent = table.parentElement;
        if (parent && table.offsetWidth > parent.clientWidth + 1) {
          table.setAttribute("data-cards", "");
        }
      }
    }

    function schedule() {
      if (!frame) frame = requestAnimationFrame(update);
    }

    const observer = new MutationObserver(schedule);
    observer.observe(container, { childList: true, subtree: true, characterData: true });
    phone.addEventListener("change", schedule);
    window.addEventListener("resize", schedule);
    schedule();

    return () => {
      observer.disconnect();
      phone.removeEventListener("change", schedule);
      window.removeEventListener("resize", schedule);
      if (frame) cancelAnimationFrame(frame);
    };
  }, [containerRef, primaryCellClass, active]);
}
