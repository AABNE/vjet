import { pgTable, integer, serial, text, timestamp, boolean } from "drizzle-orm/pg-core";
import { usersTable } from "./users";
import { flightsTable } from "./flights";
import { timetableTable } from "./timetable";

// ── Virtual fleet ────────────────────────────────────────────────────────────
// A specific aircraft registration in the VJetstar simulated fleet.
export const aircraftTable = pgTable("aircraft", {
  id: serial("id").primaryKey(),
  registration: text("registration").notNull().unique(), // e.g. VH-VFO
  type: text("type").notNull(),                           // fleet code: A320 | A20N | A21N | B788
  // "active" | "maintenance_hold" | "grounded"
  status: text("status").notNull().default("active"),
  note: text("note"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
});
export type Aircraft = typeof aircraftTable.$inferSelect;

// Which registration is assigned to a scheduled service.
export const aircraftAssignmentsTable = pgTable("aircraft_assignments", {
  id: serial("id").primaryKey(),
  timetableId: integer("timetable_id").references(() => timetableTable.id, { onDelete: "cascade" }),
  flightId: integer("flight_id").references(() => flightsTable.id, { onDelete: "cascade" }),
  registration: text("registration").notNull(),
  // "assigned" | "swapped" | "cancelled"
  status: text("status").notNull().default("assigned"),
  reason: text("reason"),
  assignedBy: text("assigned_by").notNull().default("system"), // agent:fleet-manager | user:<id>
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
});
export type AircraftAssignment = typeof aircraftAssignmentsTable.$inferSelect;

// ── Delay reports ────────────────────────────────────────────────────────────
export const delayReportsTable = pgTable("delay_reports", {
  id: serial("id").primaryKey(),
  timetableId: integer("timetable_id"),
  flightId: integer("flight_id"),
  pilotUserId: integer("pilot_user_id"),
  registration: text("registration"),
  scheduledDepAt: timestamp("scheduled_dep_at", { withTimezone: true }),
  estimatedAt: timestamp("estimated_at", { withTimezone: true }),
  delayMinutes: integer("delay_minutes"),
  // late_inbound | aircraft_substitution | pilot_availability | technical | weather | atc | schedule_conflict | other | unknown
  category: text("category").notNull().default("unknown"),
  reason: text("reason"),
  // draft | notified | confirmed | closed
  status: text("status").notNull().default("draft"),
  createdBy: text("created_by").notNull().default("agent:flight-monitor"),
  dedupeKey: text("dedupe_key").unique(), // one open report per flight-event
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
});
export type DelayReport = typeof delayReportsTable.$inferSelect;

// ── Maintenance reports + holds ─────────────────────────────────────────────
export const maintenanceReportsTable = pgTable("maintenance_reports", {
  id: serial("id").primaryKey(),
  registration: text("registration").notNull(),
  reportedByUserId: integer("reported_by_user_id"),
  flightId: integer("flight_id"),
  category: text("category").notNull().default("other"),
  description: text("description").notNull().default(""),
  // pre_departure | in_flight | after_landing | unknown
  phase: text("phase").notNull().default("unknown"),
  requestRestriction: boolean("request_restriction").notNull().default(false),
  // draft | submitted | under_review | awaiting_info | maintenance_hold | resolved | closed
  status: text("status").notNull().default("submitted"),
  priority: text("priority").notNull().default("normal"), // low | normal | high
  reviewerUserId: integer("reviewer_user_id"),
  findings: text("findings"),
  holdActive: boolean("hold_active").notNull().default(false),
  clearedByUserId: integer("cleared_by_user_id"),
  clearedAt: timestamp("cleared_at", { withTimezone: true }),
  clearReason: text("clear_reason"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
});
export type MaintenanceReport = typeof maintenanceReportsTable.$inferSelect;

// ── Ops dispatch records (readiness) ────────────────────────────────────────
export const dispatchRecordsTable = pgTable("dispatch_records", {
  id: serial("id").primaryKey(),
  timetableId: integer("timetable_id").unique(),
  flightId: integer("flight_id"),
  registration: text("registration"),
  // draft | awaiting_review | ready | hold | cancelled | completed
  status: text("status").notNull().default("draft"),
  notes: text("notes"),
  reviewedByUserId: integer("reviewed_by_user_id"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
});
export type DispatchRecord = typeof dispatchRecordsTable.$inferSelect;

// ── Operational events (live feed + audit) ──────────────────────────────────
export const operationalEventsTable = pgTable("operational_events", {
  id: serial("id").primaryKey(),
  kind: text("kind").notNull(),
  severity: text("severity").notNull().default("info"), // info | warn | critical
  title: text("title").notNull(),
  body: text("body").notNull().default(""),
  agentKey: text("agent_key"),
  actor: text("actor"), // agent:x | user:<id> | system
  refType: text("ref_type"),
  refId: text("ref_id"),
  taskRunId: integer("task_run_id"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});
export type OperationalEvent = typeof operationalEventsTable.$inferSelect;

// ── AI agent task runs ───────────────────────────────────────────────────────
export const agentTaskRunsTable = pgTable("agent_task_runs", {
  id: serial("id").primaryKey(),
  agentKey: text("agent_key").notNull(),
  // working | completed | error | waiting_approval
  status: text("status").notNull().default("working"),
  task: text("task").notNull().default(""),
  objective: text("objective"),
  refType: text("ref_type"),
  refId: text("ref_id"),
  facts: text("facts"),          // JSON string: observations / data used
  summary: text("summary"),      // concise decision summary (LLM or templated)
  proposedAction: text("proposed_action"),
  outcome: text("outcome"),
  error: text("error"),
  startedAt: timestamp("started_at", { withTimezone: true }).notNull().defaultNow(),
  finishedAt: timestamp("finished_at", { withTimezone: true }),
});
export type AgentTaskRun = typeof agentTaskRunsTable.$inferSelect;

// ── Approval queue ───────────────────────────────────────────────────────────
export const approvalsTable = pgTable("approvals", {
  id: serial("id").primaryKey(),
  agentKey: text("agent_key").notNull(),
  // aircraft_swap | route_change | flight_cancel | clear_hold | other
  actionType: text("action_type").notNull(),
  title: text("title").notNull(),
  reason: text("reason"),
  payload: text("payload"),      // JSON: what to do if approved
  affected: text("affected"),    // JSON: records impacted
  validation: text("validation"),// JSON: checks run
  // pending | approved | rejected | applied | failed
  status: text("status").notNull().default("pending"),
  decidedByUserId: integer("decided_by_user_id"),
  decidedAt: timestamp("decided_at", { withTimezone: true }),
  appliedAt: timestamp("applied_at", { withTimezone: true }),
  note: text("note"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});
export type Approval = typeof approvalsTable.$inferSelect;

// ── Agent runtime state (pause + auto-action config) ────────────────────────
// agentKey "global" holds the emergency-pause flag for all autonomous actions.
// ── Maintenance engine: repair jobs + parts inventory ──────────────────────
export const maintenanceJobsTable = pgTable("maintenance_jobs", {
  id: serial("id").primaryKey(),
  registration: text("registration").notNull(),
  reportId: integer("report_id"),
  category: text("category").notNull().default("other"),
  part: text("part"),
  repairMinutes: integer("repair_minutes").notNull().default(180),
  // deferred | awaiting_part | in_repair | done
  phase: text("phase").notNull().default("in_repair"),
  etaAt: timestamp("eta_at", { withTimezone: true }),
  location: text("location"),
  orderedSpares: integer("ordered_spares").notNull().default(0),
  note: text("note"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
});
export type MaintenanceJob = typeof maintenanceJobsTable.$inferSelect;

export const partsInventoryTable = pgTable("parts_inventory", {
  part: text("part").primaryKey(),
  qty: integer("qty").notNull().default(0),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
});
export type PartsInventory = typeof partsInventoryTable.$inferSelect;

export const agentStateTable = pgTable("agent_state", {
  agentKey: text("agent_key").primaryKey(),
  paused: boolean("paused").notNull().default(false),
  autoApprove: text("auto_approve").notNull().default("[]"), // JSON array of actionTypes allowed to auto-run
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
});
export type AgentState = typeof agentStateTable.$inferSelect;
