import { Link as LinkIcon } from "lucide-react";
import { useEffect, useState, type FormEvent } from "react";
import { BOT_NAME } from "../brand.ts";
import { Button } from "../components/Button.tsx";
import { TextField } from "../components/TextField.tsx";
import { checkMeetingLink } from "./start.ts";

export const LINK_HINT = `Google Meet, Zoom or Teams. ${BOT_NAME} asks to join; admit it from the meeting.`;
export const LINK_ERROR = "Use an https Google Meet, Zoom or Teams link.";

// The start form: one field and one button. A link that isn't an https URL sends nothing. While a start runs the field
// is read-only (not disabled, so focus stays on it) and the button is busy, so a double click sends one request; after
// a few seconds a line says it can take a while. `error` is a reply about the link itself, shown under the field.
export function StartForm({ onStart, sending, error, onEdit, clearKey = 0 }: {
  onStart: (meetingUrl: string) => void;
  sending: boolean;
  error?: string | undefined;
  onEdit?: (() => void) | undefined;
  // Changes when the field should empty (after any outcome that isn't about the link itself).
  clearKey?: number;
}) {
  const [value, setValue] = useState("");
  const [invalid, setInvalid] = useState(false);
  const [slow, setSlow] = useState(false);
  useEffect(() => {
    if (clearKey > 0) setValue("");
  }, [clearKey]);
  useEffect(() => {
    if (!sending) return setSlow(false);
    const timer = setTimeout(() => setSlow(true), 3000);
    return () => clearTimeout(timer);
  }, [sending]);
  const submit = (e: FormEvent) => {
    e.preventDefault();
    if (sending) return;
    const url = checkMeetingLink(value);
    if (!url) {
      setInvalid(true);
      return;
    }
    onStart(url);
  };
  return (
    <form className="grid gap-3.5" onSubmit={submit} noValidate>
      <TextField
        label="Meeting link"
        hint={LINK_HINT}
        icon={<LinkIcon />}
        type="url"
        inputMode="url"
        autoComplete="off"
        spellCheck={false}
        placeholder="Paste a meeting link"
        value={value}
        readOnly={sending}
        aria-disabled={sending || undefined}
        error={invalid ? LINK_ERROR : error}
        onChange={(e) => {
          setValue(e.target.value);
          setInvalid(false);
          onEdit?.();
        }}
      />
      <Button type="submit" block busy={sending} busyLabel="Starting…">Start session</Button>
      {slow && <p className="m-0 text-center text-sm text-ink-2" role="status">This can take up to 20 seconds. Keep this page open.</p>}
    </form>
  );
}
