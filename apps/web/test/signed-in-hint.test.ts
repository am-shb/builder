import { describe, expect, it } from "vitest";
import { probablySignedIn } from "../src/lib/signed-in-hint.ts";
import { isLandingPath, normalPath } from "../src/landing/paths.ts";

describe("the sign-in hint (ADR 0017)", () => {
  it("is false with no Clerk cookie, or with Clerk's signed-out value", () => {
    expect(probablySignedIn("")).toBe(false);
    expect(probablySignedIn("theme=dark")).toBe(false);
    expect(probablySignedIn("__client_uat=0")).toBe(false);
    expect(probablySignedIn("__client_uat_Ab3x-9=0; other=1")).toBe(false);
  });

  it("is true once Clerk has a sign-in time, with or without a suffix", () => {
    expect(probablySignedIn("__client_uat=1761200000")).toBe(true);
    expect(probablySignedIn("a=1; __client_uat_Ab3x-9=1761200000")).toBe(true);
  });

  it("ignores look-alike names and values that aren't a time", () => {
    expect(probablySignedIn("x__client_uat=1761200000")).toBe(false);
    expect(probablySignedIn("__client_uatx=1761200000")).toBe(false);
    expect(probablySignedIn("__client_uat=abc")).toBe(false);
    expect(probablySignedIn("__client_uat=")).toBe(false);
  });
});

describe("the landing paths", () => {
  it("are home, privacy and terms, with or without a trailing slash", () => {
    expect(["/", "/privacy", "/terms/"].map(normalPath).every(isLandingPath)).toBe(true);
    expect(["/sign-in", "/sessions/1", "/choose-organization", "/_design"].map(normalPath).some(isLandingPath)).toBe(false);
  });
});
