import { Check, Moon, Sun, SunMoon, type LucideIcon } from "lucide-react";
import { DropdownMenu } from "radix-ui";
import { useColorMode } from "../hooks/useColorMode.ts";
import { COLOR_MODES, type ColorMode } from "../lib/color-mode.ts";
import { cn } from "../lib/cn.ts";

const CHOICES: Record<ColorMode, { label: string; icon: LucideIcon }> = {
  system: { label: "System", icon: SunMoon },
  light: { label: "Light", icon: Sun },
  dark: { label: "Dark", icon: Moon },
};

// The header's color mode button (ADR 0013): a 44px icon button that opens a small menu of System, Light and Dark,
// the current one checked. A menu rather than a button that cycles: three choices are each one step away, the person
// sees all of them and which is on before choosing, and a cycle would pass through a mode they didn't want (Dark on
// the way from Light to System). The icon shows the choice: sun-and-moon for System, a sun, a moon. Radix gives the
// menu its keyboard use (Enter, Space or the arrows open it; arrows move; Escape closes and returns focus). The menu
// isn't portalled to <body>: it stays inside the header, so it belongs to the page's banner landmark.
export function ColorModeMenu({ className }: { className?: string }) {
  const [mode, setMode] = useColorMode();
  const { label, icon: Icon } = CHOICES[mode];
  return (
    <DropdownMenu.Root>
      <DropdownMenu.Trigger
        aria-label={`Color mode: ${label}`}
        className={cn(
          "grid size-11 shrink-0 place-items-center rounded-full text-ink-2 hover:bg-sunk hover:text-ink data-[state=open]:bg-sunk data-[state=open]:text-ink",
          className,
        )}
      >
        <Icon aria-hidden="true" className="size-5" />
      </DropdownMenu.Trigger>
      <DropdownMenu.Content
        align="end"
        sideOffset={6}
        collisionPadding={12}
        className={cn(
          "z-50 min-w-48 rounded-plate bg-surface p-1.5 shadow-elevated ring-1 ring-hair outline-none",
          "motion-safe:data-[state=open]:animate-in motion-safe:data-[state=open]:fade-in-0 motion-safe:data-[state=open]:zoom-in-98",
          "motion-safe:data-[state=closed]:animate-out motion-safe:data-[state=closed]:fade-out-0",
          "motion-safe:duration-150",
        )}
      >
        <DropdownMenu.Label className="px-3 pt-1.5 pb-1 text-sm font-medium text-ink-2">Color mode</DropdownMenu.Label>
        <DropdownMenu.RadioGroup value={mode} onValueChange={(value) => setMode(value as ColorMode)}>
          {COLOR_MODES.map((m) => {
            const { label: itemLabel, icon: ItemIcon } = CHOICES[m];
            return (
              <DropdownMenu.RadioItem
                key={m}
                value={m}
                className="flex min-h-11 cursor-default items-center gap-3 rounded-field px-3 text-label text-ink outline-none select-none data-[highlighted]:bg-sunk"
              >
                <ItemIcon aria-hidden="true" className="size-[18px] shrink-0 text-ink-2" />
                <span className="flex-1">{itemLabel}</span>
                <DropdownMenu.ItemIndicator>
                  <Check aria-hidden="true" className="size-4 text-primary" />
                </DropdownMenu.ItemIndicator>
              </DropdownMenu.RadioItem>
            );
          })}
        </DropdownMenu.RadioGroup>
      </DropdownMenu.Content>
    </DropdownMenu.Root>
  );
}
