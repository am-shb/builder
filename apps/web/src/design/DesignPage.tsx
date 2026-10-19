// The design system on one page (ADR 0013), for development only: main.tsx loads it at /_design in the dev server, and
// the production build leaves it out. Query: ?theme=light|dark forces a mode; ?view=shell shows the sessions screen
// built from the components (&empty=1 for the empty state, &open=sheet|confirm with an overlay open, &toast=1).
import { Link, Plus, RotateCw } from "lucide-react";
import { useEffect, useState, type ReactNode } from "react";
import { BOT_NAME } from "../brand.ts";
import { AppShell, PageIntro, SectionHeader, SplitLayout } from "../components/AppShell.tsx";
import { Button } from "../components/Button.tsx";
import { Callout } from "../components/Callout.tsx";
import { ConfirmModal } from "../components/ConfirmModal.tsx";
import { EmptyState } from "../components/EmptyState.tsx";
import { DraftToAgreed, Mark } from "../components/Mark.tsx";
import { PageState } from "../components/PageState.tsx";
import { ResponsiveModal } from "../components/ResponsiveModal.tsx";
import { SessionList, SessionRow, SessionRowSkeleton } from "../components/SessionRow.tsx";
import { STATUS_LABELS, StatusPill } from "../components/StatusPill.tsx";
import { TextField } from "../components/TextField.tsx";
import { Toaster, toast } from "../components/Toaster.tsx";
import { AccountPlaceholder, OrgPlaceholder, StartFormPreview } from "./DesignChrome.tsx";

const q = new URLSearchParams(location.search);
// Set before the first paint, so the forced mode never flashes the other one.
const forced = q.get("theme");
if (forced === "light" || forced === "dark") document.documentElement.dataset.theme = forced;

const SESSIONS = [
  { code: "kfp-qzwd-nre", status: "in_meeting", platform: "meet", platformLabel: "Google Meet", when: "12 min ago" },
  { code: "842 1337 7051", status: "joining", platform: "zoom", platformLabel: "Zoom", when: "1 min ago" },
  { code: "Teams meeting", status: "start_unknown", platform: "teams", platformLabel: "Teams", when: "25 min ago" },
  { code: "xtr-mbha-qpo", status: "ended", platform: "meet", platformLabel: "Google Meet", when: "yesterday at 4:12 PM" },
  { code: "ahn-vexr-kid", status: "start_failed", platform: "meet", platformLabel: "Google Meet", when: "Monday at 10:03 AM" },
];

const EMPTY_STEPS = ["Paste the meeting link", `Admit ${BOT_NAME} when it asks to join`, "Watch the prototype take shape"];

const SWATCHES: [string, string][] = [
  ["bg-bg shadow-[inset_0_0_0_1px_var(--hair)]", "background"], ["bg-surface shadow-[inset_0_0_0_1px_var(--hair)]", "surface"],
  ["bg-sunk", "sunk"], ["bg-hair", "hair"], ["bg-ink", "ink"], ["bg-ink-2", "ink-2"], ["bg-ink-3", "ink-3"], ["bg-input", "input"],
  ["bg-primary", "primary"], ["bg-live", "live"], ["bg-accent-tint", "accent tint"], ["bg-s-warn-bg", "status: warning"],
  ["bg-s-fail-bg", "status: didn't start"], ["bg-danger", "danger"],
];

function Section({ title, children }: { title: string; children: ReactNode }) {
  return (
    <section className="mt-10 first:mt-8" aria-labelledby={`kit-${title}`}>
      <h2 id={`kit-${title}`} className="mt-0 mb-4 text-label font-semibold text-ink-2">{title}</h2>
      {children}
    </section>
  );
}

