// ---------------------------------------------------------------------------
// Access token storage
// ---------------------------------------------------------------------------
// Holds the JWT returned by POST /authentication/login_auth (see
// backend/app/api/routes/authentication.py) in sessionStorage — cleared
// automatically when the tab closes, unlike localStorage. apiFetch (see
// lib/api.ts) reads this on every request to attach the Authorization header.
const ACCESS_TOKEN_KEY = "handpikd_access_token";

export function setAccessToken(token: string) {
  window.sessionStorage.setItem(ACCESS_TOKEN_KEY, token);
}

export function getAccessToken(): string | null {
  return window.sessionStorage.getItem(ACCESS_TOKEN_KEY);
}

export function clearAccessToken() {
  window.sessionStorage.removeItem(ACCESS_TOKEN_KEY);
}

// ---------------------------------------------------------------------------
// User role storage
// ---------------------------------------------------------------------------
// Holds the `role` returned alongside the JWT by POST /authentication/login_auth
// (see backend/app/api/routes/authentication.py, backed by UserRole in
// backend/app/models/user.py — "admin" or "customer"). Stored in
// sessionStorage, same as the access token, so it disappears when the tab
// closes rather than persisting in localStorage or a cookie. The dashboard
// shells (components/dashboard-shell.tsx) read this to decide whether the
// signed-in user is allowed on /admin or /customer.
const USER_ROLE_KEY = "handpikd_user_role";

export type UserRole = "admin" | "customer";

export function setUserRole(role: string) {
  window.sessionStorage.setItem(USER_ROLE_KEY, role);
}

export function getUserRole(): UserRole | null {
  const value = window.sessionStorage.getItem(USER_ROLE_KEY);
  return value === "admin" || value === "customer" ? value : null;
}

export function clearUserRole() {
  window.sessionStorage.removeItem(USER_ROLE_KEY);
}

export function clearSession() {
  clearAccessToken();
  clearUserRole();
}
