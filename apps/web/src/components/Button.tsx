import { cva, type VariantProps } from "class-variance-authority";
import type { ComponentProps, MouseEvent } from "react";
import { Slot } from "radix-ui";
import { cn } from "../lib/cn.ts";
import { Spinner } from "./Spinner.tsx";

// Pills. Primary: evergreen with a fine highlight. Secondary: an outline pill. Quiet: a tinted pill (Refresh).
// Disabled is flat; busy keeps its color, shows a spinner and ignores clicks, so a double click sends one request.
export const buttonVariants = cva(
  [
    "inline-flex items-center justify-center gap-2 rounded-full font-semibold whitespace-nowrap select-none touch-manipulation",
    "transition-[background-color,transform] duration-150 ease-out motion-safe:active:scale-[0.98]",
    "disabled:cursor-not-allowed disabled:bg-sunk disabled:text-ink-3 disabled:shadow-none disabled:active:scale-100",
    "aria-busy:cursor-progress [&_svg]:size-[18px] [&_svg]:shrink-0",
  ],
  {
    variants: {
      variant: {
        primary: "bg-primary text-on-primary shadow-glow hover:enabled:not-aria-busy:bg-primary-hover",
        secondary: "text-ink shadow-outline hover:enabled:not-aria-busy:bg-sunk",
        quiet: "bg-accent-tint text-accent-ink hover:enabled:not-aria-busy:bg-accent-tint-hover [&_svg]:size-4",
      },
      size: {
        md: "min-h-12 px-6 text-label",
        sm: "min-h-11 px-4 text-label",
      },
      block: { true: "w-full", false: "" },
    },
    defaultVariants: { variant: "primary", size: "md", block: false },
  },
);

export type ButtonProps = ComponentProps<"button"> &
  VariantProps<typeof buttonVariants> & {
    // While a request runs: a spinner, and `busyLabel` in place of the children ("Starting…").
    busy?: boolean;
    busyLabel?: string;
    asChild?: boolean;
  };

export function Button({ className, variant, size, block, busy = false, busyLabel, asChild = false, onClick, children, type, ...props }: ButtonProps) {
  const Comp = asChild ? Slot.Root : "button";
  const handleClick = (e: MouseEvent<HTMLButtonElement>) => {
    if (busy) {
      e.preventDefault();
      return;
    }
    onClick?.(e);
  };
  return (
    <Comp
      type={asChild ? undefined : (type ?? "button")}
      className={cn(buttonVariants({ variant, size, block }), className)}
      aria-busy={busy || undefined}
      aria-disabled={busy || undefined}
      onClick={handleClick}
      {...props}
    >
      {busy ? (
        <>
          <Spinner />
          {busyLabel ?? children}
        </>
      ) : (
        children
      )}
    </Comp>
  );
}
