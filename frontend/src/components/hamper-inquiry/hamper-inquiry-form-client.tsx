"use client";

// ---------------------------------------------------------------------------
// <HamperInquiryFormClient> — the interactive progressive form at
// /hamper-inquiry-form
// ---------------------------------------------------------------------------
// Three steps: "details" (firm name / occasion / quantity / budget), then
// "selection" (the admin-configured category -> item -> option hierarchy,
// rendered as one expand-on-check tree via <InquiryTreeSelector> — checking
// a category reveals its items, checking an item reveals its brand options,
// and so on to whatever depth the admin has configured), then "review"
// (a summary + submit). A successful submit swaps the whole form out for a
// thank-you state, same pattern as home_page/contact-form.tsx.
//
// The hierarchy is fetched once on mount (not lazily on reaching step 2) so
// it's already loaded by the time the visitor gets there.
import { useEffect, useState, type FormEvent } from "react";
import { Button } from "@/components/button";
import { CheckIcon } from "@/components/icons";
import { InquiryTreeSelector } from "@/components/hamper-inquiry/inquiry-tree-selector";
import {
  collectDescendantIds,
  fetchPublicInquiryFormTree,
  submitHamperInquiry,
  type InquiryTreeNode,
} from "@/lib/inquiry-form";
import styles from "@/styles/hamper-inquiry.module.css";

type Step = "details" | "selection" | "review" | "success";

const STEPS: { key: Step; label: string }[] = [
  { key: "details", label: "Your details" },
  { key: "selection", label: "What you need" },
  { key: "review", label: "Review & submit" },
];

function ReviewSelections({
  nodes,
  selectedIds,
  depth = 0,
}: {
  nodes: InquiryTreeNode[];
  selectedIds: Set<number>;
  depth?: number;
}) {
  const checked = nodes.filter((node) => selectedIds.has(node.id));
  if (checked.length === 0) return null;

  return (
    <ul className={depth === 0 ? styles.reviewTree : styles.reviewTreeNested}>
      {checked.map((node) => (
        <li key={node.id} className={styles.reviewTreeItem}>
          {node.label}
          {node.note && <span className={styles.reviewTreeNote}> ({node.note})</span>}
          {node.children.length > 0 && (
            <ReviewSelections nodes={node.children} selectedIds={selectedIds} depth={depth + 1} />
          )}
        </li>
      ))}
    </ul>
  );
}

