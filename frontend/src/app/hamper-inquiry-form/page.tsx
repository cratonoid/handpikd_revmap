// Route: "/hamper-inquiry-form" (this file sits in an `app/hamper-inquiry-form/`
// folder).
//
// A Server Component wrapper. The actual multi-step form (needs client state
// for the current step, fetched hierarchy, and selections) lives in the
// separate Client Component <HamperInquiryFormClient>.
import type { Metadata } from "next";
import { Header } from "@/components/header";
import { Footer } from "@/components/footer";
import { HamperInquiryFormClient } from "@/components/hamper-inquiry/hamper-inquiry-form-client";
import styles from "@/styles/hamper-inquiry.module.css";
import sharedStyles from "@/styles/shared.module.css";

export const metadata: Metadata = {
  title: "Hamper Inquiry Form",
  description:
    "Tell us about your firm, occasion, quantity, and budget, then pick the categories you're interested in — Handpikd will put together hamper options that fit.",
};

export default function HamperInquiryFormPage() {
  return (
    <>
      <Header />
      <main className={sharedStyles.pageMain}>
        <div className={styles.pageInner}>
          <HamperInquiryFormClient />
        </div>
      </main>
      <Footer />
    </>
  );
}
