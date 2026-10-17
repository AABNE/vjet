import { pgTable, text, serial, integer, timestamp } from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod/v4";

export const flightsTable = pgTable("flights", {
  id: serial("id").primaryKey(),
  flightNumber: text("flight_number").notNull(),
  departure: text("departure").notNull(),
  arrival: text("arrival").notNull(),
  aircraft: text("aircraft").notNull(), // "A320", "A20N", "A21N", "B788"
  departureTime: text("departure_time").notNull(), // origin LOCAL time, e.g. "06:30"
  flightDate: text("flight_date").notNull(), // origin LOCAL date, e.g. "2026-04-05"
  durationMinutes: integer("duration_minutes").notNull(),
  // True UTC departure instant (set for generated schedule flights). The 30-min
  // cutoff is computed from this so it's correct regardless of the origin's
  // timezone/DST. Nullable for legacy rows that only have local date + time.
  departsAt: timestamp("departs_at", { withTimezone: true }),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

export const insertFlightSchema = createInsertSchema(flightsTable).omit({ id: true, createdAt: true });
export type InsertFlight = z.infer<typeof insertFlightSchema>;
export type Flight = typeof flightsTable.$inferSelect;
