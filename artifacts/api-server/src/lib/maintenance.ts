// Autonomous maintenance engine. The maintenance agent reads each hold, works
// out the repair (replacement time for the part + 3h), sources the part from
// inventory (ordering 3 and waiting for a factory ferry delivery if out of
// stock), defers work while the aircraft still has sectors to fly, then — when
// the repair ETA passes — returns the aircraft to service automatically.
//
// Numbers are a reasonable simulation, not real engineering data.
import {
  db, eq, and, inArray, lte, sql,
  maintenanceReportsTable, maintenanceJobsTable, partsInventoryTable,
  aircraftTable, aircraftAssignmentsTable, timetableTable, opsSettingsTable,
} from "@workspace/db";
import { runAgentTask, logEvent, isPaused } from "./ops-core";
import { clearHold } from "./fleet";

// Base replacement time (minutes) per issue category; +3h is added on top.
const REPAIR_BASE: Record<string, { minutes: number; part: string | null }> = {
  door: { minutes: 240, part: "cabin door" },
  engine: { minutes: 600, part: "engine module" },
  landing_gear: { minutes: 420, part: "gear actuator" },
  controls: { minutes: 300, part: "flight-control unit" },
  electrical: { minutes: 180, part: "avionics LRU" },
  fmc: { minutes: 150, part: "FMC display unit" },
  other: { minutes: 120, part: null },
};
const BUFFER_MIN = 180; // + 3h
const MAINT_BASES = ["YSSY", "YBBN", "YPPH", "YMML"];

// Real time by default: one quoted minute of repair/ferry is one real minute.
// Override with MAINT_MINUTE_MS (e.g. 1000 = 60× faster) if you want to watch a
// whole cycle quickly.
export const MAINT_MINUTE_MS = Number(process.env.MAINT_MINUTE_MS) || 60_000;

// ── Operational settings (key/value) ────────────────────────────────────────
export async function getSetting(key: string): Promise<string | null> {
  const [r] = await db.select().from(opsSettingsTable).where(eq(opsSettingsTable.key, key));
  return r?.value ?? null;
}
export async function setSetting(key: string, value: string): Promise<void> {
  await db.insert(opsSettingsTable).values({ key, value, updatedAt: new Date() })
    .onConflictDoUpdate({ target: opsSettingsTable.key, set: { value, updatedAt: new Date() } });
}
// When on, parts are available immediately — the factory-ferry delivery wait is
// skipped — but the repair itself still runs in real time.
export async function skipDelivery(): Promise<boolean> {
  return (await getSetting("skip_delivery_time")) === "1";
}

// Map a free-text category/description to a repair profile + keyword flags.
function classify(category: string, description: string): { key: string; profile: { minutes: number; part: string | null }; unfit: boolean; returned: boolean } {
  const s = `${category} ${description}`.toLowerCase();
  let key = "other";
  if (/door/.test(s)) key = "door";
  else if (/engine|thrust|n1|egt/.test(s)) key = "engine";
  else if (/gear|tyre|tire|brake/.test(s)) key = "landing_gear";
  else if (/flap|slat|rudder|aileron|elevator|control/.test(s)) key = "controls";
  else if (/electric|avionic|battery|generator/.test(s)) key = "electrical";
  else if (/fmc|mcdu|screen|display|cdu/.test(s)) key = "fmc";
  const unfit = /inop|unable|unserviceable|u\/s|fail|crack|smoke|fire|leak/.test(s);
  const returned = /return(ed)? to (the )?(airport|field|stand|gate)|air return|divert/.test(s);
  return { key, profile: REPAIR_BASE[key] ?? REPAIR_BASE.other, unfit, returned };
}

function ferryDeliveryMinutes(acType: string): number {
  const base = acType === "B788" ? 9 * 60 : 10 * 60; // Boeing 9h, Airbus 10h
  const jitter = Math.round((Math.random() * 2 - 1) * 60); // ±1h
  return base + 120 + jitter; // + 2h handling
}

