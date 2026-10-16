// @neondatabase/serverless uses WebSockets (native in CF Workers) instead of
// TCP sockets, making it compatible with Cloudflare Workers/Pages Functions.
import { Pool } from "@neondatabase/serverless";
import { drizzle } from "drizzle-orm/neon-serverless";
import * as schema from "./schema";

if (!process.env.DATABASE_URL) {
  throw new Error("DATABASE_URL must be set.");
}

export const pool = new Pool({ connectionString: process.env.DATABASE_URL });
export const db = drizzle(pool, { schema });

export * from "./schema";
// Re-export drizzle helpers so routes don't import from drizzle-orm directly
export { eq, ne, and, inArray, sql } from "drizzle-orm";
