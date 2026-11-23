// Phone alerts: Web Push to the installed admin app. The service worker
// (public/sw.js, registered by components/pwa-register.tsx) shows each
// push; the backend (app/services/push.py) sends one for every notification
// addressed to a person, and the Work board's task reminders.
import { apiFetch } from "@/lib/api";

export type PushState =
  | "unsupported" // this browser can't receive pushes at all
  | "install-first" // iPhone/iPad Safari: only works from the Home Screen app
  | "blocked" // the person said no; only the phone's settings can undo it
  | "off"
  | "on";

function isIos(): boolean {
  return /iPad|iPhone|iPod/.test(navigator.userAgent) || (navigator.platform === "MacIntel" && navigator.maxTouchPoints > 1);
}

function isStandalone(): boolean {
  return (
    window.matchMedia("(display-mode: standalone)").matches ||
    (navigator as Navigator & { standalone?: boolean }).standalone === true
  );
}

function supported(): boolean {
  return "serviceWorker" in navigator && "PushManager" in window && "Notification" in window;
}

async function currentSubscription(): Promise<PushSubscription | null> {
  const registration = await navigator.serviceWorker.getRegistration("/admin");
  return registration ? registration.pushManager.getSubscription() : null;
}

async function saveSubscription(subscription: PushSubscription): Promise<void> {
  const response = await apiFetch("/admin/notifications/push_subscribe", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(subscription.toJSON()),
  });
  if (!response.ok) throw new Error("Couldn't turn on phone alerts. Please try again.");
}

export async function getPushState(): Promise<PushState> {
  if (!supported()) return isIos() && !isStandalone() ? "install-first" : "unsupported";
  if (Notification.permission === "denied") return "blocked";
  const subscription = await currentSubscription();
  if (!subscription || Notification.permission !== "granted") return "off";
  // Re-saved on every visit so the phone stays tied to whoever is signed in.
  await saveSubscription(subscription).catch(() => undefined);
  return "on";
}

function keyBytes(base64url: string): Uint8Array<ArrayBuffer> {
  const base64 = (base64url + "=".repeat((4 - (base64url.length % 4)) % 4)).replace(/-/g, "+").replace(/_/g, "/");
  const raw = atob(base64);
  const bytes = new Uint8Array(new ArrayBuffer(raw.length));
  for (let i = 0; i < raw.length; i += 1) bytes[i] = raw.charCodeAt(i);
  return bytes;
}

export async function enablePush(): Promise<PushState> {
  const permission = await Notification.requestPermission();
  if (permission === "denied") return "blocked";
  if (permission !== "granted") return "off";

  const response = await apiFetch("/admin/notifications/push_public_key");
  if (!response.ok) throw new Error("Couldn't turn on phone alerts. Please try again.");
  const { public_key: publicKey }: { public_key: string } = await response.json();

  const registration =
    (await navigator.serviceWorker.getRegistration("/admin")) ??
    (await navigator.serviceWorker.register("/sw.js", { scope: "/admin", updateViaCache: "none" }));
  await navigator.serviceWorker.ready;
  const subscription =
    (await registration.pushManager.getSubscription()) ??
    (await registration.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: keyBytes(publicKey) }));
  await saveSubscription(subscription);
  return "on";
}

export async function disablePush(): Promise<PushState> {
  const subscription = await currentSubscription();
  if (subscription) {
    await apiFetch("/admin/notifications/push_unsubscribe", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ endpoint: subscription.endpoint }),
    }).catch(() => undefined);
    await subscription.unsubscribe();
  }
  return "off";
}
