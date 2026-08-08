// Route: "/hamper-inquiry-form" (this file sits in an `app/hamper-inquiry-form/`
// folder).
//
// A Server Component: the banner is static text, so it's rendered here
// directly. The actual multi-step form (needs client state for the current
// step, fetched hierarchy, and selections) lives in the separate Client
// Component <HamperInquiryFormClient>.
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
        <section className={styles.banner}>
          <div className={styles.bannerInner}>
            <h1 className={styles.bannerHeading}>Hamper Inquiry Form</h1>
            <p className={styles.bannerParagraph}>
              Tell us a bit about what you need and we&apos;ll put together hamper options that fit your occasion
              and budget.
            </p>
          </div>
        </section>

        <div className={styles.pageInner}>
          <HamperInquiryFormClient />
        </div>
      </main>
      <Footer />
    </>
  );
}
