import { clsx, type ClassValue } from "clsx";
import { extendTailwindMerge } from "tailwind-merge";

// tailwind-merge has to know our type scale (globals.css): otherwise it reads `text-label` as a color and drops the
// real color class next to it.
const twMerge = extendTailwindMerge({
  extend: { theme: { text: ["label", "heading", "heading-lg", "code", "code-lg", "title", "title-lg"] } },
});

// Joins class names, letting a later Tailwind class win over an earlier one (`cn("px-4", "px-6")` is "px-6").
export function cn(...inputs: ClassValue[]): string {
  return twMerge(clsx(inputs));
}
