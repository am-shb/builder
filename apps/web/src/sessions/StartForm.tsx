import { Link as LinkIcon } from "lucide-react";
import { useEffect, useState, type FormEvent } from "react";
import { BOT_NAME } from "../brand.ts";
import { Button } from "../components/Button.tsx";
import { TextField } from "../components/TextField.tsx";
import { checkMeetingLink } from "@builder/session-core";

export const LINK_HINT = `Google Meet, Zoom or Teams. ${BOT_NAME} asks to join; admit it from the meeting.`;
export const LINK_ERROR = "Use an https Google Meet, Zoom or Teams link.";

// The start form: one field and one button. A link that isn't an https URL sends nothing. While a start runs the field
// is read-only (not disabled, so focus stays on it) and the button is busy, so a double click sends one request; after
// a few seconds a line says it can take a while. `error` is a reply about the link itself, shown under the field. The
// link lives with the start (StartSessionProvider), so the panel and the sheet show the same one.
export function StartForm({ value, onValueChange, onStart, sending, error }: {
  value: string;
  onValueChange: (value: string) => void;
  onStart: (meetingUrl: string) => void;
  sending: boolean;
  error?: string | undefined;
}) {
  const [invalid, setInvalid] = useState(false);
  const [slow, setSlow] = useState(false);
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
      // Cleared first, so the same message is announced again on a second try.
      setInvalid(false);
      requestAnimationFrame(() => setInvalid(true));
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
          onValueChange(e.target.value);
          setInvalid(false);
        }}
      />
      <div>
        <Button type="submit" block busy={sending} busyLabel="Starting…">Start session</Button>
        {/* Always mounted, so the line is announced when it appears. */}
        <p role="status" className="m-0 mt-3.5 text-center text-sm text-ink-2 empty:mt-0">
          {slow && "This can take up to 20 seconds. Keep this page open."}
        </p>
      </div>
    </form>
  );
}
