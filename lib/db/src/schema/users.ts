import { pgTable, text, serial, timestamp, doublePrecision, boolean } from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod/v4";

export const usersTable = pgTable("users", {
  id: serial("id").primaryKey(),
  username: text("username").notNull().unique(),
  passwordHash: text("password_hash").notNull(),
  aircraft: text("aircraft").notNull().default("A320"),
  simulatorVersion: text("simulator_version").notNull().default("MSFS2024"),
  simbriefUsername: text("simbrief_username"),
  // VATSIM Certificate ID (numeric), set by an admin in the control tower.
  cid: text("cid"),
  isAdmin: text("is_admin").notNull().default("false"),
  hasSeenTutorial: text("has_seen_tutorial").notNull().default("false"),
  mustChangePassword: text("must_change_password").notNull().default("false"),
  simHours: doublePrecision("sim_hours").notNull().default(0),
  // Presence, updated by the Sim Link desktop heartbeat (used for no-show paging).
  lastSeenAt: timestamp("last_seen_at", { withTimezone: true }),
  msfsRunning: boolean("msfs_running").notNull().default(false),
  // Flight tracking: "simlink" (PC) | "volanta" (Xbox).
  trackingMethod: text("tracking_method").notNull().default("simlink"),
  volantaUsername: text("volanta_username"),
  // Discord account the pilot signed up with — used to DM their ops notifications.
  discordId: text("discord_id"),
  // Profile picture URL (Discord avatar or a custom image URL).
  avatarUrl: text("avatar_url"),
  // When true, Available routes only shows flights departing where the pilot's
  // last flight landed (realistic sequential routing).
  routeContinuity: boolean("route_continuity").notNull().default(false),
  // System "virtual pilots" that fly the schedule when no human picks a flight
  // up. Hidden from the human roster; the ops layer treats them like any pilot.
  isVirtual: boolean("is_virtual").notNull().default(false),
  // Owner (super-admin): can add/remove admin on other accounts.
  isOwner: boolean("is_owner").notNull().default(false),
  // Ban + appeal flow. appealStatus: "none" | "submitted" | "denied".
  banned: boolean("banned").notNull().default(false),
  banReason: text("ban_reason"),
  appealText: text("appeal_text"),
  appealStatus: text("appeal_status").notNull().default("none"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

export const insertUserSchema = createInsertSchema(usersTable).omit({ id: true, createdAt: true });
export type InsertUser = z.infer<typeof insertUserSchema>;
export type User = typeof usersTable.$inferSelect;
