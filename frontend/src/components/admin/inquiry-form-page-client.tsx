"use client";

// ---------------------------------------------------------------------------
// <InquiryFormPageClient> — the interactive half of /admin/inquiry-form
// ---------------------------------------------------------------------------
// Mirrors inventory-page-client.tsx's two-tab split: "Submissions" (view
// what visitors have submitted on the public /hamper-inquiry-form page) and
// "Form builder" (edit the category -> item -> option hierarchy that page
// presents). Submissions is the default/first tab since "what came in" is
// the more common thing to check than "edit the form structure".
import { useState } from "react";
import { InquiryFormEditorTab } from "@/components/admin/inquiry-form-editor-tab";
import { InquiryFormSubmissionsTab } from "@/components/admin/inquiry-form-submissions-tab";
import styles from "@/styles/dashboard.module.css";

type Tab = "submissions" | "builder";

export function InquiryFormPageClient() {
  const [tab, setTab] = useState<Tab>("submissions");

  return (
    <>
      <h1 className={styles.pageHeading}>Hamper Inquiry Form</h1>
      <p className={styles.pageSubtext}>
        Review visitor submissions from /hamper-inquiry-form, or edit the category hierarchy the form presents.
      </p>

      <div className={styles.viewToggle} role="tablist" aria-label="Hamper inquiry form section">
        <button
          type="button"
          role="tab"
          aria-selected={tab === "submissions"}
          onClick={() => setTab("submissions")}
          className={`${styles.viewToggleButton} ${tab === "submissions" ? styles.viewToggleButtonActive : ""}`}
        >
          Submissions
        </button>
        <button
          type="button"
          role="tab"
          aria-selected={tab === "builder"}
          onClick={() => setTab("builder")}
          className={`${styles.viewToggleButton} ${tab === "builder" ? styles.viewToggleButtonActive : ""}`}
        >
          Form builder
        </button>
      </div>

      {tab === "submissions" ? <InquiryFormSubmissionsTab /> : <InquiryFormEditorTab />}
    </>
  );
}
