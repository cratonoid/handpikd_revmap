// Small uppercase section label with a subtle red accent dot — the one
// consistent place red appears across the site, repeated as a quiet motif.
export function Eyebrow({
  children,
  className = "",
  as: Tag = "span",
}: {
  children: React.ReactNode;
  className?: string;
  as?: "span" | "p";
}) {
  return (
    <Tag
      className={`inline-flex items-center gap-2 text-xs font-semibold tracking-[0.14em] text-charcoal uppercase ${className}`}
    >
      <span aria-hidden="true" className="h-1.5 w-1.5 shrink-0 rounded-full bg-red" />
      {children}
    </Tag>
  );
}
