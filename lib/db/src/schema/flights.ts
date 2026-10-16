import { pgTable, text, serial, integer, timestamp } from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod/v4";

export const flightsTable = pgTable("flights", {
  id: serial("id").primaryKey(),
  flightNumber: text("flight_number").notNull(),
  departure: text("departure").notNull(),
  arrival: text("arrival").notNull(),
  aircraft: text("aircraft").notNull(), // "737", "777", "A320"
  departureTime: text("departure_time").notNull(), // e.g. "06:30"
  flightDate: text("flight_date").notNull(), // e.g. "2026-04-05"
  durationMinutes: integer("duration_minutes").notNull(),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

export const insertFlightSchema = createInsertSchema(flightsTable).omit({ id: true, createdAt: true });
export type InsertFlight = z.infer<typeof insertFlightSchema>;
export type Flight = typeof flightsTable.$inferSelect;