function Kit() {
  const [sheet, setSheet] = useState(false);
  const [confirm, setConfirm] = useState(false);
  return (
    <AppShell org={<OrgPlaceholder />} account={<AccountPlaceholder />}>
      <div data-testid="design-page" className="max-w-[760px]">
        <PageIntro title="Design system" subtitle="Every component and state, light and dark. Development only." />

        <Section title="Colors">
          <ul className="m-0 grid list-none grid-cols-2 gap-3 p-0 sm:grid-cols-4">
            {SWATCHES.map(([cls, name]) => (
              <li key={name} className="flex items-center gap-2.5 text-sm">
                <span aria-hidden="true" className={`size-9 shrink-0 rounded-xl ${cls}`} />{name}
              </li>
            ))}
          </ul>
        </Section>

        <Section title="Type">
          <p className="tabular m-0 text-code-lg font-medium tracking-[-0.03em]">kfp-qzwd-nre</p>
          <p className="mt-1 mb-0 text-sm text-ink-2">Meeting code, 28 / 34px medium, tabular</p>
          <p className="mt-5 mb-0 text-base">Body, 16px. Send {BOT_NAME} into a meeting, then follow each session here.</p>
          <p className="mt-1 mb-0 text-sm text-ink-2">Secondary, 14px. Google Meet, 12 min ago</p>
        </Section>

        <Section title="Mark">
          <div className="flex items-center gap-6"><Mark /><Mark className="size-12" /><DraftToAgreed /></div>
        </Section>

        <Section title="Buttons">
          <div className="flex flex-wrap items-center gap-3">
            <Button>Start session</Button>
            <Button variant="secondary" size="sm">Cancel</Button>
            <Button variant="quiet" size="sm"><RotateCw aria-hidden="true" />Refresh</Button>
            <Button busy busyLabel="Starting…">Start session</Button>
            <Button disabled>Start session</Button>
            <Button><Plus aria-hidden="true" />New session</Button>
          </div>
        </Section>

        <Section title="States">
          <p className="mt-0 mb-4 text-sm text-ink-2">Forced here so they show in screenshots: keyboard focus, a focused field, a hovered and a pressed row, a disabled field.</p>
          <div className="grid max-w-[420px] gap-5">
            <div className="flex flex-wrap gap-3">
              <Button className="outline-2 outline-offset-3 outline-primary">Focused</Button>
              <Button variant="secondary" size="sm" className="outline-2 outline-offset-3 outline-primary">Focused</Button>
            </div>
            <TextField label="Focused field" placeholder="Paste a meeting link" icon={<Link />}
              className="[&_input]:border-primary [&_input]:shadow-[inset_0_0_0_0.5px_var(--primary),0_0_0_4px_color-mix(in_srgb,var(--primary)_18%,transparent)]" />
            <TextField label="Disabled field" value="meet.google.com/kfp-qzwd-nre" disabled readOnly icon={<Link />} />
          </div>
          <SessionList className="mt-5">
            <SessionRow href="#" {...SESSIONS[0]!} className="bg-plate" />
            <SessionRow href="#" {...SESSIONS[1]!} className="scale-[0.99] bg-sunk" />
            <SessionRow href="#" {...SESSIONS[2]!} className="outline-2 outline-offset-[-2px] outline-primary" />
          </SessionList>
        </Section>

        <Section title="Status">
          <div className="flex flex-wrap gap-2.5">
            {[...Object.keys(STATUS_LABELS), "something_new"].map((s) => <StatusPill key={s} status={s} />)}
          </div>
        </Section>

        <Section title="Text field">
          <div className="grid max-w-[420px] gap-7">
            <StartFormPreview onStart={() => toast.success("Session started. Admit it when it asks to join.")} />
            <TextField label="Meeting link" defaultValue="meet.google.com/abc" error="Use an https Google Meet, Zoom or Teams link." icon={<Link />} />
          </div>
        </Section>

        <Section title="Callouts">
          <div className="grid gap-3">
            <Callout tone="warning" title={`We couldn't confirm whether ${BOT_NAME} joined`}>Check the meeting for a {BOT_NAME} bot before trying again.</Callout>
            <Callout tone="error" title="Sessions aren't available right now" action={<Button variant="secondary" size="sm">Refresh</Button>}>Try again in a moment.</Callout>
            <Callout tone="info" title="Statuses update when you refresh">Live updates come later.</Callout>
          </div>
        </Section>

        <Section title="Session rows">
          <SessionList>{SESSIONS.map((s) => <SessionRow key={s.code} href="#" {...s} />)}</SessionList>
        </Section>

        <Section title="Loading">
          <SessionList aria-label="Loading sessions" aria-busy="true">{[1, 2, 3].map((i) => <SessionRowSkeleton key={i} />)}</SessionList>
        </Section>

        <Section title="Empty state">
          <EmptyState title="Start your first session" description={`Bring ${BOT_NAME} into a meeting. It listens while you decide, and builds the prototype on the shared screen.`}
            steps={EMPTY_STEPS} action={<Button block><Plus aria-hidden="true" />New session</Button>} />
        </Section>

        <Section title="Page state">
          <div className="rounded-panel bg-surface shadow-elevated">
            <PageState icon={<DraftToAgreed />} title="No such session in this organization" action={<Button variant="secondary" size="sm">Back to sessions</Button>}>
              It may belong to another organization, or the link is wrong.
            </PageState>
          </div>
        </Section>

        <Section title="Overlays">
          <div className="flex flex-wrap gap-3">
            <Button variant="secondary" size="sm" onClick={() => setSheet(true)}>Open the start form</Button>
            <Button variant="secondary" size="sm" onClick={() => setConfirm(true)}>Open a confirmation</Button>
            <Button variant="secondary" size="sm" onClick={() => toast.success("Link copied")}>Show a toast</Button>
          </div>
        </Section>
      </div>
      <ResponsiveModal open={sheet} onOpenChange={setSheet} title="New session"><StartFormPreview onStart={() => setSheet(false)} /></ResponsiveModal>
      <ConfirmModal open={confirm} onOpenChange={setConfirm} title="Start another session for this link?"
        description={`An earlier start for this link didn't confirm. Check the meeting for a ${BOT_NAME} bot before starting another.`}
        confirmLabel="Start anyway" onConfirm={() => setConfirm(false)} />
    </AppShell>
  );
}

