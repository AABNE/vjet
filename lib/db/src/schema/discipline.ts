import { pgTable, integer, serial, text, timestamp } from "drizzle-orm/pg-core";
import { usersTable } from "./users";

// Per-pilot discipline counters. 3 infractions = 1 strike; 3 strikes = a ban
// that doubles each time (1h, 2h, 4h, 8h, 16h…). All counters reset monthly,
// keyed by periodKey ("YYYY-MM").
export const pilotDisciplineTable = pgTable("pilot_discipline", {
  userId: integer("user_id").primaryKey().references(() => usersTable.id),
  periodKey: text("period_key").notNull().default(""),
  infractions: integer("infractions").notNull().default(0),
  strikes: integer("strikes").notNull().default(0),
  banLevel: integer("ban_level").notNull().default(0),
  bannedUntil: timestamp("banned_until", { withTimezone: true }),
});
export type PilotDiscipline = typeof pilotDisciplineTable.$inferSelect;

// A log of every infraction, for the pilot's record.
export const pilotInfractionsTable = pgTable("pilot_infractions", {
  id: serial("id").primaryKey(),
  userId: integer("user_id").notNull().references(() => usersTable.id),
  type: text("type").notNull(),
  reason: text("reason").notNull().default(""),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});
export type PilotInfraction = typeof pilotInfractionsTable.$inferSelect;
