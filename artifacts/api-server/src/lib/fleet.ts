// Fleet + maintenance core: aircraft availability, assignments, and the
// precautionary virtual-maintenance-hold workflow. Backend-enforced — a held
// aircraft can never be assigned or marked dispatch-ready.
import {
  db, eq, and, gt,
  aircraftTable, aircraftAssignmentsTable, maintenanceReportsTable,
  dispatchRecordsTable, timetableTable, flightsTable,
} from "@workspace/db";
import { logEvent } from "./ops-core";
import { notify } from "./ops";

export async function isHeld(registration: string): Promise<boolean> {
  const [ac] = await db.select().from(aircraftTable).where(eq(aircraftTable.registration, registration));
  return !!ac && ac.status !== "active";
}

// An active aircraft of the given type that isn't held and isn't already
// assigned to an open sector.
export async function findReplacement(type: string, excludeReg?: string): Promise<string | null> {
  const fleet = await db.select().from(aircraftTable)
    .where(and(eq(aircraftTable.type, type), eq(aircraftTable.status, "active")));
  const openAssigns = await db.select().from(aircraftAssignmentsTable)
    .where(eq(aircraftAssignmentsTable.status, "assigned"));
  const busy = new Set(openAssigns.map((a) => a.registration));
  for (const ac of fleet) {
    if (excludeReg && ac.registration === excludeReg) continue;
    if (!busy.has(ac.registration)) return ac.registration;
  }
  return null;
}

// A genuine spare: an active aircraft of the type with NO upcoming flights at
// all (one of the tails the scheduler kept idle). Preferred for replacements.
export async function findSpare(type: string, excludeReg: string): Promise<string | null> {
  const fleet = await db.select().from(aircraftTable)
    .where(and(eq(aircraftTable.type, type), eq(aircraftTable.status, "active")));
  const now = new Date();
  for (const ac of fleet) {
    if (ac.registration === excludeReg) continue;
    const [busy] = await db.select().from(flightsTable)
      .where(and(eq(flightsTable.registration, ac.registration), gt(flightsTable.departsAt, now))).limit(1);
    if (!busy) return ac.registration;
  }
  return null;
}

// A logical replacement: an active aircraft of the type that is actually AT the
// departure airport at that time and free to fly the sector (no teleporting).
// Position is derived from its own rotation — where its last flight landed, or,
// if it has none yet, where its day starts.
const TURN_MS = 30 * 60_000;
export async function findReplacementAtAirport(
  type: string, airport: string, departMs: number, durationMin: number, excludeReg: string,
): Promise<string | null> {
  const fleet = await db.select().from(aircraftTable)
    .where(and(eq(aircraftTable.type, type), eq(aircraftTable.status, "active")));
  const winStart = departMs;
  const winEnd = departMs + (durationMin + 30) * 60_000;
  for (const ac of fleet) {
    if (ac.registration === excludeReg) continue;
    const fls = await db.select().from(flightsTable).where(eq(flightsTable.registration, ac.registration));
    const timeline = fls
      .filter((f) => f.departsAt)
      .map((f) => { const dep = new Date(f.departsAt as Date).getTime(); return { dep, end: dep + (f.durationMinutes ?? 0) * 60_000, from: f.departure, to: f.arrival }; })
      .sort((a, b) => a.dep - b.dep);
    // Busy if any of its flights overlaps the window (incl. turnaround).
    if (timeline.some((t) => t.dep < winEnd && t.end + TURN_MS > winStart)) continue;
    // Where is it at departMs? Last flight that landed (with turnaround) before then.
    let pos: string | null = null;
    for (const t of timeline) { if (t.end + TURN_MS <= departMs) pos = t.to; }
    if (pos === null && timeline.length) pos = timeline[0].from; // starts its day here
    if (pos === airport) return ac.registration;
  }
  return null;
}

// When an aircraft goes tech, move its upcoming booked sectors onto a spare, or
// cancel them if nothing's free. Only touches not-yet-started future flights.
export async function reassignOrCancel(registration: string, reason: string): Promise<{ reassigned: number; cancelled: number }> {
  const now = Date.now();
  const entries = await db.select().from(timetableTable).where(eq(timetableTable.status, "pending"));
  let reassigned = 0, cancelled = 0;
  for (const tt of entries) {
    const [f] = await db.select().from(flightsTable).where(eq(flightsTable.id, tt.flightId));
    if (!f) continue;
    const [asg] = await db.select().from(aircraftAssignmentsTable)
      .where(and(eq(aircraftAssignmentsTable.timetableId, tt.id), eq(aircraftAssignmentsTable.status, "assigned")));
    const eff = asg?.registration ?? f.registration ?? null;
    if (eff !== registration) continue;
    if (f.departsAt && new Date(f.departsAt).getTime() <= now) continue; // leave anything underway/past

    // Only swap to an aircraft actually at this flight's departure airport.
    const departMs = f.departsAt ? new Date(f.departsAt).getTime() : null;
    const repl = departMs != null
      ? await findReplacementAtAirport(f.aircraft, f.departure, departMs, f.durationMinutes, registration)
      : null;
    if (repl) {
      await assignAircraft({ timetableId: tt.id, flightId: f.id, registration: repl, by: "agent:fleet-manager", reason });
      await notify(tt.userId, "ops", `Aircraft change — ${f.flightNumber}`, `${registration} went tech; you've been moved to ${repl}. Same route and time.`);
      reassigned++;
    } else {
      await db.delete(timetableTable).where(eq(timetableTable.id, tt.id));
      await notify(tt.userId, "ops", `Flight cancelled — ${f.flightNumber}`, `${registration} went tech and no spare aircraft was free, so ${f.departure}-${f.arrival} is cancelled. Please pick another flight.`);
      cancelled++;
    }
  }
  if (reassigned || cancelled) {
    await logEvent({ kind: "swap_proposed", agentKey: "fleet-manager", title: `${registration} tech — ${reassigned} reassigned, ${cancelled} cancelled`, body: reason, refType: "aircraft", refId: registration });
  }
  return { reassigned, cancelled };
}

