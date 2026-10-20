import { ChevronDown } from "lucide-react";
import { Link } from "lucide-react";
import { useState, type FormEvent } from "react";
import { BOT_NAME } from "../brand.ts";
import { Button } from "../components/Button.tsx";
import { TextField } from "../components/TextField.tsx";

// Stand-ins for Clerk's org switcher and user button, for the preview only. W2 puts Clerk's components in these slots.
export function OrgPlaceholder() {
  return (
    <button type="button" className="flex h-11 items-center gap-2 rounded-full pr-2.5 pl-1.5 hover:bg-sunk">
      <span className="sr-only">Organization: </span>
      <span aria-hidden="true" className="grid size-[30px] place-items-center rounded-full bg-surface text-xs font-[650] shadow-[inset_0_0_0_1px_var(--hair)]">N</span>
      <span className="max-w-[10em] truncate text-sm font-medium">Northwind Studio</span>
      <ChevronDown aria-hidden="true" className="size-4 text-ink-2" strokeWidth={1.75} />
    </button>
  );
}

export function AccountPlaceholder() {
  return (
    <button type="button" aria-label="Account" className="grid size-11 place-items-center rounded-full hover:bg-sunk">
      <span aria-hidden="true" className="grid size-[30px] place-items-center rounded-full bg-primary text-xs font-[650] text-on-primary">K</span>
    </button>
  );
}

// The start form's look (W5 builds the real one, with the api call and every outcome).
export function StartFormPreview({ onStart }: { onStart?: () => void }) {
  const [busy, setBusy] = useState(false);
  const submit = (e: FormEvent) => {
    e.preventDefault();
    setBusy(true);
    setTimeout(() => {
      setBusy(false);
      onStart?.();
    }, 900);
  };
  return (
    <form className="grid gap-3.5" onSubmit={submit}>
      <TextField
        label="Meeting link"
        hint={`Google Meet, Zoom or Teams. ${BOT_NAME} asks to join; admit it from the meeting.`}
        icon={<Link />}
        type="url"
        inputMode="url"
        autoComplete="off"
        placeholder="Paste a meeting link"
      />
      <Button type="submit" block busy={busy} busyLabel="Starting…">Start session</Button>
    </form>
  );
}
