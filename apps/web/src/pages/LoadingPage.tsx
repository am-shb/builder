import { Spinner } from "../components/Spinner.tsx";

// While Clerk loads. It fades in after 150 ms, so a fast load shows nothing at all.
export function LoadingPage() {
  return (
    <div role="status" aria-label="Loading" className="grid min-h-dvh place-items-center text-ink-2 motion-safe:animate-in motion-safe:fade-in motion-safe:delay-150 motion-safe:fill-mode-both">
      <Spinner className="size-6" />
      <span className="sr-only">Loading…</span>
    </div>
  );
}
