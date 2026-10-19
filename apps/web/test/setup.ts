// Tests never reach the network (ADR 0012): not Clerk, not the api, not the engine, not any paid service. Every way a
// test could open a connection fails the test instead. A test that needs a reply passes its own fake fetch.
import { cleanup } from "@testing-library/react";
import { afterEach } from "vitest";

export class NetworkBlockedError extends Error {
  constructor(what: string) {
    super(`${what} is blocked in tests. Pass a fake instead.`);
    this.name = "NetworkBlockedError";
  }
}

function blocked(what: string) {
  return function () {
    throw new NetworkBlockedError(what);
  };
}

const g = globalThis as Record<string, unknown>;
g.fetch = async () => {
  throw new NetworkBlockedError("fetch");
};
g.WebSocket = blocked("WebSocket");
g.EventSource = blocked("EventSource");
g.XMLHttpRequest = blocked("XMLHttpRequest");
if (typeof navigator !== "undefined") {
  Object.defineProperty(navigator, "sendBeacon", { value: blocked("navigator.sendBeacon"), configurable: true });
}

afterEach(() => cleanup());
