// JSON in and out, and the one error shape every route answers with (docs/adr/0010-api-stack.md):
// { error: { code, message } }. `code` is stable snake_case for the web app; `message` is for people.
import type { IncomingMessage, ServerResponse } from "node:http";

export const MAX_BODY_BYTES = 1_000_000;

export class HttpError extends Error {
  override name = "HttpError";
  readonly status: number;
  readonly code: string;
  constructor(status: number, code: string, message: string) {
    super(message);
    this.status = status;
    this.code = code;
  }
}

export function sendJson(res: ServerResponse, status: number, body: unknown, headers: Record<string, string> = {}) {
  res.writeHead(status, { "content-type": "application/json; charset=utf-8", "cache-control": "no-store", ...headers });
  res.end(JSON.stringify(body));
}

export function sendError(res: ServerResponse, status: number, code: string, message: string, headers: Record<string, string> = {}) {
  sendJson(res, status, { error: { code, message } }, headers);
}

/** Reads a JSON body of at most `maxBytes`. Throws HttpError 413, 415 or 400. */
export async function readJson(req: IncomingMessage, maxBytes = MAX_BODY_BYTES): Promise<unknown> {
  const type = req.headers["content-type"] ?? "";
  if (!/^application\/json(\s*;|$)/i.test(type)) {
    throw new HttpError(415, "unsupported_media_type", "Send the body as application/json.");
  }
  const chunks: Buffer[] = [];
  let size = 0;
  for await (const chunk of req as AsyncIterable<Buffer>) {
    size += chunk.length;
    if (size > maxBytes) throw new HttpError(413, "payload_too_large", `The body must be at most ${maxBytes} bytes.`);
    chunks.push(chunk);
  }
  try {
    return JSON.parse(Buffer.concat(chunks).toString("utf8"));
  } catch {
    throw new HttpError(400, "invalid_json", "The body is not valid JSON.");
  }
}
