import { describe, expect, it } from "vitest";
import { clerkAppearance } from "../src/clerk/appearance.ts";

// The phone field is a box (phoneInputBox) around a country picker and an input that is also a formFieldInput. Only
// the box may draw the focus ring; the input's own ring must be switched off, or the field shows two.
describe("Clerk's phone field", () => {
  const box = clerkAppearance.elements.phoneInputBox.split(" ");
  const field = clerkAppearance.elements.formFieldInput.split(" ");

  it("draws its focus ring on the box, like the other fields draw theirs", () => {
    expect(box).toContain("focus-within:border-primary");
    expect(box.some((c) => c.startsWith("focus-within:shadow-["))).toBe(true);
    expect(field.some((c) => c.startsWith("focus:shadow-["))).toBe(true);
  });

  it("switches off the inner input's border, ring and outline, winning over formFieldInput", () => {
    for (const c of ["[&_input]:border-0!", "[&_input]:shadow-none!", "[&_input]:outline-none!"]) expect(box).toContain(c);
  });
});
