import Link from "next/link";
import type { ComponentPropsWithoutRef } from "react";
import { ArrowRightIcon } from "@/components/icons";

const variants = {
  primary:
    "bg-button-primary text-cream hover:bg-button-primary-hover focus-visible:outline-button-primary",
  secondary:
    "bg-button-secondary text-charcoal hover:bg-button-secondary-hover focus-visible:outline-button-secondary",
  tertiary:
    "bg-button-tertiary text-charcoal hover:bg-button-tertiary-hover focus-visible:outline-button-tertiary",
} as const;

type Variant = keyof typeof variants;

const shared =
  "group inline-flex min-h-11 items-center justify-center gap-2 rounded-full px-6 py-3 text-sm font-semibold tracking-wide transition-colors duration-200 focus-visible:outline-2 focus-visible:outline-offset-2 active:scale-[0.98]";

export function Button({
  variant = "primary",
  href,
  showArrow = false,
  className = "",
  children,
  onClick,
  ...props
}: {
  variant?: Variant;
  href?: string;
  showArrow?: boolean;
  className?: string;
  children: React.ReactNode;
} & Omit<ComponentPropsWithoutRef<"button">, "className" | "children">) {
  const classes = `${shared} ${variants[variant]} ${className}`;

  const content = (
    <>
      {children}
      {showArrow && (
        <ArrowRightIcon className="h-4 w-4 transition-transform duration-200 group-hover:translate-x-0.5" />
      )}
    </>
  );

  if (href) {
    return (
      <Link
        href={href}
        className={classes}
        onClick={onClick as unknown as React.MouseEventHandler<HTMLAnchorElement>}
      >
        {content}
      </Link>
    );
  }

  return (
    <button className={classes} onClick={onClick} {...props}>
      {content}
    </button>
  );
}
