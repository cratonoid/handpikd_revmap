"use client";

// ---------------------------------------------------------------------------
// <TrackPageClient> — /track/[id], the customer's view of their delivery
// ---------------------------------------------------------------------------
// Polls our own backend every 15 seconds (never Porter: the backend keeps the
// data fresh and only hands out what's safe, see lib/tracking.ts). If an
// update fails the last known status stays up, with how old it is.
import { useEffect, useState } from "react";
import { Logo } from "@/components/logo";
import { TrackMap } from "@/components/track/track-map";
import { fetchTracking, trackStatusLabel, type Tracking } from "@/lib/tracking";
import styles from "@/styles/track.module.css";

const POLL_MS = 15_000;
// Older than this, the page says updates are delayed.
const STALE_MS = 2 * 60_000;

type View = { kind: "loading" } | { kind: "expired" } | { kind: "tracking"; data: Tracking };

function timeOfDay(iso: string): string {
  return new Date(iso).toLocaleTimeString("en-IN", { timeZone: "Asia/Kolkata", hour: "numeric", minute: "2-digit" });
}

function etaText(seconds: number): string {
  const minutes = Math.max(1, Math.round(seconds / 60));
  if (minutes < 60) return `${minutes} min`;
  const hours = Math.floor(minutes / 60);
  return `${hours} h ${minutes % 60} min`;
}

export function TrackPageClient({ id }: { id: string }) {
  const [view, setView] = useState<View>({ kind: "loading" });
  const [now, setNow] = useState(() => Date.now());

  useEffect(() => {
    let cancelled = false;
    let timer: ReturnType<typeof setTimeout> | undefined;

    async function poll() {
      let finished = false;
      try {
        const data = await fetchTracking(id);
        if (cancelled) return;
        if (data === null) {
          setView({ kind: "expired" });
          return; // nothing more will come
        }
        setView({ kind: "tracking", data });
        finished = data.finished;
      } catch {
        // Keep showing what we had; the "last updated" line tells its age.
        if (!cancelled) setView((previous) => (previous.kind === "loading" ? { kind: "expired" } : previous));
      }
      if (!cancelled && !finished) timer = setTimeout(() => void poll(), POLL_MS);
    }

    void poll();
    const clock = setInterval(() => setNow(Date.now()), 30_000);
    return () => {
      cancelled = true;
      if (timer) clearTimeout(timer);
      clearInterval(clock);
    };
  }, [id]);

  return (
    <main className={styles.page}>
      <header className={styles.header}>
        <Logo compact />
      </header>

      {view.kind === "loading" && <p className={styles.muted}>Loading your delivery…</p>}

      {view.kind === "expired" && (
        <section className={styles.card}>
          <h1 className={styles.status}>This tracking link has expired.</h1>
          <p className={styles.muted}>If your delivery is still on its way, ask us for a new link.</p>
        </section>
      )}

      {view.kind === "tracking" && <TrackingView data={view.data} now={now} />}
    </main>
  );
}

function TrackingView({ data, now }: { data: Tracking; now: number }) {
  const stale = !data.finished && now - new Date(data.lastUpdated).getTime() > STALE_MS;
  const showEta = data.etaSeconds !== null && (data.status === "on_the_way" || data.status === "arrived");
  const vehicle = [data.vehicleType, data.vehicleNumber].filter(Boolean).join(" · ");

  return (
    <>
      <section className={styles.card} aria-live="polite">
        <p className={styles.eyebrow}>Your delivery</p>
        <h1 className={styles.status}>{trackStatusLabel(data.status)}</h1>
        {showEta && data.status === "on_the_way" && (
          <p className={styles.eta}>
            Arriving in about <strong>{etaText(data.etaSeconds!)}</strong>
          </p>
        )}
        {(data.driverFirstName || vehicle) && (
          <p className={styles.driver}>
            {data.driverFirstName && <span>Driver: {data.driverFirstName}</span>}
            {data.driverFirstName && vehicle && <span aria-hidden="true"> · </span>}
            {vehicle && <span>{vehicle}</span>}
          </p>
        )}
        {!data.finished && !data.driver && data.status !== "searching" && (
          <p className={styles.muted}>The driver&apos;s position appears here once they&apos;re on their way to you.</p>
        )}
      </section>

      {!data.finished && data.drop && <TrackMap driver={data.driver} drop={data.drop} />}

      {!data.finished && (
        <p className={stale ? styles.stale : styles.muted}>
          {stale ? "Live updates are delayed, showing the last known status. " : ""}
          Last updated {timeOfDay(data.lastUpdated)}
        </p>
      )}
      {!data.finished && data.driver && (
        <p className={styles.legend}>
          <span className={styles.legendDriver} aria-hidden="true" /> Driver
          <span className={styles.legendDrop} aria-hidden="true" /> Delivery point
        </p>
      )}
    </>
  );
}
