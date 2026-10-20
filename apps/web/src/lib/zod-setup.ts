// zod would otherwise test whether it may compile code at runtime, the first time it checks an object. It catches the
// error, but under our CSP (no 'unsafe-eval') the browser still reports a violation on every page. jitless skips the
// test and the compiling. Imported first by main.tsx, so it runs before any other module uses zod.
import { z } from "zod";

z.config({ jitless: true });
