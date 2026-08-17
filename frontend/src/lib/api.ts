// ---------------------------------------------------------------------------
// Backend API base URL
// ---------------------------------------------------------------------------
// The FastAPI backend (see backend/README.md) runs at http://localhost:8000
// in development, mounted under its api_v1_prefix ("/api/v1" — see
// backend/app/core/config.py). NEXT_PUBLIC_API_BASE_URL lets a deployed
// frontend point at a different backend host without a code change; the
// "NEXT_PUBLIC_" prefix is what makes Next.js expose an env var to
// browser-side code instead of keeping it server-only.
export const API_BASE_URL = process.env.NEXT_PUBLIC_API_BASE_URL ?? "http://localhost:8000/api/v1";

// ---------------------------------------------------------------------------
// Product image URLs
// ---------------------------------------------------------------------------
// The backend stores/returns image_path as a path relative to itself (e.g.
// "/media/<uuid>.jpg", see backend/app/services/storage.py), not a full URL
// — unlike the old R2 setup, nothing here is publicly addressable on its
// own. In production this resolves correctly as-is because nginx proxies
// /media/ straight to the backend on the same origin as the frontend (see
// deploy/nginx.conf). Locally there's no nginx in front, so
// NEXT_PUBLIC_MEDIA_BASE_URL fills in the backend's own origin instead.
const MEDIA_BASE_URL = process.env.NEXT_PUBLIC_MEDIA_BASE_URL ?? "http://localhost:8000";

export function resolveMediaUrl(path: string): string {
  // An image held in this session but not yet saved is already a complete,
  // renderable source rather than a backend-relative path: product images
  // arrive as "data:" URIs (product-form-modal.tsx), and catalogue pages as
  // "blob:" object URLs pulled from a staged PDF (catalogue-form-modal.tsx).
  return path.startsWith("http") || path.startsWith("data:") || path.startsWith("blob:")
    ? path
    : `${MEDIA_BASE_URL}${path}`;
}

import { clearSession, getAccessToken } from "@/lib/auth";

// ---------------------------------------------------------------------------
// apiFetch — the one place every backend request should go through
// ---------------------------------------------------------------------------
// Attaches the stored JWT (see lib/auth.ts) as a Bearer token on every call,
// so each request is validated by the backend's get_current_user dependency
// (backend/app/api/deps.py) rather than only checking auth once at login.
// If a call that carried a stored token comes back 401 (expired/invalid
// token, or the user was deleted server-side), the whole session (token +
// role) is cleared and the browser is sent to /login. Clearing sessionStorage
// alone wouldn't be enough: DashboardShell (components/dashboard-shell.tsx)
// only re-reads the stored role on mount, so an already-open page would
// otherwise keep rendering as "authorized" while every further request
// 401s with no way for the user to tell why (this is what "Not
// authenticated" on an already-loaded page means — the session died
// mid-visit, not a bug in whatever request happened to surface it first).
//
// Gated on `token` being non-null so this doesn't fire for requests that
// were never authenticated to begin with — most notably login-form.tsx's
// own call to /authentication/login_auth, which legitimately 401s on a
// wrong password and needs to show that inline rather than get redirected
// away from the login page it's already on.
export async function apiFetch(path: string, options: RequestInit = {}): Promise<Response> {
  const token = getAccessToken();
  const headers = new Headers(options.headers);
  if (token) {
    headers.set("Authorization", `Bearer ${token}`);
  }

  const response = await fetch(`${API_BASE_URL}${path}`, { ...options, headers });

  if (response.status === 401 && token) {
    clearSession();
    if (typeof window !== "undefined") {
      window.location.assign("/login");
    }
  }

  return response;
}
