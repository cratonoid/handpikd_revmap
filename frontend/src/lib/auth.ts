// ---------------------------------------------------------------------------
// Where the session lives
// ---------------------------------------------------------------------------
// In a browser tab, sessionStorage: cleared when the tab closes, unlike
// localStorage. In the installed home-screen app (see public/admin.webmanifest)
// that same behaviour would log you out constantly, because phones kill
// backgrounded apps all the time and each relaunch starts a fresh session —
// so there it's localStorage instead, and the session lasts until the JWT
// itself expires (settings.jwt_expire_minutes in backend/app/core/config.py)
// or you log out. The installed app is detected by its display mode, which
// iOS reports through the non-standard navigator.standalone instead.
function isInstalledApp(): boolean {
  return (
    window.matchMedia("(display-mode: standalone)").matches ||
    (navigator as Navigator & { standalone?: boolean }).standalone === true
  );
}

function sessionStore(): Storage {
  return isInstalledApp() ? window.localStorage : window.sessionStorage;
}

// ---------------------------------------------------------------------------
// Access token storage
// ---------------------------------------------------------------------------
// Holds the JWT returned by POST /authentication/login_auth (see
// backend/app/api/routes/authentication.py) in sessionStore() above. apiFetch
// (see lib/api.ts) reads this on every request to attach the Authorization
// header.
const ACCESS_TOKEN_KEY = "handpikd_access_token";

export function setAccessToken(token: string) {
  sessionStore().setItem(ACCESS_TOKEN_KEY, token);
}

export function getAccessToken(): string | null {
  return sessionStore().getItem(ACCESS_TOKEN_KEY);
}

// Clears both stores rather than just sessionStore(): on Android the installed
// app shares storage with Chrome, so logging out in either should leave no
// token behind in the other.
export function clearAccessToken() {
  window.sessionStorage.removeItem(ACCESS_TOKEN_KEY);
  window.localStorage.removeItem(ACCESS_TOKEN_KEY);
}

// ---------------------------------------------------------------------------
// User role storage
// ---------------------------------------------------------------------------
// Holds the `role` returned alongside the JWT by POST /authentication/login_auth
// (see backend/app/api/routes/authentication.py, backed by UserRole in
// backend/app/models/user.py — "admin" or "customer"). Stored alongside the
// access token in sessionStore(), so the two always live and die together.
// The dashboard shells (components/dashboard-shell.tsx) read this to decide
// whether the signed-in user is allowed on /admin or /customer.
const USER_ROLE_KEY = "handpikd_user_role";

export type UserRole = "admin" | "customer";

export function setUserRole(role: string) {
  sessionStore().setItem(USER_ROLE_KEY, role);
}

export function getUserRole(): UserRole | null {
  const value = sessionStore().getItem(USER_ROLE_KEY);
  return value === "admin" || value === "customer" ? value : null;
}

export function clearUserRole() {
  window.sessionStorage.removeItem(USER_ROLE_KEY);
  window.localStorage.removeItem(USER_ROLE_KEY);
}

export function clearSession() {
  clearAccessToken();
  clearUserRole();
}
