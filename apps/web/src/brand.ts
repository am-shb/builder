// The names people see come from @builder/session-core, so the web and mobile apps and the error text they share agree
// on them (ADR 0012, ADR 0016). Re-exported here so the web's screens keep one local import. From the package's brand
// entry only, so the landing page doesn't load the rest of the package and zod with it (ADR 0017).
export { BOT_NAME, PRODUCT_NAME } from "@builder/session-core/brand";
