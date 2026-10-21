import { pgTable, integer, serial, text, timestamp } from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod/v4";
import { usersTable } from "./users";

// A pilot reporting another pilot (misconduct in a shared cockpit, crew chat, etc.).
export const userReportsTable = pgTable("user_reports", {
  id: serial("id").primaryKey(),
  reporterId: integer("reporter_id").notNull().references(() => usersTable.id),
  reportedId: integer("reported_id").notNull().references(() => usersTable.id),
  reason: text("reason").notNull(),
  // Optional free-text detail + where it happened (e.g. "cockpit ABC123").
  detail: text("detail").notNull().default(""),
  context: text("context").notNull().default(""),
  // Evidence captured at report time: JSON crew-chat transcript + a base64
  // data-URL of the recent crew-call audio (empty if voice wasn't on).
  chat: text("chat").notNull().default("[]"),
  audioClip: text("audio_clip").notNull().default(""),
  // "open" | "resolved" | "dismissed"
  status: text("status").notNull().default("open"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  resolvedAt: timestamp("resolved_at", { withTimezone: true }),
});

export const insertUserReportSchema = createInsertSchema(userReportsTable).omit({ id: true, createdAt: true, resolvedAt: true, status: true });
export type InsertUserReport = z.infer<typeof insertUserReportSchema>;
export type UserReport = typeof userReportsTable.$inferSelect;
