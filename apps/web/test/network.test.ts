import { describe, expect, it } from "vitest";
import { NetworkBlockedError } from "./setup.ts";

describe("the test setup blocks the network", () => {
  it("fetch rejects", async () => {
    await expect(fetch("https://example.invalid/")).rejects.toBeInstanceOf(NetworkBlockedError);
  });

  it("WebSocket, EventSource, XMLHttpRequest and sendBeacon throw", () => {
    expect(() => new WebSocket("wss://example.invalid/")).toThrow(NetworkBlockedError);
    expect(() => new EventSource("https://example.invalid/")).toThrow(NetworkBlockedError);
    expect(() => new XMLHttpRequest()).toThrow(NetworkBlockedError);
    expect(() => navigator.sendBeacon("https://example.invalid/")).toThrow(NetworkBlockedError);
  });
});
