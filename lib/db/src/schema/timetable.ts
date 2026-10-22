import { pgTable, integer, serial, text, timestamp, boolean } from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod/v4";
import { usersTable } from "./users";
import { flightsTable } from "./flights";

export const timetableTable = pgTable("timetable", {
  id: serial("id").primaryKey(),
  userId: integer("user_id").notNull().references(() => usersTable.id),
  flightId: integer("flight_id").notNull().references(() => flightsTable.id),
  // "pending" | "active" | "completed" | "flagged" | "cancelled"
  status: text("status").notNull().default("pending"),
  startedAt: timestamp("started_at", { withTimezone: true }),
  finishedAt: timestamp("finished_at", { withTimezone: true }),
  flightDurationSeconds: integer("flight_duration_seconds"),
  // flagging
  flagReason: text("flag_reason"),
  approvedByAdmin: boolean("approved_by_admin").notNull().default(false),
  // dispatch flow: "none" | "requested" | "approved" | "cleared"
  dispatchStatus: text("dispatch_status").notNull().default("none"),
  briefing: text("briefing"), // JSON string of the imported SimBrief briefing
  pushbackViolation: boolean("pushback_violation").notNull().default(false),
  noShowNotified: boolean("no_show_notified").notNull().default(false),
  // Autonomous "virtual" operation (nobody picked the flight up). The engine
  // stores the randomised actual departure/arrival instants it flies to.
  isVirtual: boolean("is_virtual").notNull().default(false),
  virtualDepAt: timestamp("virtual_dep_at", { withTimezone: true }),
  virtualArrAt: timestamp("virtual_arr_at", { withTimezone: true }),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

export const insertTimetableSchema = createInsertSchema(timetableTable).omit({ id: true, createdAt: true });
export type InsertTimetable = z.infer<typeof insertTimetableSchema>;
export type Timetable = typeof timetableTable.$inferSelect;
