import { OrganizationSwitcher, UserButton } from "@clerk/react";
import { useEffect, useRef, type ReactNode } from "react";
import { AppShell } from "../components/AppShell.tsx";

// The app shell for members: Clerk's org switcher (personal accounts hidden) and account menu in the top bar.
// Switching org changes the session token, so every request after it is for the new org.
export function SignedInShell({ actionBar, children }: { actionBar?: ReactNode; children: ReactNode }) {
  return (
    <AppShell
      org={<LabelInName><OrganizationSwitcher hidePersonal afterCreateOrganizationUrl="/" /></LabelInName>}
      account={<UserButton />}
      actionBar={actionBar}
    >
      {children}
    </AppShell>
  );
}

// Clerk's org switcher shows the org's name but labels its button "Open organization switcher", so a voice-control user
// who says the name they see can't reach it (WCAG 2.5.3, label in name). Clerk's appearance options can't set ARIA, so
// this keeps the label starting with the visible name, and follows Clerk's re-renders.
function LabelInName({ children }: { children: ReactNode }) {
  const box = useRef<HTMLSpanElement>(null);
  useEffect(() => {
    const el = box.current;
    if (!el) return;
    const fix = () => {
      const button = el.querySelector("button");
      const name = button?.textContent?.trim();
      if (!button || !name) return;
      const label = `${name}, switch organization`;
      if (button.getAttribute("aria-label") !== label) button.setAttribute("aria-label", label);
    };
    fix();
    const observer = new MutationObserver(fix);
    observer.observe(el, { subtree: true, childList: true, characterData: true, attributes: true, attributeFilter: ["aria-label"] });
    return () => observer.disconnect();
  }, []);
  return <span ref={box} className="contents">{children}</span>;
}
