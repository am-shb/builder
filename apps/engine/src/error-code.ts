// What to log about an error: a code or a name, never the message. Messages and details can quote row values,
// request bodies or meeting text. Drizzle wraps every failed query in an error named "Error" with no code, so
// the Postgres or network code (42P01, ECONNREFUSED) is read from `cause`.
type ErrorLike = { code?: unknown; name?: unknown; cause?: ErrorLike | null } | null | undefined;

export const errorCode = (err: unknown): string => {
  const e = err as ErrorLike;
  const code = e?.code ?? e?.cause?.code;
  if (typeof code === "string") return code;
  const name = e?.cause?.name ?? e?.name;
  return typeof name === "string" ? name : "unknown";
};
