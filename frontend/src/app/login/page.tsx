// Route: "/login" (this file sits in an `app/login/` folder).
//
// Server Component shell (no "use client") rendering the shared Header/
// Footer, handing off the interactive form to <LoginForm> — a Client
// Component — same split as app/products/page.tsx.
import type { Metadata } from "next";
import { Header } from "@/components/header";
import { Footer } from "@/components/footer";
import { LoginForm } from "@/components/login-form";
import shared from "@/styles/shared.module.css";
import styles from "@/styles/login.module.css";

export const metadata: Metadata = {
  title: "Log In",
  description: "Log in to your Handpikd account.",
};

export default function LoginPage() {
  return (
    <>
      <Header />
      <main className={shared.pageMain}>
        <div className={styles.loginMain}>
          <div className={styles.loginCard}>
            <h1 className={styles.loginHeading}>Log in</h1>
            <p className={styles.loginSubtext}>Enter your email and password to access your account.</p>
            <LoginForm />
          </div>
        </div>
      </main>
      <Footer />
    </>
  );
}
