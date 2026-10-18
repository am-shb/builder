// drizzle-kit settings, used only on a developer machine to generate migrations from src/db/schema.ts:
//   npx drizzle-kit generate
// Migrations are applied at runtime by src/db/migrate.ts (drizzle-kit is a dev dependency and isn't installed
// on Render). The migrations table lives in the engine's own schema, apart from the api's.
import { defineConfig } from "drizzle-kit";

export default defineConfig({
  dialect: "postgresql",
  schema: "./src/db/schema.ts",
  out: "./drizzle",
  schemaFilter: ["engine"],
  migrations: { schema: "engine", table: "__drizzle_migrations" },
});
