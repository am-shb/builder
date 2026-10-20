import { CircleAlert } from "lucide-react";
import { useId, type ComponentProps, type ReactNode } from "react";
import { cn } from "../lib/cn.ts";

type TextFieldProps = Omit<ComponentProps<"input">, "id"> & {
  label: string;
  // Help under the label, linked to the input for screen readers.
  hint?: string;
  // Shown under the field and announced, linked to the input; also marks it invalid.
  error?: string;
  icon?: ReactNode;
};

export function TextField({ label, hint, error, icon, className, ...props }: TextFieldProps) {
  const id = useId();
  const hintId = hint ? `${id}-hint` : undefined;
  const errorId = error ? `${id}-error` : undefined;
  const describedBy = [hintId, errorId].filter(Boolean).join(" ") || undefined;
  return (
    <div className={cn("grid gap-2.5", className)}>
      <label htmlFor={id} className="text-label font-semibold">{label}</label>
      {hint && <p id={hintId} className="-mt-1.5 text-sm text-ink-2">{hint}</p>}
      <span className="relative flex">
        {icon && <span aria-hidden="true" className="pointer-events-none absolute top-1/2 left-4 -translate-y-1/2 text-ink-2 [&_svg]:size-[18px]">{icon}</span>}
        <input
          id={id}
          aria-describedby={describedBy}
          aria-invalid={error ? true : undefined}
          className={cn(
            "min-h-13 w-full rounded-field border-[1.5px] border-input bg-surface pr-4 text-base text-ink transition-[border-color,box-shadow] duration-150",
            "placeholder:text-ink-3 focus:border-primary focus:shadow-[inset_0_0_0_0.5px_var(--primary),0_0_0_4px_color-mix(in_srgb,var(--primary)_18%,transparent)] focus:outline-none",
            "disabled:cursor-not-allowed disabled:bg-sunk disabled:text-ink-2 read-only:bg-sunk",
            "aria-invalid:border-danger aria-invalid:bg-danger-bg",
            icon ? "pl-11" : "pl-4",
          )}
          {...props}
        />
      </span>
      {/* Always mounted, so an error that appears is announced wherever focus is (also one that arrives long after
          the button was pressed). Empty, it takes no room. */}
      <div role="alert" className="empty:-mt-2.5">
        {error && (
          <p id={errorId} className="m-0 flex items-center gap-1.5 text-sm font-medium text-danger">
            <CircleAlert aria-hidden="true" className="size-4 shrink-0" />
            {error}
          </p>
        )}
      </div>
    </div>
  );
}
