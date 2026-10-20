import { Check } from "lucide-react";
import { Toaster as Sonner } from "sonner";
import { DESKTOP, useMediaQuery } from "../hooks/useMediaQuery.ts";

export { toast } from "sonner";

// Toasts are for short, non-critical confirmations only ("Link copied"). Errors and the unknown-outcome warning are
// persistent callouts. On phones they sit above the sticky action bar.
export function Toaster() {
  const desktop = useMediaQuery(DESKTOP);
  return (
    <Sonner
      position={desktop ? "bottom-right" : "bottom-center"}
      offset={desktop ? 24 : { bottom: 104 }}
      mobileOffset={{ bottom: 104, left: 20, right: 20 }}
      icons={{ success: <Check aria-hidden="true" className="size-[18px] text-live" /> }}
      toastOptions={{
        unstyled: true,
        classNames: {
          toast: "flex w-full items-start gap-2.5 rounded-[20px] bg-toast-bg px-4 py-3 text-toast-ink font-medium shadow-elevated md:w-[360px]",
          icon: "mt-[3px]",
          title: "leading-snug",
        },
      }}
    />
  );
}
