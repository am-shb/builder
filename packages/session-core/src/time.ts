// When a session started, in the viewer's local time, relative to now: "just now", "12 min ago" (even across
// midnight), "3 h ago" earlier today, "yesterday at 4:12 PM", then a date ("Oct 14 at 10:03 AM"). A weekday alone isn't
// used: "Wednesday at 10:03 AM" can read as upcoming. A time in the future (a skewed clock) reads as "just now".
export function startedWhen(iso: string, now: Date = new Date(), locale?: string): string {
  const then = new Date(iso);
  if (Number.isNaN(then.getTime())) return "at an unknown time";
  const minutes = Math.floor((now.getTime() - then.getTime()) / 60_000);
  if (minutes < 1) return "just now";
  if (minutes < 60) return `${minutes} min ago`;
  const time = then.toLocaleTimeString(locale, { hour: "numeric", minute: "2-digit" });
  const days = dayDiff(then, now);
  if (days <= 0) return `${Math.floor(minutes / 60)} h ago`;
  if (days === 1) return `yesterday at ${time}`;
  const sameYear = then.getFullYear() === now.getFullYear();
  return `${then.toLocaleDateString(locale, { month: "short", day: "numeric", ...(sameYear ? {} : { year: "numeric" }) })} at ${time}`;
}

// Calendar days between two moments, in local time (rounded, so a DST day still counts as one).
function dayDiff(a: Date, b: Date): number {
  const start = (d: Date) => new Date(d.getFullYear(), d.getMonth(), d.getDate()).getTime();
  return Math.round((start(b) - start(a)) / 86_400_000);
}