export function HamperInquiryFormClient() {
  const [step, setStep] = useState<Step>("details");

  const [firmName, setFirmName] = useState("");
  const [occasion, setOccasion] = useState("");
  const [itemQuantity, setItemQuantity] = useState("");
  const [budgetPerItem, setBudgetPerItem] = useState("");
  const [detailsError, setDetailsError] = useState<string | null>(null);

  const [tree, setTree] = useState<InquiryTreeNode[] | null>(null);
  const [treeLoading, setTreeLoading] = useState(true);
  const [treeError, setTreeError] = useState<string | null>(null);
  const [selectedIds, setSelectedIds] = useState<Set<number>>(new Set());
  const [selectionError, setSelectionError] = useState<string | null>(null);

  const [submitStatus, setSubmitStatus] = useState<"idle" | "submitting">("idle");
  const [submitError, setSubmitError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;

    fetchPublicInquiryFormTree()
      .then((result) => {
        if (!cancelled) setTree(result);
      })
      .catch(() => {
        if (!cancelled) setTreeError("Couldn't load the category options. Please refresh and try again.");
      })
      .finally(() => {
        if (!cancelled) setTreeLoading(false);
      });

    return () => {
      cancelled = true;
    };
  }, []);

  function handleDetailsSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = event.currentTarget;
    if (!form.checkValidity()) {
      form.reportValidity();
      setDetailsError("Please fill in the required fields before continuing.");
      return;
    }
    setDetailsError(null);
    setStep("selection");
  }

  function handleToggle(
    node: InquiryTreeNode,
    siblings: InquiryTreeNode[],
    selectionMode: "single" | "multi",
    maxSelections: number | null,
  ) {
    setSelectionError(null);
    setSelectedIds((prev) => {
      const next = new Set(prev);

      if (next.has(node.id)) {
        next.delete(node.id);
        for (const id of collectDescendantIds(node)) next.delete(id);
        return next;
      }

      if (selectionMode === "single") {
        for (const sibling of siblings) {
          if (sibling.id !== node.id && next.has(sibling.id)) {
            next.delete(sibling.id);
            for (const id of collectDescendantIds(sibling)) next.delete(id);
          }
        }
      } else if (maxSelections !== null) {
        const checkedCount = siblings.filter((sibling) => next.has(sibling.id)).length;
        if (checkedCount >= maxSelections) return prev;
      }

      next.add(node.id);
      return next;
    });
  }

  function handleSelectionContinue() {
    if (selectedIds.size === 0) {
      setSelectionError("Please select at least one category you're interested in.");
      return;
    }
    setSelectionError(null);
    setStep("review");
  }

  async function handleSubmit() {
    setSubmitStatus("submitting");
    setSubmitError(null);
    try {
      await submitHamperInquiry({
        firmName,
        occasion,
        itemQuantity: Number(itemQuantity),
        budgetPerItem: Number(budgetPerItem),
        selectedNodeIds: Array.from(selectedIds),
      });
      setStep("success");
    } catch (err) {
      setSubmitError(err instanceof Error ? err.message : "Something went wrong. Please try again.");
    } finally {
      setSubmitStatus("idle");
    }
  }

  if (step === "success") {
    return (
      <div className={styles.card}>
        <div className={styles.successWrap}>
          <span className={styles.successIcon}>
            <CheckIcon className="h-7 w-7" />
          </span>
          <h2 className={styles.successHeading}>Thanks — your inquiry is in.</h2>
          <p className={styles.successText}>
            A member of the Handpikd team will review your requirements and get back to you shortly with hamper
            options that fit.
          </p>
        </div>
      </div>
    );
  }

  return (
    <div>
      <div className={styles.stepperRow}>
        {STEPS.map((item, index) => {
          const currentIndex = STEPS.findIndex((s) => s.key === step);
          const done = index < currentIndex;
          const active = item.key === step;
          return (
            <div key={item.key} className={styles.stepperItem}>
              <span
                className={`${styles.stepperDot} ${active ? styles.stepperDotActive : ""} ${
                  done ? styles.stepperDotDone : ""
                }`}
              >
                {done ? <CheckIcon className="h-3.5 w-3.5" strokeWidth={2.5} /> : index + 1}
              </span>
              <span className={`${styles.stepperLabel} ${active ? styles.stepperLabelActive : ""}`}>
                {item.label}
              </span>
              {index < STEPS.length - 1 && <span className={styles.stepperConnector} />}
            </div>
          );
        })}
      </div>

      {step === "details" && (
        <form noValidate={false} onSubmit={handleDetailsSubmit} className={styles.card}>
          <h2 className={styles.cardHeading}>Tell us about your gifting need</h2>
          <p className={styles.cardSubtext}>A few quick details before you pick what you&apos;re looking for.</p>

          <div className={styles.formGrid}>
            <div>
              <label htmlFor="firmName" className={styles.formLabel}>
                Firm name
              </label>
              <input
                id="firmName"
                name="firmName"
                type="text"
                required
                value={firmName}
                onChange={(e) => setFirmName(e.target.value)}
                className={styles.formInput}
              />
            </div>
            <div>
              <label htmlFor="occasion" className={styles.formLabel}>
                Occasion
              </label>
              <input
                id="occasion"
                name="occasion"
                type="text"
                required
                placeholder="e.g. Diwali, onboarding kit, annual day"
                value={occasion}
                onChange={(e) => setOccasion(e.target.value)}
                className={styles.formInput}
              />
            </div>
            <div>
              <label htmlFor="itemQuantity" className={styles.formLabel}>
                Item quantity
              </label>
              <input
                id="itemQuantity"
                name="itemQuantity"
                type="number"
                min={1}
                step={1}
                required
                value={itemQuantity}
                onChange={(e) => setItemQuantity(e.target.value)}
                className={styles.formInput}
              />
            </div>
            <div>
              <label htmlFor="budgetPerItem" className={styles.formLabel}>
                Budget per item (without GST)
              </label>
              <input
                id="budgetPerItem"
                name="budgetPerItem"
                type="number"
                min={1}
                step="0.01"
                required
                value={budgetPerItem}
                onChange={(e) => setBudgetPerItem(e.target.value)}
                className={styles.formInput}
              />
            </div>
          </div>

          {detailsError && (
            <p role="alert" aria-live="polite" className={styles.formError}>
              {detailsError}
            </p>
          )}

          <div className={styles.stepActions}>
            <div className={styles.stepActionsRight}>
              <Button type="submit" variant="primary" showArrow>
                Continue
              </Button>
            </div>
          </div>
        </form>
      )}

      {step === "selection" && (
        <div className={styles.card}>
          <h2 className={styles.cardHeading}>What are you looking for?</h2>
          <p className={styles.cardSubtext}>
            Pick the categories you&apos;re interested in — more options will appear as you go.
          </p>

          {treeLoading ? (
            <p className={styles.loadingText}>Loading options…</p>
          ) : treeError ? (
            <p role="alert" className={styles.formError}>
              {treeError}
            </p>
          ) : tree && tree.length > 0 ? (
            <InquiryTreeSelector
              nodes={tree}
              selectionMode="multi"
              maxSelections={null}
              heading="Select the categories you're interested in:"
              selectedIds={selectedIds}
              onToggle={handleToggle}
            />
          ) : (
            <p className={styles.emptyText}>No categories are available right now. Please check back shortly.</p>
          )}

          {selectionError && (
            <p role="alert" aria-live="polite" className={styles.formError}>
              {selectionError}
            </p>
          )}

          <div className={styles.stepActions}>
            <Button type="button" variant="tertiary" onClick={() => setStep("details")}>
              Back
            </Button>
            <div className={styles.stepActionsRight}>
              <Button type="button" variant="primary" showArrow onClick={handleSelectionContinue}>
                Continue
              </Button>
            </div>
          </div>
        </div>
      )}

      {step === "review" && (
        <div className={styles.card}>
          <h2 className={styles.cardHeading}>Review your inquiry</h2>
          <p className={styles.cardSubtext}>Double-check everything below before you submit.</p>

          <div className={styles.reviewList}>
            <div className={styles.reviewRow}>
              <span className={styles.reviewLabel}>Firm name</span>
              <span className={styles.reviewValue}>{firmName}</span>
            </div>
            <div className={styles.reviewRow}>
              <span className={styles.reviewLabel}>Occasion</span>
              <span className={styles.reviewValue}>{occasion}</span>
            </div>
            <div className={styles.reviewRow}>
              <span className={styles.reviewLabel}>Item quantity</span>
              <span className={styles.reviewValue}>{itemQuantity}</span>
            </div>
            <div className={styles.reviewRow}>
              <span className={styles.reviewLabel}>Budget per item (without GST)</span>
              <span className={styles.reviewValue}>₹{budgetPerItem}</span>
            </div>
          </div>

          <p className={styles.reviewSelectionsHeading}>What you&apos;re interested in</p>
          {tree ? (
            <ReviewSelections nodes={tree} selectedIds={selectedIds} />
          ) : (
            <p className={styles.reviewEmpty}>Nothing selected.</p>
          )}

          {submitError && (
            <p role="alert" aria-live="polite" className={styles.formError}>
              {submitError}
            </p>
          )}

          <div className={styles.stepActions}>
            <Button type="button" variant="tertiary" onClick={() => setStep("selection")} disabled={submitStatus === "submitting"}>
              Back
            </Button>
            <div className={styles.stepActionsRight}>
              <Button type="button" variant="primary" onClick={handleSubmit} disabled={submitStatus === "submitting"}>
                {submitStatus === "submitting" ? "Submitting…" : "Submit inquiry"}
              </Button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
