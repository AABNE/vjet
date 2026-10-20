// The operations monitor — a background tick that runs the rule-based agents:
// flight monitoring + delay detection, dispatch checks, and fleet conflict
// detection. Everything it does is logged as agent task runs + operational
// events so the AI Control Room can show it. Idempotent (dedupe keys), safe to
// run repeatedly, and respects the global/agent pause flags.
import {
  db, eq, and, inArray,
  delayReportsTable, dispatchRecordsTable, aircraftAssignmentsTable,
  timetableTable,
} from "@workspace/db";
import { logger } from "./logger";
import { collectTracking, type TrackedFlight } from "./tracking";
import { runAgentTask, logEvent, isPaused, aiSummarize } from "./ops-core";
import { notify } from "./ops";
import { refreshAirports, getWeather, isAdverse } from "./weather";
import { opsManagerReview } from "./approvals";
import { maintenanceTick } from "./maintenance";

const TICK_MS = 10_000;

// ── Flight monitoring + automated delay reports ─────────────────────────────
async function flightMonitorTick(): Promise<void> {
  if (await isPaused("flight-monitor")) return;
  await runAgentTask("flight-monitor", "Scan tracking + schedule for delays", async ({ taskRunId }) => {
    const tracks = await collectTracking();
    const delayed = tracks.filter((t) => t.status === "confirmed_delay" || t.status === "possible_delay");
    const unavailable = tracks.filter((t) => t.status === "tracking_unavailable");

    let created = 0, updated = 0, notified = 0;
    for (const t of delayed) {
      const changed = await upsertDelay(t, taskRunId);
      if (changed === "created") { created++; if (t.status === "confirmed_delay") notified += await pageDelay(t); }
      else if (changed === "updated") updated++;
    }

    // Close delay reports for sectors that have since completed.
    const completed = await db.select().from(timetableTable).where(eq(timetableTable.status, "completed"));
    for (const c of completed) {
      await db.update(delayReportsTable)
        .set({ status: "closed", updatedAt: new Date() })
        .where(and(eq(delayReportsTable.timetableId, c.id), inArray(delayReportsTable.status, ["draft", "notified"])));
    }

    const facts = {
      tracked: tracks.length,
      confirmedDelays: delayed.filter((d) => d.status === "confirmed_delay").length,
      possibleDelays: delayed.filter((d) => d.status === "possible_delay").length,
      trackingUnavailable: unavailable.length,
      reportsCreated: created, reportsUpdated: updated, pilotsNotified: notified,
    };
    const fallback = `Scanned ${tracks.length} sector(s): ${facts.confirmedDelays} confirmed, ${facts.possibleDelays} possible delays; ${created} report(s) raised.`;
    const summary = (created || facts.confirmedDelays)
      ? await aiSummarize("flight-monitor", `Flight monitor results: ${JSON.stringify(facts)}. One sentence.`, fallback)
      : fallback;
    return { facts, summary, outcome: `${created} created, ${updated} updated, ${notified} notified` };
  });
}

async function upsertDelay(t: TrackedFlight, taskRunId: number): Promise<"created" | "updated" | "noop"> {
  const dedupeKey = `delay:${t.timetableId}`;
  const [existing] = await db.select().from(delayReportsTable).where(eq(delayReportsTable.dedupeKey, dedupeKey));
  const category = t.flightStatus.toLowerCase() === "active" ? "late_inbound" : "unknown";
  if (!existing) {
    await db.insert(delayReportsTable).values({
      timetableId: t.timetableId, flightId: t.flightId, pilotUserId: t.pilotUserId,
      scheduledDepAt: t.scheduledDepAt, estimatedAt: t.estimatedArrAt,
      delayMinutes: t.delayMinutes, category, status: "draft",
      createdBy: "agent:flight-monitor", dedupeKey,
    }).onConflictDoNothing();
    await logEvent({
      kind: "delay_detected", severity: t.status === "confirmed_delay" ? "warn" : "info",
      title: `${t.status === "confirmed_delay" ? "Confirmed" : "Possible"} delay — ${t.flightNumber}`,
      body: `${t.departure}→${t.arrival}, ~${t.delayMinutes ?? "?"} min. Cause not yet confirmed.`,
      agentKey: "flight-monitor", refType: "delay_report", refId: t.timetableId, taskRunId,
    });
    return "created";
  }
  if (existing.status === "closed") return "noop";
  if ((existing.delayMinutes ?? 0) !== (t.delayMinutes ?? 0)) {
    await db.update(delayReportsTable)
      .set({ delayMinutes: t.delayMinutes, estimatedAt: t.estimatedArrAt, updatedAt: new Date() })
      .where(eq(delayReportsTable.id, existing.id));
    return "updated";
  }
  return "noop";
}

// Page the pilot once when a confirmed delay report is first raised.
async function pageDelay(t: TrackedFlight): Promise<number> {
  await notify(t.pilotUserId, "ops", `Delay logged — ${t.flightNumber}`,
    `Ops has logged a delay on ${t.departure}→${t.arrival} (about ${t.delayMinutes ?? "?"} min). Open My Paperwork to confirm the cause.`);
  return 1;
}

