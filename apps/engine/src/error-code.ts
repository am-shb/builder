// What to log about an error: a code or a name, never the message. Messages and details can quote row values,
// request bodies or meeting text (a SurrealDB index error names the duplicate value, a coercion error the field's).
// - A string `code` (ECONNREFUSED, or the engine's own SURREAL_UNREACHABLE) is the code.
// - A SurrealDB server error has a `kind` (NotFound, NotAllowed, Query, Internal, ...) and often a detail kind,
//   reported together as "NotFound.Table" or "Query.TransactionConflict". The detail's own fields, such as a table
//   name, are left out. Its numeric `code` is the JSON-RPC code, the same for many kinds, so it is not used.
// - Otherwise the code of the error's `cause`, then the cause's name, then the error's own name.
type ErrorLike = { code?: unknown; kind?: unknown; details?: { kind?: unknown } | null; name?: unknown; cause?: ErrorLike | null } | null | undefined;

const codeOf = (e: ErrorLike): string | undefined => {
  if (typeof e?.code === "string") return e.code;
  if (typeof e?.kind === "string") return typeof e.details?.kind === "string" ? `${e.kind}.${e.details.kind}` : e.kind;
  return undefined;
};

export const errorCode = (err: unknown): string => {
  const e = err as ErrorLike;
  const code = codeOf(e) ?? codeOf(e?.cause);
  if (code) return code;
  const name = e?.cause?.name ?? e?.name;
  return typeof name === "string" ? name : "unknown";
};
