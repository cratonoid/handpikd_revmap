"use client";

// ---------------------------------------------------------------------------
// <TrackMap> — the customer tracking page's map: the driver and the drop
// point, nothing else (no pickup marker, no route line that would reveal
// where the delivery started). Leaflet with OpenStreetMap tiles, loaded on
// the client only since Leaflet needs `window`.
// ---------------------------------------------------------------------------
import { useEffect, useRef } from "react";
import type { Map as LeafletMap, Marker } from "leaflet";
import "leaflet/dist/leaflet.css";
import type { TrackPoint } from "@/lib/tracking";
import styles from "@/styles/track.module.css";

type Props = { driver: TrackPoint | null; drop: TrackPoint | null };

export function TrackMap({ driver, drop }: Props) {
  const containerRef = useRef<HTMLDivElement>(null);
  const mapRef = useRef<LeafletMap | null>(null);
  const markersRef = useRef<{ driver?: Marker; drop?: Marker }>({});
  const fittedRef = useRef(false);
  const leafletRef = useRef<typeof import("leaflet") | null>(null);

  useEffect(() => {
    let cancelled = false;
    void import("leaflet").then((L) => {
      if (cancelled || !containerRef.current || mapRef.current) return;
      leafletRef.current = L;
      const map = L.map(containerRef.current, { zoomControl: true, attributionControl: true });
      L.tileLayer("https://tile.openstreetmap.org/{z}/{x}/{y}.png", {
        maxZoom: 19,
        attribution: '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a>',
      }).addTo(map);
      map.setView([20.59, 78.96], 4); // India, until the first position arrives
      mapRef.current = map;
      // Ask the effect below to place the markers now the map exists.
      containerRef.current.dispatchEvent(new Event("trackmapready"));
    });
    return () => {
      cancelled = true;
      mapRef.current?.remove();
      mapRef.current = null;
      markersRef.current = {};
      fittedRef.current = false;
    };
  }, []);

  useEffect(() => {
    const container = containerRef.current;
    function place() {
      const L = leafletRef.current;
      const map = mapRef.current;
      if (!L || !map) return;
      const icon = (className: string, label: string) =>
        L.divIcon({ className: "", html: `<div class="${className}" aria-label="${label}"></div>`, iconSize: [22, 22], iconAnchor: [11, 11] });

      for (const [key, point, className, label] of [
        ["driver", driver, styles.driverMarker, "Driver"],
        ["drop", drop, styles.dropMarker, "Delivery point"],
      ] as const) {
        const existing = markersRef.current[key];
        if (point) {
          if (existing) existing.setLatLng([point.lat, point.lng]);
          else markersRef.current[key] = L.marker([point.lat, point.lng], { icon: icon(className, label), title: label }).addTo(map);
        } else if (existing) {
          existing.remove();
          delete markersRef.current[key];
        }
      }

      const points = [driver, drop].filter((p): p is TrackPoint => p !== null);
      // Frame both once a driver appears, then leave the zoom to the customer.
      if (points.length && (!fittedRef.current || (driver && points.length === 2 && !map.getBounds().contains([driver.lat, driver.lng])))) {
        if (points.length === 1) map.setView([points[0].lat, points[0].lng], 14);
        else map.fitBounds(L.latLngBounds(points.map((p) => [p.lat, p.lng] as [number, number])), { padding: [40, 40] });
        fittedRef.current = points.length === 2;
      }
    }
    place();
    container?.addEventListener("trackmapready", place);
    return () => container?.removeEventListener("trackmapready", place);
  }, [driver, drop]);

  return <div ref={containerRef} className={styles.map} role="img" aria-label="Map showing the driver and the delivery point" />;
}