// Assign (or reassign) a registration to a timetable sector. Refuses a held
// aircraft. `by` is "user:<id>" or "agent:<key>".
export async function assignAircraft(
  opts: { timetableId: number; flightId: number; registration: string; by: string; reason?: string },
): Promise<{ ok: boolean; error?: string }> {
  if (await isHeld(opts.registration)) return { ok: false, error: "Aircraft is on a maintenance hold." };
  const [existing] = await db.select().from(aircraftAssignmentsTable)
    .where(and(eq(aircraftAssignmentsTable.timetableId, opts.timetableId), eq(aircraftAssignmentsTable.status, "assigned")));
  if (existing) {
    await db.update(aircraftAssignmentsTable)
      .set({ registration: opts.registration, reason: opts.reason ?? null, assignedBy: opts.by, updatedAt: new Date() })
      .where(eq(aircraftAssignmentsTable.id, existing.id));
  } else {
    await db.insert(aircraftAssignmentsTable).values({
      timetableId: opts.timetableId, flightId: opts.flightId, registration: opts.registration,
      assignedBy: opts.by, reason: opts.reason ?? null,
    });
  }
  return { ok: true };
}

// Upcoming (pending/active) sectors whose assigned aircraft is `registration`.
export async function sectorsForRegistration(registration: string) {
  const assigns = await db.select().from(aircraftAssignmentsTable)
    .where(and(eq(aircraftAssignmentsTable.registration, registration), eq(aircraftAssignmentsTable.status, "assigned")));
  const out = [];
  for (const a of assigns) {
    if (a.timetableId == null) continue;
    const [tt] = await db.select().from(timetableTable).where(eq(timetableTable.id, a.timetableId));
    if (!tt || (tt.status !== "pending" && tt.status !== "active")) continue;
    const [f] = await db.select().from(flightsTable).where(eq(flightsTable.id, tt.flightId));
    out.push({ assignment: a, timetable: tt, flight: f });
  }
  return out;
}

// Apply a precautionary hold. Grounds the aircraft, blocks dispatch-ready on its
// sectors, and returns the affected sectors for the fleet manager to act on.
export async function applyHold(
  registration: string,
  reason: string,
  ctx: { reportId?: number; actor: string },
): Promise<{ affected: Awaited<ReturnType<typeof sectorsForRegistration>> }> {
  await db.insert(aircraftTable).values({ registration, type: "UNKNOWN", status: "maintenance_hold", note: reason })
    .onConflictDoUpdate({ target: aircraftTable.registration, set: { status: "maintenance_hold", note: reason, updatedAt: new Date() } });

  if (ctx.reportId != null) {
    await db.update(maintenanceReportsTable)
      .set({ holdActive: true, status: "maintenance_hold", updatedAt: new Date() })
      .where(eq(maintenanceReportsTable.id, ctx.reportId));
  }

  const affected = await sectorsForRegistration(registration);

  // Any dispatch record on affected sectors drops to hold.
  for (const s of affected) {
    if (s.timetable.id != null) {
      await db.update(dispatchRecordsTable).set({ status: "hold", updatedAt: new Date() })
        .where(eq(dispatchRecordsTable.timetableId, s.timetable.id));
    }
  }

  await logEvent({
    kind: "aircraft_hold", severity: "critical", actor: ctx.actor, agentKey: "maintenance",
    title: `${registration} placed on maintenance hold`,
    body: `${reason}. ${affected.length} upcoming sector(s) affected.`,
    refType: "aircraft", refId: registration,
  });
  return { affected };
}

// Clear a hold — reviewer/admin only (enforced by the route). Separate from
// resolving the maintenance report.
export async function clearHold(
  registration: string,
  ctx: { userId: number; reason: string; reportId?: number },
): Promise<void> {
  await db.update(aircraftTable).set({ status: "active", note: null, updatedAt: new Date() })
    .where(eq(aircraftTable.registration, registration));
  if (ctx.reportId != null) {
    await db.update(maintenanceReportsTable)
      .set({ holdActive: false, clearedByUserId: ctx.userId, clearedAt: new Date(), clearReason: ctx.reason, updatedAt: new Date() })
      .where(eq(maintenanceReportsTable.id, ctx.reportId));
  }
  await logEvent({
    kind: "audit", severity: "info", actor: `user:${ctx.userId}`, agentKey: "maintenance",
    title: `${registration} hold cleared`, body: ctx.reason, refType: "aircraft", refId: registration,
  });
}

// Notify a pilot (and log). Reuses the in-app notifications; Discord handled by
// the comms agent elsewhere.
export async function notifyPilot(userId: number, title: string, body: string): Promise<void> {
  await notify(userId, "ops", title, body);
}
