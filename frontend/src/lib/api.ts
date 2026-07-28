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

import { clearAccessToken, getAccessToken } from "@/lib/auth";

// ---------------------------------------------------------------------------
// apiFetch — the one place every backend request should go through
// ---------------------------------------------------------------------------
// Attaches the stored JWT (see lib/auth.ts) as a Bearer token on every call,
// so each request is validated by the backend's get_current_user dependency
// (backend/app/api/deps.py) rather than only checking auth once at login.
// If the backend ever responds 401 (missing/expired/invalid token), the
// stale token is cleared so the app doesn't keep resending it.
export async function apiFetch(path: string, options: RequestInit = {}): Promise<Response> {
  const token = getAccessToken();
  const headers = new Headers(options.headers);
  if (token) {
    headers.set("Authorization", `Bearer ${token}`);
  }

  const response = await fetch(`${API_BASE_URL}${path}`, { ...options, headers });

  if (response.status === 401) {
    clearAccessToken();
  }

  return response;
}