async function stock(part: string): Promise<number> {
  const [r] = await db.select().from(partsInventoryTable).where(eq(partsInventoryTable.part, part));
  return r?.qty ?? 0;
}
async function addStock(part: string, delta: number): Promise<void> {
  await db.insert(partsInventoryTable).values({ part, qty: Math.max(0, delta), updatedAt: new Date() })
    .onConflictDoUpdate({ target: partsInventoryTable.part, set: { qty: sql`GREATEST(0, ${partsInventoryTable.qty} + ${delta})`, updatedAt: new Date() } });
}

async function hasOpenSectors(registration: string): Promise<boolean> {
  const assigns = await db.select().from(aircraftAssignmentsTable)
    .where(and(eq(aircraftAssignmentsTable.registration, registration), eq(aircraftAssignmentsTable.status, "assigned")));
  for (const a of assigns) {
    if (a.timetableId == null) continue;
    const [tt] = await db.select().from(timetableTable).where(eq(timetableTable.id, a.timetableId));
    if (tt && (tt.status === "pending" || tt.status === "active")) return true;
  }
  return false;
}

// Create jobs for new holds, advance in-flight jobs, and auto-return aircraft.
export async function maintenanceTick(): Promise<void> {
  if (await isPaused("maintenance")) return;
  await runAgentTask("maintenance", "Work maintenance holds", async ({ taskRunId }) => {
    const now = Date.now();
    const skip = await skipDelivery(); // parts arrive instantly when on (repair stays real-time)
    let opened = 0, ordered = 0, deferred = 0, completed = 0;

    // 1) Open a job for any held report that doesn't have one yet.
    const held = await db.select().from(maintenanceReportsTable).where(eq(maintenanceReportsTable.holdActive, true));
    for (const rep of held) {
      const [existing] = await db.select().from(maintenanceJobsTable)
        .where(and(eq(maintenanceJobsTable.reportId, rep.id), inArray(maintenanceJobsTable.phase, ["deferred", "awaiting_part", "in_repair"])));
      if (existing) continue;
      const [ac] = await db.select().from(aircraftTable).where(eq(aircraftTable.registration, rep.registration));
      const acType = ac?.type ?? "A320";
      const { key, profile } = classify(rep.category, rep.description);
      const repairMinutes = profile.minutes + BUFFER_MIN;
      const grounded = ac?.status === "grounded";

      // Defer the repair while the aircraft still has sectors to fly (unless grounded).
      if (!grounded && await hasOpenSectors(rep.registration)) {
        await db.insert(maintenanceJobsTable).values({ registration: rep.registration, reportId: rep.id, category: key, part: profile.part, repairMinutes, phase: "deferred", note: "waiting for the aircraft to finish its sectors" });
        deferred++; continue;
      }

      // Source the part.
      let phase = "in_repair", eta = now + repairMinutes * MAINT_MINUTE_MS, orderedSpares = 0, note = "";
      if (profile.part) {
        const have = await stock(profile.part);
        if (have > 0) {
          await addStock(profile.part, -1);
        } else if (skip) {
          // Delivery skipped: part is on hand immediately, repair runs in real time.
          orderedSpares = 2; // the rest of the batch is shelved on completion
          note = `${profile.part} fitted immediately (delivery skipped); ${Math.round(repairMinutes / 60)}h repair`;
        } else {
          const delivery = ferryDeliveryMinutes(acType);
          phase = "awaiting_part"; eta = now + (delivery + repairMinutes) * MAINT_MINUTE_MS; orderedSpares = 2; // order 3, use 1, 2 spare
          note = `ordered 3× ${profile.part}; factory ferry ~${Math.round(delivery / 60)}h, then ${Math.round(repairMinutes / 60)}h repair`;
          ordered++;
          await logEvent({ kind: "report_created", severity: "warn", agentKey: "maintenance", title: `Part on order — ${rep.registration}`, body: `${profile.part} out of stock. Ordered 3; ETA ~${Math.round((delivery + repairMinutes) / 60)}h.`, refType: "maintenance_report", refId: rep.id, taskRunId });
        }
      }
      await db.insert(maintenanceJobsTable).values({ registration: rep.registration, reportId: rep.id, category: key, part: profile.part, repairMinutes, phase, etaAt: new Date(eta), orderedSpares, note });
      opened++;
      await logEvent({ kind: "report_created", agentKey: "maintenance", title: `Repair started — ${rep.registration}`, body: `${key.replace("_", " ")} · ${Math.round(repairMinutes / 60)}h${profile.part ? ` · part: ${profile.part}` : ""}`, refType: "maintenance_report", refId: rep.id, taskRunId });
    }

    // 2) Promote deferred jobs whose aircraft are now free.
    const deferredJobs = await db.select().from(maintenanceJobsTable).where(eq(maintenanceJobsTable.phase, "deferred"));
    for (const j of deferredJobs) {
      const [ac] = await db.select().from(aircraftTable).where(eq(aircraftTable.registration, j.registration));
      if (ac?.status !== "grounded" && await hasOpenSectors(j.registration)) continue;
      let phase = "in_repair", eta = now + j.repairMinutes * MAINT_MINUTE_MS, orderedSpares = 0;
      if (j.part) {
        const have = await stock(j.part);
        if (have > 0) await addStock(j.part, -1);
        else if (skip) { orderedSpares = 2; } // part on hand immediately; repair real-time
        else { const delivery = ferryDeliveryMinutes(ac?.type ?? "A320"); phase = "awaiting_part"; eta = now + (delivery + j.repairMinutes) * MAINT_MINUTE_MS; orderedSpares = 2; ordered++; }
      }
      await db.update(maintenanceJobsTable).set({ phase, etaAt: new Date(eta), orderedSpares, updatedAt: new Date() }).where(eq(maintenanceJobsTable.id, j.id));
    }

    // 3) Complete jobs whose ETA has passed → return aircraft to service.
    const due = await db.select().from(maintenanceJobsTable)
      .where(and(inArray(maintenanceJobsTable.phase, ["in_repair", "awaiting_part"]), lte(maintenanceJobsTable.etaAt, new Date())));
    for (const j of due) {
      if (j.orderedSpares > 0 && j.part) await addStock(j.part, j.orderedSpares); // spares land with the delivery
      await clearHold(j.registration, { userId: 0, reason: `Repair complete (${j.category.replace("_", " ")})`, reportId: j.reportId ?? undefined });
      if (j.reportId != null) await db.update(maintenanceReportsTable).set({ status: "resolved", findings: `Auto-repaired: ${j.category.replace("_", " ")}${j.part ? ` (${j.part} replaced)` : ""}`, updatedAt: new Date() }).where(eq(maintenanceReportsTable.id, j.reportId));
      await db.update(maintenanceJobsTable).set({ phase: "done", updatedAt: new Date() }).where(eq(maintenanceJobsTable.id, j.id));
      completed++;
      await logEvent({ kind: "audit", agentKey: "maintenance", title: `${j.registration} back in service`, body: `${j.category.replace("_", " ")} repaired.`, refType: "aircraft", refId: j.registration });
    }

    const active = await db.select().from(maintenanceJobsTable).where(inArray(maintenanceJobsTable.phase, ["deferred", "awaiting_part", "in_repair"]));
    const facts = { held: held.length, opened, ordered, deferred, completed, active: active.length };
    return { facts, summary: `Worked ${held.length} hold(s): ${opened} new repair(s), ${ordered} part order(s), ${completed} returned to service, ${active.length} in progress.`, outcome: `${completed} returned, ${active.length} active` };
  });
}

// Choose a maintenance base for a reposition (nearest-ish is out of scope; pick a base).
export function maintenanceBaseFor(_registration: string): string { return MAINT_BASES[0]; }
