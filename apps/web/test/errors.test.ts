import { describe, expect, it } from "vitest";
import { ApiError } from "../src/api/client.ts";
import { explainError, roleLabel } from "../src/api/errors.ts";
import { BOT_NAME, PRODUCT_NAME } from "../src/brand.ts";
import { session } from "./helpers/fake-api.ts";

const e = (status: number, code: string, errorCode?: string) =>
  new ApiError(status, code, errorCode ? session({ status: "start_failed", errorCode }) : undefined);

// The plan's error table, row by row.
describe("reading", () => {
  it.each([
    [e(401, "unauthenticated"), "read", "Your sign-in has expired or isn't accepted here.", "sign_in"],
    [e(403, "no_active_org"), "read", "Choose an organization to continue.", "choose_org"],
    [e(403, "forbidden"), "read", "Your role in this organization can't do that.", "none"],
    [e(404, "not_found"), "detail", "No such session in this organization.", "back_to_list"],
    [e(404, "not_found"), "read", "Something went wrong (not_found).", "none"],
    [e(405, "method_not_allowed"), "read", "Something went wrong (method_not_allowed).", "refresh"],
    [e(500, "internal_error"), "read", "Something went wrong on our side. Try again in a moment.", "refresh"],
    [e(503, "auth_unavailable"), "read", "Sign-in isn't available right now.", "refresh"],
    [e(503, "db_unavailable"), "read", "Sessions aren't available right now.", "refresh"],
    [e(0, "network_error"), "read", `Can't reach ${PRODUCT_NAME}. Check your connection.`, "refresh"],
    [e(200, "bad_response"), "read", "Something went wrong (bad_response).", "refresh"],
    [e(418, "teapot"), "read", "Something went wrong (teapot).", "refresh"],
    [e(0, "signed_out"), "read", "Your sign-in has expired.", "sign_in"],
  ] as const)("%o in %s", (err, ctx, title, action) => {
    const x = explainError(err, ctx);
    expect([x.title, x.action, x.botMayExist]).toEqual([title, action, false]);
  });
});

describe("starting", () => {
  it.each([
    [e(400, "invalid_request"), "Use an https Google Meet, Zoom or Teams link.", "fix_link"],
    [e(400, "invalid_json"), "Something went wrong (invalid_json).", "none"],
    [e(401, "unauthenticated"), "Your sign-in has expired or isn't accepted here.", "sign_in"],
    [e(403, "no_active_org"), "Choose an organization to continue.", "choose_org"],
    [e(413, "payload_too_large"), "Something went wrong (payload_too_large).", "none"],
    [e(502, "engine_rejected", "recall_rejected"), `${BOT_NAME} couldn't join this meeting.`, "fix_link"],
    [e(502, "engine_rejected", "meeting_in_use"), `${BOT_NAME} already has a session in this meeting.`, "back_to_list"],
    [e(503, "db_unavailable"), "Sessions aren't available right now.", "refresh"],
    [e(502, "engine_rejected", "session_conflict"), "Starting meetings isn't working right now (session_conflict).", "none"],
    [e(503, "engine_unavailable"), "Starting meetings isn't available right now.", "none"],
    [e(503, "limits_unavailable"), "Starting meetings isn't set up on this server yet.", "none"],
  ] as const)("no new bot: %o", (err, title, action) => {
    const x = explainError(err, "start");
    expect([x.title, x.action, x.botMayExist]).toEqual([title, action, false]);
  });

  it.each([
    e(504, "engine_outcome_unknown"),
    e(500, "internal_error"),
    e(0, "network_error"),
    e(200, "bad_response"),
    e(599, "something_new"),
    e(502, "http_502"),
    e(503, "http_503"),
  ])("a bot may exist: %o shows the warning, with no retry", (err) => {
    const x = explainError(err, "start");
    expect(x.botMayExist).toBe(true);
    expect(x.tone).toBe("warning");
    expect(x.detail).toMatch(/before trying again/);
  });

  it("anything that isn't an ApiError is unexpected: a start warns, a read says so without blaming the connection", () => {
    expect(explainError(new Error("boom"), "start").botMayExist).toBe(true);
    const read = explainError(new Error("boom"), "read");
    expect([read.title, read.botMayExist]).toEqual(["Something went wrong (unexpected).", false]);
  });

  it("no token from Clerk: nothing was sent, so no warning and no bot", () => {
    const start = explainError(new ApiError(0, "token_error"), "start");
    expect([start.tone, start.botMayExist, start.detail]).toEqual(["error", false, "Nothing was sent. Try again in a moment."]);
    const read = explainError(new ApiError(0, "token_error"), "read");
    expect([read.title, read.action]).toEqual(["Sign-in didn't respond.", "refresh"]);
  });
});

it("role labels", () => {
  expect([roleLabel("org:admin"), roleLabel("org:member"), roleLabel("org:billing")]).toEqual(["Admin", "Member", "org:billing"]);
});
