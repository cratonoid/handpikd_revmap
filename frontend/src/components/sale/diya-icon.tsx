// ---------------------------------------------------------------------------
// <DiyaIcon> — small oil-lamp glyph used as the festive motif
// ---------------------------------------------------------------------------
// Purely decorative everywhere it's used, so it's always aria-hidden. Colors
// are fixed (flame gold/orange, clay lamp) rather than `currentColor` so the
// lamp reads the same on the dark strip and the light bands.
export function DiyaIcon({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 32 32" aria-hidden="true" focusable="false" className={className}>
      {/* flame */}
      <path d="M16 3c2.6 3.4 4 6 4 8.2A4 4 0 0 1 16 15a4 4 0 0 1-4-3.8C12 9 13.4 6.4 16 3Z" fill="#f2a516" />
      <path d="M16 7.5c1.2 1.7 1.8 2.9 1.8 3.9a1.8 1.8 0 0 1-3.6 0c0-1 .6-2.2 1.8-3.9Z" fill="#fde68a" />
      {/* lamp bowl */}
      <path d="M3 17h26c-1 6-6.4 10-13 10S4 23 3 17Z" fill="#b5532a" />
      <path d="M6.5 20.5h19" stroke="#e8b931" strokeWidth="1.4" strokeLinecap="round" />
      <ellipse cx="16" cy="17" rx="13" ry="1.6" fill="#8c3a1c" />
    </svg>
  );
}
