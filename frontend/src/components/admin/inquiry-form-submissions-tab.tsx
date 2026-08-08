"use client";

// ---------------------------------------------------------------------------
// <InquiryFormSubmissionsTab> — the "Submissions" half of /admin/inquiry-form
// ---------------------------------------------------------------------------
// A flat table of every visitor submission, with the same click-to-expand
// inline preview as categories-page-client.tsx uses for a category's
// children — clicking a row reveals that submission's selected hierarchy
// underneath it via <SelectionNodeList>, built from the submission's own
// snapshotted `selections` (see lib/inquiry-form.ts's
// buildSubmissionSelectionTree) rather than the live, possibly-since-edited
// hierarchy, so a submission always renders exactly what the visitor picked.
import { Fragment, useEffect, useState } from "react";
import { ChevronRightIcon } from "@/components/icons";
import {
  buildSubmissionSelectionTree,
  fetchInquirySubmissions,
  type InquirySubmission,
  type SubmissionSelectionNode,
} from "@/lib/inquiry-form";
import styles from "@/styles/dashboard.module.css";

function SelectionNodeList({ nodes, depth = 0 }: { nodes: SubmissionSelectionNode[]; depth?: number }) {
  return (
    <ul className={depth === 0 ? styles.treeRoot : styles.treeChildren}>
      {nodes.map((node) => (
        <li key={node.nodeId} className={styles.treeNode}>
          <div className={styles.treeNodeRow}>
            <div className={styles.treeNodeMain}>
              <span className={depth === 0 ? styles.treeNodeNameRoot : styles.treeNodeName}>
                {node.label}
                {node.note && <span className={styles.treeNodeNote}>({node.note})</span>}
              </span>
            </div>
          </div>
          {node.children.length > 0 && <SelectionNodeList nodes={node.children} depth={depth + 1} />}
        </li>
      ))}
    </ul>
  );
}

export function InquiryFormSubmissionsTab() {
  const [submissions, setSubmissions] = useState<InquirySubmission[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [expandedIds, setExpandedIds] = useState<Set<number>>(new Set());

  useEffect(() => {
    let cancelled = false;

    fetchInquirySubmissions()
      .then((result) => {
        if (!cancelled) setSubmissions(result);
      })
      .catch(() => {
        if (!cancelled) setLoadError("Failed to load submissions.");
      })
      .finally(() => {
        if (!cancelled) setIsLoading(false);
      });

    return () => {
      cancelled = true;
    };
  }, []);

  function toggleExpanded(id: number) {
    setExpandedIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) {
        next.delete(id);
      } else {
        next.add(id);
      }
      return next;
    });
  }

  return (
    <div className={styles.tableWrap}>
      {isLoading ? (
        <p className={styles.pageSubtext}>Loading submissions…</p>
      ) : loadError ? (
        <p role="alert" className={styles.formError}>
          {loadError}
        </p>
      ) : (
        <table className={styles.table}>
          <thead>
            <tr>
              <th className={`${styles.tableHeadCell} ${styles.tableHeadCellSerial}`}>S.No</th>
              <th className={styles.tableHeadCell}>Firm name</th>
              <th className={styles.tableHeadCell}>Occasion</th>
              <th className={styles.tableHeadCell}>Item qty</th>
              <th className={styles.tableHeadCell}>Budget/item</th>
              <th className={styles.tableHeadCell}>Submitted</th>
              <th className={styles.tableHeadCell}>Selections</th>
            </tr>
          </thead>
          <tbody>
            {submissions.map((submission, index) => {
              const isExpanded = expandedIds.has(submission.id);
              const selectionTree = buildSubmissionSelectionTree(submission.selections);

              return (
                <Fragment key={submission.id}>
                  <tr
                    onClick={() => toggleExpanded(submission.id)}
                    className={styles.tableRow}
                    aria-expanded={isExpanded}
                    title="Click to view selections"
                  >
                    <td className={`${styles.tableCell} ${styles.tableCellSerial}`}>{index + 1}</td>
                    <td className={`${styles.tableCell} ${styles.tableCellPrimary}`}>{submission.firmName}</td>
                    <td className={styles.tableCell}>{submission.occasion}</td>
                    <td className={styles.tableCell}>{submission.itemQuantity}</td>
                    <td className={styles.tableCell}>₹{submission.budgetPerItem}</td>
                    <td className={styles.tableCell}>
                      {new Date(submission.createdAt).toLocaleString("en-IN", { timeZone: "Asia/Kolkata" })}
                    </td>
                    <td className={styles.tableCell}>
                      <span className={styles.tableCategoryName}>
                        <ChevronRightIcon
                          className={`h-3.5 w-3.5 ${styles.tableChevron} ${isExpanded ? styles.tableChevronOpen : ""}`}
                        />
                        {submission.selections.length} selected
                      </span>
                    </td>
                  </tr>

                  {isExpanded && (
                    <tr>
                      <td className={`${styles.tableCell} ${styles.tableCellSerial} ${styles.tableDropdownCell}`} />
                      <td colSpan={6} className={styles.tableDropdownCell}>
                        {selectionTree.length > 0 ? (
                          <SelectionNodeList nodes={selectionTree} />
                        ) : (
                          <p className={styles.pageSubtext}>No categories were selected.</p>
                        )}
                      </td>
                    </tr>
                  )}
                </Fragment>
              );
            })}
          </tbody>
        </table>
      )}
      {!isLoading && !loadError && submissions.length === 0 && (
        <p className={styles.pageSubtext}>No submissions yet.</p>
      )}
    </div>
  );
}
