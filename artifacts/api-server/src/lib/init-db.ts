import { pool } from "@workspace/db";
import { logger } from "./logger";
import bcrypt from "bcryptjs";
import { LIVERY_REGOS, RESERVE_PLAN } from "../data/livery-regos";

export async function initDb(): Promise<void> {
  const client = await pool.connect();
  try {
    // Create tables if not exists
    await client.query(`
      CREATE TABLE IF NOT EXISTS "users" (
        "id"                  SERIAL PRIMARY KEY,
        "username"            TEXT NOT NULL UNIQUE,
        "password_hash"       TEXT NOT NULL,
        "aircraft"            TEXT NOT NULL DEFAULT 'A320',
        "simulator_version"   TEXT NOT NULL DEFAULT 'MSFS2024',
        "simbrief_username"   TEXT,
        "is_admin"            TEXT NOT NULL DEFAULT 'false',
        "has_seen_tutorial"   TEXT NOT NULL DEFAULT 'false',
        "must_change_password" TEXT NOT NULL DEFAULT 'false',
        "sim_hours"           DOUBLE PRECISION NOT NULL DEFAULT 0,
        "created_at"          TIMESTAMPTZ NOT NULL DEFAULT NOW()
      );

      ALTER TABLE "users" ADD COLUMN IF NOT EXISTS "sim_hours" DOUBLE PRECISION NOT NULL DEFAULT 0;
      ALTER TABLE "users" ADD COLUMN IF NOT EXISTS "simbrief_username" TEXT;
      ALTER TABLE "users" ADD COLUMN IF NOT EXISTS "simulator_version" TEXT NOT NULL DEFAULT 'MSFS2024';
      ALTER TABLE "users" ADD COLUMN IF NOT EXISTS "has_seen_tutorial" TEXT NOT NULL DEFAULT 'false';
      ALTER TABLE "users" ADD COLUMN IF NOT EXISTS "must_change_password" TEXT NOT NULL DEFAULT 'false';
      ALTER TABLE "users" ADD COLUMN IF NOT EXISTS "last_seen_at" TIMESTAMPTZ;
      ALTER TABLE "users" ADD COLUMN IF NOT EXISTS "msfs_running" BOOLEAN NOT NULL DEFAULT FALSE;
      ALTER TABLE "users" ADD COLUMN IF NOT EXISTS "tracking_method" TEXT NOT NULL DEFAULT 'simlink';
      ALTER TABLE "users" ADD COLUMN IF NOT EXISTS "volanta_username" TEXT;
      ALTER TABLE "users" ADD COLUMN IF NOT EXISTS "discord_id" TEXT;
      ALTER TABLE "users" ADD COLUMN IF NOT EXISTS "route_continuity" BOOLEAN NOT NULL DEFAULT FALSE;

      CREATE TABLE IF NOT EXISTS "flights" (
        "id"               SERIAL PRIMARY KEY,
        "flight_number"    TEXT NOT NULL,
        "departure"        TEXT NOT NULL,
        "arrival"          TEXT NOT NULL,
        "aircraft"         TEXT NOT NULL,
        "departure_time"   TEXT NOT NULL,
        "flight_date"      TEXT NOT NULL,
        "duration_minutes" INTEGER NOT NULL,
        "departs_at"       TIMESTAMPTZ,
        "created_at"       TIMESTAMPTZ NOT NULL DEFAULT NOW()
      );

      ALTER TABLE "flights" ADD COLUMN IF NOT EXISTS "departs_at" TIMESTAMPTZ;
      ALTER TABLE "flights" ADD COLUMN IF NOT EXISTS "registration" TEXT;

      CREATE TABLE IF NOT EXISTS "timetable" (
        "id"                      SERIAL PRIMARY KEY,
        "user_id"                 INTEGER NOT NULL REFERENCES "users"("id") ON DELETE CASCADE,
        "flight_id"               INTEGER NOT NULL REFERENCES "flights"("id") ON DELETE CASCADE,
        "status"                  TEXT NOT NULL DEFAULT 'pending',
        "started_at"              TIMESTAMPTZ,
        "finished_at"             TIMESTAMPTZ,
        "flight_duration_seconds" INTEGER,
        "flag_reason"             TEXT,
        "approved_by_admin"       BOOLEAN NOT NULL DEFAULT FALSE,
        "created_at"              TIMESTAMPTZ NOT NULL DEFAULT NOW()
      );

      ALTER TABLE "timetable" ADD COLUMN IF NOT EXISTS "flag_reason" TEXT;
      ALTER TABLE "timetable" ADD COLUMN IF NOT EXISTS "approved_by_admin" BOOLEAN NOT NULL DEFAULT FALSE;
      ALTER TABLE "timetable" ADD COLUMN IF NOT EXISTS "dispatch_status" TEXT NOT NULL DEFAULT 'none';
      ALTER TABLE "timetable" ADD COLUMN IF NOT EXISTS "briefing" TEXT;
      ALTER TABLE "timetable" ADD COLUMN IF NOT EXISTS "pushback_violation" BOOLEAN NOT NULL DEFAULT FALSE;
      ALTER TABLE "timetable" ADD COLUMN IF NOT EXISTS "no_show_notified" BOOLEAN NOT NULL DEFAULT FALSE;

      CREATE TABLE IF NOT EXISTS "session" (
        "sid"    VARCHAR NOT NULL COLLATE "default",
        "sess"   JSON NOT NULL,
        "expire" TIMESTAMP(6) NOT NULL,
        CONSTRAINT "session_pkey" PRIMARY KEY ("sid") NOT DEFERRABLE INITIALLY IMMEDIATE
      );

      CREATE INDEX IF NOT EXISTS "IDX_session_expire" ON "session" ("expire");

      CREATE TABLE IF NOT EXISTS "applications" (
        "discord_id" TEXT PRIMARY KEY,
        "username"   TEXT NOT NULL,
        "aircraft"   TEXT NOT NULL DEFAULT '',
        "email"      TEXT,
        "cid"        TEXT,
        "status"     TEXT NOT NULL DEFAULT 'pending',
        "created_at" TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        "decided_at" TIMESTAMPTZ
      );
      ALTER TABLE "applications" ADD COLUMN IF NOT EXISTS "tracking_method" TEXT NOT NULL DEFAULT 'simlink';
      ALTER TABLE "applications" ADD COLUMN IF NOT EXISTS "volanta_username" TEXT;

      CREATE TABLE IF NOT EXISTS "notifications" (
        "id"         SERIAL PRIMARY KEY,
        "user_id"    INTEGER NOT NULL REFERENCES "users"("id") ON DELETE CASCADE,
        "kind"       TEXT NOT NULL DEFAULT 'info',
        "title"      TEXT NOT NULL,
        "body"       TEXT NOT NULL DEFAULT '',
        "read_at"    TIMESTAMPTZ,
        "created_at" TIMESTAMPTZ NOT NULL DEFAULT NOW()
      );
      CREATE INDEX IF NOT EXISTS "IDX_notifications_user" ON "notifications" ("user_id");

      CREATE TABLE IF NOT EXISTS "pilot_discipline" (
        "user_id"      INTEGER PRIMARY KEY REFERENCES "users"("id") ON DELETE CASCADE,
        "period_key"   TEXT NOT NULL DEFAULT '',
        "infractions"  INTEGER NOT NULL DEFAULT 0,
        "strikes"      INTEGER NOT NULL DEFAULT 0,
        "ban_level"    INTEGER NOT NULL DEFAULT 0,
        "banned_until" TIMESTAMPTZ
      );

      CREATE TABLE IF NOT EXISTS "pilot_infractions" (
        "id"         SERIAL PRIMARY KEY,
        "user_id"    INTEGER NOT NULL REFERENCES "users"("id") ON DELETE CASCADE,
        "type"       TEXT NOT NULL,
        "reason"     TEXT NOT NULL DEFAULT '',
        "created_at" TIMESTAMPTZ NOT NULL DEFAULT NOW()
      );
      CREATE INDEX IF NOT EXISTS "IDX_infractions_user" ON "pilot_infractions" ("user_id");

      -- ── Airline operations (ops) ──────────────────────────────────────────
      CREATE TABLE IF NOT EXISTS "aircraft" (
        "id"           SERIAL PRIMARY KEY,
        "registration" TEXT NOT NULL UNIQUE,
        "type"         TEXT NOT NULL,
        "status"       TEXT NOT NULL DEFAULT 'active',
        "note"         TEXT,
        "base"         TEXT,
        "created_at"   TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        "updated_at"   TIMESTAMPTZ NOT NULL DEFAULT NOW()
      );
      ALTER TABLE "aircraft" ADD COLUMN IF NOT EXISTS "base" TEXT;

      CREATE TABLE IF NOT EXISTS "aircraft_assignments" (
        "id"           SERIAL PRIMARY KEY,
        "timetable_id" INTEGER REFERENCES "timetable"("id") ON DELETE CASCADE,
        "flight_id"    INTEGER REFERENCES "flights"("id") ON DELETE CASCADE,
        "registration" TEXT NOT NULL,
        "status"       TEXT NOT NULL DEFAULT 'assigned',
        "reason"       TEXT,
        "assigned_by"  TEXT NOT NULL DEFAULT 'system',
        "created_at"   TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        "updated_at"   TIMESTAMPTZ NOT NULL DEFAULT NOW()
      );
      CREATE INDEX IF NOT EXISTS "IDX_assign_tt" ON "aircraft_assignments" ("timetable_id");

      CREATE TABLE IF NOT EXISTS "delay_reports" (
        "id"               SERIAL PRIMARY KEY,
        "timetable_id"     INTEGER,
        "flight_id"        INTEGER,
        "pilot_user_id"    INTEGER,
        "registration"     TEXT,
        "scheduled_dep_at" TIMESTAMPTZ,
        "estimated_at"     TIMESTAMPTZ,
        "delay_minutes"    INTEGER,
        "category"         TEXT NOT NULL DEFAULT 'unknown',
        "reason"           TEXT,
        "status"           TEXT NOT NULL DEFAULT 'draft',
        "created_by"       TEXT NOT NULL DEFAULT 'agent:flight-monitor',
        "dedupe_key"       TEXT UNIQUE,
        "created_at"       TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        "updated_at"       TIMESTAMPTZ NOT NULL DEFAULT NOW()
      );

      CREATE TABLE IF NOT EXISTS "maintenance_reports" (
        "id"                  SERIAL PRIMARY KEY,
        "registration"        TEXT NOT NULL,
        "reported_by_user_id" INTEGER,
        "flight_id"           INTEGER,
        "category"            TEXT NOT NULL DEFAULT 'other',
        "description"         TEXT NOT NULL DEFAULT '',
        "phase"               TEXT NOT NULL DEFAULT 'unknown',
        "request_restriction" BOOLEAN NOT NULL DEFAULT FALSE,
        "status"              TEXT NOT NULL DEFAULT 'submitted',
        "priority"            TEXT NOT NULL DEFAULT 'normal',
        "reviewer_user_id"    INTEGER,
        "findings"            TEXT,
        "hold_active"         BOOLEAN NOT NULL DEFAULT FALSE,
        "cleared_by_user_id"  INTEGER,
        "cleared_at"          TIMESTAMPTZ,
        "clear_reason"        TEXT,
        "created_at"          TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        "updated_at"          TIMESTAMPTZ NOT NULL DEFAULT NOW()
      );
      CREATE INDEX IF NOT EXISTS "IDX_maint_reg" ON "maintenance_reports" ("registration");

      CREATE TABLE IF NOT EXISTS "dispatch_records" (
        "id"                 SERIAL PRIMARY KEY,
        "timetable_id"       INTEGER UNIQUE,
        "flight_id"          INTEGER,
        "registration"       TEXT,
        "status"             TEXT NOT NULL DEFAULT 'draft',
        "notes"              TEXT,
        "reviewed_by_user_id" INTEGER,
        "created_at"         TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        "updated_at"         TIMESTAMPTZ NOT NULL DEFAULT NOW()
      );

      CREATE TABLE IF NOT EXISTS "operational_events" (
        "id"          SERIAL PRIMARY KEY,
        "kind"        TEXT NOT NULL,
        "severity"    TEXT NOT NULL DEFAULT 'info',
        "title"       TEXT NOT NULL,
        "body"        TEXT NOT NULL DEFAULT '',
        "agent_key"   TEXT,
        "actor"       TEXT,
        "ref_type"    TEXT,
        "ref_id"      TEXT,
        "task_run_id" INTEGER,
        "created_at"  TIMESTAMPTZ NOT NULL DEFAULT NOW()
      );
      CREATE INDEX IF NOT EXISTS "IDX_opsevents_created" ON "operational_events" ("created_at");

      CREATE TABLE IF NOT EXISTS "agent_task_runs" (
        "id"              SERIAL PRIMARY KEY,
        "agent_key"       TEXT NOT NULL,
        "status"          TEXT NOT NULL DEFAULT 'working',
        "task"            TEXT NOT NULL DEFAULT '',
        "objective"       TEXT,
        "ref_type"        TEXT,
        "ref_id"          TEXT,
        "facts"           TEXT,
        "summary"         TEXT,
        "proposed_action" TEXT,
        "outcome"         TEXT,
        "error"           TEXT,
        "started_at"      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        "finished_at"     TIMESTAMPTZ
      );
      CREATE INDEX IF NOT EXISTS "IDX_taskruns_agent" ON "agent_task_runs" ("agent_key");

      CREATE TABLE IF NOT EXISTS "approvals" (
        "id"                SERIAL PRIMARY KEY,
        "agent_key"         TEXT NOT NULL,
        "action_type"       TEXT NOT NULL,
        "title"             TEXT NOT NULL,
        "reason"            TEXT,
        "payload"           TEXT,
        "affected"          TEXT,
        "validation"        TEXT,
        "status"            TEXT NOT NULL DEFAULT 'pending',
        "decided_by_user_id" INTEGER,
        "decided_at"        TIMESTAMPTZ,
        "applied_at"        TIMESTAMPTZ,
        "note"              TEXT,
        "created_at"        TIMESTAMPTZ NOT NULL DEFAULT NOW()
      );

      CREATE TABLE IF NOT EXISTS "maintenance_jobs" (
        "id"             SERIAL PRIMARY KEY,
        "registration"   TEXT NOT NULL,
        "report_id"      INTEGER,
        "category"       TEXT NOT NULL DEFAULT 'other',
        "part"           TEXT,
        "repair_minutes" INTEGER NOT NULL DEFAULT 180,
        "phase"          TEXT NOT NULL DEFAULT 'in_repair',
        "eta_at"         TIMESTAMPTZ,
        "location"       TEXT,
        "ordered_spares" INTEGER NOT NULL DEFAULT 0,
        "note"           TEXT,
        "created_at"     TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        "updated_at"     TIMESTAMPTZ NOT NULL DEFAULT NOW()
      );
      CREATE INDEX IF NOT EXISTS "IDX_maintjobs_reg" ON "maintenance_jobs" ("registration");

      CREATE TABLE IF NOT EXISTS "parts_inventory" (
        "part"       TEXT PRIMARY KEY,
        "qty"        INTEGER NOT NULL DEFAULT 0,
        "updated_at" TIMESTAMPTZ NOT NULL DEFAULT NOW()
      );

      CREATE TABLE IF NOT EXISTS "agent_state" (
        "agent_key"    TEXT PRIMARY KEY,
        "paused"       BOOLEAN NOT NULL DEFAULT FALSE,
        "auto_approve" TEXT NOT NULL DEFAULT '[]',
        "manual_actions" TEXT NOT NULL DEFAULT '[]',
        "updated_at"   TIMESTAMPTZ NOT NULL DEFAULT NOW()
      );
      ALTER TABLE "agent_state" ADD COLUMN IF NOT EXISTS "manual_actions" TEXT NOT NULL DEFAULT '[]';

      CREATE TABLE IF NOT EXISTS "ops_settings" (
        "key"        TEXT PRIMARY KEY,
        "value"      TEXT NOT NULL DEFAULT '',
        "updated_at" TIMESTAMPTZ NOT NULL DEFAULT NOW()
      );

      CREATE TABLE IF NOT EXISTS "ai_config" (
        "agent_key"         TEXT PRIMARY KEY,
        "provider"          TEXT NOT NULL DEFAULT 'openrouter',
        "model_id"          TEXT NOT NULL,
        "enabled"           BOOLEAN NOT NULL DEFAULT TRUE,
        "temperature"       DOUBLE PRECISION NOT NULL DEFAULT 0.4,
        "max_tokens"        INTEGER NOT NULL DEFAULT 500,
        "timeout_ms"        INTEGER NOT NULL DEFAULT 20000,
        "max_retries"       INTEGER NOT NULL DEFAULT 1,
        "fallback_model_id" TEXT,
        "updated_at"        TIMESTAMPTZ NOT NULL DEFAULT NOW()
      );

      CREATE TABLE IF NOT EXISTS "ai_usage" (
        "id"                SERIAL PRIMARY KEY,
        "agent_key"         TEXT NOT NULL,
        "model"             TEXT NOT NULL,
        "ok"                BOOLEAN NOT NULL DEFAULT TRUE,
        "latency_ms"        INTEGER,
        "prompt_tokens"     INTEGER,
        "completion_tokens" INTEGER,
        "error_code"        TEXT,
        "created_at"        TIMESTAMPTZ NOT NULL DEFAULT NOW()
      );
      CREATE INDEX IF NOT EXISTS "IDX_aiusage_agent" ON "ai_usage" ("agent_key");

      CREATE TABLE IF NOT EXISTS "weather_reports" (
        "icao"          TEXT PRIMARY KEY,
        "iata"          TEXT,
        "name"          TEXT,
        "metar_raw"     TEXT,
        "metar_json"    TEXT,
        "taf_raw"       TEXT,
        "observed_at"   TIMESTAMPTZ,
        "taf_issued_at" TIMESTAMPTZ,
        "fetched_at"    TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        "ok"            BOOLEAN NOT NULL DEFAULT TRUE
      );
    `);

    // Seed a virtual fleet (plausible Jetstar-style registrations) if empty.
    // Enough tails that the rotation solver can cover the daily schedule.
    const fleet = await client.query(`SELECT 1 FROM "aircraft" LIMIT 1`);
    if (fleet.rows.length === 0) {
      const seed: Array<[string, string]> = [];
      const gen = (prefix: string, letters: string, type: string) => {
        for (const l of letters) seed.push([`${prefix}${l}`, type]);
      };
      gen("VH-VG", "ABCDEFGHJKLMNP", "A320"); // 14 A320
      gen("VH-A5", "ABCDEFGHJK", "A20N");       // 10 A320neo
      gen("VH-OF", "ABCDEFGH", "A21N");         // 8 A321neo
      gen("VH-VK", "ABCDEF", "B788");           // 6 787-8
      for (const [reg, type] of seed) {
        await client.query(
          `INSERT INTO "aircraft" (registration, type) VALUES ($1, $2) ON CONFLICT (registration) DO NOTHING`,
          [reg, type],
        );
      }
      logger.info({ count: seed.length }, "Seeded virtual fleet");
    }

    // Always ensure the real livery registrations exist in the fleet (idempotent).
    let liveryAdded = 0;
    for (const [type, regos] of Object.entries(LIVERY_REGOS)) {
      for (const reg of regos) {
        const r = await client.query(
          `INSERT INTO "aircraft" (registration, type) VALUES ($1, $2) ON CONFLICT (registration) DO NOTHING`,
          [reg, type],
        );
        liveryAdded += r.rowCount ?? 0;
      }
    }
    if (liveryAdded) logger.info({ liveryAdded }, "Added livery registrations to fleet");

    // Park reserve aircraft on the ground across the network (idempotent &
    // deterministic): clear all bases, then assign the lowest free active tail of
    // each required type to each airport in the plan.
    await client.query(`UPDATE "aircraft" SET "base" = NULL`);
    let reservesSet = 0;
    for (const { base, type } of RESERVE_PLAN) {
      const { rows: pick } = await client.query(
        `SELECT registration FROM "aircraft" WHERE type = $1 AND status = 'active' AND "base" IS NULL ORDER BY registration LIMIT 1`,
        [type],
      );
      if (pick[0]) { await client.query(`UPDATE "aircraft" SET "base" = $2 WHERE registration = $1`, [pick[0].registration, base]); reservesSet++; }
    }
    logger.info({ reservesSet }, "Parked reserve aircraft across the network");

    // Seed default admin if no users exist
    const { rows } = await client.query(`SELECT id FROM "users" LIMIT 1`);
    if (rows.length === 0) {
      const hash = await bcrypt.hash("admin1234", 12);
      await client.query(
        `INSERT INTO "users" (username, password_hash, aircraft, simulator_version, is_admin, has_seen_tutorial, must_change_password)
         VALUES ($1, $2, $3, $4, $5, $6, $7)
         ON CONFLICT (username) DO NOTHING`,
        ["admin", hash, "A320,A20N,A21N,B788", "MSFS2024", "true", "false", "false"]
      );
      logger.info("Default admin created — username: admin / password: admin1234");
    }

    logger.info("Database initialised");
  } finally {
    client.release();
  }
}