function Shell() {
  const empty = q.get("empty") === "1";
  const [sheet, setSheet] = useState(q.get("open") === "sheet");
  const [confirm, setConfirm] = useState(q.get("open") === "confirm");
  const newSession = <Button block onClick={() => setSheet(true)}><Plus aria-hidden="true" />New session</Button>;
  return (
    <AppShell org={<OrgPlaceholder />} account={<AccountPlaceholder />} actionBar={empty ? undefined : newSession}>
      <div data-testid="design-page">
        <SplitLayout
          intro={<PageIntro title="Sessions" subtitle={`Send ${BOT_NAME} into a meeting, then follow each session here.`} />}
          panel={<StartFormPreview onStart={() => toast.success("Session started")} />}
        >
          {empty ? (
            <>
              <h2 className="sr-only">Your sessions</h2>
              <EmptyState className="md:mt-[var(--section-baseline,14px)]" title="Start your first session" description={`Bring ${BOT_NAME} into a meeting. It listens while you decide, and builds the prototype on the shared screen.`}
                steps={EMPTY_STEPS} action={newSession} />
            </>
          ) : (
            <section aria-labelledby="recent">
              <SectionHeader id="recent" title="Recent" action={<Button variant="quiet" size="sm"><RotateCw aria-hidden="true" />Refresh</Button>} />
              <SessionList>{SESSIONS.map((s) => <SessionRow key={s.code} href="#" {...s} />)}</SessionList>
            </section>
          )}
        </SplitLayout>
      </div>
      <ResponsiveModal open={sheet} onOpenChange={setSheet} title="New session"><StartFormPreview onStart={() => setSheet(false)} /></ResponsiveModal>
      <ConfirmModal open={confirm} onOpenChange={setConfirm} title="Start another session for this link?"
        description={`An earlier start for this link didn't confirm. Check the meeting for a ${BOT_NAME} bot before starting another.`}
        confirmLabel="Start anyway" onConfirm={() => setConfirm(false)} />
    </AppShell>
  );
}

export default function DesignPage() {
  useEffect(() => {
    // An id, so React's development double effect shows it once.
    if (q.get("toast") === "1") toast.success("Link copied", { id: "preview-toast" });
  }, []);
  return (
    <>
      {q.get("view") === "shell" ? <Shell /> : <Kit />}
      <Toaster />
    </>
  );
}