// ── Dispatch checks ──────────────────────────────────────────────────────────
async function dispatchTick(): Promise<void> {
  if (await isPaused("dispatch")) return;
  await runAgentTask("dispatch", "Review dispatch readiness", async () => {
    const open = await db.select().from(timetableTable).where(inArray(timetableTable.status, ["pending", "active"]));
    let ensured = 0, held = 0;
    for (const e of open) {
      const [rec] = await db.select().from(dispatchRecordsTable).where(eq(dispatchRecordsTable.timetableId, e.id));
      const [assign] = await db.select().from(aircraftAssignmentsTable)
        .where(and(eq(aircraftAssignmentsTable.timetableId, e.id), eq(aircraftAssignmentsTable.status, "assigned")));
      if (!rec) {
        await db.insert(dispatchRecordsTable).values({
          timetableId: e.id, flightId: e.flightId, registration: assign?.registration ?? null, status: "draft",
        }).onConflictDoNothing();
        ensured++;
      }
    }
    return { facts: { openSectors: open.length, recordsEnsured: ensured, onHold: held }, summary: `Checked ${open.length} open sector(s); ensured ${ensured} dispatch record(s).`, outcome: "ok" };
  });
}

// ── Fleet conflict detection ────────────────────────────────────────────────
async function fleetTick(): Promise<void> {
  if (await isPaused("fleet-manager")) return;
  await runAgentTask("fleet-manager", "Check aircraft assignment conflicts", async ({ taskRunId }) => {
    const assigns = await db.select().from(aircraftAssignmentsTable).where(eq(aircraftAssignmentsTable.status, "assigned"));
    const byReg = new Map<string, number>();
    for (const a of assigns) byReg.set(a.registration, (byReg.get(a.registration) ?? 0) + 1);
    const conflicts = [...byReg.entries()].filter(([, n]) => n > 1).map(([reg]) => reg);
    for (const reg of conflicts) {
      await logEvent({
        kind: "schedule_conflict", severity: "warn", agentKey: "fleet-manager",
        title: `${reg} double-booked`, body: `${reg} is assigned to more than one open sector.`,
        refType: "aircraft", refId: reg, taskRunId,
      });
    }
    return { facts: { assignments: assigns.length, conflicts }, summary: conflicts.length ? `Found ${conflicts.length} aircraft double-booked.` : `No assignment conflicts across ${assigns.length} assignment(s).`, outcome: `${conflicts.length} conflict(s)` };
  });
}

// ── Weather watch ────────────────────────────────────────────────────────────
const lastWeatherAlert = new Map<string, number>(); // icao → last alert ms
const WEATHER_ALERT_GAP = 2 * 60 * 60_000;
async function weatherTick(): Promise<void> {
  if (await isPaused("flight-monitor")) return;
  const tracks = await collectTracking();
  if (tracks.length === 0) return;
  const codes = [...new Set(tracks.flatMap((t) => [t.departure, t.arrival]))];
  await refreshAirports(codes);
  for (const code of codes) {
    const w = await getWeather(code);
    if (!w) continue;
    const { adverse, reasons } = isAdverse(w);
    if (!adverse) continue;
    const last = lastWeatherAlert.get(w.icao) ?? 0;
    if (Date.now() - last < WEATHER_ALERT_GAP) continue;
    lastWeatherAlert.set(w.icao, Date.now());
    await logEvent({
      kind: "report_created", severity: "warn", agentKey: "flight-monitor",
      title: `Adverse weather — ${w.iata ?? w.icao}`,
      body: `${reasons.join(", ")}. ${w.metarRaw ?? ""}`.slice(0, 280),
      refType: "aircraft", refId: w.icao,
    });
  }
}

async function tick(): Promise<void> {
  if (await isPaused("global")) return;
  await flightMonitorTick();
  await dispatchTick();
  await fleetTick();
  await weatherTick();
  // Operations Manager clears the approval queue autonomously — the human never
  // needs to action it.
  if (!(await isPaused("ops-manager"))) await opsManagerReview();
}

// Maintenance runs on its own, faster cadence so grounded aircraft are worked
// and returned to service promptly (the compressed repair clock resolves in
// minutes). Kept separate from the main tick so the two never run it at once.
const MAINT_TICK_MS = 15_000;
let maintBusy = false;
async function maintLoop(): Promise<void> {
  if (maintBusy) return;
  maintBusy = true;
  try { await maintenanceTick(); }
  catch (err) { logger.error({ err }, "maintenance tick failed"); }
  finally { maintBusy = false; }
}

export function startOpsMonitor(): void {
  const run = () => tick().catch((err) => logger.error({ err }, "ops-monitor tick failed"));
  run();
  setInterval(run, TICK_MS);
  void maintLoop();
  setInterval(() => void maintLoop(), MAINT_TICK_MS);
  logger.info({ everyMs: TICK_MS, maintEveryMs: MAINT_TICK_MS }, "ops-monitor started");
}
