import { pgTable, text, timestamp } from "drizzle-orm/pg-core";

// Pilot applications submitted from the /apply site. Stored so that when a
// recruiter clicks "Accept" in Discord, we can look the application up by the
// applicant's Discord ID and auto-create their pilot-hub account with the
// username they chose. Keyed by Discord ID: re-applying overwrites the pending
// record.
export const applicationsTable = pgTable("applications", {
  discordId: text("discord_id").primaryKey(),
  username: text("username").notNull(),
  aircraft: text("aircraft").notNull().default(""), // comma-separated fleet codes
  email: text("email"),
  cid: text("cid"),
  status: text("status").notNull().default("pending"), // pending | accepted | declined
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  decidedAt: timestamp("decided_at", { withTimezone: true }),
});

export type Application = typeof applicationsTable.$inferSelect;
