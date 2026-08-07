"use client";

// ---------------------------------------------------------------------------
// <LoginForm> — calls POST /authentication/login_auth
// ---------------------------------------------------------------------------
// Needs "use client" because it uses React state, a submit handler, and
// next/navigation's router — all browser-only.
//
// login_auth (see backend/app/api/routes/authentication.py) returns a JWT
// alongside the success message. It's stored in sessionStorage (lib/auth.ts)
// and, from then on, apiFetch (lib/api.ts) attaches it to every API request
// so the backend can validate it on each call, not just at login.
import { useState, type FormEvent } from "react";
import { useRouter } from "next/navigation";
import { Button } from "@/components/button";
import { apiFetch } from "@/lib/api";
import { setAccessToken, setUserRole } from "@/lib/auth";
import styles from "@/styles/login.module.css";

type Status = "idle" | "loading";

export function LoginForm() {
  const router = useRouter();
  const [status, setStatus] = useState<Status>("idle");
  const [error, setError] = useState<string | null>(null);

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = event.currentTarget;

    if (!form.checkValidity()) {
      form.reportValidity();
      return;
    }

    const formData = new FormData(form);
    const email = formData.get("email");
    const password = formData.get("password");

    setStatus("loading");
    setError(null);

    try {
      const response = await apiFetch("/authentication/login_auth", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email, password }),
      });

      if (!response.ok) {
        // login_auth returns 403 for an unknown email and 401 for a password
        // mismatch (see backend/app/api/routes/authentication.py) — both are
        // shown as the same generic message rather than revealing which one.
        setError(
          response.status === 401 || response.status === 403
            ? "Invalid email or password."
            : "Something went wrong. Please try again.",
        );
        setStatus("idle");
        return;
      }

      // login_auth also returns `role` ("admin" or "customer" — see
      // backend/app/models/user.py's UserRole enum), which decides which
      // dashboard the user lands on.
      const data: { access_token: string; role: string } = await response.json();
      setAccessToken(data.access_token);
      setUserRole(data.role);
      router.push(data.role === "admin" ? "/admin" : "/customer");
    } catch {
      setError("Couldn't reach the server. Please try again.");
      setStatus("idle");
    }
  }

  return (
    <form noValidate={false} onSubmit={handleSubmit} className={styles.form}>
      <div>
        <label htmlFor="email" className={styles.formLabel}>
          Email
        </label>
        <input id="email" name="email" type="email" autoComplete="email" required className={styles.formInput} />
      </div>

      <div>
        <label htmlFor="password" className={styles.formLabel}>
          Password
        </label>
        <input
          id="password"
          name="password"
          type="password"
          autoComplete="current-password"
          required
          className={styles.formInput}
        />
      </div>

      {error && (
        <p role="alert" aria-live="polite" className={styles.formError}>
          {error}
        </p>
      )}

      <Button type="submit" variant="primary" className={styles.formSubmit} disabled={status === "loading"}>
        {status === "loading" ? "Signing in…" : "Sign in"}
      </Button>
    </form>
  );
}
